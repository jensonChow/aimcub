/**
 * @core/store — platform-neutral local persistence for aims/milestones/memories.
 *
 * One JSON file under a data directory that BOTH the desktop app and the CLI point at
 * (default ~/.aimcub), so a person's aims are one set of rows with two faces. Shapes reuse
 * @core/types 1:1 so a later Supabase sync is transform-free.
 *
 * The {@link AimStore} interface is ASYNC on purpose: the current implementation
 * ({@link createJsonFileStore}) does synchronous fs under the hood, but a future Supabase
 * adapter is genuinely async — coding to the async interface now means swapping adapters
 * later is a one-line change at call sites, not a rewrite (the "design for C" decision).
 *
 * This package is NOT in the purity-guarded kernel (that is only @core/domain + @core/types),
 * so it may do node fs/os/path/crypto I/O. @core/domain must never import this.
 */
import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  attributeEvidence,
  buildAimProgressReadModel,
  decideContextIntakeSession,
  deriveContextCandidatesFromWork,
  evaluate,
  inferContextCategory,
  isPromptLikeContextCandidate,
  planMerge,
  routeMilestones,
  validatePlan,
} from "@core/domain";
// DecompositionOutput is imported as a VALUE (the Zod schema) so the store can re-validate
// the SHAPE of any plan it is asked to persist — the gatekeeper for untrusted input.
import { AcceptanceRule, AimDraft, DecompositionOutput, ManualEvidencePayload } from "@core/types";
import type {
  ContextCategory,
  Actor,
  ActorKind,
  AgentRunMode,
  AimDraft as AimDraftRow,
  AimDraftAnswer,
  AimDraftPhase,
  AimDraftQuestion,
  AimDraftSaveBlock,
  AimDraftStage,
  AimDraftStatus,
  AimDraftSurface,
  AimProgressReadModel,
  Assignment,
  AssignmentSource,
  AssignmentStatus,
  ContextIntakeSession,
  EvidenceAttribution,
  Evidence,
  EvidenceKind,
  Goal,
  GoalDomain,
  Memory,
  MemoryKind,
  Milestone,
  MilestoneCompletion,
  MilestoneStatus,
  ManualEvidenceRequiredItem,
  PlanNode,
  Run,
  RunEvent,
  RunEventType,
  RunStatus,
  SubAimRelation,
  ToolTrace,
  ToolTraceStatus,
} from "@core/types";

/** Fixed local owner for the single-user local app (matches the web demo owner). */
export const DEFAULT_OWNER = "00000000-0000-4000-8000-000000000001";

/** The on-disk shape. */
export interface LocalStore {
  ownerId: string;
  goals: Goal[];
  aimDrafts: AimDraftRow[];
  milestonesByGoal: Record<string, Milestone[]>;
  memories: Memory[];
  evidence: Evidence[];
  completions: MilestoneCompletion[];
  actors: Actor[];
  subAimRelations: SubAimRelation[];
  assignments: Assignment[];
  runs: Run[];
  runEvents: RunEvent[];
  toolTraces: ToolTrace[];
  evidenceAttributions: EvidenceAttribution[];
  contextIntakeSessions: ContextIntakeSession[];
}

/** A memory to persist alongside a new goal (e.g. derived from clarifying answers). */
export interface NewMemory {
  content: string;
  /** Defaults to `semantic`. */
  kind?: MemoryKind;
  /** Defaults from the text prefix, then `project_fact`. */
  category?: ContextCategory;
  /** Defaults to `1`. */
  confidence?: number;
  /** Defaults to `user_stated`. */
  source?: Memory["source"];
}

export interface CreateGoalInput {
  ownerId?: string;
  title: string;
  description?: string;
  domain?: GoalDomain;
  metadata?: Record<string, unknown>;
  parentGoalId?: string;
  parentMilestoneId?: string;
  /** The validated decomposition; milestones are materialized from it. */
  plan: DecompositionOutput;
  memories?: NewMemory[];
}

/** Re-plan an existing aim: swap in a new decomposition while preserving finished work. */
export interface UpdateGoalInput {
  id: string;
  /** Optional rename; omitted/blank keeps the current title. */
  title?: string;
  /** Optional new description; omitted keeps the current one (`""` clears it). */
  description?: string;
  /** Optional metadata patch merged into the existing goal metadata. */
  metadata?: Record<string, unknown>;
  /** The new decomposition; merged via `planMerge` (completed milestones frozen). */
  plan: DecompositionOutput;
}

export interface UpsertAimDraftInput {
  id?: string;
  ownerId?: string;
  title?: string;
  description?: string;
  parentGoalId?: string | null;
  parentMilestoneId?: string | null;
  currentStage?: AimDraftStage;
  phase?: AimDraftPhase;
  status?: AimDraftStatus;
  aimSurface?: AimDraftSurface;
  contextNote?: string;
  intakeQuestions?: AimDraftQuestion[];
  intakeAnswers?: AimDraftAnswer[];
  clarifyQuestions?: AimDraftQuestion[];
  clarifyAnswers?: AimDraftAnswer[];
  clarifyAssumptions?: AimDraftRow["clarify_assumptions"];
  draftPlan?: DecompositionOutput | null;
  finalPlan?: DecompositionOutput | null;
  saveBlock?: AimDraftSaveBlock | null;
}

export interface AddEvidenceInput {
  ownerId?: string;
  goalId: string;
  milestoneId?: string | null;
  emitterId?: string | null;
  kind: EvidenceKind;
  sourceEventId?: string | null;
  occurredAt?: string;
  summary?: string;
  payload?: Record<string, unknown>;
  trustScore?: number;
  runId?: string | null;
  assignmentId?: string | null;
}

export interface AddEvidenceResult {
  evidence: Evidence;
  /** True when the idempotency key already existed and no new row was appended. */
  deduped: boolean;
  /** Completion rows created by evaluating the affected milestone(s). */
  completions: MilestoneCompletion[];
}

export interface ConfirmMilestoneInput {
  goalId: string;
  milestoneId: string;
  ownerId?: string;
  summary?: string;
  proofNote?: string;
  urls?: string[];
  filePaths?: string[];
  requiredEvidence?: ManualEvidenceRequiredItem[];
}

export interface ConfirmMilestoneResult {
  evidence: Evidence | null;
  completion: MilestoneCompletion | null;
  alreadyCompleted: boolean;
}

export interface AddMemoryInput extends NewMemory {
  ownerId?: string;
  goalId?: string | null;
}

export interface AddMemoryCandidateInput extends NewMemory {
  ownerId?: string;
  goalId?: string | null;
}

export interface AcceptMemoryCandidateInput {
  id: string;
  content?: string;
  kind?: MemoryKind;
  category?: ContextCategory;
  confidence?: number;
  source?: Memory["source"];
  /** Omit to keep the candidate's current scope; null promotes it to global context. */
  goalId?: string | null;
}

export interface DeprioritizeMemoryInput {
  id: string;
  /** Defaults to 0.5, below the planning selection threshold. */
  confidence?: number;
}

export interface ImportStoreResult {
  goals: number;
  aimDrafts: number;
  milestones: number;
  memories: number;
  evidence: number;
  completions: number;
  actors: number;
  subAimRelations: number;
  assignments: number;
  runs: number;
  runEvents: number;
  toolTraces: number;
  evidenceAttributions: number;
  contextIntakeSessions: number;
}

export interface AddActorInput {
  ownerId?: string;
  kind: ActorKind;
  displayName: string;
  capabilities?: string[];
  userId?: string | null;
  agentKind?: string;
  runMode?: AgentRunMode;
  model?: string | null;
  connectionRef?: string | null;
}

export interface AssignMilestoneInput {
  ownerId?: string;
  goalId: string;
  milestoneId: string;
  actorKind: ActorKind;
  actorId?: string | null;
  status?: AssignmentStatus;
  source?: AssignmentSource;
  reason?: string;
  capabilityTags?: string[];
}

export interface CreateRunInput {
  ownerId?: string;
  goalId: string;
  milestoneId: string;
  assignmentId?: string | null;
  actorKind: ActorKind;
  actorId?: string | null;
  status?: RunStatus;
  workspaceRoot?: string | null;
  sandbox?: string | null;
  networkEnabled?: boolean;
  model?: string | null;
  reasoning?: string | null;
  summary?: string;
}

export interface AppendRunEventInput {
  ownerId?: string;
  runId: string;
  type: RunEventType;
  summary?: string;
  payload?: Record<string, unknown>;
}

export interface FinishRunInput {
  runId: string;
  status: Extract<RunStatus, "completed" | "failed" | "blocked" | "cancelled">;
  summary?: string;
  error?: string | null;
}

export interface RecordToolTraceInput {
  ownerId?: string;
  sessionId?: string | null;
  toolName: string;
  status: ToolTraceStatus;
  summary?: string;
  sources?: Array<Record<string, unknown>>;
  error?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface CreateContextIntakeSessionInput {
  ownerId?: string;
  goalId?: string | null;
  aimTitle: string;
  aimDescription?: string | null;
  readiness?: string;
  missingQuestions?: string[];
  blockedReasons?: string[];
  toolTraceIds?: string[];
}

/** The persistence surface. Async so a Supabase adapter can implement the same contract. */
export interface AimStore {
  listGoals(): Promise<Goal[]>;
  getGoal(id: string): Promise<{ goal: Goal; milestones: Milestone[] } | null>;
  createGoal(input: CreateGoalInput): Promise<{ goal: Goal; milestones: Milestone[] }>;
  listAimDrafts(): Promise<AimDraftRow[]>;
  getAimDraft(id: string): Promise<AimDraftRow | null>;
  upsertAimDraft(input: UpsertAimDraftInput): Promise<AimDraftRow>;
  discardAimDraft(id: string): Promise<void>;
  /**
   * Re-plan an existing aim. Returns the updated goal + milestones, or `null` if no aim
   * has that id. Throws if the new plan is structurally invalid (mirrors `materialize`).
   */
  updateGoal(input: UpdateGoalInput): Promise<{ goal: Goal; milestones: Milestone[] } | null>;
  deleteGoal(id: string): Promise<void>;
  listEvidence(goalId: string): Promise<Evidence[]>;
  addEvidence(input: AddEvidenceInput): Promise<AddEvidenceResult>;
  confirmMilestone(input: ConfirmMilestoneInput): Promise<ConfirmMilestoneResult | null>;
  listMemories(goalId?: string | null): Promise<Memory[]>;
  listMemoryHistory(goalId?: string | null): Promise<Memory[]>;
  addMemory(input: AddMemoryInput): Promise<Memory>;
  listMemoryCandidates(goalId?: string | null): Promise<Memory[]>;
  addMemoryCandidate(input: AddMemoryCandidateInput): Promise<Memory>;
  acceptMemoryCandidate(input: AcceptMemoryCandidateInput): Promise<Memory | null>;
  rejectMemoryCandidate(id: string): Promise<Memory | null>;
  archiveMemory(id: string): Promise<Memory | null>;
  deprioritizeMemory(input: DeprioritizeMemoryInput): Promise<Memory | null>;
  listActors(): Promise<Actor[]>;
  addActor(input: AddActorInput): Promise<Actor>;
  listAssignments(goalId?: string | null): Promise<Assignment[]>;
  assignMilestone(input: AssignMilestoneInput): Promise<Assignment>;
  listSubAimRelations(goalId?: string | null): Promise<SubAimRelation[]>;
  listRuns(goalId?: string | null): Promise<Run[]>;
  createRun(input: CreateRunInput): Promise<Run>;
  appendRunEvent(input: AppendRunEventInput): Promise<RunEvent | null>;
  finishRun(input: FinishRunInput): Promise<Run | null>;
  recordToolTrace(input: RecordToolTraceInput): Promise<ToolTrace>;
  createContextIntakeSession(input: CreateContextIntakeSessionInput): Promise<ContextIntakeSession>;
  sedimentContextFromGoal(goalId: string): Promise<Memory[]>;
  getAimProgress(goalId: string): Promise<AimProgressReadModel | null>;
  exportData(): Promise<LocalStore>;
  importData(snapshot: LocalStore, mode?: "merge" | "replace"): Promise<ImportStoreResult>;
}

export interface JsonFileStoreOptions {
  /** Optional deterministic id source for tests and seed builders. Defaults to random UUIDs. */
  idFactory?: () => string;
  /** Optional deterministic clock for tests and seed builders. Defaults to the current time. */
  now?: () => string;
}

/** Default data dir: `$AIMCUB_HOME` or `~/.aimcub` (shared by desktop + CLI). */
export function defaultDataDir(): string {
  const override = process.env.AIMCUB_HOME?.trim();
  return override && override.length > 0 ? override : join(homedir(), ".aimcub");
}

// ──────────────────────────────────────────────────────────────────────────
// Provider settings — the LLM config (which endpoint, which key, which model).
//
// Persisted to `settings.json` SIBLING to the aim store, so the desktop app and the CLI
// (`aim setup` / `aim config`) read+write ONE provider config — the same "two faces over one
// store" idea as the aims. Lives here (not in a shell) because it is local fs persistence,
// the same class of thing `createJsonFileStore` does; `@core/domain` must never import it.
// ──────────────────────────────────────────────────────────────────────────

/** Persisted LLM provider config. Structurally the desktop's `ProviderConfig`. */
export type ProviderSettingsProvider =
  | "anthropic"
  | "openai"
  | "deepseek"
  | "minimax"
  | "zai"
  | "google"
  | "qwen"
  | "openai-compatible";

const PROVIDER_SETTINGS_PROVIDERS: readonly ProviderSettingsProvider[] = [
  "anthropic",
  "openai",
  "deepseek",
  "minimax",
  "zai",
  "google",
  "qwen",
  "openai-compatible",
];

export interface ProviderSettings {
  provider: ProviderSettingsProvider;
  apiKey: string;
  /** Endpoint root for OpenAI-compatible providers; omitted ⇒ provider default. */
  baseURL?: string;
  /** Model id selected for the provider. */
  model?: string;
}

export type WebResearchSettingsProvider = "brave";

export interface WebResearchSettings {
  provider: WebResearchSettingsProvider;
  apiKey: string;
  enabled: boolean;
  fetchPages: boolean;
}

export type ContextOnlineSourceProvider =
  | "notion"
  | "obsidian"
  | "google-drive"
  | "supabase"
  | "database"
  | "url"
  | "other";

export interface ContextOnlineSourceSettings {
  id: string;
  provider: ContextOnlineSourceProvider;
  label: string;
  reference: string;
  enabled: boolean;
}

export interface ContextSourceSettings {
  version: 1;
  local: {
    enabled: boolean;
    workspaceRoot?: string;
    filePaths: string[];
  };
  online: {
    enabled: boolean;
    sources: ContextOnlineSourceSettings[];
  };
  research: {
    webEnabled: boolean;
    deepResearch: boolean;
  };
  userSession: {
    enabled: boolean;
  };
  questionnaire: {
    enabled: boolean;
  };
}

const CONTEXT_ONLINE_SOURCE_PROVIDERS: readonly ContextOnlineSourceProvider[] = [
  "notion",
  "obsidian",
  "google-drive",
  "supabase",
  "database",
  "url",
  "other",
];

export const DEFAULT_CONTEXT_SOURCE_SETTINGS: ContextSourceSettings = {
  version: 1,
  local: {
    enabled: false,
    filePaths: [],
  },
  online: {
    enabled: false,
    sources: [],
  },
  research: {
    webEnabled: true,
    deepResearch: true,
  },
  userSession: {
    enabled: true,
  },
  questionnaire: {
    enabled: true,
  },
};

function isProviderSettingsProvider(value: unknown): value is ProviderSettingsProvider {
  return typeof value === "string" && PROVIDER_SETTINGS_PROVIDERS.includes(value as ProviderSettingsProvider);
}

function isContextOnlineSourceProvider(value: unknown): value is ContextOnlineSourceProvider {
  return typeof value === "string" && CONTEXT_ONLINE_SOURCE_PROVIDERS.includes(value as ContextOnlineSourceProvider);
}

/** Path to the provider settings file (sibling to the aim store). */
export function settingsPath(dataDir: string = defaultDataDir()): string {
  return join(dataDir, "settings.json");
}

/** Path to first-party web research provider settings. */
export function webResearchSettingsPath(dataDir: string = defaultDataDir()): string {
  return join(dataDir, "web-settings.json");
}

/** Path to context source settings. */
export function contextSourceSettingsPath(dataDir: string = defaultDataDir()): string {
  return join(dataDir, "context-sources.json");
}

/**
 * Load provider settings from settings.json. Migrates the legacy `{ anthropicApiKey }` shape
 * (the first key-only desktop slice) into the multi-provider shape. Returns null when nothing
 * usable is on file (missing, unparsable, or an unknown provider).
 */
export function loadSettings(dataDir: string = defaultDataDir()): ProviderSettings | null {
  try {
    const p = settingsPath(dataDir);
    if (!existsSync(p)) return null;
    const s = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;

    // Legacy migration: an Anthropic-only key blob from the first desktop slice.
    if (typeof s.anthropicApiKey === "string" && s.anthropicApiKey.trim() && !s.provider) {
      return { provider: "anthropic", apiKey: s.anthropicApiKey.trim() };
    }

    const provider = s.provider;
    if (!isProviderSettingsProvider(provider)) return null;
    return {
      provider,
      apiKey: typeof s.apiKey === "string" ? s.apiKey : "",
      baseURL: typeof s.baseURL === "string" && s.baseURL.trim() ? s.baseURL.trim() : undefined,
      model: typeof s.model === "string" && s.model.trim() ? s.model.trim() : undefined,
    };
  } catch {
    return null;
  }
}

/** Persist provider settings to settings.json with owner-only (0600) perms — it holds a key. */
export function saveSettings(config: ProviderSettings, dataDir: string = defaultDataDir()): void {
  mkdirSync(dataDir, { recursive: true });
  const p = settingsPath(dataDir);
  writeFileSync(p, JSON.stringify(config, null, 2), { encoding: "utf8", mode: 0o600 });
  // mode on writeFileSync only applies on create; enforce it on overwrite too.
  try {
    chmodSync(p, 0o600);
  } catch {
    /* best-effort (e.g. Windows) */
  }
}

export function loadWebResearchSettings(dataDir: string = defaultDataDir()): WebResearchSettings | null {
  try {
    const p = webResearchSettingsPath(dataDir);
    if (!existsSync(p)) return null;
    const s = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
    if (s.provider !== "brave") return null;
    return {
      provider: "brave",
      apiKey: typeof s.apiKey === "string" ? s.apiKey : "",
      enabled: typeof s.enabled === "boolean" ? s.enabled : Boolean(typeof s.apiKey === "string" && s.apiKey.trim()),
      fetchPages: typeof s.fetchPages === "boolean" ? s.fetchPages : true,
    };
  } catch {
    return null;
  }
}

export function saveWebResearchSettings(config: WebResearchSettings, dataDir: string = defaultDataDir()): void {
  mkdirSync(dataDir, { recursive: true });
  const p = webResearchSettingsPath(dataDir);
  writeFileSync(p, JSON.stringify(config, null, 2), { encoding: "utf8", mode: 0o600 });
  try {
    chmodSync(p, 0o600);
  } catch {
    /* best-effort (e.g. Windows) */
  }
}

function cleanOptionalPath(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function uniqueCleanPaths(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    const path = cleanOptionalPath(item);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out;
}

function normalizeOnlineSources(value: unknown): ContextOnlineSourceSettings[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const sources: ContextOnlineSourceSettings[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const provider = isContextOnlineSourceProvider(row.provider) ? row.provider : "other";
    const label = typeof row.label === "string" && row.label.trim() ? row.label.trim() : provider;
    const reference = typeof row.reference === "string" ? row.reference.trim() : "";
    if (!reference) continue;
    const key = `${provider}\u0000${reference.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push({
      id: typeof row.id === "string" && row.id.trim() ? row.id.trim() : randomUUID(),
      provider,
      label,
      reference,
      enabled: typeof row.enabled === "boolean" ? row.enabled : true,
    });
  }
  return sources;
}

export function normalizeContextSourceSettings(input: unknown): ContextSourceSettings {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ...DEFAULT_CONTEXT_SOURCE_SETTINGS, local: { ...DEFAULT_CONTEXT_SOURCE_SETTINGS.local }, online: { ...DEFAULT_CONTEXT_SOURCE_SETTINGS.online } };
  }
  const row = input as Record<string, unknown>;
  const local = row.local && typeof row.local === "object" && !Array.isArray(row.local)
    ? row.local as Record<string, unknown>
    : {};
  const online = row.online && typeof row.online === "object" && !Array.isArray(row.online)
    ? row.online as Record<string, unknown>
    : {};
  const research = row.research && typeof row.research === "object" && !Array.isArray(row.research)
    ? row.research as Record<string, unknown>
    : {};
  const userSession = row.userSession && typeof row.userSession === "object" && !Array.isArray(row.userSession)
    ? row.userSession as Record<string, unknown>
    : {};
  const questionnaire = row.questionnaire && typeof row.questionnaire === "object" && !Array.isArray(row.questionnaire)
    ? row.questionnaire as Record<string, unknown>
    : {};

  return {
    version: 1,
    local: {
      enabled: typeof local.enabled === "boolean" ? local.enabled : Boolean(cleanOptionalPath(local.workspaceRoot) || uniqueCleanPaths(local.filePaths).length > 0),
      workspaceRoot: cleanOptionalPath(local.workspaceRoot),
      filePaths: uniqueCleanPaths(local.filePaths),
    },
    online: {
      enabled: typeof online.enabled === "boolean" ? online.enabled : normalizeOnlineSources(online.sources).length > 0,
      sources: normalizeOnlineSources(online.sources),
    },
    research: {
      webEnabled: typeof research.webEnabled === "boolean" ? research.webEnabled : DEFAULT_CONTEXT_SOURCE_SETTINGS.research.webEnabled,
      deepResearch: typeof research.deepResearch === "boolean" ? research.deepResearch : DEFAULT_CONTEXT_SOURCE_SETTINGS.research.deepResearch,
    },
    userSession: {
      enabled: typeof userSession.enabled === "boolean" ? userSession.enabled : DEFAULT_CONTEXT_SOURCE_SETTINGS.userSession.enabled,
    },
    questionnaire: {
      enabled: typeof questionnaire.enabled === "boolean" ? questionnaire.enabled : DEFAULT_CONTEXT_SOURCE_SETTINGS.questionnaire.enabled,
    },
  };
}

export function loadContextSourceSettings(dataDir: string = defaultDataDir()): ContextSourceSettings {
  try {
    const p = contextSourceSettingsPath(dataDir);
    if (!existsSync(p)) return normalizeContextSourceSettings(null);
    return normalizeContextSourceSettings(JSON.parse(readFileSync(p, "utf8")) as unknown);
  } catch {
    return normalizeContextSourceSettings(null);
  }
}

export function saveContextSourceSettings(config: ContextSourceSettings, dataDir: string = defaultDataDir()): ContextSourceSettings {
  const normalized = normalizeContextSourceSettings(config);
  mkdirSync(dataDir, { recursive: true });
  const p = contextSourceSettingsPath(dataDir);
  writeFileSync(p, JSON.stringify(normalized, null, 2), { encoding: "utf8", mode: 0o600 });
  try {
    chmodSync(p, 0o600);
  } catch {
    /* best-effort (e.g. Windows) */
  }
  return normalized;
}

/**
 * The store's single validation gate for any plan it is asked to persist. Runs the Zod SHAPE
 * check (the same gate the LLM `decompose` path uses — required key/title/acceptance_rule and
 * field types) AND the semantic invariants Zod can't express (unique keys, acyclic, edge
 * refs). Returns the parsed value with defaults applied. Throws `invalid decomposition: …` on
 * any failure. This is what stops a hand-edited (`aim edit`) or otherwise untrusted plan from
 * persisting a structurally broken milestone (e.g. one with no acceptance_rule, which could
 * never be evaluated — corrupting derived state).
 */
function parseDecomposition(plan: DecompositionOutput): DecompositionOutput {
  const parsed = DecompositionOutput.safeParse(plan);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new Error(`invalid decomposition: ${issues}`);
  }
  const semantic = validatePlan(parsed.data);
  if (!semantic.ok) {
    throw new Error(`invalid decomposition: ${semantic.errors.join("; ")}`);
  }
  return parsed.data;
}

function planNodeMetadata(node: PlanNode): Record<string, unknown> {
  return {
    est_effort: node.est_effort,
    plan_key: node.key,
    ...(node.decomposition_contract ? { decomposition_contract: node.decomposition_contract } : {}),
    ...(node.routing_override ? { routing_override: node.routing_override } : {}),
  };
}

/**
 * Validate a DecompositionOutput and materialize it into linear Milestone rows.
 * Routes through {@link parseDecomposition} (shape + semantic gate, identical to web/desktop).
 */
export function materialize(
  decomposition: DecompositionOutput,
  goalId: string,
  ownerId: string,
  statuses: MilestoneStatus[] = [],
  idFactory: () => string = randomUUID,
): Milestone[] {
  const plan = parseDecomposition(decomposition);

  const idByKey = new Map<string, string>();
  for (const node of plan.nodes) idByKey.set(node.key, idFactory());
  const dependsOn = new Map<string, string>(); // to -> from id
  for (const edge of plan.edges) {
    const fromId = idByKey.get(edge.from);
    if (fromId) dependsOn.set(edge.to, fromId);
  }

  return plan.nodes.map((node, i) => {
    const status = statuses[i] ?? "pending";
    return {
      id: idByKey.get(node.key)!,
      goal_id: goalId,
      owner_id: ownerId,
      title: node.title,
      description: node.description,
      status,
      order_index: i,
      depends_on_id: dependsOn.get(node.key) ?? null,
      acceptance_rule: node.acceptance_rule,
      xp_reward: node.xp_reward,
      completed_at: null,
      metadata: planNodeMetadata(node),
    } satisfies Milestone;
  });
}

/**
 * Re-plan: merge a new decomposition into a goal's existing milestones, preserving
 * finished work. Delegates the freeze/update/add/skip decision to `@core/domain`'s
 * `planMerge` (the single source of the re-plan invariant) and materializes the result
 * into Milestone rows:
 *  - freeze  → keep the completed row verbatim (its id, status, content, completed_at).
 *  - update  → reuse the stable id + status + completed_at; take title/desc/rule/xp/effort
 *              from the new node.
 *  - add     → a fresh `pending` milestone with a new id.
 *  - skip    → an unfinished milestone the new plan dropped; kept as a `skipped` row
 *              (soft delete — finished/in-flight history is never silently lost).
 * Order follows the merged order (new nodes in plan order, then retired rows). `depends_on`
 * is rebuilt from the new plan's edges for keyed rows; retired rows depend on nothing.
 */
export function mergeMilestones(
  existing: Milestone[],
  goalId: string,
  ownerId: string,
  next: DecompositionOutput,
  idFactory: () => string = randomUUID,
): Milestone[] {
  const plan = parseDecomposition(next);

  const merged = planMerge(
    existing.map((m) => ({ id: m.id, title: m.title, status: m.status })),
    plan,
  );
  const existingById = new Map(existing.map((m) => [m.id, m]));
  const nodeByKey = new Map<string, PlanNode>(plan.nodes.map((n) => [n.key, n]));

  // Stable id per surviving node key (existing id for update/freeze, fresh for add), so the
  // new plan's edges can resolve to milestone ids.
  const idByKey = new Map<string, string>();
  for (const item of merged) {
    if (item.nodeKey) idByKey.set(item.nodeKey, item.existingId ?? idFactory());
  }
  const dependsOn = new Map<string, string>(); // node key (`to`) -> prerequisite milestone id
  for (const edge of plan.edges) {
    const fromId = idByKey.get(edge.from);
    if (fromId) dependsOn.set(edge.to, fromId);
  }

  const milestones: Milestone[] = [];
  merged.forEach((item, order) => {
    const node = item.nodeKey ? nodeByKey.get(item.nodeKey) : undefined;
    const prev = item.existingId ? existingById.get(item.existingId) : undefined;

    if (item.action === "add" && node) {
      milestones.push({
        id: idByKey.get(node.key)!,
        goal_id: goalId,
        owner_id: ownerId,
        title: node.title,
        description: node.description,
        status: "pending",
        order_index: order,
        depends_on_id: dependsOn.get(node.key) ?? null,
        acceptance_rule: node.acceptance_rule,
        xp_reward: node.xp_reward,
        completed_at: null,
        metadata: planNodeMetadata(node),
      });
    } else if (item.action === "update" && node && prev) {
      // Reuse the stable id, status, and completed_at; refresh the plan-authored content.
      milestones.push({
        ...prev,
        title: node.title,
        description: node.description,
        order_index: order,
        depends_on_id: dependsOn.get(node.key) ?? null,
        acceptance_rule: node.acceptance_rule,
        xp_reward: node.xp_reward,
        metadata: { ...prev.metadata, ...planNodeMetadata(node) },
      });
    } else if (item.action === "freeze" && prev) {
      // A completed milestone — never overwrite its content; just re-thread order/deps.
      milestones.push({
        ...prev,
        order_index: order,
        depends_on_id: item.nodeKey ? (dependsOn.get(item.nodeKey) ?? null) : null,
        metadata: item.nodeKey ? { ...prev.metadata, plan_key: item.nodeKey } : prev.metadata,
      });
    } else if (item.action === "skip" && prev) {
      // Unfinished but dropped from the new plan — retire as a soft-deleted row.
      milestones.push({ ...prev, status: "skipped", order_index: order, depends_on_id: null });
    }
  });

  return milestones;
}

const MANUAL_CONFIRM_RULE = AcceptanceRule.parse({
  logic: "all",
  completion_mode: "manual",
  clauses: [{ evaluator: "manual_confirm", auto_verifiable: false, match: {} }],
});

function allMilestones(store: LocalStore): Milestone[] {
  return Object.values(store.milestonesByGoal).flat();
}

function evidenceForMilestone(store: LocalStore, milestone: Milestone): Evidence[] {
  return store.evidence.filter(
    (ev) =>
      ev.goal_id === milestone.goal_id &&
      (ev.milestone_id === null || ev.milestone_id === milestone.id),
  );
}

function hasCompletion(store: LocalStore, milestoneId: string): boolean {
  return store.completions.some((c) => c.milestone_id === milestoneId);
}

function canUserConfirm(rule: ReturnType<typeof AcceptanceRule.parse>): boolean {
  return (
    rule.completion_mode !== "auto" ||
    rule.clauses.some((clause) => clause.evaluator === "manual_confirm")
  );
}

function normalizeProofText(value: string | undefined): string {
  return normalizeMemoryContent(value ?? "");
}

function uniqueCleanStrings(values: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values ?? []) {
    const cleaned = normalizeProofText(value);
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
  }
  return out;
}

function normalizeProofUrls(values: readonly string[] | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of uniqueCleanStrings(values)) {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error(`Manual proof URL is invalid: ${value}`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("Manual proof URLs must start with http:// or https://.");
    }
    const normalized = parsed.toString();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function requiredEvidenceForMilestone(milestone: Milestone): string[] {
  const contract = milestone.metadata?.decomposition_contract;
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) return [];
  const required = (contract as Record<string, unknown>).required_evidence;
  return Array.isArray(required) ? uniqueCleanStrings(required.filter((item): item is string => typeof item === "string")) : [];
}

function evidenceItemKey(value: string): string {
  return normalizeProofText(value).toLowerCase();
}

function normalizeRequiredEvidenceSelection(
  milestone: Milestone,
  selected: readonly ManualEvidenceRequiredItem[] | undefined,
): ManualEvidenceRequiredItem[] {
  const required = requiredEvidenceForMilestone(milestone);
  if (required.length === 0) return [];
  const known = new Map(required.map((item) => [evidenceItemKey(item), item]));
  const selectedByKey = new Map<string, boolean>();
  for (const item of selected ?? []) {
    const text = normalizeProofText(item.text);
    const key = evidenceItemKey(text);
    if (!known.has(key)) {
      throw new Error(`Required evidence item does not belong to this milestone: ${text || "(blank)"}`);
    }
    selectedByKey.set(key, item.satisfied === true);
  }
  const normalized = required.map((text) => ({
    text,
    satisfied: selectedByKey.get(evidenceItemKey(text)) ?? false,
  }));
  if (!normalized.some((item) => item.satisfied)) {
    throw new Error("Manual proof must check at least one required evidence item.");
  }
  return normalized;
}

function proofSummary(input: ConfirmMilestoneInput, milestone: Milestone, proofNote: string, urls: readonly string[], filePaths: readonly string[]): string {
  const explicit = normalizeProofText(input.summary);
  if (explicit) return explicit;
  const basis = proofNote || urls[0] || filePaths[0] || milestone.title;
  return `Manual proof for ${milestone.title}: ${basis.length > 140 ? `${basis.slice(0, 139).trim()}...` : basis}`;
}

function normalizeManualEvidence(input: ConfirmMilestoneInput, milestone: Milestone): {
  summary: string;
  payload: Record<string, unknown>;
} {
  const proofNote = normalizeProofText(input.proofNote ?? input.summary);
  const urls = normalizeProofUrls(input.urls);
  const filePaths = uniqueCleanStrings(input.filePaths);
  if (!proofNote && urls.length === 0 && filePaths.length === 0) {
    throw new Error("Manual proof requires a note, URL, or file reference.");
  }
  const requiredEvidence = normalizeRequiredEvidenceSelection(milestone, input.requiredEvidence);
  const payload = ManualEvidencePayload.parse({
    confirmed: true,
    milestone_id: milestone.id,
    ...(proofNote ? { proof_note: proofNote } : {}),
    urls,
    file_paths: filePaths,
    required_evidence: requiredEvidence,
  });
  return {
    summary: proofSummary(input, milestone, proofNote, urls, filePaths),
    payload,
  };
}

function insertCompletion(
  store: LocalStore,
  milestone: Milestone,
  decidedBy: MilestoneCompletion["decided_by"],
  triggeringEvidenceIds: string[],
  now: string,
  idFactory: () => string = randomUUID,
): MilestoneCompletion | null {
  if (hasCompletion(store, milestone.id)) return null;
  const completion: MilestoneCompletion = {
    id: idFactory(),
    milestone_id: milestone.id,
    owner_id: milestone.owner_id,
    decided_by: decidedBy,
    triggering_evidence_ids: triggeringEvidenceIds,
    awarded_xp: milestone.xp_reward,
    created_at: now,
  };
  store.completions.push(completion);
  milestone.status = "completed";
  milestone.completed_at = now;
  for (const assignment of store.assignments.filter((row) => row.milestone_id === milestone.id)) {
    if (assignment.status !== "cancelled") {
      assignment.status = "completed";
      assignment.updated_at = now;
    }
  }
  return completion;
}

function evaluateGoal(
  store: LocalStore,
  goalId: string,
  now: string,
  idFactory: () => string = randomUUID,
): MilestoneCompletion[] {
  const created: MilestoneCompletion[] = [];
  const milestones = store.milestonesByGoal[goalId] ?? [];
  for (const milestone of milestones) {
    if (milestone.status === "completed" || hasCompletion(store, milestone.id)) continue;
    const parsedRule = AcceptanceRule.safeParse(milestone.acceptance_rule);
    if (!parsedRule.success) continue;
    const rule = parsedRule.data;
    const evidence = evidenceForMilestone(store, milestone);
    const result = evaluate(rule, evidence);
    if (result.passed) {
      const matched = evidence.filter((ev) => result.matchedEvidenceIds.includes(ev.id));
      const hasManual = matched.some((ev) => ev.kind === "manual_check");
      if (rule.completion_mode === "manual" && !hasManual) continue;
      const completion = insertCompletion(
        store,
        milestone,
        hasManual ? "user_confirm" : "rule_auto",
        result.matchedEvidenceIds,
        now,
        idFactory,
      );
      if (completion) created.push(completion);
      continue;
    }

    const manualEvidence = evidence.filter((ev) => ev.kind === "manual_check");
    const manualResult = evaluate(MANUAL_CONFIRM_RULE, manualEvidence);
    if (manualResult.passed && canUserConfirm(rule)) {
      const completion = insertCompletion(
        store,
        milestone,
        "user_confirm",
        manualResult.matchedEvidenceIds,
        now,
        idFactory,
      );
      if (completion) created.push(completion);
    }
  }
  return created;
}

function emptyStore(): LocalStore {
  return {
    ownerId: DEFAULT_OWNER,
    goals: [],
    aimDrafts: [],
    milestonesByGoal: {},
    memories: [],
    evidence: [],
    completions: [],
    actors: [],
    subAimRelations: [],
    assignments: [],
    runs: [],
    runEvents: [],
    toolTraces: [],
    evidenceAttributions: [],
    contextIntakeSessions: [],
  };
}

function normalizeMemoryContent(content: string): string {
  return content.replace(/\s+/g, " ").trim();
}

function memoryDedupeKey(content: string): string {
  return normalizeMemoryContent(content).toLowerCase();
}

function findDuplicateMemory(store: LocalStore, content: string, goalId: string | null, excludeId?: string): Memory | undefined {
  const key = memoryDedupeKey(content);
  return store.memories.find(
    (m) => m.id !== excludeId && m.status !== "deleted" && m.goal_id === goalId && memoryDedupeKey(m.content) === key,
  );
}

function sortMemoriesNewestFirst(rows: Memory[]): Memory[] {
  return rows.slice().sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
}

function defaultCategoryForMemory(content: string, kind: MemoryKind): ContextCategory {
  return inferContextCategory(content, kind === "procedural" ? "procedure" : "project_fact");
}

function normalizeMemoryRow(row: Memory): Memory {
  const memory = row as Memory & { category?: ContextCategory };
  return {
    ...memory,
    category: memory.category ?? defaultCategoryForMemory(memory.content, memory.kind),
  };
}

function normalizeAimDraftRow(row: unknown): AimDraftRow | null {
  const parsed = AimDraft.safeParse(row);
  return parsed.success ? parsed.data : null;
}

function sortAimDraftsNewestFirst(rows: AimDraftRow[]): AimDraftRow[] {
  return rows.slice().sort((a, b) => (b.updated_at ?? b.created_at ?? "").localeCompare(a.updated_at ?? a.created_at ?? ""));
}

/**
 * A JSON-file-backed {@link AimStore} rooted at `dataDir` (default {@link defaultDataDir}).
 * Each operation loads → mutates → saves; fine for a single user. (If concurrent desktop +
 * CLI writes ever become real, move to SQLite — last-writer-wins is the known limitation.)
 */
export function createJsonFileStore(dataDir: string = defaultDataDir(), options: JsonFileStoreOptions = {}): AimStore {
  const file = join(dataDir, "store.json");
  const nextId = options.idFactory ?? randomUUID;
  const nowIso = options.now ?? (() => new Date().toISOString());

  function load(): LocalStore {
    try {
      if (!existsSync(file)) return emptyStore();
      const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<LocalStore>;
      return {
        ownerId: parsed.ownerId ?? DEFAULT_OWNER,
        goals: parsed.goals ?? [],
        aimDrafts: (parsed.aimDrafts ?? []).map(normalizeAimDraftRow).filter((row): row is AimDraftRow => row !== null),
        milestonesByGoal: parsed.milestonesByGoal ?? {},
        memories: (parsed.memories ?? []).map(normalizeMemoryRow),
        evidence: parsed.evidence ?? [],
        completions: parsed.completions ?? [],
        actors: parsed.actors ?? [],
        subAimRelations: parsed.subAimRelations ?? [],
        assignments: parsed.assignments ?? [],
        runs: parsed.runs ?? [],
        runEvents: parsed.runEvents ?? [],
        toolTraces: parsed.toolTraces ?? [],
        evidenceAttributions: parsed.evidenceAttributions ?? [],
        contextIntakeSessions: parsed.contextIntakeSessions ?? [],
      };
    } catch {
      return emptyStore();
    }
  }

  function save(store: LocalStore): void {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(file, JSON.stringify(store, null, 2), "utf8");
  }

  return {
    async listGoals(): Promise<Goal[]> {
      return load().goals.slice().sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
    },

    async getGoal(id: string): Promise<{ goal: Goal; milestones: Milestone[] } | null> {
      const store = load();
      const goal = store.goals.find((g) => g.id === id);
      if (!goal) return null;
      return { goal, milestones: store.milestonesByGoal[id] ?? [] };
    },

    async listAimDrafts(): Promise<AimDraftRow[]> {
      return sortAimDraftsNewestFirst(load().aimDrafts);
    },

    async getAimDraft(id: string): Promise<AimDraftRow | null> {
      return load().aimDrafts.find((draft) => draft.id === id) ?? null;
    },

    async upsertAimDraft(input: UpsertAimDraftInput): Promise<AimDraftRow> {
      const store = load();
      const now = nowIso();
      const existing = input.id ? store.aimDrafts.find((draft) => draft.id === input.id) : undefined;
      const draft = AimDraft.parse({
        id: existing?.id ?? input.id ?? nextId(),
        owner_id: input.ownerId ?? existing?.owner_id ?? store.ownerId ?? DEFAULT_OWNER,
        title: input.title ?? existing?.title ?? "",
        description: input.description ?? existing?.description ?? "",
        parent_goal_id: input.parentGoalId === undefined ? existing?.parent_goal_id ?? null : input.parentGoalId,
        parent_milestone_id: input.parentMilestoneId === undefined ? existing?.parent_milestone_id ?? null : input.parentMilestoneId,
        current_stage: input.currentStage ?? existing?.current_stage ?? "aim",
        phase: input.phase === undefined ? existing?.phase ?? null : input.phase,
        status: input.status ?? existing?.status ?? "draft",
        aim_surface: input.aimSurface === undefined ? existing?.aim_surface ?? null : input.aimSurface,
        context_note: input.contextNote ?? existing?.context_note ?? "",
        intake_questions: input.intakeQuestions ?? existing?.intake_questions ?? [],
        intake_answers: input.intakeAnswers ?? existing?.intake_answers ?? [],
        clarify_questions: input.clarifyQuestions ?? existing?.clarify_questions ?? [],
        clarify_answers: input.clarifyAnswers ?? existing?.clarify_answers ?? [],
        clarify_assumptions: input.clarifyAssumptions ?? existing?.clarify_assumptions ?? [],
        draft_plan: input.draftPlan === undefined ? existing?.draft_plan ?? null : input.draftPlan,
        final_plan: input.finalPlan === undefined ? existing?.final_plan ?? null : input.finalPlan,
        save_block: input.saveBlock === undefined ? existing?.save_block ?? null : input.saveBlock,
        created_at: existing?.created_at ?? now,
        updated_at: now,
      });
      if (existing) {
        store.aimDrafts = store.aimDrafts.map((row) => row.id === draft.id ? draft : row);
      } else {
        store.aimDrafts.push(draft);
      }
      save(store);
      return draft;
    },

    async discardAimDraft(id: string): Promise<void> {
      const store = load();
      store.aimDrafts = store.aimDrafts.filter((draft) => draft.id !== id);
      save(store);
    },

    async createGoal(input: CreateGoalInput): Promise<{ goal: Goal; milestones: Milestone[] }> {
      const store = load();
      const now = nowIso();
      const ownerId = input.ownerId ?? store.ownerId ?? DEFAULT_OWNER;
      const goalId = nextId();

      const goal: Goal = {
        id: goalId,
        owner_id: ownerId,
        title: input.title,
        description: input.description ?? "",
        domain: input.domain ?? "software",
        status: "active",
        target_date: null,
        plan_json: input.plan,
        metadata: input.metadata ?? {},
        created_at: now,
      };

      const milestones = materialize(input.plan, goalId, ownerId, [], nextId);
      const routedAssignments: Assignment[] = routeMilestones({
        milestones,
        actors: store.actors,
      }).map((assignment) => ({
        id: nextId(),
        owner_id: ownerId,
        goal_id: assignment.goalId,
        milestone_id: assignment.milestoneId,
        actor_kind: assignment.actorKind,
        actor_id: assignment.actorId,
        status: assignment.status,
        source: assignment.source,
        reason: assignment.reason,
        capability_tags: assignment.capabilityTags,
        created_at: now,
        updated_at: now,
      }));

      const memories: Memory[] = (input.memories ?? [])
        .filter((m) => m.content.trim().length > 0)
        .map((m) => ({
          id: nextId(),
          owner_id: ownerId,
          goal_id: goalId,
          kind: m.kind ?? "semantic",
          category: m.category ?? defaultCategoryForMemory(m.content, m.kind ?? "semantic"),
          content: m.content,
          confidence: m.confidence ?? 1,
          source: m.source ?? "user_stated",
          status: "active",
          superseded_by: null,
          created_at: now,
        } satisfies Memory));

      store.goals.push(goal);
      store.milestonesByGoal[goalId] = milestones;
      store.memories.push(...memories);
      store.assignments.push(...routedAssignments);

      const metadataParentGoalId = typeof input.metadata?.parent_goal_id === "string" ? input.metadata.parent_goal_id : undefined;
      const metadataParentMilestoneId = typeof input.metadata?.parent_milestone_id === "string" ? input.metadata.parent_milestone_id : undefined;
      const parentGoalId = input.parentGoalId ?? metadataParentGoalId;
      const parentMilestoneId = input.parentMilestoneId ?? metadataParentMilestoneId;
      if (parentGoalId || parentMilestoneId) {
        if (!parentGoalId || !parentMilestoneId) {
          throw new Error("Both parentGoalId and parentMilestoneId are required for a child aim.");
        }
        const parentGoal = store.goals.find((g) => g.id === parentGoalId);
        const parentMilestone = (store.milestonesByGoal[parentGoalId] ?? []).find((m) => m.id === parentMilestoneId);
        if (!parentGoal || !parentMilestone) {
          throw new Error("Parent aim or sub-aim not found.");
        }
        store.subAimRelations.push({
          id: nextId(),
          owner_id: ownerId,
          parent_goal_id: parentGoalId,
          parent_milestone_id: parentMilestoneId,
          child_goal_id: goalId,
          status: "active",
          reason: "User manually decomposed this sub-aim into a child aim.",
          created_at: now,
          updated_at: now,
        });
      }
      save(store);

      return { goal, milestones };
    },

    async updateGoal(input: UpdateGoalInput): Promise<{ goal: Goal; milestones: Milestone[] } | null> {
      const store = load();
      const goal = store.goals.find((g) => g.id === input.id);
      if (!goal) return null;

      const existing = store.milestonesByGoal[input.id] ?? [];
      const milestones = mergeMilestones(existing, goal.id, goal.owner_id, input.plan, nextId);

      const title = input.title?.trim();
      if (title) goal.title = title;
      if (input.description !== undefined) goal.description = input.description;
      goal.plan_json = input.plan;
      if (input.metadata) goal.metadata = { ...goal.metadata, ...input.metadata };

      store.milestonesByGoal[goal.id] = milestones;
      const assignmentNow = nowIso();
      const existingAssignmentMilestoneIds = new Set(
        store.assignments.filter((assignment) => assignment.goal_id === goal.id).map((assignment) => assignment.milestone_id),
      );
      const missingAssignments = routeMilestones({
        milestones: milestones.filter((milestone) => !existingAssignmentMilestoneIds.has(milestone.id) && milestone.status !== "skipped"),
        actors: store.actors,
      }).map((assignment) => ({
        id: nextId(),
        owner_id: goal.owner_id,
        goal_id: assignment.goalId,
        milestone_id: assignment.milestoneId,
        actor_kind: assignment.actorKind,
        actor_id: assignment.actorId,
        status: assignment.status,
        source: assignment.source,
        reason: assignment.reason,
        capability_tags: assignment.capabilityTags,
        created_at: assignmentNow,
        updated_at: assignmentNow,
      } satisfies Assignment));
      store.assignments.push(...missingAssignments);
      save(store);
      return { goal, milestones };
    },

    async deleteGoal(id: string): Promise<void> {
      const store = load();
      const milestoneIds = new Set((store.milestonesByGoal[id] ?? []).map((m) => m.id));
      const runIds = new Set(store.runs.filter((run) => run.goal_id === id).map((run) => run.id));
      const evidenceIds = new Set(store.evidence.filter((ev) => ev.goal_id === id).map((ev) => ev.id));
      store.goals = store.goals.filter((g) => g.id !== id);
      store.aimDrafts = store.aimDrafts.filter((draft) => draft.parent_goal_id !== id);
      delete store.milestonesByGoal[id];
      store.memories = store.memories.filter((m) => m.goal_id !== id);
      store.evidence = store.evidence.filter((ev) => ev.goal_id !== id);
      store.completions = store.completions.filter((c) => !milestoneIds.has(c.milestone_id));
      store.subAimRelations = store.subAimRelations.filter((relation) => relation.parent_goal_id !== id && relation.child_goal_id !== id);
      store.assignments = store.assignments.filter((assignment) => assignment.goal_id !== id);
      store.runs = store.runs.filter((run) => run.goal_id !== id);
      store.runEvents = store.runEvents.filter((event) => !runIds.has(event.run_id));
      store.evidenceAttributions = store.evidenceAttributions.filter(
        (attribution) => attribution.goal_id !== id && !evidenceIds.has(attribution.evidence_id),
      );
      store.contextIntakeSessions = store.contextIntakeSessions.filter((session) => session.goal_id !== id);
      save(store);
    },

    async listEvidence(goalId: string): Promise<Evidence[]> {
      return load()
        .evidence.filter((ev) => ev.goal_id === goalId)
        .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
    },

    async addEvidence(input: AddEvidenceInput): Promise<AddEvidenceResult> {
      const store = load();
      const goal = store.goals.find((g) => g.id === input.goalId);
      if (!goal) throw new Error(`Aim ${input.goalId} not found.`);
      if (input.milestoneId) {
        const milestone = (store.milestonesByGoal[input.goalId] ?? []).find((m) => m.id === input.milestoneId);
        if (!milestone) throw new Error(`Milestone ${input.milestoneId} not found on aim ${input.goalId}.`);
      }

      const emitterId = input.emitterId ?? null;
      const sourceEventId = input.sourceEventId ?? null;
      if (emitterId !== null && sourceEventId !== null) {
        const existing = store.evidence.find(
          (ev) => ev.emitter_id === emitterId && ev.source_event_id === sourceEventId,
        );
        if (existing) {
          return { evidence: existing, deduped: true, completions: [] };
        }
      }

      const now = nowIso();
      const evidence: Evidence = {
        id: nextId(),
        owner_id: input.ownerId ?? goal.owner_id ?? store.ownerId,
        goal_id: input.goalId,
        milestone_id: input.milestoneId ?? null,
        emitter_id: emitterId,
        kind: input.kind,
        source_event_id: sourceEventId,
        occurred_at: input.occurredAt ?? now,
        summary: input.summary ?? "",
        payload: input.payload ?? {},
        trust_score: input.trustScore ?? 1,
        created_at: now,
      };

      store.evidence.push(evidence);
      const run = input.runId ? store.runs.find((row) => row.id === input.runId) ?? null : null;
      const assignment = input.assignmentId
        ? store.assignments.find((row) => row.id === input.assignmentId) ?? null
        : run?.assignment_id
          ? store.assignments.find((row) => row.id === run.assignment_id) ?? null
          : input.milestoneId
            ? store.assignments.find((row) => row.milestone_id === input.milestoneId) ?? null
            : null;
      store.evidenceAttributions.push({
        id: nextId(),
        ...attributeEvidence({ evidence, assignment, run }),
        created_at: now,
      });
      const completions = evaluateGoal(store, input.goalId, now, nextId);
      save(store);
      return { evidence, deduped: false, completions };
    },

    async confirmMilestone(input: ConfirmMilestoneInput): Promise<ConfirmMilestoneResult | null> {
      const store = load();
      const goal = store.goals.find((g) => g.id === input.goalId);
      if (!goal) return null;
      const milestone = (store.milestonesByGoal[input.goalId] ?? []).find((m) => m.id === input.milestoneId);
      if (!milestone) return null;
      const existing = store.completions.find((c) => c.milestone_id === milestone.id) ?? null;
      if (existing) {
        return {
          evidence: store.evidence.find((ev) => existing.triggering_evidence_ids.includes(ev.id)) ?? null,
          completion: existing,
          alreadyCompleted: true,
        };
      }

      const now = nowIso();
      const manualEvidence = normalizeManualEvidence(input, milestone);
      const evidence: Evidence = {
        id: nextId(),
        owner_id: input.ownerId ?? milestone.owner_id,
        goal_id: input.goalId,
        milestone_id: milestone.id,
        emitter_id: null,
        kind: "manual_check",
        source_event_id: null,
        occurred_at: now,
        summary: manualEvidence.summary,
        payload: manualEvidence.payload,
        trust_score: 1,
        created_at: now,
      };
      store.evidence.push(evidence);
      const assignment = store.assignments.find((row) => row.milestone_id === milestone.id) ?? null;
      store.evidenceAttributions.push({
        id: nextId(),
        ...attributeEvidence({
          evidence,
          assignment,
          reason: "Human manual proof confirmed this sub-aim.",
        }),
        created_at: now,
      });
      const completions = evaluateGoal(store, input.goalId, now, nextId);
      const completion = completions.find((c) => c.milestone_id === milestone.id) ?? null;
      save(store);
      return { evidence, completion, alreadyCompleted: false };
    },

    async listMemories(goalId: string | null = null): Promise<Memory[]> {
      const rows = load().memories.filter((m) => {
        if (m.status !== "active") return false;
        return goalId === null || m.goal_id === goalId;
      });
      return sortMemoriesNewestFirst(rows);
    },

    async listMemoryHistory(goalId: string | null = null): Promise<Memory[]> {
      const rows = load().memories.filter((m) => goalId === null || m.goal_id === goalId);
      return sortMemoriesNewestFirst(rows);
    },

    async addMemory(input: AddMemoryInput): Promise<Memory> {
      const store = load();
      const content = normalizeMemoryContent(input.content);
      if (!content) throw new Error("Memory content is required.");
      if (input.goalId) {
        const goal = store.goals.find((g) => g.id === input.goalId);
        if (!goal) throw new Error(`Aim ${input.goalId} not found.`);
      }
      const goalId = input.goalId ?? null;
      const duplicate = findDuplicateMemory(store, content, goalId);
      if (duplicate) {
        if (duplicate.status === "pending" || duplicate.status === "deprioritized") {
          duplicate.kind = input.kind ?? duplicate.kind;
          duplicate.category = input.category ?? defaultCategoryForMemory(content, duplicate.kind);
          duplicate.confidence = input.confidence ?? 1;
          duplicate.source = input.source ?? "user_stated";
          duplicate.status = "active";
          save(store);
        }
        return duplicate;
      }
      const now = nowIso();
      const memory: Memory = {
        id: nextId(),
        owner_id: input.ownerId ?? store.ownerId,
        goal_id: goalId,
        kind: input.kind ?? "semantic",
        category: input.category ?? defaultCategoryForMemory(content, input.kind ?? "semantic"),
        content,
        confidence: input.confidence ?? 1,
        source: input.source ?? "user_stated",
        status: "active",
        superseded_by: null,
        created_at: now,
      };
      store.memories.push(memory);
      save(store);
      return memory;
    },

    async listMemoryCandidates(goalId: string | null = null): Promise<Memory[]> {
      const rows = load().memories.filter((m) => {
        if (m.status !== "pending") return false;
        return goalId === null || m.goal_id === goalId;
      });
      return sortMemoriesNewestFirst(rows);
    },

    async addMemoryCandidate(input: AddMemoryCandidateInput): Promise<Memory> {
      const store = load();
      const content = normalizeMemoryContent(input.content);
      if (!content) throw new Error("Memory content is required.");
      if (input.goalId) {
        const goal = store.goals.find((g) => g.id === input.goalId);
        if (!goal) throw new Error(`Aim ${input.goalId} not found.`);
      }
      const goalId = input.goalId ?? null;
      const duplicate = findDuplicateMemory(store, content, goalId);
      if (duplicate) return duplicate;
      const now = nowIso();
      const memory: Memory = {
        id: nextId(),
        owner_id: input.ownerId ?? store.ownerId,
        goal_id: goalId,
        kind: input.kind ?? "semantic",
        category: input.category ?? defaultCategoryForMemory(content, input.kind ?? "semantic"),
        content,
        confidence: input.confidence ?? 0.7,
        source: input.source ?? "agent_inferred",
        status: "pending",
        superseded_by: null,
        created_at: now,
      };
      store.memories.push(memory);
      save(store);
      return memory;
    },

    async acceptMemoryCandidate(input: AcceptMemoryCandidateInput): Promise<Memory | null> {
      const store = load();
      const memory = store.memories.find((m) => m.id === input.id && m.status === "pending");
      if (!memory) return null;
      const content = input.content !== undefined ? normalizeMemoryContent(input.content) : memory.content;
      if (!content) throw new Error("Memory content is required.");
      if (isPromptLikeContextCandidate(content)) {
        throw new Error("Context candidate must be edited into an actual answer before it can be accepted.");
      }
      if (input.goalId) {
        const goal = store.goals.find((g) => g.id === input.goalId);
        if (!goal) throw new Error(`Aim ${input.goalId} not found.`);
      }
      const goalId = input.goalId !== undefined ? input.goalId : memory.goal_id;
      const confidence = input.confidence ?? Math.max(memory.confidence, 0.9);
      const duplicate = findDuplicateMemory(store, content, goalId, memory.id);
      if (duplicate) {
        if (duplicate.status === "pending" || duplicate.status === "deprioritized") {
          duplicate.content = content;
          duplicate.kind = input.kind ?? duplicate.kind;
          duplicate.category = input.category ?? defaultCategoryForMemory(content, duplicate.kind);
          duplicate.confidence = confidence;
          if (input.source) duplicate.source = input.source;
          duplicate.status = "active";
        } else if (duplicate.status === "active") {
          if (input.kind) duplicate.kind = input.kind;
          if (input.category) duplicate.category = input.category;
          duplicate.confidence = Math.max(duplicate.confidence, confidence);
          if (input.source) duplicate.source = input.source;
        }
        memory.status = "deleted";
        memory.superseded_by = duplicate.id;
        save(store);
        return duplicate;
      }
      memory.content = content;
      memory.goal_id = goalId;
      if (input.kind) memory.kind = input.kind;
      memory.category = input.category ?? defaultCategoryForMemory(content, memory.kind);
      memory.confidence = confidence;
      if (input.source) memory.source = input.source;
      memory.status = "active";
      save(store);
      return memory;
    },

    async rejectMemoryCandidate(id: string): Promise<Memory | null> {
      const store = load();
      const memory = store.memories.find((m) => m.id === id && m.status === "pending");
      if (!memory) return null;
      memory.status = "deleted";
      save(store);
      return memory;
    },

    async archiveMemory(id: string): Promise<Memory | null> {
      const store = load();
      const memory = store.memories.find((m) => m.id === id && m.status === "active");
      if (!memory) return null;
      memory.status = "deleted";
      save(store);
      return memory;
    },

    async deprioritizeMemory(input: DeprioritizeMemoryInput): Promise<Memory | null> {
      const store = load();
      const memory = store.memories.find((m) => m.id === input.id && m.status === "active");
      if (!memory) return null;
      const confidence = input.confidence ?? 0.5;
      if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
        throw new Error("Memory confidence must be a number from 0 to 1.");
      }
      memory.confidence = Math.min(memory.confidence, confidence);
      memory.status = "deprioritized";
      save(store);
      return memory;
    },

    async listActors(): Promise<Actor[]> {
      return load().actors.slice().sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
    },

    async addActor(input: AddActorInput): Promise<Actor> {
      const store = load();
      const now = nowIso();
      const ownerId = input.ownerId ?? store.ownerId;
      const actor: Actor = input.kind === "human"
        ? {
            id: nextId(),
            owner_id: ownerId,
            kind: "human",
            display_name: input.displayName,
            capabilities: input.capabilities ?? [],
            status: "active",
            user_id: input.userId ?? null,
            created_at: now,
          }
        : {
            id: nextId(),
            owner_id: ownerId,
            kind: "agent",
            display_name: input.displayName,
            capabilities: input.capabilities ?? [],
            status: "active",
            agent_kind: input.agentKind ?? "local_cli",
            run_mode: input.runMode ?? "local_cli",
            model: input.model ?? null,
            connection_ref: input.connectionRef ?? null,
            created_at: now,
          };
      store.actors.push(actor);
      save(store);
      return actor;
    },

    async listAssignments(goalId: string | null = null): Promise<Assignment[]> {
      const rows = load().assignments.filter((assignment) => goalId === null || assignment.goal_id === goalId);
      return rows.slice().sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
    },

    async assignMilestone(input: AssignMilestoneInput): Promise<Assignment> {
      const store = load();
      const goal = store.goals.find((g) => g.id === input.goalId);
      if (!goal) throw new Error(`Aim ${input.goalId} not found.`);
      const milestone = (store.milestonesByGoal[input.goalId] ?? []).find((m) => m.id === input.milestoneId);
      if (!milestone) throw new Error(`Milestone ${input.milestoneId} not found on aim ${input.goalId}.`);
      if (input.actorId && !store.actors.some((actor) => actor.id === input.actorId && actor.kind === input.actorKind)) {
        throw new Error(`Actor ${input.actorId} not found.`);
      }
      const now = nowIso();
      const existing = store.assignments.find((assignment) => assignment.milestone_id === milestone.id);
      if (existing) {
        existing.actor_kind = input.actorKind;
        existing.actor_id = input.actorId ?? null;
        existing.status = input.status ?? "assigned";
        existing.source = input.source ?? "user_override";
        existing.reason = input.reason ?? "Assignment updated by the user.";
        existing.capability_tags = input.capabilityTags ?? existing.capability_tags;
        existing.updated_at = now;
        save(store);
        return existing;
      }
      const assignment: Assignment = {
        id: nextId(),
        owner_id: input.ownerId ?? goal.owner_id,
        goal_id: goal.id,
        milestone_id: milestone.id,
        actor_kind: input.actorKind,
        actor_id: input.actorId ?? null,
        status: input.status ?? "assigned",
        source: input.source ?? "user_override",
        reason: input.reason ?? "Assignment created by the user.",
        capability_tags: input.capabilityTags ?? [],
        created_at: now,
        updated_at: now,
      };
      store.assignments.push(assignment);
      save(store);
      return assignment;
    },

    async listSubAimRelations(goalId: string | null = null): Promise<SubAimRelation[]> {
      const rows = load().subAimRelations.filter((relation) =>
        goalId === null || relation.parent_goal_id === goalId || relation.child_goal_id === goalId,
      );
      return rows.slice().sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
    },

    async listRuns(goalId: string | null = null): Promise<Run[]> {
      const rows = load().runs.filter((run) => goalId === null || run.goal_id === goalId);
      return rows.slice().sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
    },

    async createRun(input: CreateRunInput): Promise<Run> {
      const store = load();
      const goal = store.goals.find((g) => g.id === input.goalId);
      if (!goal) throw new Error(`Aim ${input.goalId} not found.`);
      const milestone = (store.milestonesByGoal[input.goalId] ?? []).find((m) => m.id === input.milestoneId);
      if (!milestone) throw new Error(`Milestone ${input.milestoneId} not found on aim ${input.goalId}.`);
      const assignment = input.assignmentId
        ? store.assignments.find((row) => row.id === input.assignmentId)
        : store.assignments.find((row) => row.milestone_id === milestone.id);
      const now = nowIso();
      const attempt = store.runs.filter((run) => run.milestone_id === milestone.id).length + 1;
      const status = input.status ?? "queued";
      const run: Run = {
        id: nextId(),
        owner_id: input.ownerId ?? goal.owner_id,
        goal_id: goal.id,
        milestone_id: milestone.id,
        assignment_id: assignment?.id ?? input.assignmentId ?? null,
        actor_kind: input.actorKind,
        actor_id: input.actorId ?? assignment?.actor_id ?? null,
        kind: input.actorKind === "agent" ? "agent" : "human",
        status,
        attempt,
        workspace_root: input.workspaceRoot ?? null,
        sandbox: input.sandbox ?? null,
        network_enabled: input.networkEnabled ?? false,
        model: input.model ?? null,
        reasoning: input.reasoning ?? null,
        summary: input.summary ?? "",
        error: null,
        queued_at: now,
        started_at: status === "running" ? now : null,
        finished_at: null,
        created_at: now,
      };
      store.runs.push(run);
      if (assignment && assignment.status !== "cancelled") {
        assignment.status = status === "queued" ? "assigned" : status === "running" ? "running" : assignment.status;
        assignment.updated_at = now;
      }
      store.runEvents.push({
        id: nextId(),
        owner_id: run.owner_id,
        run_id: run.id,
        type: status === "running" ? "run.started" : "run.queued",
        summary: input.summary ?? "",
        payload: {},
        created_at: now,
      });
      save(store);
      return run;
    },

    async appendRunEvent(input: AppendRunEventInput): Promise<RunEvent | null> {
      const store = load();
      const run = store.runs.find((row) => row.id === input.runId);
      if (!run) return null;
      const event: RunEvent = {
        id: nextId(),
        owner_id: input.ownerId ?? run.owner_id,
        run_id: run.id,
        type: input.type,
        summary: input.summary ?? "",
        payload: input.payload ?? {},
        created_at: nowIso(),
      };
      store.runEvents.push(event);
      save(store);
      return event;
    },

    async finishRun(input: FinishRunInput): Promise<Run | null> {
      const store = load();
      const run = store.runs.find((row) => row.id === input.runId);
      if (!run) return null;
      const now = nowIso();
      run.status = input.status;
      run.summary = input.summary ?? run.summary;
      run.error = input.error ?? null;
      run.finished_at = now;
      if (!run.started_at) run.started_at = run.queued_at ?? now;
      const assignment = run.assignment_id ? store.assignments.find((row) => row.id === run.assignment_id) : null;
      if (assignment && assignment.status !== "completed" && assignment.status !== "cancelled") {
        assignment.status = input.status === "completed" ? "assigned" : input.status === "failed" ? "blocked" : input.status;
        assignment.updated_at = now;
      }
      store.runEvents.push({
        id: nextId(),
        owner_id: run.owner_id,
        run_id: run.id,
        type: input.status === "completed" ? "run.completed" : input.status === "cancelled" ? "run.cancelled" : "run.failed",
        summary: input.summary ?? input.error ?? "",
        payload: {},
        created_at: now,
      });
      save(store);
      return run;
    },

    async recordToolTrace(input: RecordToolTraceInput): Promise<ToolTrace> {
      const store = load();
      const now = nowIso();
      const trace: ToolTrace = {
        id: nextId(),
        owner_id: input.ownerId ?? store.ownerId,
        session_id: input.sessionId ?? null,
        tool_name: input.toolName,
        status: input.status,
        summary: input.summary ?? "",
        sources: input.sources ?? [],
        error: input.error ?? null,
        started_at: input.startedAt ?? null,
        finished_at: input.finishedAt ?? (input.status === "succeeded" || input.status === "failed" || input.status === "blocked" ? now : null),
        created_at: now,
      };
      store.toolTraces.push(trace);
      save(store);
      return trace;
    },

    async createContextIntakeSession(input: CreateContextIntakeSessionInput): Promise<ContextIntakeSession> {
      const store = load();
      const now = nowIso();
      const traceIds = new Set(input.toolTraceIds ?? []);
      const decision = decideContextIntakeSession({
        aimTitle: input.aimTitle,
        aimDescription: input.aimDescription,
        goalId: input.goalId,
        readiness: input.readiness,
        missingQuestions: input.missingQuestions,
        blockedReasons: input.blockedReasons,
        toolTraces: store.toolTraces.filter((trace) => traceIds.has(trace.id)),
      });
      const session: ContextIntakeSession = {
        id: nextId(),
        owner_id: input.ownerId ?? store.ownerId,
        ...decision,
        started_at: now,
        closed_at: decision.status === "ready" ? now : null,
        created_at: now,
      };
      store.contextIntakeSessions.push(session);
      save(store);
      return session;
    },

    async sedimentContextFromGoal(goalId: string): Promise<Memory[]> {
      const store = load();
      const goal = store.goals.find((row) => row.id === goalId);
      if (!goal) throw new Error(`Aim ${goalId} not found.`);
      const milestones = store.milestonesByGoal[goalId] ?? [];
      const candidates = deriveContextCandidatesFromWork({
        goal,
        milestones,
        evidence: store.evidence.filter((row) => row.goal_id === goalId),
        runs: store.runs.filter((row) => row.goal_id === goalId),
        completions: store.completions.filter((completion) => milestones.some((milestone) => milestone.id === completion.milestone_id)),
      });
      const created: Memory[] = [];
      for (const candidate of candidates) {
        const content = normalizeMemoryContent(candidate.content);
        if (!content) continue;
        const scopedGoalId = candidate.scope === "aim" ? goalId : null;
        const duplicate = findDuplicateMemory(store, content, scopedGoalId);
        if (duplicate) {
          created.push(duplicate);
          continue;
        }
        const memory: Memory = {
          id: nextId(),
          owner_id: goal.owner_id,
          goal_id: scopedGoalId,
          kind: candidate.category === "procedure" ? "procedural" : "semantic",
          category: candidate.category,
          content,
          confidence: candidate.confidence ?? 0.7,
          source: "evidence_derived",
          status: "pending",
          superseded_by: null,
          created_at: nowIso(),
        };
        store.memories.push(memory);
        created.push(memory);
      }
      save(store);
      return created;
    },

    async getAimProgress(goalId: string): Promise<AimProgressReadModel | null> {
      const store = load();
      const goal = store.goals.find((row) => row.id === goalId);
      if (!goal) return null;
      const milestones = store.milestonesByGoal[goalId] ?? [];
      const milestoneIds = new Set(milestones.map((milestone) => milestone.id));
      const contextCandidates = store.memories.filter((memory) =>
        memory.status === "pending" && (memory.goal_id === null || memory.goal_id === goalId),
      );
      const acceptedContext = store.memories.filter((memory) =>
        memory.status === "active" && memory.goal_id === goalId,
      );
      return buildAimProgressReadModel({
        goal,
        milestones,
        actors: store.actors,
        assignments: store.assignments.filter((assignment) => assignment.goal_id === goalId),
        runs: store.runs.filter((run) => run.goal_id === goalId),
        subAimRelations: store.subAimRelations.filter((relation) =>
          relation.parent_goal_id === goalId || relation.child_goal_id === goalId,
        ),
        goals: store.goals,
        milestonesByGoal: store.milestonesByGoal,
        evidence: store.evidence.filter((row) => row.goal_id === goalId),
        completions: store.completions.filter((completion) => milestoneIds.has(completion.milestone_id)),
        contextCandidates,
        acceptedContext,
      });
    },

    async exportData(): Promise<LocalStore> {
      return load();
    },

    async importData(snapshot: LocalStore, mode: "merge" | "replace" = "merge"): Promise<ImportStoreResult> {
      const incoming: LocalStore = {
        ownerId: snapshot.ownerId ?? DEFAULT_OWNER,
        goals: snapshot.goals ?? [],
        aimDrafts: (snapshot.aimDrafts ?? []).map(normalizeAimDraftRow).filter((row): row is AimDraftRow => row !== null),
        milestonesByGoal: snapshot.milestonesByGoal ?? {},
        memories: (snapshot.memories ?? []).map(normalizeMemoryRow),
        evidence: snapshot.evidence ?? [],
        completions: snapshot.completions ?? [],
        actors: snapshot.actors ?? [],
        subAimRelations: snapshot.subAimRelations ?? [],
        assignments: snapshot.assignments ?? [],
        runs: snapshot.runs ?? [],
        runEvents: snapshot.runEvents ?? [],
        toolTraces: snapshot.toolTraces ?? [],
        evidenceAttributions: snapshot.evidenceAttributions ?? [],
        contextIntakeSessions: snapshot.contextIntakeSessions ?? [],
      };
      if (mode === "replace") {
        save(incoming);
        return {
          goals: incoming.goals.length,
          aimDrafts: incoming.aimDrafts.length,
          milestones: allMilestones(incoming).length,
          memories: incoming.memories.length,
          evidence: incoming.evidence.length,
          completions: incoming.completions.length,
          actors: incoming.actors.length,
          subAimRelations: incoming.subAimRelations.length,
          assignments: incoming.assignments.length,
          runs: incoming.runs.length,
          runEvents: incoming.runEvents.length,
          toolTraces: incoming.toolTraces.length,
          evidenceAttributions: incoming.evidenceAttributions.length,
          contextIntakeSessions: incoming.contextIntakeSessions.length,
        };
      }

      const store = load();
      const mergeRows = <T extends { id: string }>(current: T[], next: T[]): number => {
        let added = 0;
        const byId = new Map(current.map((row) => [row.id, row]));
        for (const row of next) {
          if (!byId.has(row.id)) {
            current.push(row);
            added += 1;
          }
        }
        return added;
      };

      const goals = mergeRows(store.goals, incoming.goals);
      const aimDrafts = mergeRows(store.aimDrafts, incoming.aimDrafts);
      const memories = mergeRows(store.memories, incoming.memories);
      const evidence = mergeRows(store.evidence, incoming.evidence);
      const completions = mergeRows(store.completions, incoming.completions);
      const actors = mergeRows(store.actors, incoming.actors);
      const subAimRelations = mergeRows(store.subAimRelations, incoming.subAimRelations);
      const assignments = mergeRows(store.assignments, incoming.assignments);
      const runs = mergeRows(store.runs, incoming.runs);
      const runEvents = mergeRows(store.runEvents, incoming.runEvents);
      const toolTraces = mergeRows(store.toolTraces, incoming.toolTraces);
      const evidenceAttributions = mergeRows(store.evidenceAttributions, incoming.evidenceAttributions);
      const contextIntakeSessions = mergeRows(store.contextIntakeSessions, incoming.contextIntakeSessions);
      let milestones = 0;
      for (const [goalId, nextRows] of Object.entries(incoming.milestonesByGoal)) {
        store.milestonesByGoal[goalId] ??= [];
        milestones += mergeRows(store.milestonesByGoal[goalId], nextRows);
      }
      save(store);
      return {
        goals,
        aimDrafts,
        milestones,
        memories,
        evidence,
        completions,
        actors,
        subAimRelations,
        assignments,
        runs,
        runEvents,
        toolTraces,
        evidenceAttributions,
        contextIntakeSessions,
      };
    },
  };
}
