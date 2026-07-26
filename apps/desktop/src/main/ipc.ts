/**
 * Registers the IPC handlers the renderer calls through the preload bridge.
 * Goal persistence is delegated to the shared `@aimcub/store` (so the CLI sees the same
 * aims). Clarifying answers are folded into dimension-aware `user_stated` memories — the
 * first concrete writes toward the memory pillar.
 */
import { homedir } from "node:os";

import { app, BrowserWindow, ipcMain, nativeTheme, shell, type IpcMainInvokeEvent } from "electron";

import { ContextCategory, type Goal } from "@aimcub/types";
import { defaultDataDir, type NewMemory } from "@aimcub/store";
import {
  buildLocalHandoffManifest,
  critiquePlan,
  routingOverrideForMilestone,
  reviewContextCaptureFulfillment,
  reviewContextHealth,
  reviewContextIntakeProgress,
  reviewContextProfile,
  reviewContextSedimentation,
  reviewPlan,
  validatePlanRouting,
  type ContextIntakeProgressSignal,
  type DecompositionLearningReport,
  type RoutingRuntimeAgentOption,
} from "@aimcub/core";
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
} from "@aimcub/llm";

import {
  IPC,
  type AcceptContextCandidateRequest,
  type ClarifyRequest,
  type CreateAimRequest,
  type DeprioritizeContextMemoryRequest,
  type ConfirmMilestoneRequest,
  type DraftRequest,
  type GoalDetail,
  type RenameAimRequest,
  type UpdateGoalPlanRequest,
  type IntakeRequest,
  type ProviderConfig,
  type ProviderStatus,
  type ProviderTestResult,
  type ContextSourceConfig,
  type ContextSourceStatus,
  type DesktopPreferences,
  type LocalContextPickResult,
  type LocalAgentDetection,
  type LocalAgentRunRequest,
  type LocalAgentRunResult,
  type PlanningDebugTraceStage,
  type PlanningLiveEvent,
  type PlanningLiveSummary,
  type PlanningAgentDetection,
  type PlanningSessionAnswerRequest,
  type PlanningSessionChatRequest,
  type PlanningPassRequest,
  type PlanningSessionRef,
  type PlanningSessionStartRequest,
  type RunLiveEvent,
  type RunMilestoneAgentRequest,
  type RunMilestoneAgentResult,
  type RefineRequest,
  type SaveRequest,
  type SavedGoal,
  type UpsertAimDraftRequest,
  type WebResearchConfig,
  type WebResearchStatus,
  type WebResearchTestResult,
  type WindowThemeSource,
} from "../shared/ipc";
import { researchEvidenceForReview, runClarify, runDraft, runIntakeQuestions, runRefine, type PlanningModelRunLiveEvent } from "./planner";
import { aimStore } from "./store";
import { buildGateway, getProviderStatus, setProviderConfig, testProviderConfig } from "./gateway";
import { collectDesktopPlanningContext, type DesktopPlanningContext } from "./tools";
import {
  getContextSourceConfig,
  pickLocalContextFiles,
  pickLocalContextFolder,
  setContextSourceConfig,
} from "./context-source-settings";
import { getWebResearchStatus, setWebResearchConfig, testWebResearchConfig } from "./web-research-settings";
import { listLocalAgents, runLocalAgent } from "./local-agents";
import { defaultLocalAgentRegistry } from "@aimcub/local-agent";
import { loadDesktopPreferences, saveDesktopPreferences } from "./app-settings";
import {
  cancelQueuedRun,
  claimConsentedRun,
  createDesktopRunQueue,
  enqueueDesktopRun,
  isConsentedEscalation,
  kickRunQueue,
  logStrandedQueuedRuns,
  resolveDesktopRunPermission,
} from "./run-queue";
import {
  answerPlanningQuestion,
  cancelPlanningSession,
  discardPlanningPass,
  finishPlanningNow,
  getPlanningPassView,
  getPlanningSessionState,
  planningSessionMemoryCandidates,
  postPlanningChat,
  releasePlanningSession,
  setPlanningSessionBroadcast,
  startPlanningSession,
  takePlanningSessionMetadata,
} from "./planning-session";

/** Live run events go to every open window: a background drain has no originating sender. */
function broadcastRunLiveEvent(payload: RunLiveEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    window.webContents.send(IPC.runLiveEvent, payload);
  }
}

const runQueue = createDesktopRunQueue(aimStore, broadcastRunLiveEvent);

// Embedded planning sessions broadcast the same way: they outlive navigation,
// so there is no single originating sender to target.
setPlanningSessionBroadcast((payload) => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    window.webContents.send(IPC.planningSessionEvent, payload);
  }
});

async function planningContext(input: {
  title: string;
  description?: string;
}): Promise<DesktopPlanningContext> {
  return collectDesktopPlanningContext(input);
}

const INTAKE_CONTEXT_CACHE_LIMIT = 12;
const intakeContextByRunId = new Map<string, DesktopPlanningContext>();

function rememberIntakeContext(runId: string | undefined, context: DesktopPlanningContext): void {
  if (!runId) return;
  intakeContextByRunId.delete(runId);
  intakeContextByRunId.set(runId, context);
  while (intakeContextByRunId.size > INTAKE_CONTEXT_CACHE_LIMIT) {
    const oldest = intakeContextByRunId.keys().next().value as string | undefined;
    if (!oldest) break;
    intakeContextByRunId.delete(oldest);
  }
}

async function planningContextForIntake(req: IntakeRequest): Promise<DesktopPlanningContext> {
  const continuing = Boolean(req.priorQuestions?.length || req.answers?.length);
  const cached = continuing && req.clientRunId ? intakeContextByRunId.get(req.clientRunId) : null;
  if (cached) return cached;
  const context = await planningContext(req);
  rememberIntakeContext(req.clientRunId, context);
  return context;
}

function intakeExplorationHistory(req: IntakeRequest): Array<{ question: string; answer: string }> {
  const questions = new Map((req.priorQuestions ?? []).map((question) => [question.id, question.question]));
  return (req.answers ?? []).flatMap((answer) => {
    const labels = answer.selected_labels?.map((label) => label.trim()).filter(Boolean)
      ?? (answer.selected_label?.trim() ? [answer.selected_label.trim()] : []);
    const answerText = [...labels, answer.other_text?.trim()].filter((value): value is string => Boolean(value)).join("; ");
    const question = questions.get(answer.question_id)?.trim();
    return question && answerText ? [{ question, answer: answerText }] : [];
  });
}

async function goalDetail(goalId: string): Promise<GoalDetail | null> {
  return aimStore.getGoal(goalId);
}

function routingAgentOptions(detections: readonly LocalAgentDetection[]): RoutingRuntimeAgentOption[] {
  return detections.map((agent) => ({
    id: agent.id,
    label: agent.name,
    available: agent.available,
    authenticated: agent.authStatus !== "missing",
    models: agent.models,
    unavailableReason: agent.authMessage ?? agent.diagnostics[0] ?? null,
  }));
}

/**
 * Enqueue one sub-aim onto the durable run queue and return at once. Selection (sub-aim, runtime,
 * model), execution, event persistence and evidence all live in the shared orchestrator; the run
 * itself streams back on `IPC.runLiveEvent` and lands in the store, so closing the window no
 * longer throws work away.
 *
 * The renderer's permission is treated as untrusted input: `resolveDesktopRunPermission` decides
 * what is recordable, and anything above the background floor is claimed BY ID here — the drain
 * that runs on its own stays read-only-scoped, so a widened run can only ever execute inside the
 * session whose user granted it.
 */
async function runMilestoneAgent(req: RunMilestoneAgentRequest): Promise<RunMilestoneAgentResult> {
  const detail = await aimStore.getGoal(req.goalId);
  if (!detail) return { ok: false, runId: null, error: "Aim not found.", permission: null };
  const milestone = detail.milestones.find((item) => item.id === req.milestoneId);
  if (!milestone) return { ok: false, runId: null, error: "Sub-aim not found.", permission: null };
  const override = routingOverrideForMilestone(milestone);
  if (!req.agentId && override?.owner === "human") {
    return {
      ok: false,
      runId: null,
      error: "This sub-aim is routed to a human. Reassign it to an agent before running a local agent.",
      permission: null,
    };
  }
  try {
    const permission = resolveDesktopRunPermission(req.permission);
    const runId = await enqueueDesktopRun(runQueue, {
      goalId: detail.goal.id,
      milestoneId: milestone.id,
      permission,
      ...(req.agentId ? { agentId: req.agentId } : {}),
      ...(req.model ? { model: req.model } : {}),
      ...(req.prompt ? { instruction: req.prompt } : {}),
    });
    if (isConsentedEscalation(permission)) claimConsentedRun(runQueue, runId);
    else kickRunQueue(runQueue);
    return { ok: true, runId, error: null, permission };
  } catch (error) {
    return {
      ok: false,
      runId: null,
      error: error instanceof Error ? error.message : String(error),
      permission: null,
    };
  }
}

function planningToolTrace(context: DesktopPlanningContext) {
  return {
    observations: context.toolObservations,
    observationEvents: context.toolObservationEvents,
    failures: context.toolFailures,
    distillation: context.toolDistillation,
  };
}

function planningRunId(req: { clientRunId?: string }): string {
  return req.clientRunId?.trim() || `main:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function planningContextSummary(context: DesktopPlanningContext): PlanningLiveSummary {
  return {
    selectedContext: context.report.selected.length,
    ignoredContext: context.report.ignored.length,
    totalContext: context.report.total,
    observationCount: context.toolObservationEvents.length || context.toolObservations.length,
    failureCount: context.toolFailures.length,
    candidateCount: context.toolDistillation?.durableMemoryCandidates.length ?? 0,
  };
}

function intakeToolSignals(context: DesktopPlanningContext) {
  return context.toolObservationEvents.map((event) => ({
    toolName: event.toolName,
    summary: event.observation.summary,
  }));
}

function emitPlanningLiveEvent(
  event: IpcMainInvokeEvent,
  runId: string,
  payload: Omit<PlanningLiveEvent, "runId" | "at"> & { at?: string },
): void {
  event.sender.send(IPC.planningLiveEvent, {
    ...payload,
    runId,
    at: payload.at ?? new Date().toISOString(),
  } satisfies PlanningLiveEvent);
}

function emitPlanningFailure(
  event: IpcMainInvokeEvent,
  runId: string,
  stage: PlanningDebugTraceStage,
  error: unknown,
): void {
  const message = error instanceof Error ? error.message : String(error);
  emitPlanningLiveEvent(event, runId, {
    type: "planning.failed",
    stage,
    error: message,
    summary: { errorCount: 1 },
  });
}

function modelRunHooks(event: IpcMainInvokeEvent, runId: string) {
  return {
    onModelRun(modelEvent: PlanningModelRunLiveEvent) {
      emitPlanningLiveEvent(event, runId, {
        type: modelEvent.type,
        stage: modelEvent.run.stage,
        modelRun: modelEvent.run,
      });
    },
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
    const selected = Array.isArray(answer.selected_labels) && answer.selected_labels.length > 0
      ? answer.selected_labels.map((label) => label.trim()).filter(Boolean).join("; ")
      : "";
    const text = selected
      ? [selected, answer.other_text?.trim()].filter(Boolean).join("; ")
      : answer.other_text?.trim() || answer.selected_label?.trim();
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

/** The subset of a persist request the synthesis bundle is derived from (shared by save + update). */
type SavedGoalSynthesisInput = Pick<
  SaveRequest,
  | "title"
  | "description"
  | "draft"
  | "plan"
  | "quality"
  | "review"
  | "qualityRetry"
  | "debugTrace"
  | "questions"
  | "answers"
  | "parentGoalId"
  | "parentMilestoneId"
>;

/**
 * Compute the synthesis bundle a persisted aim carries in `metadata` (plan quality, aim intake,
 * context intake progress + sedimentation, local handoff manifest, planning context/tools, clarify
 * answer impact, capture fulfillment) plus the `user_stated` memories folded from clarify answers.
 * Shared by `saveGoal` (create) and `updateGoalPlan` (land/re-plan) so both persist the same context
 * regardless of which path created the goal. Pure derivation over `@aimcub/core` + the local store; no
 * mutation (the caller persists).
 */
async function synthesizeSavedGoalMetadata(input: SavedGoalSynthesisInput) {
  const selectedContext = await planningContext({ title: input.title, description: input.description });
  const lineageLearning = await contextLineageLearning();
  const memories: NewMemory[] = clarifyAnswersToMemories(input.questions, input.answers);
  const researchEvidence = researchEvidenceForReview(selectedContext.research, selectedContext.researchRequired);
  const answerImpact = input.answers.length > 0
    ? traceClarifyAnswerImpact({
        questions: input.questions,
        answers: input.answers,
        beforePlan: input.draft ?? null,
        afterPlan: input.plan,
        beforeQuality: input.draft ? critiquePlan({ plan: input.draft, context: selectedContext.memories, research: researchEvidence }) : null,
        afterQuality: input.quality ?? null,
      })
    : null;
  const captureFulfillment = reviewContextCaptureFulfillment({
    questions: input.questions,
    answers: input.answers,
    memories,
    impacts: answerImpact?.rows ?? [],
  });
  const intake = buildAimIntakeReport({
    title: input.title,
    description: input.description,
    planning: selectedContext,
    draftReview: input.review ?? null,
    lineageLearning,
  });
  const intakeSignals = contextIntakeSignals({
    planning: selectedContext,
    questions: input.questions,
    answers: input.answers,
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
    plan: input.plan,
    aimContext: contextSedimentation.aimContext,
    durableMemoryCandidates: contextSedimentation.durableMemoryCandidates,
    contextSedimentation,
    selectedContext: selectedContext.memories,
  });

  const metadata: Record<string, unknown> = {
    ...(input.quality !== undefined || input.qualityRetry || input.review
      ? planQualityMetadata({
          quality: input.quality ?? null,
          retried: input.qualityRetry?.retried ?? false,
          attempts: input.qualityRetry?.attempts ?? 1,
          firstQuality: input.qualityRetry?.firstQuality ?? null,
          output: input.plan,
        }, input.review)
      : {}),
    aim_intake: intake,
    context_intake_progress: intakeProgress,
    context_sedimentation: contextSedimentation,
    local_handoff_manifest: localHandoffManifest,
    planning_context: selectedContext.report,
    planning_tools: planningToolTrace(selectedContext),
    ...(input.debugTrace ? { planning_debug_trace: input.debugTrace } : {}),
    ...(input.parentGoalId && input.parentMilestoneId
      ? {
          parent_goal_id: input.parentGoalId,
          parent_milestone_id: input.parentMilestoneId,
        }
      : {}),
    ...(answerImpact ? { clarify_answer_impact: answerImpact } : {}),
    ...(captureFulfillment.total > 0 ? { context_capture_fulfillment: captureFulfillment } : {}),
  };

  return { metadata, memories, answerImpact, contextSedimentation };
}

type SavedGoalSynthesis = Awaited<ReturnType<typeof synthesizeSavedGoalMetadata>>;

/**
 * Record the pending context candidates a persisted aim seeds (sedimented aim context + durable
 * memory candidates, clarify assumptions, plan-review candidates). Shared by save + update; store
 * candidate writes dedupe by normalized content, so re-running on a re-plan is idempotent-safe.
 */
async function recordSavedGoalContextCandidates(
  goal: Goal,
  input: { contextSedimentation: SavedGoalSynthesis["contextSedimentation"]; assumptions?: SaveRequest["assumptions"]; review?: SaveRequest["review"] },
) {
  return [
    ...(await recordSedimentationAimContextForStore(aimStore, goal, input.contextSedimentation)),
    ...(await recordSedimentationMemoryCandidatesForStore(aimStore, input.contextSedimentation)),
    ...(await recordAssumptionContextCandidatesForStore(aimStore, goal, input.assumptions ?? [])),
    ...(await recordReviewContextCandidatesForStore(aimStore, goal, input.review)),
  ];
}

export function registerIpc(): void {
  ipcMain.handle(IPC.getWindowChromeState, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return {
      fullscreen: Boolean(win?.isFullScreen()),
      colorScheme: nativeTheme.shouldUseDarkColors ? "dark" : "light",
    };
  });

  // The in-app theme toggle drives the native window appearance. Setting themeSource fires
  // nativeTheme's "updated" listener (main/index.ts), which repaints the window background
  // and re-emits the chrome state — so the native titlebar/traffic-light context follows an
  // in-app light/dark override instead of desyncing from the OS. Validate the untrusted value.
  ipcMain.handle(IPC.setThemeSource, (_event, source: WindowThemeSource) => {
    if (source === "system" || source === "light" || source === "dark") {
      nativeTheme.themeSource = source;
    }
  });

  ipcMain.handle(IPC.getAppInfo, () => {
    const dir = defaultDataDir();
    const home = homedir();
    return {
      version: app.getVersion(),
      // Tilde-shortened for display; revealWorkspace resolves the real dir itself.
      workspacePath: dir.startsWith(home) ? `~${dir.slice(home.length)}` : dir,
    };
  });

  // Takes no renderer input — it only ever opens the fixed local workspace root, so a
  // compromised renderer can't use it to open arbitrary paths.
  ipcMain.handle(IPC.revealWorkspace, async () => {
    await shell.openPath(defaultDataDir());
  });

  // Corruption/recovery reports. Read-only and cheap; the cockpit polls it with its other
  // startup reads so a quarantined store never looks like an empty workspace.
  ipcMain.handle(IPC.getStoreDiagnostics, () => aimStore.getDiagnostics());

  ipcMain.handle(IPC.getDesktopPreferences, (): DesktopPreferences => loadDesktopPreferences());

  ipcMain.handle(IPC.setDesktopPreferences, (_e, prefs: DesktopPreferences): DesktopPreferences =>
    saveDesktopPreferences(prefs),
  );

  // The folder picker behind a `workspace-write` consent. A native dialog is the grant: the
  // renderer cannot name a path the user did not choose here (main re-checks it at enqueue).
  ipcMain.handle(IPC.pickRunWorkspace, async (): Promise<LocalContextPickResult> => pickLocalContextFolder());

  ipcMain.handle(IPC.intake, async (event, req: IntakeRequest) => {
    const runId = planningRunId(req);
    emitPlanningLiveEvent(event, runId, { type: "planning.started", stage: "intake" });
    try {
      emitPlanningLiveEvent(event, runId, { type: "context.started", stage: "intake" });
      const selectedContext = await planningContextForIntake(req);
      const toolsTrace = planningToolTrace(selectedContext);
      emitPlanningLiveEvent(event, runId, {
        type: "context.completed",
        stage: "intake",
        planningContext: selectedContext.report,
        planningTools: toolsTrace,
        summary: planningContextSummary(selectedContext),
      });
      const intake = buildAimIntakeReport({
        title: req.title,
        description: req.description,
        planning: selectedContext,
        lineageLearning: await contextLineageLearning(),
      });
      const generated = await runIntakeQuestions(
        buildGateway(),
        {
          title: req.title,
          description: req.description,
          intake,
          memories: selectedContext.memories,
          research: selectedContext.research,
          researchRequired: selectedContext.researchRequired,
          toolSignals: intakeToolSignals(selectedContext),
          explorationHistory: intakeExplorationHistory(req),
          maxQuestions: req.maxQuestions,
        },
        modelRunHooks(event, runId),
      );
      if (!generated.ok || !generated.intake) {
        emitPlanningLiveEvent(event, runId, {
          type: "planning.failed",
          stage: "intake",
          error: generated.errors.join("; "),
          summary: { errorCount: generated.errors.length },
        });
        throw new Error(generated.errors.join("; ") || "Failed to generate intake questions.");
      }
      emitPlanningLiveEvent(event, runId, {
        type: "intake.completed",
        stage: "intake",
        intake: generated.intake,
        summary: { questionCount: generated.intake.questions.length },
      });
      return generated.intake;
    } catch (err) {
      emitPlanningFailure(event, runId, "intake", err);
      throw err;
    }
  });

  ipcMain.handle(IPC.draft, async (event, req: DraftRequest) => {
    const runId = planningRunId(req);
    emitPlanningLiveEvent(event, runId, { type: "planning.started", stage: "draft" });
    try {
      emitPlanningLiveEvent(event, runId, { type: "context.started", stage: "draft" });
      const selectedContext = await planningContext(req);
      const toolsTrace = planningToolTrace(selectedContext);
      emitPlanningLiveEvent(event, runId, {
        type: "context.completed",
        stage: "draft",
        planningContext: selectedContext.report,
        planningTools: toolsTrace,
        summary: planningContextSummary(selectedContext),
      });
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
        modelRunHooks(event, runId),
      );
      const intake = buildAimIntakeReport({
        title: req.title,
        description: req.description,
        planning: selectedContext,
        draftReview: draft.review ?? null,
        lineageLearning,
      });
      if (draft.ok) {
        emitPlanningLiveEvent(event, runId, {
          type: "draft.completed",
          stage: "draft",
          intake,
          summary: {
            milestoneCount: draft.output?.nodes.length ?? 0,
            qualityScore: draft.quality?.score,
            qualityGrade: draft.quality?.grade,
          },
        });
      } else {
        emitPlanningLiveEvent(event, runId, {
          type: "planning.failed",
          stage: "draft",
          error: draft.errors.join("; "),
          summary: { errorCount: draft.errors.length },
        });
      }
      return {
        ...draft,
        intake,
        planningContext: selectedContext.report,
        planningTools: toolsTrace,
      };
    } catch (err) {
      emitPlanningFailure(event, runId, "draft", err);
      throw err;
    }
  });

  ipcMain.handle(IPC.clarify, async (event, req: ClarifyRequest) => {
    const runId = planningRunId(req);
    emitPlanningLiveEvent(event, runId, { type: "clarify.started", stage: "clarify" });
    try {
      emitPlanningLiveEvent(event, runId, { type: "context.started", stage: "clarify" });
      const selectedContext = await planningContext(req);
      const toolsTrace = planningToolTrace(selectedContext);
      emitPlanningLiveEvent(event, runId, {
        type: "context.completed",
        stage: "clarify",
        planningContext: selectedContext.report,
        planningTools: toolsTrace,
        summary: planningContextSummary(selectedContext),
      });
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
        modelRunHooks(event, runId),
      );
      if (clarified.ok) {
        emitPlanningLiveEvent(event, runId, {
          type: "clarify.completed",
          stage: "clarify",
          summary: { questionCount: clarified.output?.questions.length ?? 0 },
        });
      } else {
        emitPlanningLiveEvent(event, runId, {
          type: "planning.failed",
          stage: "clarify",
          error: clarified.errors.join("; "),
          summary: { errorCount: clarified.errors.length },
        });
      }
      return { ...clarified, planningTools: toolsTrace };
    } catch (err) {
      emitPlanningFailure(event, runId, "clarify", err);
      throw err;
    }
  });

  ipcMain.handle(IPC.refine, async (event, req: RefineRequest) => {
    const runId = planningRunId(req);
    emitPlanningLiveEvent(event, runId, { type: "refine.started", stage: "refine" });
    try {
      emitPlanningLiveEvent(event, runId, { type: "context.started", stage: "refine" });
      const selectedContext = await planningContext(req);
      const toolsTrace = planningToolTrace(selectedContext);
      emitPlanningLiveEvent(event, runId, {
        type: "context.completed",
        stage: "refine",
        planningContext: selectedContext.report,
        planningTools: toolsTrace,
        summary: planningContextSummary(selectedContext),
      });
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
        modelRunHooks(event, runId),
      );
      const intake = buildAimIntakeReport({
        title: req.title,
        description: req.description,
        planning: selectedContext,
        draftReview: refined.review ?? null,
        lineageLearning,
      });
      if (refined.ok) {
        emitPlanningLiveEvent(event, runId, {
          type: "refine.completed",
          stage: "refine",
          intake,
          summary: {
            milestoneCount: refined.output?.nodes.length ?? 0,
            qualityScore: refined.quality?.score,
            qualityGrade: refined.quality?.grade,
          },
        });
      } else {
        emitPlanningLiveEvent(event, runId, {
          type: "planning.failed",
          stage: "refine",
          error: refined.errors.join("; "),
          summary: { errorCount: refined.errors.length },
        });
      }
      return {
        ...refined,
        intake,
        planningContext: selectedContext.report,
        planningTools: toolsTrace,
      };
    } catch (err) {
      emitPlanningFailure(event, runId, "refine", err);
      throw err;
    }
  });

  ipcMain.handle(IPC.listGoals, (): Promise<Goal[]> => aimStore.listGoals());

  ipcMain.handle(IPC.getGoal, (_e, id: string): Promise<GoalDetail | null> => goalDetail(id));

  ipcMain.handle(IPC.getAimProgress, (_e, id: string) => aimStore.getAimProgress(id));

  ipcMain.handle(IPC.getAimJournal, (_e, id: string) => aimStore.listRunEvents(id));

  ipcMain.handle(IPC.listAimProgressSummaries, () => aimStore.listAimProgressSummaries());

  ipcMain.handle(IPC.deleteGoal, (_e, id: string): Promise<void> => {
    // Never delete under a writer: a planning brain still running for this aim stops first
    // (safe no-op when none). The store cascade below is authoritative for the rows.
    cancelPlanningSession(id);
    return aimStore.deleteGoal(id);
  });

  ipcMain.handle(IPC.listAimDrafts, () => aimStore.listAimDrafts());

  ipcMain.handle(IPC.getAimDraft, (_e, id: string) => aimStore.getAimDraft(id));

  ipcMain.handle(IPC.upsertAimDraft, (_e, req: UpsertAimDraftRequest) => aimStore.upsertAimDraft(req));

  ipcMain.handle(IPC.discardAimDraft, (_e, id: string): Promise<void> => aimStore.discardAimDraft(id));

  ipcMain.handle(IPC.listMemories, (_e, goalId?: string | null) => aimStore.listMemories(goalId ?? null));

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

  ipcMain.handle(IPC.getContextSourceConfig, async (): Promise<ContextSourceStatus> => getContextSourceConfig());

  ipcMain.handle(IPC.setContextSourceConfig, async (_e, config: ContextSourceConfig): Promise<ContextSourceStatus> =>
    setContextSourceConfig(config),
  );

  ipcMain.handle(IPC.pickLocalContextFolder, async (): Promise<LocalContextPickResult> => pickLocalContextFolder());

  ipcMain.handle(IPC.pickLocalContextFiles, async (): Promise<LocalContextPickResult> => pickLocalContextFiles());

  ipcMain.handle(IPC.listLocalAgents, async (): Promise<PlanningAgentDetection[]> => {
    // The renderer must not mirror adapter capabilities (a stale mirror once hid
    // the embedded path on a codex-only machine) — main states them per row.
    // The flag is pure ADAPTER capability; availability/auth stay separate so the
    // brain menu can show an installed-but-signed-out runtime as disabled.
    const detections = await listLocalAgents();
    return detections.map((detection) => ({
      ...detection,
      planningCapable: Boolean(defaultLocalAgentRegistry.get(detection.id)?.buildPlanningSessionInvocation),
    }));
  });

  ipcMain.handle(IPC.runLocalAgent, (_e, req: LocalAgentRunRequest): Promise<LocalAgentRunResult> =>
    runLocalAgent(req),
  );

  ipcMain.handle(IPC.runMilestoneAgent, (_e, req: RunMilestoneAgentRequest): Promise<RunMilestoneAgentResult> =>
    runMilestoneAgent(req),
  );

  ipcMain.handle(IPC.cancelRun, async (_e, runId: string): Promise<boolean> =>
    runQueue.cancel(runId) || (await cancelQueuedRun(aimStore, runId)),
  );

  // The re-grant path for a `workspace-write` run a previous session left queued: the renderer has
  // already re-shown that row's recorded permission and gotten an explicit click, so this only
  // executes the row that consent already lives on — the same claim-by-id path a fresh grant uses.
  ipcMain.handle(IPC.claimQueuedRun, (_e, runId: string): void => {
    claimConsentedRun(runQueue, runId);
  });

  // Anything left queued by a previous session (or by a CLI invocation that exited) resumes as
  // soon as the handlers are live.
  kickRunQueue(runQueue);
  // Diagnostic only — reports what stays queued above the floor and why; claims nothing.
  void logStrandedQueuedRuns(aimStore).catch((error: unknown) => {
    console.error("[aimcub] stranded-run diagnostic failed:", error);
  });

  ipcMain.handle(IPC.confirmMilestone, async (_e, req: ConfirmMilestoneRequest): Promise<GoalDetail | null> => {
    await aimStore.confirmMilestone({
      goalId: req.goalId,
      milestoneId: req.milestoneId,
      summary: req.summary,
      proofNote: req.proofNote,
      urls: req.urls,
      filePaths: req.filePaths,
      requiredEvidence: req.requiredEvidence,
    });
    await aimStore.sedimentContextFromGoal(req.goalId);
    return goalDetail(req.goalId);
  });

  ipcMain.handle(IPC.saveGoal, async (_e, req: SaveRequest): Promise<SavedGoal> => {
    const routingValidation = validatePlanRouting({
      plan: req.plan,
      agents: routingAgentOptions(await listLocalAgents()),
      allowHuman: true,
    });
    if (!routingValidation.ok) {
      throw new Error([
        "Routing validation failed:",
        ...routingValidation.issues.map((item) => `${item.title}: ${item.message}`),
      ].join("\n"));
    }
    const synthesis = await synthesizeSavedGoalMetadata(req);
    const saved = await aimStore.createGoal({
      title: req.title,
      description: req.description,
      parentGoalId: req.parentGoalId,
      parentMilestoneId: req.parentMilestoneId,
      plan: req.plan,
      metadata: synthesis.metadata,
      memories: synthesis.memories,
    });
    const contextCandidates = await recordSavedGoalContextCandidates(saved.goal, {
      contextSedimentation: synthesis.contextSedimentation,
      assumptions: req.assumptions,
      review: req.review,
    });
    if (req.draftId) await aimStore.discardAimDraft(req.draftId);
    return {
      ...saved,
      answerImpact: synthesis.answerImpact,
      contextCandidates,
    };
  });

  ipcMain.handle(IPC.createAim, async (_e, req: CreateAimRequest): Promise<SavedGoal> => {
    // Goal-first: persist a plan-less shell so the Journey mounts immediately. No plan, no synthesis
    // yet — the first plan (and its synthesis metadata) lands later via `updateGoalPlan`.
    const saved = await aimStore.createAimShell({
      title: req.title,
      description: req.description,
      parentGoalId: req.parentGoalId,
      parentMilestoneId: req.parentMilestoneId,
    });
    // Discard the pre-goal composer draft now that the shell exists (parity with `saveGoal`).
    if (req.draftId) await aimStore.discardAimDraft(req.draftId);
    return { ...saved };
  });

  ipcMain.handle(IPC.renameGoal, async (_e, req: RenameAimRequest): Promise<Goal | null> => {
    // Title/description-only patch — no plan, no milestone re-materialization. Works on a shell.
    const updated = await aimStore.renameGoal({ id: req.goalId, title: req.title, description: req.description });
    return updated?.goal ?? null;
  });

  ipcMain.handle(IPC.startPlanningSession, async (_e, req: PlanningSessionStartRequest) => startPlanningSession(req));
  ipcMain.handle(IPC.getPlanningSessionState, (_e, req: PlanningSessionRef) => getPlanningSessionState(req.goalId));
  ipcMain.handle(IPC.getPlanningPass, (_e, req: PlanningPassRequest) => getPlanningPassView(req.goalId, req.withLanding ?? true));
  ipcMain.handle(IPC.discardPlanningPass, (_e, req: PlanningSessionRef) => discardPlanningPass(req.goalId));
  ipcMain.handle(IPC.answerPlanningQuestion, (_e, req: PlanningSessionAnswerRequest) => answerPlanningQuestion(req));
  ipcMain.handle(IPC.postPlanningChat, (_e, req: PlanningSessionChatRequest) => postPlanningChat(req.goalId, req.text));
  ipcMain.handle(IPC.finishPlanningNow, (_e, req: PlanningSessionRef) => finishPlanningNow(req.goalId));
  ipcMain.handle(IPC.cancelPlanningSession, (_e, req: PlanningSessionRef) => {
    cancelPlanningSession(req.goalId);
  });

  ipcMain.handle(IPC.updateGoalPlan, async (_e, req: UpdateGoalPlanRequest): Promise<SavedGoal | null> => {
    // Same routing gate as `saveGoal` (main trusts the renderer's validateExecutablePlan but re-checks
    // routing before persisting).
    const routingValidation = validatePlanRouting({
      plan: req.plan,
      agents: routingAgentOptions(await listLocalAgents()),
      allowHuman: true,
    });
    if (!routingValidation.ok) {
      throw new Error([
        "Routing validation failed:",
        ...routingValidation.issues.map((item) => `${item.title}: ${item.message}`),
      ].join("\n"));
    }

    // Planning-run mode (the funnel context is supplied) recomputes the full synthesis bundle so a
    // shell's first plan / a fresh re-plan carries the same metadata + memories + candidates a
    // funnel `saveGoal` would. Manual-edit mode (no `questions`) is minimal: merge the plan only and
    // leave existing metadata untouched (the live agent handoff reads per-milestone contracts, which
    // `mergeMilestones` refreshes, so no goal-level manifest regeneration is needed).
    const planningRunMode = req.questions !== undefined;
    const synthesis = planningRunMode
      ? await synthesizeSavedGoalMetadata({
          title: req.title ?? "",
          description: req.description,
          draft: req.draft,
          plan: req.plan,
          quality: req.quality,
          review: req.review,
          qualityRetry: req.qualityRetry,
          debugTrace: req.debugTrace,
          questions: req.questions ?? [],
          answers: req.answers ?? [],
        })
      : null;

    // An embedded planning session landed this plan: its serialized transcript,
    // research provenance, and assumptions travel on the goal metadata, and the
    // brain's proposed durable facts become PENDING memory candidates (never
    // silently active memory).
    const planningSessionState = planningRunMode ? takePlanningSessionMetadata(req.goalId) : null;
    const sessionCandidates = planningRunMode ? planningSessionMemoryCandidates(req.goalId) : [];
    const metadata = synthesis
      ? planningSessionState
        ? { ...synthesis.metadata, planning_session: planningSessionState }
        : synthesis.metadata
      : undefined;

    const updated = await aimStore.updateGoal({
      id: req.goalId,
      title: req.title,
      description: req.description,
      plan: req.plan,
      metadata,
    });
    if (!updated) return null;
    if (planningRunMode) {
      for (const candidate of sessionCandidates) {
        const category = ContextCategory.safeParse(candidate.category);
        await aimStore.addMemoryCandidate({
          goalId: candidate.scope === "current_aim" ? updated.goal.id : null,
          content: candidate.content,
          ...(category.success ? { category: category.data } : {}),
          source: "agent_inferred",
        });
      }
      releasePlanningSession(req.goalId);
    }

    let answerImpact: SavedGoalSynthesis["answerImpact"] = null;
    let contextCandidates: Awaited<ReturnType<typeof recordSavedGoalContextCandidates>> | undefined;
    if (synthesis) {
      // Parity with `createGoal`, which inserts the clarify-answer memories inline. `addMemory`
      // dedupes by content+goal, so re-plans do not accumulate duplicates.
      for (const memory of synthesis.memories) {
        await aimStore.addMemory({ ...memory, goalId: updated.goal.id });
      }
      contextCandidates = await recordSavedGoalContextCandidates(updated.goal, {
        contextSedimentation: synthesis.contextSedimentation,
        assumptions: req.assumptions,
        review: req.review,
      });
      answerImpact = synthesis.answerImpact;
    }
    if (req.draftId) await aimStore.discardAimDraft(req.draftId);
    return { ...updated, answerImpact, contextCandidates };
  });
}
