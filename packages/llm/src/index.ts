/**
 * @core/llm — Claude invocation gateway: model routing + metering + caching strategy (interface-first).
 * Billing decision: always connect directly via the Anthropic API key (not the Agent SDK subscription quota), so cost is meterable, cacheable, and batchable.
 * v0: model routing + gateway interface; the concrete SDK calls are wired up in v1a (to avoid introducing a network dependency in v0).
 */

/** 2026 model IDs (lean-first: decompose/replan/celebrate use Sonnet, high-frequency nudge/classify use Haiku; Opus only for highlight moments). */
export const Models = {
  opus: "claude-opus-4-8",
  sonnet: "claude-sonnet-4-6",
  haiku: "claude-haiku-4-5-20251001",
} as const;
export type ModelId = (typeof Models)[keyof typeof Models];

export type LlmTask =
  | "decompose" // initial decomposition
  | "replan" // incremental replanning
  | "celebrate" // milestone-reached celebration (high emotional value)
  | "goal_complete" // goal-completion grand celebration (rare highlight)
  | "nudge" // routine proactive message (high frequency)
  | "classify" // classification/scoring/phrasing
  | "extract_memory"; // memory extraction

/** Task -> model routing. Lean version: Opus is reserved only for goal_complete; everything else uses Sonnet/Haiku. */
export function routeModel(task: LlmTask): ModelId {
  switch (task) {
    case "goal_complete":
      return Models.opus;
    case "decompose":
    case "replan":
    case "celebrate":
      return Models.sonnet;
    case "nudge":
    case "classify":
    case "extract_memory":
      return Models.haiku;
  }
}

export interface LlmUsage {
  model: ModelId;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

/** Metering hook: reports usage on every call, for quota/circuit-breaker purposes. */
export interface UsageMeter {
  record(ownerId: string, task: LlmTask, usage: LlmUsage): Promise<void>;
}

export interface LlmRequest {
  task: LlmTask;
  system?: string;
  prompt: string;
  /** JSON Schema enforcing structured output (decomposition uses flat nodes+edges). */
  schema?: unknown;
  /** Override the routing (rare). */
  model?: ModelId;
}

export interface LlmResponse<T = string> {
  output: T;
  usage: LlmUsage;
}

/** Gateway interface. The concrete implementation (Anthropic SDK + prompt caching) is wired up in v1a. */
export interface LlmGateway {
  complete(req: LlmRequest): Promise<LlmResponse<string>>;
  completeStructured<T>(req: LlmRequest & { schema: unknown }): Promise<LlmResponse<T>>;
}

// ── v1a wiring ───────────────────────────────────────────────────────────────
// Concrete Anthropic-backed gateway + the goal-decomposition pipeline.
export { AnthropicLlmGateway } from "./anthropic-gateway";
export type {
  AnthropicGatewayOptions,
  AnthropicClientPort,
} from "./anthropic-gateway";
export { decompose } from "./decompose";
export type { DecomposeInput, DecomposeResult } from "./decompose";
export { decompositionJsonSchema } from "./decomposition-schema";
export type { DecompositionJsonSchema } from "./decomposition-schema";

// ── v1b wiring ───────────────────────────────────────────────────────────────
// Pet-voice pipelines (emotional shell): shared persona + celebrate/nudge.
export { PERSONA_SYSTEM_PROMPT, PERSONA_MESSAGE_MAX_CHARS } from "./persona";
export type { PersonaMessageResult } from "./persona";
export { celebrate } from "./celebrate";
export type { CelebrateInput } from "./celebrate";
export { nudge } from "./nudge";
export type { NudgeInput } from "./nudge";
