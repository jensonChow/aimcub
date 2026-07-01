/**
 * The IPC contract shared by main (handlers), preload (bridge), and renderer (types).
 * Renderer imports these as `import type` only, so this module is erased from the
 * renderer bundle — only main/preload pull in the channel constants at runtime.
 */
import type { DecompositionOutput, Goal, Memory, Milestone } from "@core/types";
import type { AimIntakeReport, ContextHealthRow, ContextLineageLearningReport, ContextProfileReport, DecompositionLearningReport, DecompositionStrategyReport, PlanQualityReport, PlanReviewReport } from "@core/domain";
import type { LlmProvider } from "@core/llm/providers";
import type {
  ClarifyOutput,
  ClarifyQuestion,
  ClarifyAnswer,
  ClarifyAssumption,
  ClarifyAnswerImpactReport,
  ClarifyLearningReport,
  PlanningContextSelectionReport,
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
}

export interface ClarifyIpcResult {
  ok: boolean;
  output: ClarifyOutput | null;
  errors: string[];
}

export interface SavedGoal {
  goal: Goal;
  milestones: Milestone[];
  contextCandidates?: Memory[];
  answerImpact?: ClarifyAnswerImpactReport | null;
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

/** The typed surface exposed on `window.aimcub` by the preload bridge. */
export interface AimcubApi {
  intake(req: DraftRequest): Promise<AimIntakeReport>;
  draft(req: DraftRequest): Promise<PlanResult>;
  clarify(req: ClarifyRequest): Promise<ClarifyIpcResult>;
  refine(req: RefineRequest): Promise<PlanResult>;
  saveGoal(req: SaveRequest): Promise<SavedGoal>;
  listGoals(): Promise<Goal[]>;
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
}

/** Channel names — kept in one place so main and preload can't drift. */
export const IPC = {
  intake: "aimcub:intake",
  draft: "aimcub:draft",
  clarify: "aimcub:clarify",
  refine: "aimcub:refine",
  saveGoal: "aimcub:saveGoal",
  listGoals: "aimcub:listGoals",
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
} as const;

declare global {
  interface Window {
    aimcub: AimcubApi;
  }
}
