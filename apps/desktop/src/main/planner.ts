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
  generateAimIntakeQuestions,
  type LlmGateway,
  type ClarifyAnswer,
  type ClarifyLearningReport,
  type ClarifyQuestion,
  type DecomposeWithQualityResult,
  type AimOutputLanguage,
  type AimIntakeToolSignal,
  type LlmRequest,
  type LlmResponse,
  type PlanningMemory,
  type ResearchBrief,
} from "@core/llm";
import { reviewPlan, type AimIntakeReport, type ContextCaptureLearningReport, type ContextLineageLearningReport, type DecompositionLearningReport, type DecompositionStrategyReport, type PlanQualityResearchEvidence, type PlanReviewReport } from "@core/domain";
import type { DecompositionOutput } from "@core/types";

import type {
  ClarifyIpcResult,
  PlanResult,
  PlanningDebugTrace,
  PlanningLiveModelRun,
  PlanningModelRunTrace,
  PlanningRunStage,
} from "../shared/ipc";

const NO_PROVIDER = "No LLM provider configured — add a provider and API key in settings.";
const MODEL_INPUT_PREVIEW_CHARS = 1_800;

export type PlanningModelRunLiveEvent =
  | { type: "model.started"; run: PlanningLiveModelRun }
  | { type: "model.completed"; run: PlanningModelRunTrace }
  | { type: "model.failed"; run: PlanningModelRunTrace };

export interface PlanningDebugHooks {
  onModelRun?: (event: PlanningModelRunLiveEvent) => void;
}

export interface IntakeQuestionResult {
  ok: boolean;
  intake: AimIntakeReport | null;
  errors: string[];
  debugTrace?: PlanningDebugTrace | null;
}

function createDebugTrace(stage: PlanningRunStage, startedAtMs: number, modelRuns: PlanningModelRunTrace[]): PlanningDebugTrace {
  const finishedAtMs = Date.now();
  return {
    version: 1,
    stage,
    startedAt: new Date(startedAtMs).toISOString(),
    finishedAt: new Date(finishedAtMs).toISOString(),
    durationMs: finishedAtMs - startedAtMs,
    modelRuns,
  };
}

function emitModelRun(hooks: PlanningDebugHooks | undefined, event: PlanningModelRunLiveEvent): void {
  try {
    hooks?.onModelRun?.(event);
  } catch {
    // Debug event delivery must never change planning behavior.
  }
}

function previewModelInput(value: string | undefined): string | undefined {
  const cleaned = (value ?? "").replace(/\s+/g, " ").trim();
  if (!cleaned) return undefined;
  if (cleaned.length <= MODEL_INPUT_PREVIEW_CHARS) return cleaned;
  return `${cleaned.slice(0, MODEL_INPUT_PREVIEW_CHARS - 1).trim()}…`;
}

function tracedGateway(gateway: LlmGateway, stage: PlanningRunStage, hooks?: PlanningDebugHooks): {
  gateway: LlmGateway;
  modelRuns: PlanningModelRunTrace[];
} {
  const modelRuns: PlanningModelRunTrace[] = [];
  let nextId = 1;

  async function record<T>(
    req: LlmRequest,
    structured: boolean,
    run: () => Promise<LlmResponse<T>>,
  ): Promise<LlmResponse<T>> {
    const startedAtMs = Date.now();
    const id = `${stage}-${nextId++}`;
    const startedAt = new Date(startedAtMs).toISOString();
    emitModelRun(hooks, {
      type: "model.started",
      run: {
        id,
        stage,
        task: req.task,
        status: "running",
        structured,
        hasSchema: req.schema !== undefined,
        startedAt,
        promptChars: req.prompt.length,
        systemChars: req.system?.length ?? 0,
        promptPreview: previewModelInput(req.prompt),
        systemPreview: previewModelInput(req.system),
        model: req.model ?? null,
      },
    });
    try {
      const response = await run();
      const trace: PlanningModelRunTrace = {
        id,
        stage,
        task: req.task,
        status: "ok",
        structured,
        hasSchema: req.schema !== undefined,
        startedAt,
        durationMs: Date.now() - startedAtMs,
        promptChars: req.prompt.length,
        systemChars: req.system?.length ?? 0,
        promptPreview: previewModelInput(req.prompt),
        systemPreview: previewModelInput(req.system),
        model: response.usage.model || req.model || null,
        usage: response.usage,
      };
      modelRuns.push(trace);
      emitModelRun(hooks, { type: "model.completed", run: trace });
      return response;
    } catch (err) {
      const trace: PlanningModelRunTrace = {
        id,
        stage,
        task: req.task,
        status: "error",
        structured,
        hasSchema: req.schema !== undefined,
        startedAt,
        durationMs: Date.now() - startedAtMs,
        promptChars: req.prompt.length,
        systemChars: req.system?.length ?? 0,
        promptPreview: previewModelInput(req.prompt),
        systemPreview: previewModelInput(req.system),
        model: req.model ?? null,
        usage: null,
        error: err instanceof Error ? err.message : String(err),
      };
      modelRuns.push(trace);
      emitModelRun(hooks, { type: "model.failed", run: trace });
      throw err;
    }
  }

  return {
    modelRuns,
    gateway: {
      complete(req) {
        return record(req, false, () => gateway.complete(req));
      },
      completeStructured<T>(req: LlmRequest & { schema: unknown }) {
        return record(req, true, () => gateway.completeStructured<T>(req));
      },
    },
  };
}

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

export function researchEvidenceForReview(research: ResearchBrief | null | undefined, required: boolean): PlanQualityResearchEvidence | null {
  if (research) {
    return {
      required,
      sourceCount: research.sources.length,
      fetchedSourceCount: research.fetchedSourceCount,
      searchResultCount: research.searchResultCount,
      sources: research.sources,
      uncertainties: research.uncertainties,
    };
  }
  return required ? { required: true, sourceCount: 0, fetchedSourceCount: 0, searchResultCount: 0 } : null;
}

export async function runIntakeQuestions(
  gateway: LlmGateway | null,
  input: {
    title: string;
    description?: string;
    intake: AimIntakeReport;
    memories?: readonly PlanningMemory[];
    research?: ResearchBrief | null;
    researchRequired?: boolean;
    toolSignals?: readonly AimIntakeToolSignal[];
    explorationHistory?: readonly { question: string; answer: string }[];
    maxQuestions?: number;
  },
  hooks?: PlanningDebugHooks,
): Promise<IntakeQuestionResult> {
  const startedAtMs = Date.now();
  if (!gateway) {
    return {
      ok: false,
      intake: null,
      errors: [NO_PROVIDER],
      debugTrace: createDebugTrace("intake", startedAtMs, []),
    };
  }
  if (input.intake.questions.length === 0) {
    return {
      ok: true,
      intake: input.intake,
      errors: [],
      debugTrace: createDebugTrace("intake", startedAtMs, []),
    };
  }
  const traced = tracedGateway(gateway, "intake", hooks);
  const result = await generateAimIntakeQuestions(traced.gateway, {
    title: input.title,
    description: input.description,
    intake: input.intake,
    memories: input.memories,
    research: input.research,
    researchRequired: input.researchRequired,
    toolSignals: input.toolSignals,
    explorationHistory: input.explorationHistory,
    maxQuestions: input.maxQuestions,
  });
  const debugTrace = createDebugTrace("intake", startedAtMs, traced.modelRuns);
  if (!result.validation.ok || !result.report) {
    return {
      ok: false,
      intake: null,
      errors: result.validation.errors,
      debugTrace,
    };
  }
  return {
    ok: true,
    intake: result.report,
    errors: [],
    debugTrace,
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
  researchRequired = false,
  hooks?: PlanningDebugHooks,
): Promise<PlanResult> {
  const startedAtMs = Date.now();
  if (!gateway) return { ok: false, output: null, errors: [NO_PROVIDER], debugTrace: createDebugTrace("draft", startedAtMs, []) };
  const traced = tracedGateway(gateway, "draft", hooks);
  const outputLanguage = inferAimOutputLanguage(title, description);
  const r = await decomposeWithQuality(traced.gateway, { title, description, memories, lineageLearning, decompositionLearning, decompositionStrategy, research, researchRequired, outputLanguage });
  const debugTrace = createDebugTrace("draft", startedAtMs, traced.modelRuns);
  if (r.output) {
    const researchEvidence = researchEvidenceForReview(research, researchRequired);
    return {
      ok: true,
      output: r.output,
      errors: [],
      quality: r.quality,
      review: reviewPlan({ plan: r.output, context: memories, quality: r.quality, research: researchEvidence }),
      qualityRetry: qualityRetry(r),
      debugTrace,
    };
  }
  return { ok: false, output: null, errors: r.validation.errors, debugTrace };
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
  hooks?: PlanningDebugHooks,
): Promise<ClarifyIpcResult> {
  const startedAtMs = Date.now();
  if (!gateway) return { ok: false, output: null, errors: [NO_PROVIDER], debugTrace: createDebugTrace("clarify", startedAtMs, []) };
  const traced = tracedGateway(gateway, "clarify", hooks);
  const outputLanguage = inferAimOutputLanguage(title, description);
  const r = await clarify(traced.gateway, { title, description, draft, memories, learning, captureLearning, lineageLearning, decompositionStrategy, outputLanguage, intake, review });
  const debugTrace = createDebugTrace("clarify", startedAtMs, traced.modelRuns);
  if (r.output) return { ok: true, output: r.output, errors: [], debugTrace };
  return { ok: false, output: null, errors: r.validation.errors, debugTrace };
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
  researchRequired = false,
  hooks?: PlanningDebugHooks,
): Promise<PlanResult> {
  const startedAtMs = Date.now();
  if (!gateway) return { ok: false, output: null, errors: [NO_PROVIDER], debugTrace: createDebugTrace("refine", startedAtMs, []) };
  const traced = tracedGateway(gateway, "refine", hooks);
  const outputLanguage = inferAimOutputLanguage(title, description);
  const reviewInstruction = reviewPrompt?.trim()
    ? `Plan review action to address before accepting:\n${reviewPrompt.trim()}`
    : "";
  const refinedDescription = [buildRefinedDescription(description, questions, answers), reviewInstruction]
    .filter((part) => part.trim().length > 0)
    .join("\n\n");
  const refinedMemories = [...answerMemoriesForRefine(questions, answers), ...memories];
  const r = await decomposeWithQuality(traced.gateway, { title, description: refinedDescription, memories: refinedMemories, lineageLearning, decompositionLearning, decompositionStrategy, research, researchRequired, outputLanguage });
  const debugTrace = createDebugTrace("refine", startedAtMs, traced.modelRuns);
  if (r.output) {
    const researchEvidence = researchEvidenceForReview(research, researchRequired);
    return {
      ok: true,
      output: r.output,
      errors: [],
      quality: r.quality,
      review: reviewPlan({ plan: r.output, context: refinedMemories, quality: r.quality, research: researchEvidence }),
      qualityRetry: qualityRetry(r),
      debugTrace,
    };
  }
  return { ok: false, output: null, errors: r.validation.errors, debugTrace };
}
