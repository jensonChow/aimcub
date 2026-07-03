/**
 * Registers the IPC handlers the renderer calls through the preload bridge.
 * Goal persistence is delegated to the shared `@core/store` (so the CLI sees the same
 * aims). Clarifying answers are folded into dimension-aware `user_stated` memories — the
 * first concrete writes toward the memory pillar.
 */
import { ipcMain } from "electron";

import type { Goal } from "@core/types";
import type { NewMemory } from "@core/store";
import {
  buildLocalHandoffManifest,
  critiquePlan,
  reviewContextCaptureFulfillment,
  reviewContextHealth,
  reviewContextIntakeProgress,
  reviewContextProfile,
  reviewContextSedimentation,
  reviewPlan,
  type ContextIntakeProgressSignal,
  type DecompositionLearningReport,
} from "@core/domain";
import {
  buildAimIntakeReport,
  planQualityMetadata,
  clarifyAnswersToMemories,
  contextIntakeSignalsFromPlanningToolEvents,
  planningContextReportsFromGoals,
  recordAssumptionContextCandidatesForStore,
  recordReviewContextCandidatesForStore,
  recordSedimentationAimContextForStore,
  recordSedimentationMemoryCandidatesForStore,
  reviewDecompositionStrategyForStore,
  summarizeClarifyLearningForStore,
  summarizeContextCaptureLearningForStore,
  summarizeContextLineageLearningForStore,
  summarizeDecompositionLearningForStore,
  traceClarifyAnswerImpact,
} from "@core/llm";

import {
  IPC,
  type AcceptContextCandidateRequest,
  type ClarifyRequest,
  type DeprioritizeContextMemoryRequest,
  type DraftRequest,
  type ProviderConfig,
  type ProviderStatus,
  type ProviderTestResult,
  type RefineRequest,
  type SaveRequest,
  type SavedGoal,
  type WebResearchConfig,
  type WebResearchStatus,
  type WebResearchTestResult,
} from "../shared/ipc";
import { researchEvidenceForReview, runClarify, runDraft, runRefine } from "./planner";
import { aimStore } from "./store";
import { buildGateway, getProviderStatus, setProviderConfig, testProviderConfig } from "./gateway";
import { collectDesktopPlanningContext, type DesktopPlanningContext } from "./tools";
import { getWebResearchStatus, setWebResearchConfig, testWebResearchConfig } from "./web-research-settings";

async function planningContext(input: {
  title: string;
  description?: string;
}): Promise<DesktopPlanningContext> {
  return collectDesktopPlanningContext(input);
}

function planningToolTrace(context: DesktopPlanningContext) {
  return {
    observations: context.toolObservations,
    observationEvents: context.toolObservationEvents,
    failures: context.toolFailures,
    distillation: context.toolDistillation,
  };
}

function contextIntakeSignals(input: {
  planning: DesktopPlanningContext;
  questions: SaveRequest["questions"];
  answers: SaveRequest["answers"];
}): ContextIntakeProgressSignal[] {
  const signals: ContextIntakeProgressSignal[] = contextIntakeSignalsFromPlanningToolEvents(
    input.planning.toolObservationEvents,
  );
  const questionById = new Map(input.questions.map((question) => [question.id, question]));
  for (const answer of input.answers) {
    const text = answer.other_text?.trim() || answer.selected_label?.trim();
    if (!text) continue;
    const question = questionById.get(answer.question_id);
    signals.push({
      source: "user_answer",
      channel: "questionnaire",
      category: question?.capture?.category,
      scope: question?.capture?.scope,
      questionId: answer.question_id,
      summary: text,
    });
  }
  return signals;
}

async function clarifyLearning() {
  return summarizeClarifyLearningForStore(aimStore);
}

async function captureLearning() {
  return summarizeContextCaptureLearningForStore(aimStore);
}

async function contextLineageLearning() {
  return summarizeContextLineageLearningForStore(aimStore);
}

async function decompositionLearning() {
  return summarizeDecompositionLearningForStore(aimStore);
}

async function decompositionStrategy(
  title: string,
  description?: string,
  learning?: DecompositionLearningReport | null,
) {
  return reviewDecompositionStrategyForStore(aimStore, title, description, learning);
}

export function registerIpc(): void {
  ipcMain.handle(IPC.intake, async (_e, req: DraftRequest) =>
    buildAimIntakeReport({
      title: req.title,
      description: req.description,
      planning: await planningContext(req),
      lineageLearning: await contextLineageLearning(),
    }),
  );

  ipcMain.handle(IPC.draft, async (_e, req: DraftRequest) => {
    const selectedContext = await planningContext(req);
    const [lineageLearning, decompositionLearningReport] = await Promise.all([contextLineageLearning(), decompositionLearning()]);
    const decompositionStrategyReport = await decompositionStrategy(req.title, req.description, decompositionLearningReport);
    const draft = await runDraft(
      buildGateway(),
      req.title,
      req.description,
      selectedContext.memories,
      lineageLearning,
      decompositionLearningReport,
      decompositionStrategyReport,
      selectedContext.research,
      selectedContext.researchRequired,
    );
    return {
      ...draft,
      intake: buildAimIntakeReport({
        title: req.title,
        description: req.description,
        planning: selectedContext,
        draftReview: draft.review ?? null,
        lineageLearning,
      }),
      planningContext: selectedContext.report,
      planningTools: planningToolTrace(selectedContext),
    };
  });

  ipcMain.handle(IPC.clarify, async (_e, req: ClarifyRequest) => {
    const selectedContext = await planningContext(req);
    const [lineageLearning, decompositionLearningReport] = await Promise.all([contextLineageLearning(), decompositionLearning()]);
    const decompositionStrategyReport = await decompositionStrategy(req.title, req.description, decompositionLearningReport);
    const draftReview = reviewPlan({
      plan: req.draft,
      context: selectedContext.memories,
      research: researchEvidenceForReview(selectedContext.research, selectedContext.researchRequired),
    });
    const intake = buildAimIntakeReport({
      title: req.title,
      description: req.description,
      planning: selectedContext,
      draftReview,
      lineageLearning,
    });
    const clarified = await runClarify(
      buildGateway(),
      req.title,
      req.description,
      req.draft,
      selectedContext.memories,
      await clarifyLearning(),
      await captureLearning(),
      intake,
      draftReview,
      lineageLearning,
      decompositionStrategyReport,
    );
    return { ...clarified, planningTools: planningToolTrace(selectedContext) };
  });

  ipcMain.handle(IPC.refine, async (_e, req: RefineRequest) => {
    const selectedContext = await planningContext(req);
    const [lineageLearning, decompositionLearningReport] = await Promise.all([contextLineageLearning(), decompositionLearning()]);
    const decompositionStrategyReport = await decompositionStrategy(req.title, req.description, decompositionLearningReport);
    const refined = await runRefine(
      buildGateway(),
      req.title,
      req.description,
      req.draft,
      req.questions,
      req.answers,
      selectedContext.memories,
      req.reviewPrompt,
      lineageLearning,
      decompositionLearningReport,
      decompositionStrategyReport,
      selectedContext.research,
      selectedContext.researchRequired,
    );
    return {
      ...refined,
      intake: buildAimIntakeReport({
        title: req.title,
        description: req.description,
        planning: selectedContext,
        draftReview: refined.review ?? null,
        lineageLearning,
      }),
      planningContext: selectedContext.report,
      planningTools: planningToolTrace(selectedContext),
    };
  });

  ipcMain.handle(IPC.listGoals, (): Promise<Goal[]> => aimStore.listGoals());

  ipcMain.handle(IPC.deleteGoal, (_e, id: string): Promise<void> => aimStore.deleteGoal(id));

  ipcMain.handle(IPC.listContextCandidates, () => aimStore.listMemoryCandidates());

  ipcMain.handle(IPC.listContextHistory, () => aimStore.listMemoryHistory());

  ipcMain.handle(IPC.listContextProfile, async () =>
    reviewContextProfile({ memories: await aimStore.listMemories() }),
  );

  ipcMain.handle(IPC.listContextHealth, async () => {
    const [goals, memories] = await Promise.all([aimStore.listGoals(), aimStore.listMemories()]);
    return reviewContextHealth({
      memories,
      traces: planningContextReportsFromGoals(goals),
    });
  });

  ipcMain.handle(IPC.listContextLearning, () => clarifyLearning());

  ipcMain.handle(IPC.listContextLineageLearning, () => contextLineageLearning());

  ipcMain.handle(IPC.listContextDecompositionLearning, () => decompositionLearning());

  ipcMain.handle(IPC.listContextDecompositionStrategy, async (_e, req: DraftRequest) =>
    decompositionStrategy(req.title, req.description),
  );

  ipcMain.handle(IPC.archiveContextMemory, (_e, id: string) => aimStore.archiveMemory(id));

  ipcMain.handle(IPC.deprioritizeContextMemory, (_e, req: DeprioritizeContextMemoryRequest) =>
    aimStore.deprioritizeMemory({ id: req.id, confidence: req.confidence }),
  );

  ipcMain.handle(IPC.acceptContextCandidate, (_e, req: AcceptContextCandidateRequest) =>
    aimStore.acceptMemoryCandidate({ id: req.id, content: req.content, goalId: req.scope === "global" ? null : undefined }),
  );

  ipcMain.handle(IPC.rejectContextCandidate, (_e, id: string) => aimStore.rejectMemoryCandidate(id));

  ipcMain.handle(IPC.getProviderConfig, async (): Promise<ProviderStatus> => getProviderStatus());

  ipcMain.handle(IPC.setProviderConfig, async (_e, config: ProviderConfig): Promise<ProviderStatus> =>
    setProviderConfig(config),
  );

  ipcMain.handle(IPC.testProviderConfig, async (_e, config: ProviderConfig): Promise<ProviderTestResult> =>
    testProviderConfig(config),
  );

  ipcMain.handle(IPC.getWebResearchConfig, async (): Promise<WebResearchStatus> => getWebResearchStatus());

  ipcMain.handle(IPC.setWebResearchConfig, async (_e, config: WebResearchConfig): Promise<WebResearchStatus> =>
    setWebResearchConfig(config),
  );

  ipcMain.handle(IPC.testWebResearchConfig, async (_e, config: WebResearchConfig): Promise<WebResearchTestResult> =>
    testWebResearchConfig(config),
  );

  ipcMain.handle(IPC.saveGoal, async (_e, req: SaveRequest): Promise<SavedGoal> => {
    const selectedContext = await planningContext({ title: req.title, description: req.description });
    const lineageLearning = await contextLineageLearning();
    const memories: NewMemory[] = clarifyAnswersToMemories(req.questions, req.answers);
    const researchEvidence = researchEvidenceForReview(selectedContext.research, selectedContext.researchRequired);
    const answerImpact = req.answers.length > 0
      ? traceClarifyAnswerImpact({
          questions: req.questions,
          answers: req.answers,
          beforePlan: req.draft ?? null,
          afterPlan: req.plan,
          beforeQuality: req.draft ? critiquePlan({ plan: req.draft, context: selectedContext.memories, research: researchEvidence }) : null,
          afterQuality: req.quality ?? null,
      })
      : null;
    const captureFulfillment = reviewContextCaptureFulfillment({
      questions: req.questions,
      answers: req.answers,
      memories,
      impacts: answerImpact?.rows ?? [],
    });
    const intake = buildAimIntakeReport({
      title: req.title,
      description: req.description,
      planning: selectedContext,
      draftReview: req.review ?? null,
      lineageLearning,
    });
    const intakeSignals = contextIntakeSignals({
      planning: selectedContext,
      questions: req.questions,
      answers: req.answers,
    });
    const intakeProgress = reviewContextIntakeProgress({
      loop: intake.loop,
      signals: intakeSignals,
    });
    const contextSedimentation = reviewContextSedimentation({
      loop: intake.loop,
      progress: intakeProgress,
      signals: intakeSignals,
    });
    const localHandoffManifest = buildLocalHandoffManifest({
      plan: req.plan,
      aimContext: contextSedimentation.aimContext,
      durableMemoryCandidates: contextSedimentation.durableMemoryCandidates,
      contextSedimentation,
      selectedContext: selectedContext.memories,
    });

    const saved = await aimStore.createGoal({
      title: req.title,
      description: req.description,
      plan: req.plan,
      metadata: {
        ...(req.quality !== undefined || req.qualityRetry || req.review
          ? planQualityMetadata({
              quality: req.quality ?? null,
              retried: req.qualityRetry?.retried ?? false,
              attempts: req.qualityRetry?.attempts ?? 1,
              firstQuality: req.qualityRetry?.firstQuality ?? null,
              output: req.plan,
            }, req.review)
          : {}),
        aim_intake: intake,
        context_intake_progress: intakeProgress,
        context_sedimentation: contextSedimentation,
        local_handoff_manifest: localHandoffManifest,
        planning_context: selectedContext.report,
        planning_tools: planningToolTrace(selectedContext),
        ...(answerImpact ? { clarify_answer_impact: answerImpact } : {}),
        ...(captureFulfillment.total > 0 ? { context_capture_fulfillment: captureFulfillment } : {}),
      },
      memories,
    });
    return {
      ...saved,
      answerImpact,
      contextCandidates: [
        ...(await recordSedimentationAimContextForStore(aimStore, saved.goal, contextSedimentation)),
        ...(await recordSedimentationMemoryCandidatesForStore(aimStore, contextSedimentation)),
        ...(await recordAssumptionContextCandidatesForStore(aimStore, saved.goal, req.assumptions ?? [])),
        ...(await recordReviewContextCandidatesForStore(aimStore, saved.goal, req.review)),
      ],
    };
  });
}
