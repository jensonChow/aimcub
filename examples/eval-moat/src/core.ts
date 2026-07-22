/**
 * The single audit point for everything this example borrows from the repo.
 *
 * `examples/` is not a workspace package, so it cannot resolve `@core/*` specifiers. Like
 * `examples/local-alpha/seed-local-alpha-demo.ts`, the harness reaches into the package sources by
 * relative path. Keeping every such import here means one file answers "what does the benchmark
 * touch?" — and the benchmark never re-implements planning logic it is supposed to be measuring.
 */
export {
  createJsonFileStore,
  defaultDataDir,
  loadSettings,
  DEFAULT_OWNER,
} from "../../../packages/store/src/index.ts";
export type {
  AimStore,
  LocalStore,
  NewMemory,
  ProviderSettings,
} from "../../../packages/store/src/index.ts";

export {
  AnthropicLlmGateway,
  OpenAiCompatibleLlmGateway,
  decompose,
  reviewDecompositionStrategyForStore,
  selectPlanningContextForStore,
  summarizeContextLineageLearningForStore,
  summarizeDecompositionLearningForStore,
} from "../../../packages/llm/src/index.ts";
export type {
  DecomposeResult,
  LlmGateway,
  LlmRequest,
  LlmResponse,
  LlmUsage,
  PlanningContextForAim,
  PlanningContextSelectionReport,
  PlanningContextSelectionRow,
  PlanningMemory,
  UsageMeter,
} from "../../../packages/llm/src/index.ts";

export { renderPlanningContext } from "../../../packages/llm/src/planning-context.ts";

export {
  getDefaultModel,
  getLlmProviderDefinition,
} from "../../../packages/llm/src/providers.ts";

export { critiquePlan } from "../../../packages/core/src/plan-quality.ts";
export type {
  PlanQualityContext,
  PlanQualityReport,
} from "../../../packages/core/src/plan-quality.ts";
export type { ContextLineageLearningReport } from "../../../packages/core/src/context-lineage.ts";
export type {
  DecompositionLearningReport,
  DecompositionStrategyReport,
} from "../../../packages/core/src/decomposition-learning.ts";

export type {
  ContextCategory,
  DecompositionOutput,
  GoalDomain,
  Memory,
  MemoryKind,
} from "../../../packages/types/src/index.ts";

/** Provider/key resolution, exactly as `aimcub` resolves it (env wins over `settings.json`). */
export { resolveProvider } from "../../../apps/cli/src/config.ts";
export type { ResolvedProvider } from "../../../apps/cli/src/config.ts";
