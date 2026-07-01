/**
 * @core/llm — Claude invocation gateway: model routing + metering + caching strategy (interface-first).
 * Billing decision: always connect directly via the Anthropic API key (not the Agent SDK subscription quota), so cost is meterable, cacheable, and batchable.
 * v0: model routing + gateway interface; the concrete SDK calls are wired up in v1a (to avoid introducing a network dependency in v0).
 */

/** 2026 model IDs (lean-first: aim decompose/replan use Sonnet, high-frequency classify/extract use Haiku; Opus reserved for explicit overrides on hard reasoning). */
export const Models = {
  opus: "claude-opus-4-8",
  sonnet: "claude-sonnet-4-6",
  haiku: "claude-haiku-4-5-20251001",
} as const;
export type ModelId = (typeof Models)[keyof typeof Models];

export type LlmTask =
  | "decompose" // initial aim decomposition
  | "replan" // incremental replanning
  | "classify" // classification / scoring / eval phrasing
  | "extract_memory"; // memory extraction (the memory pillar)

/** Task -> model routing. Lean version: decompose/replan use Sonnet, the high-frequency classify/extract tasks use Haiku. */
export function routeModel(task: LlmTask): ModelId {
  switch (task) {
    case "decompose":
    case "replan":
      return Models.sonnet;
    case "classify":
    case "extract_memory":
      return Models.haiku;
  }
}

export interface LlmUsage {
  /** The model that produced this usage. A free string — providers other than Anthropic
   * (OpenAI-compatible deployments) report their own model ids, not `ModelId`. */
  model: string;
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
// Concrete gateways (Anthropic-native + any OpenAI-compatible endpoint) + the
// goal-decomposition pipeline.
export { AnthropicLlmGateway } from "./anthropic-gateway";
export type {
  AnthropicGatewayOptions,
  AnthropicClientPort,
} from "./anthropic-gateway";
export { OpenAiCompatibleLlmGateway } from "./openai-gateway";
export type {
  OpenAiGatewayOptions,
  OpenAiFetchPort,
  OpenAiFetchResponse,
} from "./openai-gateway";
export { decompose, decomposeWithQuality, planQualityMetadata } from "./decompose";
export type {
  DecomposeInput,
  DecomposeResult,
  DecomposeWithQualityResult,
  PlanQualityMetadata,
  PlanQualityRetryMetadata,
} from "./decompose";
export { selectPlanningMemories, selectPlanningMemoriesWithTrace } from "./planning-context";
export type {
  PlanningContextSelectionReport,
  PlanningContextSelectionResult,
  PlanningContextSelectionRow,
  PlanningContextScope,
  PlanningMemory,
  SelectPlanningMemoriesInput,
} from "./planning-context";
export {
  buildAimIntakeReport,
  planningContextReportsFromGoals,
  recordAssumptionContextCandidatesForStore,
  recordReviewContextCandidatesForStore,
  reviewDecompositionStrategyForStore,
  selectPlanningContextForStore,
  summarizeClarifyLearningForStore,
  summarizeContextCaptureLearningForStore,
  summarizeContextLineageLearningForStore,
  summarizeDecompositionLearningForStore,
} from "./context-workflow";
export type {
  ContextWorkflowSnapshot,
  ContextWorkflowStore,
  PlanningContextForAim,
} from "./context-workflow";
export { localDecompose } from "./local-decompose";
export type { DecomposeRequest } from "./local-decompose";
export { decompositionJsonSchema } from "./decomposition-schema";
export type { DecompositionJsonSchema } from "./decomposition-schema";

// Clarifying-questions step (the planning "feedback step").
export {
  clarify,
  validateClarify,
  buildRefinedDescription,
  clarifyAnswersToMemories,
  clarifyImpactReportFromMetadata,
  summarizeClarifyLearning,
  traceClarifyAnswerImpact,
} from "./clarify";
export type {
  ClarifyAnswerMemory,
  ClarifyAnswerImpactReport,
  ClarifyAnswerImpactRow,
  ClarifyAnswerImpactSignal,
  ClarifyAnswerQualityDelta,
  ClarifyLearningRecommendation,
  ClarifyLearningReport,
  ClarifyLearningRow,
  ClarifyInput,
  ClarifyResult,
  ClarifyOutput,
  ClarifyQuestion,
  ClarifyOption,
  ClarifyAnswer,
  ClarifyAssumption,
  ClarifyQuestionKind,
  ClarifyQuestionWhy,
  ClarifyQuestionWhyCode,
  ClarifyQuestionSourceDimension,
  ClarifyValidation,
} from "./clarify";
export { clarifyJsonSchema } from "./clarify-schema";
export type { ClarifyJsonSchema } from "./clarify-schema";
