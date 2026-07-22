/**
 * The IPC contract shared by main (handlers), preload (bridge), and renderer (types).
 * Renderer imports these as `import type` only, so this module is erased from the
 * renderer bundle — only main/preload pull in the channel constants at runtime.
 */
import type { AimDraft, DecompositionOutput, Goal, ManualEvidenceRequiredItem, Memory, Milestone, RunEvent } from "@aimcub/types";
import type { AimIntakeReport, AimProgressReadModel, AimProgressSummary, ContextHealthRow, ContextLineageLearningReport, ContextProfileReport, DecompositionLearningReport, DecompositionStrategyReport, PlanQualityReport, PlanReviewReport } from "@aimcub/core";
import type { LlmProvider } from "@aimcub/llm/providers";
import type { ContextSourceSettings, StoreDiagnostic, UpsertAimDraftInput } from "@aimcub/store";
import type {
  LocalAgentDetection,
  LocalAgentEvent,
  LocalAgentId,
  LocalAgentRunRequest,
  LocalAgentRunResult,
} from "@aimcub/local-agent";
import type {
  ClarifyOutput,
  ClarifyQuestion,
  ClarifyAnswer,
  ClarifyAssumption,
  ClarifyAnswerImpactReport,
  ClarifyLearningReport,
  ContextDistillOutput,
  AimcubToolObservation,
  LlmTask,
  LlmUsage,
  PlanningToolObservationEvent,
  PlanningContextSelectionReport,
  PlanningToolFailure,
} from "@aimcub/llm";

export interface DraftRequest {
  title: string;
  description?: string;
  clientRunId?: string;
}

/**
 * One turn of the adaptive pre-draft Context interview. The renderer sends the
 * accumulated, already-visible questions and answers so the next question can
 * react to what the user actually said instead of replaying a static form.
 */
export interface IntakeRequest extends DraftRequest {
  priorQuestions?: ClarifyQuestion[];
  answers?: ClarifyAnswer[];
  maxQuestions?: number;
}

export interface ClarifyRequest {
  title: string;
  description?: string;
  draft: DecompositionOutput;
  clientRunId?: string;
}

export interface RefineRequest {
  title: string;
  description?: string;
  draft: DecompositionOutput;
  questions: ClarifyQuestion[];
  answers: ClarifyAnswer[];
  reviewPrompt?: string;
  clientRunId?: string;
}

export interface SaveRequest {
  draftId?: string;
  title: string;
  description?: string;
  parentGoalId?: string;
  parentMilestoneId?: string;
  draft?: DecompositionOutput | null;
  plan: DecompositionOutput;
  quality?: PlanQualityReport | null;
  review?: PlanReviewReport | null;
  qualityRetry?: {
    retried: boolean;
    attempts: number;
    firstQuality: PlanQualityReport | null;
  };
  debugTrace?: PlanningDebugTrace | null;
  questions: ClarifyQuestion[];
  answers: ClarifyAnswer[];
  assumptions?: ClarifyAssumption[];
}

/**
 * Create a plan-less "shell" aim (goal-first): the Goal is persisted immediately with no plan so the
 * Journey mounts right away. There is intentionally NO `plan` — the first plan lands later via
 * {@link UpdateGoalPlanRequest}.
 */
export interface CreateAimRequest {
  title: string;
  description?: string;
  parentGoalId?: string;
  parentMilestoneId?: string;
  /** A pre-goal composer draft to discard once the shell is created (parity with `saveGoal`). */
  draftId?: string;
}

/**
 * Land or re-plan the plan of an EXISTING aim in place (no fork). Two honest modes:
 *  - planning-run mode (`questions`/`answers` present): the first plan for a shell, or a re-plan
 *    from a fresh planning run — the handler recomputes the same synthesis bundle `saveGoal` folds
 *    into metadata + records context candidates.
 *  - manual-edit mode (no `questions`/`answers`): a direct plan edit — no fabricated intake/critique
 *    metadata; existing metadata is preserved (only the handoff manifest is regenerated).
 * Milestones are merged via `planMerge` (completed work frozen), never overwritten.
 */
export interface UpdateGoalPlanRequest {
  goalId: string;
  title?: string;
  description?: string;
  draft?: DecompositionOutput | null;
  plan: DecompositionOutput;
  quality?: PlanQualityReport | null;
  review?: PlanReviewReport | null;
  qualityRetry?: {
    retried: boolean;
    attempts: number;
    firstQuality: PlanQualityReport | null;
  };
  debugTrace?: PlanningDebugTrace | null;
  questions?: ClarifyQuestion[];
  answers?: ClarifyAnswer[];
  assumptions?: ClarifyAssumption[];
  /** A funnel draft to discard once the plan lands (parity with `saveGoal`'s draft cleanup). */
  draftId?: string;
}

/**
 * Rename an existing aim's title/description in place — no plan change. Works on a plan-less shell
 * or a planned goal (unlike {@link UpdateGoalPlanRequest}, which requires a plan).
 */
export interface RenameAimRequest {
  goalId: string;
  title?: string;
  description?: string;
}

/**
 * A decomposition result over IPC. There is no offline/template fallback: when no
 * provider is configured or the LLM call fails, `ok` is false and `errors` carries the
 * reason for the UI to surface honestly.
 */
export interface PlanResult {
  ok: boolean;
  output: DecompositionOutput | null;
  errors: string[];
  intake?: AimIntakeReport | null;
  quality?: PlanQualityReport | null;
  review?: PlanReviewReport | null;
  qualityRetry?: {
    retried: boolean;
    attempts: number;
    firstQuality: PlanQualityReport | null;
  };
  debugTrace?: PlanningDebugTrace | null;
  planningContext?: PlanningContextSelectionReport | null;
  planningTools?: PlanningToolIpcTrace | null;
}

export interface ClarifyIpcResult {
  ok: boolean;
  output: ClarifyOutput | null;
  errors: string[];
  debugTrace?: PlanningDebugTrace | null;
  planningTools?: PlanningToolIpcTrace | null;
}

export type PlanningRunStage = "intake" | "draft" | "clarify" | "refine";
export type PlanningDebugTraceStage = PlanningRunStage | "planning";

export interface PlanningModelRunTrace {
  id: string;
  stage: PlanningRunStage;
  task: LlmTask;
  status: "ok" | "error";
  structured: boolean;
  hasSchema: boolean;
  startedAt: string;
  durationMs: number;
  promptChars: number;
  systemChars: number;
  promptPreview?: string;
  systemPreview?: string;
  model: string | null;
  usage: LlmUsage | null;
  error?: string;
}

export interface PlanningDebugTrace {
  version: 1;
  stage: PlanningDebugTraceStage;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  modelRuns: PlanningModelRunTrace[];
}

export interface PlanningLiveModelRun {
  id: string;
  stage: PlanningRunStage;
  task: LlmTask;
  status: "running" | "ok" | "error";
  structured: boolean;
  hasSchema: boolean;
  startedAt: string;
  durationMs?: number;
  promptChars: number;
  systemChars: number;
  promptPreview?: string;
  systemPreview?: string;
  model: string | null;
  usage?: LlmUsage | null;
  error?: string;
}

export type PlanningLiveEventType =
  | "planning.started"
  | "context.started"
  | "context.completed"
  | "model.started"
  | "model.completed"
  | "model.failed"
  | "intake.completed"
  | "draft.completed"
  | "clarify.started"
  | "clarify.completed"
  | "refine.started"
  | "refine.completed"
  | "planning.failed";

export interface PlanningLiveSummary {
  selectedContext?: number;
  ignoredContext?: number;
  totalContext?: number;
  observationCount?: number;
  failureCount?: number;
  candidateCount?: number;
  milestoneCount?: number;
  questionCount?: number;
  qualityScore?: number;
  qualityGrade?: string;
  errorCount?: number;
}

export interface PlanningLiveEvent {
  runId: string;
  type: PlanningLiveEventType;
  stage: PlanningDebugTraceStage;
  at: string;
  message?: string;
  modelRun?: PlanningLiveModelRun;
  planningContext?: PlanningContextSelectionReport | null;
  planningTools?: PlanningToolIpcTrace | null;
  intake?: AimIntakeReport | null;
  summary?: PlanningLiveSummary;
  error?: string;
}

export interface PlanningToolIpcTrace {
  observations: Array<AimcubToolObservation<unknown>>;
  observationEvents?: PlanningToolObservationEvent[];
  failures: PlanningToolFailure[];
  distillation: ContextDistillOutput | null;
}

export interface SavedGoal {
  goal: Goal;
  milestones: Milestone[];
  contextCandidates?: Memory[];
  answerImpact?: ClarifyAnswerImpactReport | null;
}

export interface GoalDetail {
  goal: Goal;
  milestones: Milestone[];
}

export type UpsertAimDraftRequest = UpsertAimDraftInput;

export interface ConfirmMilestoneRequest {
  goalId: string;
  milestoneId: string;
  summary?: string;
  proofNote?: string;
  urls?: string[];
  filePaths?: string[];
  requiredEvidence?: ManualEvidenceRequiredItem[];
}

export interface AcceptContextCandidateRequest {
  id: string;
  content?: string;
  scope?: "aim" | "global";
}

export interface DeprioritizeContextMemoryRequest {
  id: string;
  confidence?: number;
}

// ── LLM provider configuration (multi-provider / BYO-key) ────────────────────

/**
 * Which gateway to build. `anthropic` uses the native Messages API; direct providers such
 * as OpenAI, DeepSeek, MiniMax, Z.ai, Google, and Qwen use catalog-backed defaults; the
 * `openai-compatible` escape hatch targets any custom `/chat/completions` endpoint.
 */
export type { LlmProvider };

/** What the renderer sends to configure the provider (includes the secret key). */
export interface ProviderConfig {
  provider: LlmProvider;
  /** Leave blank on update to keep the already-stored key. */
  apiKey: string;
  /** API root for OpenAI-compatible providers. Empty ⇒ provider default. */
  baseURL?: string;
  /** The selected model id. */
  model?: string;
}

/** What the renderer reads back — never includes the secret key. */
export interface ProviderStatus {
  /** True when a usable gateway can be built (provider + key + selected/default model). */
  configured: boolean;
  provider: LlmProvider | null;
  baseURL: string | null;
  model: string | null;
  /** Whether a key is on file (so the form can offer "leave blank to keep"). */
  hasApiKey: boolean;
}

/** Result of a live provider/model connection probe. Never includes the secret key. */
export interface ProviderTestResult {
  ok: boolean;
  provider: LlmProvider;
  model: string | null;
  baseURL: string | null;
  error: string | null;
  latencyMs: number;
}

export interface WebResearchConfig {
  provider: "brave";
  /** Leave blank on update to keep the already-stored key. */
  apiKey: string;
  enabled: boolean;
  fetchPages: boolean;
}

export interface WebResearchStatus {
  configured: boolean;
  provider: "brave";
  enabled: boolean;
  fetchPages: boolean;
  hasApiKey: boolean;
  keySource: "env" | "settings" | null;
}

export interface WebResearchTestResult {
  ok: boolean;
  provider: "brave";
  resultCount: number;
  error: string | null;
  latencyMs: number;
}

export type ContextSourceConfig = ContextSourceSettings;

export interface ContextSourceStatus extends ContextSourceSettings {
  local: ContextSourceSettings["local"] & {
    configured: boolean;
    source: "settings" | "env" | null;
    resolvedWorkspaceRoot: string | null;
    resolvedFilePaths: string[];
  };
  online: ContextSourceSettings["online"] & {
    configuredCount: number;
    enabledCount: number;
  };
}

export interface LocalContextPickResult {
  canceled: boolean;
  paths: string[];
}

export type {
  LocalAgentDetection,
  LocalAgentEvent,
  LocalAgentId,
  LocalAgentModelOption,
  LocalAgentRunRequest,
  LocalAgentRunResult,
  LocalAgentSandboxMode,
} from "@aimcub/local-agent";

/**
 * The sandbox levels the cockpit will ask a user to consent to. `danger-full-access` is
 * deliberately absent — no Desktop control can grant it, and the main process rejects it even
 * if a compromised renderer asks. See `docs/agent-permissions.md`.
 */
export type DesktopRunSandbox = "read-only" | "workspace-write";

/** What the user explicitly granted one run, captured before it is queued. */
export interface RunPermissionConsent {
  sandbox: DesktopRunSandbox;
  network: boolean;
  /** The folder a `workspace-write` run may write in. Required for it; ignored when read-only. */
  workspace?: string | null;
}

export interface RunMilestoneAgentRequest {
  goalId: string;
  milestoneId: string;
  agentId?: LocalAgentId;
  model?: string;
  prompt?: string;
  /** Omitted ⇒ the read-only, network-off floor. Anything else is an explicit user grant. */
  permission?: RunPermissionConsent;
}

/**
 * Enqueue-and-return: the handler puts the sub-aim on the durable run queue and answers
 * immediately with the queued run's id. Everything after that arrives on {@link IPC.runLiveEvent}
 * and lands in the store, so a run outlives the window that started it.
 */
export interface RunMilestoneAgentResult {
  ok: boolean;
  runId: string | null;
  error: string | null;
  /** The permission the main process actually recorded on the run — never wider than requested. */
  permission: RunPermissionConsent | null;
}

/**
 * Corruption/recovery events the shared store noticed while loading. Surfaced honestly instead of
 * letting a quarantined file look like an empty workspace.
 */
export type { StoreDiagnostic, StoreDiagnosticKind } from "@aimcub/store";

/** Desktop-only preferences (not shared with the CLI), persisted beside the store. */
export interface DesktopPreferences {
  /**
   * Developer mode. Off is the product: no debug, trace, or raw-payload surface renders anywhere
   * in the cockpit. On reveals them for people debugging Aimcub itself.
   */
  developerMode: boolean;
}

/** One normalized event of a worker-executed run, pushed live as it happens. */
export interface RunLiveEvent {
  goalId: string;
  runId: string;
  milestoneId: string;
  at: string;
  event: LocalAgentEvent;
}

export type SystemColorScheme = "light" | "dark";

/** Renderer theme preference pushed to the main process to drive native window chrome. */
export type WindowThemeSource = "system" | "light" | "dark";

export interface WindowChromeState {
  fullscreen: boolean;
  colorScheme: SystemColorScheme;
}

/** Static app facts for Settings (About / General). Never includes a secret. */
export interface AppInfo {
  version: string;
  /** Resolved local workspace root (~/.aimcub or $AIMCUB_HOME). */
  workspacePath: string;
}

/** The typed surface exposed on `window.aimcub` by the preload bridge. */
export interface AimcubApi {
  intake(req: IntakeRequest): Promise<AimIntakeReport>;
  draft(req: DraftRequest): Promise<PlanResult>;
  clarify(req: ClarifyRequest): Promise<ClarifyIpcResult>;
  refine(req: RefineRequest): Promise<PlanResult>;
  saveGoal(req: SaveRequest): Promise<SavedGoal>;
  /** Create a plan-less shell aim (goal-first) so the Journey can mount before planning. */
  createAim(req: CreateAimRequest): Promise<SavedGoal>;
  /** Land or re-plan the plan of an existing aim in place (no fork); null if the aim is gone. */
  updateGoalPlan(req: UpdateGoalPlanRequest): Promise<SavedGoal | null>;
  /** Rename an aim's title/description in place (works on a plan-less shell); null if the aim is gone. */
  renameGoal(req: RenameAimRequest): Promise<Goal | null>;
  listGoals(): Promise<Goal[]>;
  getGoal(id: string): Promise<GoalDetail | null>;
  getAimProgress(id: string): Promise<AimProgressReadModel | null>;
  /** The run-lifecycle event stream for one aim — a separate call so it never bloats the hot `getAimProgress`. */
  getAimJournal(id: string): Promise<RunEvent[]>;
  /** A coarse per-aim progress rollup for every aim, so list surfaces avoid firing N `getAimProgress` calls. */
  listAimProgressSummaries(): Promise<AimProgressSummary[]>;
  deleteGoal(id: string): Promise<void>;
  listAimDrafts(): Promise<AimDraft[]>;
  getAimDraft(id: string): Promise<AimDraft | null>;
  upsertAimDraft(req: UpsertAimDraftRequest): Promise<AimDraft>;
  discardAimDraft(id: string): Promise<void>;
  listMemories(goalId?: string | null): Promise<Memory[]>;
  listContextCandidates(): Promise<Memory[]>;
  listContextHistory(): Promise<Memory[]>;
  listContextProfile(): Promise<ContextProfileReport>;
  listContextHealth(): Promise<ContextHealthRow[]>;
  listContextLearning(): Promise<ClarifyLearningReport>;
  listContextLineageLearning(): Promise<ContextLineageLearningReport>;
  listContextDecompositionLearning(): Promise<DecompositionLearningReport>;
  listContextDecompositionStrategy(req: DraftRequest): Promise<DecompositionStrategyReport>;
  archiveContextMemory(id: string): Promise<Memory | null>;
  deprioritizeContextMemory(req: DeprioritizeContextMemoryRequest): Promise<Memory | null>;
  acceptContextCandidate(req: AcceptContextCandidateRequest): Promise<Memory | null>;
  rejectContextCandidate(id: string): Promise<Memory | null>;
  getProviderConfig(): Promise<ProviderStatus>;
  setProviderConfig(config: ProviderConfig): Promise<ProviderStatus>;
  testProviderConfig(config: ProviderConfig): Promise<ProviderTestResult>;
  getWebResearchConfig(): Promise<WebResearchStatus>;
  setWebResearchConfig(config: WebResearchConfig): Promise<WebResearchStatus>;
  testWebResearchConfig(config: WebResearchConfig): Promise<WebResearchTestResult>;
  getContextSourceConfig(): Promise<ContextSourceStatus>;
  setContextSourceConfig(config: ContextSourceConfig): Promise<ContextSourceStatus>;
  pickLocalContextFolder(): Promise<LocalContextPickResult>;
  pickLocalContextFiles(): Promise<LocalContextPickResult>;
  listLocalAgents(): Promise<LocalAgentDetection[]>;
  runLocalAgent(req: LocalAgentRunRequest): Promise<LocalAgentRunResult>;
  runMilestoneAgent(req: RunMilestoneAgentRequest): Promise<RunMilestoneAgentResult>;
  /**
   * Abort a run: aborts it in-process if it is actively executing, otherwise cancels it in place
   * if it is still queued (e.g. a stranded run nobody re-granted). Resolves false when neither
   * applies — the run already settled, or is executing in a different process.
   */
  cancelRun(runId: string): Promise<boolean>;
  /**
   * Execute a run this session did not enqueue but the user just re-confirmed — the re-grant path
   * for a `workspace-write` run a previous session left queued. Claims by id only: the permission
   * was fixed at enqueue time and is never re-negotiated here (`docs/agent-permissions.md`).
   */
  claimQueuedRun(runId: string): Promise<void>;
  confirmMilestone(req: ConfirmMilestoneRequest): Promise<GoalDetail | null>;
  getWindowChromeState(): Promise<WindowChromeState>;
  /** Drive the native window appearance (titlebar/background/traffic-light context) from the in-app theme toggle. */
  setThemeSource(source: WindowThemeSource): Promise<void>;
  /** Static app facts for Settings → General / About. */
  getAppInfo(): Promise<AppInfo>;
  /** Reveal the local workspace directory (~/.aimcub or $AIMCUB_HOME) in the OS file manager. */
  revealWorkspace(): Promise<void>;
  /** Store corruption/recovery reports, so the cockpit can say what happened to the data. */
  getStoreDiagnostics(): Promise<StoreDiagnostic[]>;
  getDesktopPreferences(): Promise<DesktopPreferences>;
  setDesktopPreferences(prefs: DesktopPreferences): Promise<DesktopPreferences>;
  /** Pick the folder a `workspace-write` run may write in. Cancelling grants nothing. */
  pickRunWorkspace(): Promise<LocalContextPickResult>;
  onWindowChromeState(handler: (state: WindowChromeState) => void): () => void;
  onPlanningLiveEvent(handler: (event: PlanningLiveEvent) => void): () => void;
  onRunLiveEvent(handler: (event: RunLiveEvent) => void): () => void;
}

/** Channel names — kept in one place so main and preload can't drift. */
export const IPC = {
  intake: "aimcub:intake",
  draft: "aimcub:draft",
  clarify: "aimcub:clarify",
  refine: "aimcub:refine",
  saveGoal: "aimcub:saveGoal",
  createAim: "aimcub:createAim",
  updateGoalPlan: "aimcub:updateGoalPlan",
  renameGoal: "aimcub:renameGoal",
  listGoals: "aimcub:listGoals",
  getGoal: "aimcub:getGoal",
  getAimProgress: "aimcub:getAimProgress",
  getAimJournal: "aimcub:getAimJournal",
  listAimProgressSummaries: "aimcub:listAimProgressSummaries",
  deleteGoal: "aimcub:deleteGoal",
  listAimDrafts: "aimcub:listAimDrafts",
  getAimDraft: "aimcub:getAimDraft",
  upsertAimDraft: "aimcub:upsertAimDraft",
  discardAimDraft: "aimcub:discardAimDraft",
  listMemories: "aimcub:listMemories",
  listContextCandidates: "aimcub:listContextCandidates",
  listContextHistory: "aimcub:listContextHistory",
  listContextProfile: "aimcub:listContextProfile",
  listContextHealth: "aimcub:listContextHealth",
  listContextLearning: "aimcub:listContextLearning",
  listContextLineageLearning: "aimcub:listContextLineageLearning",
  listContextDecompositionLearning: "aimcub:listContextDecompositionLearning",
  listContextDecompositionStrategy: "aimcub:listContextDecompositionStrategy",
  archiveContextMemory: "aimcub:archiveContextMemory",
  deprioritizeContextMemory: "aimcub:deprioritizeContextMemory",
  acceptContextCandidate: "aimcub:acceptContextCandidate",
  rejectContextCandidate: "aimcub:rejectContextCandidate",
  getProviderConfig: "aimcub:getProviderConfig",
  setProviderConfig: "aimcub:setProviderConfig",
  testProviderConfig: "aimcub:testProviderConfig",
  getWebResearchConfig: "aimcub:getWebResearchConfig",
  setWebResearchConfig: "aimcub:setWebResearchConfig",
  testWebResearchConfig: "aimcub:testWebResearchConfig",
  getContextSourceConfig: "aimcub:getContextSourceConfig",
  setContextSourceConfig: "aimcub:setContextSourceConfig",
  pickLocalContextFolder: "aimcub:pickLocalContextFolder",
  pickLocalContextFiles: "aimcub:pickLocalContextFiles",
  listLocalAgents: "aimcub:listLocalAgents",
  runLocalAgent: "aimcub:runLocalAgent",
  runMilestoneAgent: "aimcub:runMilestoneAgent",
  cancelRun: "aimcub:cancelRun",
  claimQueuedRun: "aimcub:claimQueuedRun",
  confirmMilestone: "aimcub:confirmMilestone",
  getWindowChromeState: "aimcub:getWindowChromeState",
  setThemeSource: "aimcub:setThemeSource",
  getAppInfo: "aimcub:getAppInfo",
  revealWorkspace: "aimcub:revealWorkspace",
  getStoreDiagnostics: "aimcub:getStoreDiagnostics",
  getDesktopPreferences: "aimcub:getDesktopPreferences",
  setDesktopPreferences: "aimcub:setDesktopPreferences",
  pickRunWorkspace: "aimcub:pickRunWorkspace",
  windowChromeState: "aimcub:windowChromeState",
  planningLiveEvent: "aimcub:planningLiveEvent",
  runLiveEvent: "aimcub:runLiveEvent",
} as const;

declare global {
  interface Window {
    aimcub: AimcubApi;
  }
}
