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
  clarifyAnswersToMemories,
  type LlmGateway,
  type ClarifyAnswer,
  type ClarifyLearningReport,
  type ClarifyQuestion,
  type DecomposeWithQualityResult,
  type AimOutputLanguage,
  type PlanningMemory,
  type ResearchBrief,
} from "@core/llm";
import { reviewPlan, type AimIntakeReport, type ContextCaptureLearningReport, type ContextLineageLearningReport, type DecompositionLearningReport, type DecompositionStrategyReport, type PlanReviewReport } from "@core/domain";
import type { DecompositionOutput } from "@core/types";

import type { ClarifyIpcResult, PlanResult } from "../shared/ipc";

const NO_PROVIDER = "No LLM provider configured — add a provider and API key in settings.";

function inferAimOutputLanguage(title: string, description?: string): AimOutputLanguage {
  const text = [title, description].filter(Boolean).join("\n");
  const cjkCount = (text.match(/[\u3400-\u9fff]/g) ?? []).length;
  const latinCount = (text.match(/[A-Za-z]/g) ?? []).length;
  return cjkCount >= 2 && cjkCount >= Math.ceil(latinCount / 3)
    ? "simplified_chinese"
    : "english";
}

function qualityRetry(result: DecomposeWithQualityResult): NonNullable<PlanResult["qualityRetry"]> {
  return {
    retried: result.retried,
    attempts: result.attempts,
    firstQuality: result.firstQuality,
  };
}

function answerMemoriesForRefine(
  questions: readonly ClarifyQuestion[],
  answers: readonly ClarifyAnswer[],
): PlanningMemory[] {
  return clarifyAnswersToMemories(questions, answers).map((memory, index) => ({
    id: `clarify.answer:${index}`,
    content: memory.content,
    kind: memory.kind,
    category: memory.category,
    source: memory.source,
    confidence: 0.9,
    goalId: null,
    goal_id: null,
  }));
}

export async function runDraft(
  gateway: LlmGateway | null,
  title: string,
  description?: string,
  memories: readonly PlanningMemory[] = [],
  lineageLearning?: ContextLineageLearningReport | null,
  decompositionLearning?: DecompositionLearningReport | null,
  decompositionStrategy?: DecompositionStrategyReport | null,
  research?: ResearchBrief | null,
): Promise<PlanResult> {
  if (!gateway) return { ok: false, output: null, errors: [NO_PROVIDER] };
  const outputLanguage = inferAimOutputLanguage(title, description);
  const r = await decomposeWithQuality(gateway, { title, description, memories, lineageLearning, decompositionLearning, decompositionStrategy, research, outputLanguage });
  if (r.output) {
    return {
      ok: true,
      output: r.output,
      errors: [],
      quality: r.quality,
      review: reviewPlan({ plan: r.output, context: memories, quality: r.quality, research }),
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
  const outputLanguage = inferAimOutputLanguage(title, description);
  const r = await clarify(gateway, { title, description, draft, memories, learning, captureLearning, lineageLearning, decompositionStrategy, outputLanguage, intake, review });
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
  research?: ResearchBrief | null,
): Promise<PlanResult> {
  if (!gateway) return { ok: false, output: null, errors: [NO_PROVIDER] };
  const outputLanguage = inferAimOutputLanguage(title, description);
  const reviewInstruction = reviewPrompt?.trim()
    ? `Plan review action to address before accepting:\n${reviewPrompt.trim()}`
    : "";
  const refinedDescription = [buildRefinedDescription(description, questions, answers), reviewInstruction]
    .filter((part) => part.trim().length > 0)
    .join("\n\n");
  const refinedMemories = [...answerMemoriesForRefine(questions, answers), ...memories];
  const r = await decomposeWithQuality(gateway, { title, description: refinedDescription, memories: refinedMemories, lineageLearning, decompositionLearning, decompositionStrategy, research, outputLanguage });
  if (r.output) {
    return {
      ok: true,
      output: r.output,
      errors: [],
      quality: r.quality,
      review: reviewPlan({ plan: r.output, context: refinedMemories, quality: r.quality, research }),
      qualityRetry: qualityRetry(r),
    };
  }
  return { ok: false, output: null, errors: r.validation.errors };
}
