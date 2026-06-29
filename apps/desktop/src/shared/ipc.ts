/**
 * The IPC contract shared by main (handlers), preload (bridge), and renderer (types).
 * Renderer imports these as `import type` only, so this module is erased from the
 * renderer bundle — only main/preload pull in the channel constants at runtime.
 */
import type { DecompositionOutput, Goal, Milestone } from "@core/types";
import type { ClarifyOutput, ClarifyQuestion, ClarifyAnswer } from "@core/llm";

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
}

export interface SaveRequest {
  title: string;
  description?: string;
  plan: DecompositionOutput;
  questions: ClarifyQuestion[];
  answers: ClarifyAnswer[];
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
}

export interface ClarifyIpcResult {
  ok: boolean;
  output: ClarifyOutput | null;
  errors: string[];
}

export interface SavedGoal {
  goal: Goal;
  milestones: Milestone[];
}

// ── LLM provider configuration (multi-provider / BYO-key) ────────────────────

/**
 * Which gateway to build. `anthropic` uses the native Messages API; `openai-compatible`
 * targets any OpenAI `/chat/completions` endpoint (OpenAI, OpenRouter, DeepSeek, local
 * Ollama/vLLM, …) so users bring their own key and point at whichever endpoint they like.
 */
export type LlmProvider = "anthropic" | "openai-compatible";

/** What the renderer sends to configure the provider (includes the secret key). */
export interface ProviderConfig {
  provider: LlmProvider;
  /** Leave blank on update to keep the already-stored key. */
  apiKey: string;
  /** API root (openai-compatible only). Empty ⇒ provider default. */
  baseURL?: string;
  /** The single model id (required for openai-compatible; ignored for anthropic routing). */
  model?: string;
}

/** What the renderer reads back — never includes the secret key. */
export interface ProviderStatus {
  /** True when a usable gateway can be built (provider + key, plus model for openai). */
  configured: boolean;
  provider: LlmProvider | null;
  baseURL: string | null;
  model: string | null;
  /** Whether a key is on file (so the form can offer "leave blank to keep"). */
  hasApiKey: boolean;
}

/** The typed surface exposed on `window.aimcub` by the preload bridge. */
export interface AimcubApi {
  draft(req: DraftRequest): Promise<PlanResult>;
  clarify(req: ClarifyRequest): Promise<ClarifyIpcResult>;
  refine(req: RefineRequest): Promise<PlanResult>;
  saveGoal(req: SaveRequest): Promise<SavedGoal>;
  listGoals(): Promise<Goal[]>;
  deleteGoal(id: string): Promise<void>;
  getProviderConfig(): Promise<ProviderStatus>;
  setProviderConfig(config: ProviderConfig): Promise<ProviderStatus>;
}

/** Channel names — kept in one place so main and preload can't drift. */
export const IPC = {
  draft: "aimcub:draft",
  clarify: "aimcub:clarify",
  refine: "aimcub:refine",
  saveGoal: "aimcub:saveGoal",
  listGoals: "aimcub:listGoals",
  deleteGoal: "aimcub:deleteGoal",
  getProviderConfig: "aimcub:getProviderConfig",
  setProviderConfig: "aimcub:setProviderConfig",
} as const;

declare global {
  interface Window {
    aimcub: AimcubApi;
  }
}
