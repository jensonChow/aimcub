import type { AimStore } from "@core/store";
import type {
  AimProgressReadModel,
  Evidence,
  Milestone,
  MilestoneCompletion,
  Run,
  RunEventType,
} from "@core/types";
import { routingOverrideForMilestone } from "@core/domain";
import {
  listLocalAgents,
  runLocalAgent,
  type LocalAgentDetection,
  type LocalAgentEvent,
  type LocalAgentId,
  type LocalAgentRunOptions,
  type LocalAgentRunResult,
} from "@core/local-agent";

export interface AimAgentRunInput {
  goalId: string;
  milestoneRef?: string;
  workspace: string;
  agentId?: LocalAgentId;
  model?: string;
  reasoning?: string;
  network?: boolean;
  readOnly?: boolean;
  onEvent?: (event: LocalAgentEvent) => void | Promise<void>;
}

export interface AimAgentRunResult {
  goalId: string;
  milestone: Milestone;
  agent: LocalAgentDetection;
  model: string;
  orchestrationRun: Run;
  run: LocalAgentRunResult;
  evidence: Evidence;
  completions: MilestoneCompletion[];
  progress: AimProgressReadModel | null;
}

export interface AimAgentRunDependencies {
  listLocalAgents: typeof listLocalAgents;
  runLocalAgent: (
    request: Parameters<typeof runLocalAgent>[0],
    options?: LocalAgentRunOptions,
  ) => Promise<LocalAgentRunResult>;
}

const defaultDependencies: AimAgentRunDependencies = {
  listLocalAgents,
  runLocalAgent,
};

function milestonePlanKey(milestone: Milestone): string {
  const key = milestone.metadata?.plan_key;
  return typeof key === "string" && key.trim() ? key.trim() : milestone.id;
}

function resolveMilestoneRef(ref: string, milestones: readonly Milestone[]): Milestone | null {
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
  row: AimProgressReadModel["milestones"][number],
  rows: readonly AimProgressReadModel["milestones"][number][],
): boolean {
  const dependencyId = row.milestone.depends_on_id;
  if (!dependencyId) return true;
  const dependency = rows.find((candidate) => candidate.milestone.id === dependencyId);
  return Boolean(dependency?.completed || dependency?.milestone.status === "skipped");
}

function selectableRow(
  row: AimProgressReadModel["milestones"][number],
  rows: readonly AimProgressReadModel["milestones"][number][],
): boolean {
  if (row.completed || row.milestone.status === "completed" || row.milestone.status === "skipped") return false;
  if (row.assignment?.actor_kind !== "agent") return false;
  if (!dependencyReady(row, rows)) return false;
  return row.latest_run?.status !== "queued" && row.latest_run?.status !== "running";
}

function chooseMilestone(
  progress: AimProgressReadModel,
  requestedRef?: string,
): AimProgressReadModel["milestones"][number] {
  const rows = [...progress.milestones].sort((a, b) => a.milestone.order_index - b.milestone.order_index);
  if (requestedRef) {
    const milestone = resolveMilestoneRef(requestedRef, rows.map((row) => row.milestone));
    if (!milestone) throw new Error(`No unique sub-aim matches "${requestedRef}".`);
    const row = rows.find((candidate) => candidate.milestone.id === milestone.id)!;
    if (row.completed || row.milestone.status === "completed" || row.milestone.status === "skipped") {
      throw new Error("The selected sub-aim is already complete or skipped.");
    }
    if (row.assignment?.actor_kind !== "agent") {
      throw new Error("The selected sub-aim is routed to a human, not a local agent.");
    }
    if (!dependencyReady(row, rows)) {
      throw new Error("The selected sub-aim is waiting for a prerequisite to complete.");
    }
    if (row.latest_run?.status === "queued" || row.latest_run?.status === "running") {
      throw new Error("The selected sub-aim already has an active run.");
    }
    return row;
  }

  const ready = rows.find((row) => selectableRow(row, rows) && !row.blocked && row.milestone.status !== "blocked");
  if (!ready) {
    throw new Error("No dependency-ready, agent-owned, incomplete sub-aim is available.");
  }
  return ready;
}

function chooseAgent(
  detections: readonly LocalAgentDetection[],
  requested: LocalAgentId | undefined,
  milestone: Milestone,
): LocalAgentDetection {
  const override = routingOverrideForMilestone(milestone);
  const routed = override?.owner === "agent" && (override.agent_id === "codex" || override.agent_id === "claude")
    ? override.agent_id
    : undefined;
  const selectedId = requested ?? routed;
  const ready = detections.filter((agent) => agent.available && agent.authStatus === "ok");
  const selected = selectedId
    ? detections.find((agent) => agent.id === selectedId)
    : ready.find((agent) => agent.id === "codex") ?? ready[0];
  if (!selected) throw new Error("No authenticated Codex or Claude CLI is available.");
  if (!selected.available) throw new Error(`${selected.name} is not installed or executable.`);
  if (selected.authStatus !== "ok") throw new Error(`${selected.name} is not authenticated.`);
  return selected;
}

function milestonePrompt(goal: AimProgressReadModel["goal"], milestone: Milestone): string {
  const contract = milestone.metadata?.decomposition_contract as Record<string, unknown> | undefined;
  const definition = typeof contract?.definition_of_done === "string" ? contract.definition_of_done : milestone.description;
  const requiredEvidence = Array.isArray(contract?.required_evidence)
    ? contract.required_evidence.filter((item): item is string => typeof item === "string").join("; ")
    : "";
  const evalSignal = typeof contract?.eval_signal === "string" ? contract.eval_signal : "";
  return [
    `Aim: ${goal.title}`,
    goal.description ? `Aim description: ${goal.description}` : "",
    `Sub-aim: ${milestone.title}`,
    milestone.description ? `Sub-aim description: ${milestone.description}` : "",
    definition ? `Definition of done: ${definition}` : "",
    requiredEvidence ? `Required evidence: ${requiredEvidence}` : "",
    evalSignal ? `Eval signal: ${evalSignal}` : "",
    "",
    "Work only on this sub-aim inside the provided workspace and permissions. Report concrete work, artifact paths, verification, blockers, and remaining work. Do not claim completion unless explicit evidence exists. Aimcub will evaluate completion separately.",
  ].filter(Boolean).join("\n");
}

function persistedRunEvent(event: LocalAgentEvent): { type: RunEventType; summary: string; payload: Record<string, unknown> } {
  const payload: Record<string, unknown> = {};
  if (event.sessionId) payload.session_id = event.sessionId;
  if (event.toolId) payload.tool_id = event.toolId;
  if (event.toolName) payload.tool_name = event.toolName;
  if (event.usage) payload.usage = event.usage;
  const summary = event.type === "agent.message.delta"
    ? "Agent response updated."
    : event.summary.slice(0, 1_000);
  if (event.type === "agent.tool.started") return { type: "tool.started", summary, payload };
  if (event.type === "agent.tool.finished") return { type: "tool.finished", summary, payload };
  return { type: "run.log", summary, payload: { ...payload, agent_event_type: event.type } };
}

export async function runAimAgent(
  store: AimStore,
  input: AimAgentRunInput,
  dependencies: AimAgentRunDependencies = defaultDependencies,
): Promise<AimAgentRunResult> {
  const progress = await store.getAimProgress(input.goalId);
  if (!progress) throw new Error(`Aim ${input.goalId} not found.`);
  const row = chooseMilestone(progress, input.milestoneRef);
  const detections = await dependencies.listLocalAgents();
  const agent = chooseAgent(detections, input.agentId, row.milestone);
  const override = routingOverrideForMilestone(row.milestone);
  const model = input.model?.trim()
    || (override?.owner === "agent" ? override.model?.trim() : "")
    || agent.models.find((candidate) => candidate.id !== "default")?.id
    || agent.models[0]?.id
    || "default";
  const sandbox = input.readOnly ? "read-only" : "workspace-write";
  const assignment = row.assignment;
  const orchestrationRun = await store.createRun({
    goalId: progress.goal.id,
    milestoneId: row.milestone.id,
    assignmentId: assignment?.id ?? null,
    actorKind: "agent",
    actorId: assignment?.actor_id ?? null,
    status: "running",
    workspaceRoot: input.workspace,
    sandbox,
    networkEnabled: Boolean(input.network),
    model,
    reasoning: input.reasoning?.trim() || null,
    summary: `${agent.name} started: ${row.milestone.title}`,
  });

  let run: LocalAgentRunResult;
  try {
    run = await dependencies.runLocalAgent({
      agentId: agent.id,
      prompt: milestonePrompt(progress.goal, row.milestone),
      cwd: input.workspace,
      model,
      reasoning: input.reasoning,
      permission: { sandbox, network: Boolean(input.network) },
    }, {
      onEvent: async (event) => {
        const persisted = persistedRunEvent(event);
        await store.appendRunEvent({ runId: orchestrationRun.id, ...persisted });
        await input.onEvent?.(event);
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await store.finishRun({ runId: orchestrationRun.id, status: "failed", summary: message, error: message });
    throw error;
  }

  let evidenceResult;
  try {
    evidenceResult = await store.addEvidence({
      goalId: progress.goal.id,
      milestoneId: row.milestone.id,
      kind: "mcp_report",
      emitterId: null,
      sourceEventId: `local-agent:${orchestrationRun.id}:result`,
      summary: run.ok
        ? `${agent.name} worked on: ${row.milestone.title}`
        : `${agent.name} failed on: ${row.milestone.title}`,
      payload: {
        agent_id: agent.id,
        model,
        workspace: input.workspace,
        command: run.command,
        args: run.args,
        ok: run.ok,
        output: run.outputText,
        events: run.events.map((event) => ({ type: event.type, summary: event.summary })),
        error: run.error,
        plan_key: milestonePlanKey(row.milestone),
      },
      trustScore: 0.6,
      runId: orchestrationRun.id,
      assignmentId: assignment?.id ?? null,
    });
    await store.finishRun({
      runId: orchestrationRun.id,
      status: run.ok ? "completed" : "failed",
      summary: run.ok
        ? `${agent.name} completed its run for: ${row.milestone.title}`
        : `${agent.name} failed its run for: ${row.milestone.title}`,
      error: run.error,
    });
    await store.sedimentContextFromGoal(progress.goal.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await store.finishRun({ runId: orchestrationRun.id, status: "failed", summary: message, error: message });
    throw error;
  }

  return {
    goalId: progress.goal.id,
    milestone: row.milestone,
    agent,
    model,
    orchestrationRun,
    run,
    evidence: evidenceResult.evidence,
    completions: evidenceResult.completions,
    progress: await store.getAimProgress(progress.goal.id),
  };
}
