/**
 * The planning pipeline run in the main process: draft → clarify → refine.
 *
 * Each step uses the @core/llm brain through the configured gateway. There is NO offline
 * template fallback ("真刀实枪"): if no provider is configured, or the LLM call fails, or
 * the model returns an invalid plan, the step returns `{ ok: false, errors }` for the UI
 * to surface honestly. The gateway is injected (built from config in the IPC layer) so
 * this module stays free of Electron and is unit-testable with a mock gateway.
 */
import {
  decomposeWithQuality,
  clarify,
  buildRefinedDescription,
  type LlmGateway,
  type ClarifyAnswer,
  type ClarifyLearningReport,
  type ClarifyQuestion,
  type DecomposeWithQualityResult,
  type PlanningMemory,
} from "@core/llm";
import { reviewPlan, type AimIntakeReport, type ContextCaptureLearningReport, type ContextLineageLearningReport, type DecompositionLearningReport, type DecompositionStrategyReport, type PlanReviewReport } from "@core/domain";
import type { DecompositionOutput } from "@core/types";

import type { ClarifyIpcResult, PlanResult } from "../shared/ipc";

const NO_PROVIDER = "No LLM provider configured — add a provider and API key in settings.";

function qualityRetry(result: DecomposeWithQualityResult): NonNullable<PlanResult["qualityRetry"]> {
  return {
    retried: result.retried,
    attempts: result.attempts,
    firstQuality: result.firstQuality,
  };
}

export async function runDraft(
  gateway: LlmGateway | null,
  title: string,
  description?: string,
  memories: readonly PlanningMemory[] = [],
  lineageLearning?: ContextLineageLearningReport | null,
  decompositionLearning?: DecompositionLearningReport | null,
  decompositionStrategy?: DecompositionStrategyReport | null,
): Promise<PlanResult> {
  if (!gateway) return { ok: false, output: null, errors: [NO_PROVIDER] };
  const r = await decomposeWithQuality(gateway, { title, description, memories, lineageLearning, decompositionLearning, decompositionStrategy });
  if (r.output) {
    return {
      ok: true,
      output: r.output,
      errors: [],
      quality: r.quality,
      review: reviewPlan({ plan: r.output, context: memories, quality: r.quality }),
      qualityRetry: qualityRetry(r),
    };
  }
  return { ok: false, output: null, errors: r.validation.errors };
}

export async function runClarify(
  gateway: LlmGateway | null,
  title: string,
  description: string | undefined,
  draft: DecompositionOutput,
  memories: readonly PlanningMemory[] = [],
  learning?: ClarifyLearningReport | null,
  captureLearning?: ContextCaptureLearningReport | null,
  intake?: AimIntakeReport | null,
  review?: Pick<PlanReviewReport, "quality" | "context"> | null,
  lineageLearning?: ContextLineageLearningReport | null,
  decompositionStrategy?: DecompositionStrategyReport | null,
): Promise<ClarifyIpcResult> {
  if (!gateway) return { ok: false, output: null, errors: [NO_PROVIDER] };
  const r = await clarify(gateway, { title, description, draft, memories, learning, captureLearning, lineageLearning, decompositionStrategy, intake, review });
  if (r.output) return { ok: true, output: r.output, errors: [] };
  return { ok: false, output: null, errors: r.validation.errors };
}

export async function runRefine(
  gateway: LlmGateway | null,
  title: string,
  description: string | undefined,
  _draft: DecompositionOutput,
  questions: ClarifyQuestion[],
  answers: ClarifyAnswer[],
  memories: readonly PlanningMemory[] = [],
  reviewPrompt?: string,
  lineageLearning?: ContextLineageLearningReport | null,
  decompositionLearning?: DecompositionLearningReport | null,
  decompositionStrategy?: DecompositionStrategyReport | null,
): Promise<PlanResult> {
  if (!gateway) return { ok: false, output: null, errors: [NO_PROVIDER] };
  const reviewInstruction = reviewPrompt?.trim()
    ? `Plan review action to address before accepting:\n${reviewPrompt.trim()}`
    : "";
  const refinedDescription = [buildRefinedDescription(description, questions, answers), reviewInstruction]
    .filter((part) => part.trim().length > 0)
    .join("\n\n");
  const r = await decomposeWithQuality(gateway, { title, description: refinedDescription, memories, lineageLearning, decompositionLearning, decompositionStrategy });
  if (r.output) {
    return {
      ok: true,
      output: r.output,
      errors: [],
      quality: r.quality,
      review: reviewPlan({ plan: r.output, context: memories, quality: r.quality }),
      qualityRetry: qualityRetry(r),
    };
  }
  return { ok: false, output: null, errors: r.validation.errors };
}
