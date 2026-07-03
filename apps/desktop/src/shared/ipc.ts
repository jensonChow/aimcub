/**
 * The IPC contract shared by main (handlers), preload (bridge), and renderer (types).
 * Renderer imports these as `import type` only, so this module is erased from the
 * renderer bundle — only main/preload pull in the channel constants at runtime.
 */
import type { DecompositionOutput, Goal, Memory, Milestone } from "@core/types";
import type { AimIntakeReport, AimProgressReadModel, ContextHealthRow, ContextLineageLearningReport, ContextProfileReport, DecompositionLearningReport, DecompositionStrategyReport, PlanQualityReport, PlanReviewReport } from "@core/domain";
import type { LlmProvider } from "@core/llm/providers";
import type {
  ClarifyOutput,
  ClarifyQuestion,
  ClarifyAnswer,
  ClarifyAssumption,
  ClarifyAnswerImpactReport,
  ClarifyLearningReport,
  ContextDistillOutput,
  AimcubToolObservation,
  PlanningToolObservationEvent,
  PlanningContextSelectionReport,
  PlanningToolFailure,
} from "@core/llm";

export interface DraftRequest {
  title: string;
  description?: string;
}

export interface ClarifyRequest {
  title: string;
  description?: string;
  draft: DecompositionOutput;
}

export interface RefineRequest {
  title: string;
  description?: string;
  draft: DecompositionOutput;
  questions: ClarifyQuestion[];
  answers: ClarifyAnswer[];
  reviewPrompt?: string;
}

export interface SaveRequest {
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
  questions: ClarifyQuestion[];
  answers: ClarifyAnswer[];
  assumptions?: ClarifyAssumption[];
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
  planningContext?: PlanningContextSelectionReport | null;
  planningTools?: PlanningToolIpcTrace | null;
}

export interface ClarifyIpcResult {
  ok: boolean;
  output: ClarifyOutput | null;
  errors: string[];
  planningTools?: PlanningToolIpcTrace | null;
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

export interface ConfirmMilestoneRequest {
  goalId: string;
  milestoneId: string;
  summary?: string;
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

export type LocalAgentId = "codex" | "claude";

export type LocalAgentSandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export interface LocalAgentModelOption {
  id: string;
  label: string;
}

export interface LocalAgentDetection {
  id: LocalAgentId;
  name: string;
  runMode: "local_cli";
  available: boolean;
  path: string | null;
  version: string | null;
  authStatus: "ok" | "missing" | "unknown";
  authMessage: string | null;
  models: LocalAgentModelOption[];
  modelsSource: "live" | "fallback";
  reasoningOptions: LocalAgentModelOption[];
  diagnostics: string[];
}

export interface LocalAgentRunRequest {
  agentId: LocalAgentId;
  prompt: string;
  cwd?: string;
  model?: string;
  reasoning?: string;
  extraAllowedDirs?: string[];
  timeoutMs?: number;
  permission?: {
    sandbox?: LocalAgentSandboxMode;
    network?: boolean;
  };
}

export interface LocalAgentEvent {
  type:
    | "agent.run.started"
    | "agent.message.delta"
    | "agent.tool.started"
    | "agent.tool.finished"
    | "agent.usage.reported"
    | "agent.run.completed"
    | "agent.run.failed"
    | "agent.stderr"
    | "agent.raw";
  summary: string;
  sessionId?: string;
  toolId?: string;
  toolName?: string;
  usage?: Record<string, number>;
  raw?: unknown;
}

export interface LocalAgentRunResult {
  ok: boolean;
  agentId: LocalAgentId;
  command: string;
  args: string[];
  events: LocalAgentEvent[];
  outputText: string;
  exitCode: number | null;
  error: string | null;
  durationMs: number;
}

export interface RunMilestoneAgentRequest {
  goalId: string;
  milestoneId: string;
  agentId?: LocalAgentId;
  prompt?: string;
}

export interface RunMilestoneAgentResult {
  ok: boolean;
  run: LocalAgentRunResult | null;
  detail: GoalDetail | null;
  error: string | null;
}

/** The typed surface exposed on `window.aimcub` by the preload bridge. */
export interface AimcubApi {
  intake(req: DraftRequest): Promise<AimIntakeReport>;
  draft(req: DraftRequest): Promise<PlanResult>;
  clarify(req: ClarifyRequest): Promise<ClarifyIpcResult>;
  refine(req: RefineRequest): Promise<PlanResult>;
  saveGoal(req: SaveRequest): Promise<SavedGoal>;
  listGoals(): Promise<Goal[]>;
  getGoal(id: string): Promise<GoalDetail | null>;
  getAimProgress(id: string): Promise<AimProgressReadModel | null>;
  deleteGoal(id: string): Promise<void>;
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
  listLocalAgents(): Promise<LocalAgentDetection[]>;
  runLocalAgent(req: LocalAgentRunRequest): Promise<LocalAgentRunResult>;
  runMilestoneAgent(req: RunMilestoneAgentRequest): Promise<RunMilestoneAgentResult>;
  confirmMilestone(req: ConfirmMilestoneRequest): Promise<GoalDetail | null>;
}

/** Channel names — kept in one place so main and preload can't drift. */
export const IPC = {
  intake: "aimcub:intake",
  draft: "aimcub:draft",
  clarify: "aimcub:clarify",
  refine: "aimcub:refine",
  saveGoal: "aimcub:saveGoal",
  listGoals: "aimcub:listGoals",
  getGoal: "aimcub:getGoal",
  getAimProgress: "aimcub:getAimProgress",
  deleteGoal: "aimcub:deleteGoal",
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
  listLocalAgents: "aimcub:listLocalAgents",
  runLocalAgent: "aimcub:runLocalAgent",
  runMilestoneAgent: "aimcub:runMilestoneAgent",
  confirmMilestone: "aimcub:confirmMilestone",
} as const;

declare global {
  interface Window {
    aimcub: AimcubApi;
  }
}
