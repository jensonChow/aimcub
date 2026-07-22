/**
 * The one run pipeline shared by every surface: select a sub-aim, select a runtime, enqueue a run,
 * execute it through the adapter engine, persist its normalized events, attribute low-trust
 * evidence, and finish the run. The CLI and the desktop main process used to carry near-identical
 * copies of this; both are now thin wrappers over the functions here.
 *
 * It lives beside the engine rather than in `@core/domain` because it is Node-shaped (it drives
 * child processes through `runLocalAgent`) and the purity kernel must stay platform-free. It never
 * writes completion: evidence is append-only and `evaluate()` remains the only completion
 * authority.
 */
import {
  AgentSelectionError,
  MilestoneSelectionError,
  NoRunnableMilestoneError,
} from "./errors";
import type {
  LocalAgentArtifact,
  LocalAgentArtifactKind,
  LocalAgentDetection,
  LocalAgentEvent,
  LocalAgentId,
  LocalAgentRunOptions,
  LocalAgentRunRequest,
  LocalAgentRunResult,
  LocalAgentSandboxMode,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Store port
//
// This package must not depend on `@core/store` — persistence depending on the runtime is the
// right direction, not the reverse — so the orchestrator states the SHAPE of the store it needs.
// `AimStore` satisfies it structurally, and the `Store*` aliases below recover the caller's own
// row types so a caller holding a full `AimStore` keeps `Run` / `Evidence` fidelity.
// ─────────────────────────────────────────────────────────────────────────────

export interface OrchestratorMilestone {
  id: string;
  title: string;
  description: string;
  status: string;
  order_index: number;
  depends_on_id: string | null;
  metadata: Record<string, unknown>;
}

export interface OrchestratorAssignment {
  id: string;
  milestone_id: string;
  actor_kind: string;
  actor_id: string | null;
}

export interface OrchestratorRun {
  id: string;
  goal_id: string;
  milestone_id: string;
  assignment_id: string | null;
  actor_id: string | null;
  status: string;
  attempt: number;
  workspace_root: string | null;
  sandbox: string | null;
  network_enabled: boolean;
  model: string | null;
  reasoning: string | null;
}

export interface OrchestratorProgress {
  goal: { id: string; title: string; description: string };
  milestones: readonly {
    milestone: OrchestratorMilestone;
    assignment: OrchestratorAssignment | null;
    latest_run: { status: string } | null;
    completed: boolean;
    blocked: boolean;
  }[];
}

export interface OrchestratorRunEvent {
  run_id: string;
  type: string;
  payload: Record<string, unknown>;
}

/** The run-event types the orchestrator itself writes — a subset of `RunEventType`. */
export type OrchestratorRunEventType =
  | "run.log"
  | "tool.started"
  | "tool.finished"
  | "artifact.created"
  | "evidence.reported";

export interface OrchestratorRunEventInput {
  runId: string;
  type: OrchestratorRunEventType;
  summary?: string;
  payload?: Record<string, unknown>;
}

export interface OrchestratorCreateRunInput {
  goalId: string;
  milestoneId: string;
  assignmentId?: string | null;
  actorKind: "agent";
  actorId?: string | null;
  status?: "queued";
  workspaceRoot?: string | null;
  sandbox?: string | null;
  networkEnabled?: boolean;
  model?: string | null;
  reasoning?: string | null;
  summary?: string;
  requestPayload?: Record<string, unknown>;
}

export interface RunOrchestratorStore {
  getAimProgress(goalId: string): Promise<OrchestratorProgress | null>;
  listRunEvents(goalId: string): Promise<readonly OrchestratorRunEvent[]>;
  listAssignments(goalId?: string | null): Promise<readonly OrchestratorAssignment[]>;
  createRun(input: OrchestratorCreateRunInput): Promise<OrchestratorRun>;
  claimNextQueuedRun(filter?: {
    goalId?: string | null;
    runId?: string;
    sandbox?: string | null;
  }): Promise<OrchestratorRun | null>;
  appendRunEvents(inputs: readonly OrchestratorRunEventInput[]): Promise<unknown>;
  finishRun(input: {
    runId: string;
    status: "completed" | "failed";
    summary?: string;
    error?: string | null;
  }): Promise<unknown>;
  addEvidence(input: {
    goalId: string;
    milestoneId?: string | null;
    kind: "mcp_report";
    emitterId?: string | null;
    sourceEventId?: string | null;
    summary?: string;
    payload?: Record<string, unknown>;
    trustScore?: number;
    runId?: string | null;
    assignmentId?: string | null;
  }): Promise<{ evidence: { id: string }; completions: readonly unknown[] }>;
  sedimentContextFromGoal(goalId: string): Promise<unknown>;
}

/** The caller's own run row type, recovered from the concrete store it passed in. */
export type StoreRun<TStore extends RunOrchestratorStore> = Awaited<ReturnType<TStore["createRun"]>>;
/** The caller's own evidence result type (evidence row + derived completion rows). */
export type StoreEvidenceResult<TStore extends RunOrchestratorStore> = Awaited<ReturnType<TStore["addEvidence"]>>;
/** The caller's own progress read model. */
export type StoreProgress<TStore extends RunOrchestratorStore> = NonNullable<Awaited<ReturnType<TStore["getAimProgress"]>>>;
/** One milestone row of the caller's own progress read model. */
export type StoreProgressRow<TStore extends RunOrchestratorStore> = StoreProgress<TStore>["milestones"][number];

// ─────────────────────────────────────────────────────────────────────────────
// Injected engine + domain functions
// ─────────────────────────────────────────────────────────────────────────────

/** The routing override a sub-aim carries, as read by `@core/domain`'s validated reader. */
export interface OrchestratorRoutingOverride {
  owner: "agent" | "human";
  agent_id?: string | null;
  model?: string | null;
}

export interface RunOrchestratorDependencies {
  listLocalAgents: () => Promise<LocalAgentDetection[]>;
  runLocalAgent: (request: LocalAgentRunRequest, options?: LocalAgentRunOptions) => Promise<LocalAgentRunResult>;
  /**
   * `routingOverrideForMilestone` from `@core/domain`. Injected rather than imported so this
   * package keeps its single `@core/llm` dependency and the validated reader stays the one
   * source of truth for what a routing override means.
   */
  routingOverrideForMilestone: (milestone: { metadata: Record<string, unknown> }) => OrchestratorRoutingOverride | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Selection
// ─────────────────────────────────────────────────────────────────────────────

function milestonePlanKey(milestone: OrchestratorMilestone): string {
  const key = milestone.metadata?.plan_key;
  return typeof key === "string" && key.trim() ? key.trim() : milestone.id;
}

function resolveMilestoneRef(ref: string, milestones: readonly OrchestratorMilestone[]): OrchestratorMilestone | null {
  const asIndex = Number(ref);
  if (Number.isInteger(asIndex) && asIndex >= 1 && asIndex <= milestones.length) {
    return milestones[asIndex - 1] ?? null;
  }
  const exact = milestones.find((milestone) => milestone.id === ref);
  if (exact) return exact;
  const matches = milestones.filter((milestone) => milestone.id.startsWith(ref));
  return matches.length === 1 ? matches[0] ?? null : null;
}

function dependencyReady(
  row: OrchestratorProgress["milestones"][number],
  rows: readonly OrchestratorProgress["milestones"][number][],
): boolean {
  const dependencyId = row.milestone.depends_on_id;
  if (!dependencyId) return true;
  const dependency = rows.find((candidate) => candidate.milestone.id === dependencyId);
  return Boolean(dependency?.completed || dependency?.milestone.status === "skipped");
}

function selectableRow(
  row: OrchestratorProgress["milestones"][number],
  rows: readonly OrchestratorProgress["milestones"][number][],
): boolean {
  if (row.completed || row.milestone.status === "completed" || row.milestone.status === "skipped") return false;
  if (row.assignment?.actor_kind !== "agent") return false;
  if (!dependencyReady(row, rows)) return false;
  // A queued or running sibling already owns this sub-aim: never enqueue it twice.
  return row.latest_run?.status !== "queued" && row.latest_run?.status !== "running";
}

/**
 * The next sub-aim to run: the caller's explicit reference if given, otherwise the first
 * dependency-ready, agent-owned, unblocked, incomplete one in plan order. Throws with a
 * user-facing reason when nothing qualifies — a selection error is a config error, not a run
 * failure a queue should retry.
 */
export function chooseMilestone(
  progress: OrchestratorProgress,
  requestedRef?: string,
  options: { excludeMilestoneIds?: readonly string[] } = {},
): OrchestratorProgress["milestones"][number] {
  const rows = [...progress.milestones].sort((a, b) => a.milestone.order_index - b.milestone.order_index);
  if (requestedRef) {
    const milestone = resolveMilestoneRef(requestedRef, rows.map((row) => row.milestone));
    if (!milestone) {
      throw new MilestoneSelectionError("milestone_not_found", `No unique sub-aim matches "${requestedRef}".`);
    }
    const row = rows.find((candidate) => candidate.milestone.id === milestone.id)!;
    if (row.completed || row.milestone.status === "completed" || row.milestone.status === "skipped") {
      throw new MilestoneSelectionError("milestone_already_done", "The selected sub-aim is already complete or skipped.");
    }
    if (row.assignment?.actor_kind !== "agent") {
      throw new MilestoneSelectionError("milestone_human_owned", "The selected sub-aim is routed to a human, not a local agent.");
    }
    if (!dependencyReady(row, rows)) {
      throw new MilestoneSelectionError(
        "milestone_dependency_pending",
        "The selected sub-aim is waiting for a prerequisite to complete.",
      );
    }
    if (row.latest_run?.status === "queued" || row.latest_run?.status === "running") {
      throw new MilestoneSelectionError("milestone_active_run", "The selected sub-aim already has an active run.");
    }
    return row;
  }

  // A finished run does NOT complete a sub-aim — `evaluate()` does — so a sub-aim stays selectable
  // after a run. `excludeMilestoneIds` is how a sweeping caller says "I already tried that one",
  // which is what stops a sweep from running the same sub-aim forever.
  const excluded = new Set(options.excludeMilestoneIds ?? []);
  const ready = rows.find((row) => (
    selectableRow(row, rows)
    && !excluded.has(row.milestone.id)
    && !row.blocked
    && row.milestone.status !== "blocked"
  ));
  if (!ready) throw new NoRunnableMilestoneError();
  return ready;
}

/**
 * The single cast in this module. The store port describes rows structurally; the store actually
 * returns its own richer types, which the `Store*` aliases recover for the caller. TypeScript
 * cannot see through the port to prove that, so it is asserted here once, in one place.
 */
function asStoreRow<TStore extends RunOrchestratorStore>(
  row: OrchestratorProgress["milestones"][number],
): StoreProgressRow<TStore> {
  return row as unknown as StoreProgressRow<TStore>;
}

/**
 * The runtime that will execute a sub-aim: an explicit request wins, then the plan's routing
 * override, then the first available authenticated detection (registration order IS preference
 * order). An override naming an unregistered runtime falls through to the default pick rather
 * than failing the run.
 */
export function chooseAgent(
  detections: readonly LocalAgentDetection[],
  requested: LocalAgentId | undefined,
  override: OrchestratorRoutingOverride | null,
): LocalAgentDetection {
  const routedId = override?.owner === "agent" ? override.agent_id : null;
  const routed = routedId && detections.some((agent) => agent.id === routedId) ? routedId : undefined;
  const selectedId = requested ?? routed;
  if (!selectedId) {
    const ready = detections.find((agent) => agent.available && agent.authStatus === "ok");
    if (!ready) throw new AgentSelectionError("no_ready_agent", "No authenticated local agent CLI is available.");
    return ready;
  }
  const selected = detections.find((agent) => agent.id === selectedId);
  if (!selected) {
    throw new AgentSelectionError(
      "unknown_agent",
      `Unknown local agent "${selectedId}". Registered agents: ${detections.map((agent) => agent.id).join(", ")}.`,
      selectedId,
    );
  }
  if (!selected.available) {
    throw new AgentSelectionError("agent_not_installed", `${selected.name} is not installed or executable.`, selected.id);
  }
  if (selected.authStatus !== "ok") {
    throw new AgentSelectionError("agent_not_authenticated", `${selected.name} is not authenticated.`, selected.id);
  }
  return selected;
}

export function milestonePrompt(
  goal: { title: string; description: string },
  milestone: OrchestratorMilestone,
  options: { workspace?: string | null; instruction?: string | null } = {},
): string {
  const contract = milestone.metadata?.decomposition_contract as Record<string, unknown> | undefined;
  const definition = typeof contract?.definition_of_done === "string" ? contract.definition_of_done : milestone.description;
  const requiredEvidence = Array.isArray(contract?.required_evidence)
    ? contract.required_evidence.filter((item): item is string => typeof item === "string").join("; ")
    : "";
  const evalSignal = typeof contract?.eval_signal === "string" ? contract.eval_signal : "";
  const scope = options.workspace
    ? "Work only on this sub-aim inside the provided workspace and permissions."
    : "Work only on this sub-aim, as far as the granted local runtime permissions allow.";
  return [
    `Aim: ${goal.title}`,
    goal.description ? `Aim description: ${goal.description}` : "",
    `Sub-aim: ${milestone.title}`,
    milestone.description ? `Sub-aim description: ${milestone.description}` : "",
    definition ? `Definition of done: ${definition}` : "",
    requiredEvidence ? `Required evidence: ${requiredEvidence}` : "",
    evalSignal ? `Eval signal: ${evalSignal}` : "",
    options.instruction?.trim() ? `User instruction: ${options.instruction.trim()}` : "",
    "",
    `${scope} Report concrete work, artifact paths, verification, blockers, and remaining work. Do not claim completion unless explicit evidence exists. Aimcub will evaluate completion separately.`,
  ].filter(Boolean).join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Raw retention
//
// The runtime's own payload is the only record of what actually happened inside a tool call, so
// it is worth keeping — but a chatty runtime can emit megabytes of it, and the store is one JSON
// file. Retention is therefore capped twice: per event, and per run. Summaries are never capped;
// a capped event still persists, it just loses (part of) its raw payload and says so.
// ─────────────────────────────────────────────────────────────────────────────

/** Per-event cap on retained raw payload, in serialized-JSON characters (~8 KB). */
export const RUN_EVENT_RAW_CHAR_CAP = 8_192;
/** Per-run budget for retained raw payloads, in serialized-JSON characters (~256 KB). */
export const RUN_RAW_CHAR_BUDGET = 262_144;

function serializeRaw(raw: unknown): string | null {
  try {
    const json = JSON.stringify(raw);
    return typeof json === "string" ? json : null;
  } catch {
    return null;
  }
}

/**
 * One run's raw-retention budget. Stateful by design: the per-run cap can only be enforced across
 * events, so the same instance travels with a run from its first event to its last.
 */
export class RunRawRetention {
  private used = 0;

  /** Add `raw` to `payload` if the caps allow it; otherwise mark why it is not there. */
  apply(raw: unknown, payload: Record<string, unknown>): void {
    if (raw === undefined) return;
    const json = serializeRaw(raw);
    if (json === null) {
      payload.raw_omitted = "unserializable";
      return;
    }
    const retained = Math.min(json.length, RUN_EVENT_RAW_CHAR_CAP);
    if (this.used + retained > RUN_RAW_CHAR_BUDGET) {
      payload.raw_omitted = "run_budget";
      return;
    }
    this.used += retained;
    if (json.length > RUN_EVENT_RAW_CHAR_CAP) {
      payload.raw_truncated = true;
      payload.raw_chars = json.length;
      payload.raw_preview = json.slice(0, RUN_EVENT_RAW_CHAR_CAP);
      return;
    }
    payload.raw = raw;
  }
}

/**
 * Normalize one engine event into the persisted run-event shape. Pass the run's
 * {@link RunRawRetention} to enforce the per-run raw budget across its events; called without
 * one, each event gets a fresh budget and only the per-event cap applies.
 */
export function persistedRunEvent(event: LocalAgentEvent, retention: RunRawRetention = new RunRawRetention()): {
  type: OrchestratorRunEventType;
  summary: string;
  payload: Record<string, unknown>;
} {
  const payload: Record<string, unknown> = {};
  if (event.sessionId) payload.session_id = event.sessionId;
  if (event.toolId) payload.tool_id = event.toolId;
  if (event.toolName) payload.tool_name = event.toolName;
  if (event.usage) payload.usage = event.usage;
  retention.apply(event.raw, payload);
  const summary = event.type === "agent.message.delta"
    ? "Agent response updated."
    : event.summary.slice(0, 1_000);
  if (event.type === "agent.tool.started") return { type: "tool.started", summary, payload };
  if (event.type === "agent.tool.finished") return { type: "tool.finished", summary, payload };
  return { type: "run.log", summary, payload: { ...payload, agent_event_type: event.type } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Artifacts
// ─────────────────────────────────────────────────────────────────────────────

const ARTIFACT_VERB: Readonly<Record<LocalAgentArtifactKind, string>> = {
  file_write: "Wrote",
  file_edit: "Edited",
  file_delete: "Deleted",
};

/** One file's work in a run: which operations touched it, and how often. */
export interface RunArtifactSummary {
  path: string;
  kinds: LocalAgentArtifactKind[];
  /** How many events touched this path, including the one that first announced it. */
  touches: number;
}

/** Normalize one reported artifact into the persisted `artifact.created` shape. */
export function persistedArtifactEvent(event: LocalAgentEvent, artifact: LocalAgentArtifact): {
  type: OrchestratorRunEventType;
  summary: string;
  payload: Record<string, unknown>;
} {
  return {
    type: "artifact.created",
    summary: `${ARTIFACT_VERB[artifact.kind]} ${artifact.path}`.slice(0, 1_000),
    payload: {
      path: artifact.path,
      kind: artifact.kind,
      ...(event.toolId ? { tool_id: event.toolId } : {}),
      ...(event.toolName ? { tool_name: event.toolName } : {}),
      source_event_type: event.type,
    },
  };
}

/**
 * Tracks the files one run touched. A run event is append-only history, so a path touched thirty
 * times gets ONE `artifact.created` (the first touch) rather than thirty events or a rewritten
 * one; the repeat count survives on the run's evidence through {@link RunArtifactLedger.summary}.
 */
export class RunArtifactLedger {
  private readonly announced = new Set<string>();
  private readonly touched = new Map<string, RunArtifactSummary>();

  /** Record the event's artifacts; returns only the ones not yet announced for this run. */
  record(event: LocalAgentEvent): LocalAgentArtifact[] {
    const fresh: LocalAgentArtifact[] = [];
    for (const artifact of event.artifacts ?? []) {
      if (!artifact.path) continue;
      const entry = this.touched.get(artifact.path);
      if (!entry) {
        this.touched.set(artifact.path, { path: artifact.path, kinds: [artifact.kind], touches: 1 });
      } else {
        entry.touches += 1;
        if (!entry.kinds.includes(artifact.kind)) entry.kinds.push(artifact.kind);
      }
      const key = `${artifact.path} ${artifact.kind}`;
      if (this.announced.has(key)) continue;
      this.announced.add(key);
      fresh.push(artifact);
    }
    return fresh;
  }

  /** Every path this run touched, in first-touch order. */
  summary(): RunArtifactSummary[] {
    return [...this.touched.values()].map((entry) => ({ ...entry, kinds: [...entry.kinds] }));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Event buffering
// ─────────────────────────────────────────────────────────────────────────────

const EVENT_FLUSH_INTERVAL_MS = 250;
/** Structurally meaningful boundaries: flush so a crash never loses a tool step or a verdict. */
const FLUSH_AT: ReadonlySet<LocalAgentEvent["type"]> = new Set([
  "agent.tool.started",
  "agent.tool.finished",
  "agent.run.completed",
  "agent.run.failed",
]);

/**
 * Batches persisted run events. One `appendRunEvents` costs a full lock→load→save cycle, so a
 * chatty runtime writing one event at a time would thrash the store; this holds events until a
 * structural boundary or {@link EVENT_FLUSH_INTERVAL_MS}, whichever comes first. Order is always
 * preserved, and by the time a run finishes every event is on disk — callers assert the end
 * state, never the flush cadence.
 */
class RunEventBuffer {
  private pending: OrchestratorRunEventInput[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private chain: Promise<void> = Promise.resolve();
  private failure: Error | null = null;
  private readonly retention = new RunRawRetention();
  private readonly ledger = new RunArtifactLedger();

  constructor(private readonly store: RunOrchestratorStore, private readonly runId: string) {}

  async push(event: LocalAgentEvent): Promise<void> {
    // Surface a previous flush failure on the engine's own callback path, so a broken store
    // still classifies as `event_callback_error` mid-run instead of silently dropping events.
    if (this.failure) throw this.failure;
    this.pending.push({ runId: this.runId, ...persistedRunEvent(event, this.retention) });
    // An artifact event follows the event that produced it, so the journal reads in causal order.
    for (const artifact of this.ledger.record(event)) {
      this.pending.push({ runId: this.runId, ...persistedArtifactEvent(event, artifact) });
    }
    if (FLUSH_AT.has(event.type)) {
      await this.flush();
      return;
    }
    this.arm();
  }

  /** Every file this run touched, for the evidence payload. */
  artifacts(): RunArtifactSummary[] {
    return this.ledger.summary();
  }

  private arm(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, EVENT_FLUSH_INTERVAL_MS);
    this.timer.unref?.();
  }

  /** Drain everything buffered so far; resolves once the store has it. */
  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.chain = this.chain
      .then(async () => {
        const batch = this.pending;
        if (batch.length === 0) return;
        this.pending = [];
        await this.store.appendRunEvents(batch);
      })
      .catch((error: unknown) => {
        this.failure ??= error instanceof Error ? error : new Error(String(error));
      });
    return this.chain;
  }

  /** Flush and rethrow whatever the store refused, so a lost event never passes for success. */
  async settle(): Promise<void> {
    await this.flush();
    if (this.failure) throw this.failure;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Enqueue
// ─────────────────────────────────────────────────────────────────────────────

/** The surface that queued a run — provenance only, never a claim gate (sandbox is). */
export type RunSurface = "desktop" | "cli";

/** What a queued run carries on its `run.queued` event so any worker can execute it later. */
export interface QueuedRunRequest {
  agent_id: LocalAgentId;
  instruction?: string;
  /** 1 for the first try; a retry re-enqueues with the next number and `retry_of` set. */
  attempt: number;
  retry_of?: string;
  /**
   * Which surface created this run. Additive and optional: a row queued before this field existed
   * simply reads back without one — {@link queuedRunRequest} degrades it to absent, not an error,
   * and nothing that claims or executes a run may require it.
   */
  surface?: RunSurface;
}

export interface EnqueueMilestoneRunInput {
  goalId: string;
  /** Index, id, or unique id prefix. Omitted = the next dependency-ready agent-owned sub-aim. */
  milestoneRef?: string;
  workspace?: string | null;
  sandbox: LocalAgentSandboxMode;
  network: boolean;
  agentId?: LocalAgentId;
  model?: string;
  reasoning?: string;
  instruction?: string;
  /** Sub-aims the automatic pick must skip — how a sweep avoids re-running what it already tried. */
  excludeMilestoneIds?: readonly string[];
  /** Set by the retry path; never by a caller. */
  attempt?: number;
  retryOf?: string;
  /** Which surface is enqueuing this run — provenance for diagnostics/timeline, not a permission. */
  surface?: RunSurface;
}

export interface EnqueuedRun<TStore extends RunOrchestratorStore> {
  run: StoreRun<TStore>;
  progress: StoreProgress<TStore>;
  row: StoreProgressRow<TStore>;
  agent: LocalAgentDetection;
  model: string;
}

/**
 * Put one sub-aim on the queue: pick the sub-aim and the runtime, then create a `queued` run bound
 * to the milestone and its assignment. Selection failures throw here, before anything is
 * persisted, so the queue only ever holds runs that were executable when they were accepted.
 */
export async function enqueueMilestoneRun<TStore extends RunOrchestratorStore>(
  store: TStore,
  input: EnqueueMilestoneRunInput,
  dependencies: RunOrchestratorDependencies,
): Promise<EnqueuedRun<TStore>> {
  const progress = await store.getAimProgress(input.goalId);
  if (!progress) throw new Error(`Aim ${input.goalId} not found.`);
  const milestoneRow = chooseMilestone(progress, input.milestoneRef, {
    ...(input.excludeMilestoneIds ? { excludeMilestoneIds: input.excludeMilestoneIds } : {}),
  });
  const override = dependencies.routingOverrideForMilestone(milestoneRow.milestone);
  const detections = await dependencies.listLocalAgents();
  const agent = chooseAgent(detections, input.agentId, override);
  const model = input.model?.trim()
    || (override?.owner === "agent" ? override.model?.trim() : "")
    || agent.models.find((candidate) => candidate.id !== "default")?.id
    || agent.models[0]?.id
    || "default";
  const assignment = milestoneRow.assignment;
  const request: QueuedRunRequest = {
    agent_id: agent.id,
    ...(input.instruction?.trim() ? { instruction: input.instruction.trim() } : {}),
    attempt: input.attempt ?? 1,
    ...(input.retryOf ? { retry_of: input.retryOf } : {}),
    ...(input.surface ? { surface: input.surface } : {}),
  };
  const run = await store.createRun({
    goalId: progress.goal.id,
    milestoneId: milestoneRow.milestone.id,
    assignmentId: assignment?.id ?? null,
    actorKind: "agent",
    actorId: assignment?.actor_id ?? null,
    status: "queued",
    workspaceRoot: input.workspace ?? null,
    sandbox: input.sandbox,
    networkEnabled: input.network,
    model,
    reasoning: input.reasoning?.trim() || null,
    summary: `${agent.name} queued: ${milestoneRow.milestone.title}`,
    requestPayload: { ...request },
  });
  return {
    run: run as StoreRun<TStore>,
    progress: progress as StoreProgress<TStore>,
    row: asStoreRow<TStore>(milestoneRow),
    agent,
    model,
  };
}

/** Read back the queue request a run was enqueued with. Missing/legacy payloads degrade to `{}`. */
export async function queuedRunRequest(
  store: RunOrchestratorStore,
  run: OrchestratorRun,
): Promise<Partial<QueuedRunRequest>> {
  const events = await store.listRunEvents(run.goal_id);
  const queued = events.find((event) => event.run_id === run.id && event.type === "run.queued");
  const payload = queued?.payload ?? {};
  return {
    ...(typeof payload.agent_id === "string" ? { agent_id: payload.agent_id } : {}),
    ...(typeof payload.instruction === "string" ? { instruction: payload.instruction } : {}),
    ...(typeof payload.attempt === "number" ? { attempt: payload.attempt } : {}),
    ...(typeof payload.retry_of === "string" ? { retry_of: payload.retry_of } : {}),
    ...(payload.surface === "desktop" || payload.surface === "cli" ? { surface: payload.surface } : {}),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Execute
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecuteQueuedRunOptions {
  /** Every normalized engine event, live — the CLI's `--jsonl` stream and the cockpit push channel. */
  onEvent?: (event: LocalAgentEvent) => void | Promise<void>;
  /** Aborting settles the engine with failure code "canceled"; the run finishes failed. */
  signal?: AbortSignal;
}

export interface ExecutedRun<TStore extends RunOrchestratorStore> {
  run: StoreRun<TStore>;
  row: StoreProgressRow<TStore>;
  agent: LocalAgentDetection;
  model: string;
  result: LocalAgentRunResult;
  evidence: StoreEvidenceResult<TStore>["evidence"];
  completions: StoreEvidenceResult<TStore>["completions"];
  request: Partial<QueuedRunRequest>;
  progress: StoreProgress<TStore> | null;
}

/**
 * Execute one already-claimed (`running`) run to a terminal state. The claimed row is the whole
 * instruction set — workspace, sandbox, network, model, reasoning come off the run itself, and the
 * chosen runtime comes off its queue request — so a run enqueued by one process executes
 * identically in another.
 */
export async function executeQueuedRun<TStore extends RunOrchestratorStore>(
  store: TStore,
  claimed: StoreRun<TStore>,
  options: ExecuteQueuedRunOptions,
  dependencies: RunOrchestratorDependencies,
): Promise<ExecutedRun<TStore>> {
  const run = claimed as unknown as OrchestratorRun;
  const progress = await store.getAimProgress(run.goal_id);
  if (!progress) {
    await store.finishRun({ runId: run.id, status: "failed", summary: `Aim ${run.goal_id} not found.`, error: `Aim ${run.goal_id} not found.` });
    throw new Error(`Aim ${run.goal_id} not found.`);
  }
  const row = progress.milestones.find((candidate) => candidate.milestone.id === run.milestone_id);
  if (!row) {
    const message = `Milestone ${run.milestone_id} not found on aim ${run.goal_id}.`;
    await store.finishRun({ runId: run.id, status: "failed", summary: message, error: message });
    throw new Error(message);
  }

  const request = await queuedRunRequest(store, run);
  const override = dependencies.routingOverrideForMilestone(row.milestone);
  let agent: LocalAgentDetection;
  try {
    const detections = await dependencies.listLocalAgents();
    agent = chooseAgent(detections, request.agent_id, override);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await store.finishRun({ runId: run.id, status: "failed", summary: message, error: message });
    throw error;
  }
  const model = run.model?.trim() || agent.models[0]?.id || "default";
  const sandbox = (run.sandbox ?? "read-only") as LocalAgentSandboxMode;
  const buffer = new RunEventBuffer(store, run.id);

  let result: LocalAgentRunResult;
  try {
    result = await dependencies.runLocalAgent({
      agentId: agent.id,
      prompt: milestonePrompt(progress.goal, row.milestone, {
        workspace: run.workspace_root,
        instruction: request.instruction,
      }),
      ...(run.workspace_root ? { cwd: run.workspace_root } : {}),
      model,
      ...(run.reasoning ? { reasoning: run.reasoning } : {}),
      permission: { sandbox, network: run.network_enabled },
    }, {
      onEvent: async (event) => {
        await buffer.push(event);
        await options.onEvent?.(event);
      },
      ...(options.signal ? { signal: options.signal } : {}),
    });
    await buffer.settle();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await buffer.flush();
    await store.finishRun({ runId: run.id, status: "failed", summary: message, error: message });
    throw error;
  }

  try {
    const artifacts = buffer.artifacts();
    const evidenceResult = await store.addEvidence({
      goalId: progress.goal.id,
      milestoneId: row.milestone.id,
      kind: "mcp_report",
      emitterId: null,
      sourceEventId: `local-agent:${run.id}:result`,
      summary: result.ok
        ? `${agent.name} worked on: ${row.milestone.title}`
        : `${agent.name} failed on: ${row.milestone.title}`,
      payload: {
        agent_id: agent.id,
        model,
        ...(run.workspace_root ? { workspace: run.workspace_root } : {}),
        command: result.command,
        args: result.args,
        ok: result.ok,
        output: result.outputText,
        events: result.events.map((event) => ({ type: event.type, summary: event.summary })),
        // The run's file-level work product, so eval can weigh claims against what was touched.
        artifacts,
        error: result.error,
        plan_key: milestonePlanKey(row.milestone),
      },
      trustScore: 0.6,
      runId: run.id,
      assignmentId: row.assignment?.id ?? run.assignment_id ?? null,
    });
    // Evidence creation belongs in the run's own timeline; the evidence row stays the record of
    // record, this event is the pointer to it.
    await store.appendRunEvents([{
      runId: run.id,
      type: "evidence.reported",
      summary: `${agent.name} reported evidence for: ${row.milestone.title}`,
      payload: {
        evidence_id: evidenceResult.evidence.id,
        kind: "mcp_report",
        trust_score: 0.6,
        milestone_id: row.milestone.id,
        artifact_count: artifacts.length,
        completion_count: evidenceResult.completions.length,
      },
    }]);
    await store.finishRun({
      runId: run.id,
      status: result.ok ? "completed" : "failed",
      summary: result.ok
        ? `${agent.name} completed its run for: ${row.milestone.title}`
        : `${agent.name} failed its run for: ${row.milestone.title}`,
      error: result.error,
    });
    await store.sedimentContextFromGoal(progress.goal.id);
    return {
      run: claimed,
      row: asStoreRow<TStore>(row),
      agent,
      model,
      result,
      evidence: evidenceResult.evidence as StoreEvidenceResult<TStore>["evidence"],
      completions: evidenceResult.completions as StoreEvidenceResult<TStore>["completions"],
      request,
      progress: (await store.getAimProgress(progress.goal.id)) as StoreProgress<TStore> | null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await store.finishRun({ runId: run.id, status: "failed", summary: message, error: message });
    throw error;
  }
}
