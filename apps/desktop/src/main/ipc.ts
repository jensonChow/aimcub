/**
 * Registers the IPC handlers the renderer calls through the preload bridge.
 * Goal persistence is delegated to the shared `@core/store` (so the CLI sees the same
 * aims). Clarifying answers are folded into dimension-aware `user_stated` memories — the
 * first concrete writes toward the memory pillar.
 */
import { BrowserWindow, ipcMain, nativeTheme, type IpcMainInvokeEvent } from "electron";

import type { Goal, Milestone } from "@core/types";
import type { NewMemory } from "@core/store";
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
  type ConfirmMilestoneRequest,
  type DraftRequest,
  type GoalDetail,
  type IntakeRequest,
  type ProviderConfig,
  type ProviderStatus,
  type ProviderTestResult,
  type ContextSourceConfig,
  type ContextSourceStatus,
  type LocalContextPickResult,
  type LocalAgentDetection,
  type LocalAgentId,
  type LocalAgentRunRequest,
  type LocalAgentRunResult,
  type PlanningDebugTraceStage,
  type PlanningLiveEvent,
  type PlanningLiveSummary,
  type RunMilestoneAgentRequest,
  type RunMilestoneAgentResult,
  type RefineRequest,
  type SaveRequest,
  type SavedGoal,
  type UpsertAimDraftRequest,
  type WebResearchConfig,
  type WebResearchStatus,
  type WebResearchTestResult,
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

function milestonePlanKey(milestone: Milestone): string {
  const key = milestone.metadata?.plan_key;
  return typeof key === "string" ? key : milestone.id;
}

function milestoneAgentPrompt(goal: Goal, milestone: Milestone, extra?: string): string {
  const contract = milestone.metadata?.decomposition_contract as Record<string, unknown> | undefined;
  const done = typeof contract?.definition_of_done === "string" ? contract.definition_of_done : milestone.description;
  const evidence = Array.isArray(contract?.required_evidence) ? contract.required_evidence.join(", ") : "";
  const evalSignal = typeof contract?.eval_signal === "string" ? contract.eval_signal : "";
  return [
    `Aim: ${goal.title}`,
    goal.description ? `Aim description: ${goal.description}` : "",
    `Sub-aim: ${milestone.title}`,
    milestone.description ? `Sub-aim description: ${milestone.description}` : "",
    done ? `Definition of done: ${done}` : "",
    evidence ? `Required evidence: ${evidence}` : "",
    evalSignal ? `Eval signal: ${evalSignal}` : "",
    extra?.trim() ? `User instruction: ${extra.trim()}` : "",
    "",
    "Work on this sub-aim as far as the local runtime permissions allow. Report what you did, what evidence exists, and what remains blocked. Do not claim completion unless the evidence is explicit.",
  ].filter(Boolean).join("\n");
}

function isLocalAgentId(value: string | null | undefined): value is LocalAgentId {
  return value === "codex" || value === "claude";
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

async function runMilestoneAgent(req: RunMilestoneAgentRequest): Promise<RunMilestoneAgentResult> {
  const detail = await aimStore.getGoal(req.goalId);
  if (!detail) return { ok: false, run: null, detail: null, error: "Aim not found." };
  const milestone = detail.milestones.find((item) => item.id === req.milestoneId);
  if (!milestone) return { ok: false, run: null, detail, error: "Sub-aim not found." };
  const override = routingOverrideForMilestone(milestone);
  if (!req.agentId && override?.owner === "human") {
    return {
      ok: false,
      run: null,
      detail,
      error: "This sub-aim is routed to a human. Reassign it to an agent before running a local agent.",
    };
  }
  const detections = await listLocalAgents();
  const overrideAgentId = override?.owner === "agent" && isLocalAgentId(override.agent_id) ? override.agent_id : undefined;
  const requestedAgentId = req.agentId ?? overrideAgentId;
  const selected = requestedAgentId
    ? detections.find((agent) => agent.id === requestedAgentId)
    : detections.find((agent) => agent.id === "codex" && agent.available && agent.authStatus !== "missing")
      ?? detections.find((agent) => agent.available && agent.authStatus !== "missing");
  if (!selected || !selected.available || selected.authStatus === "missing") {
    return { ok: false, run: null, detail, error: "No authenticated local CLI agent is available." };
  }
  const selectedModel = req.model?.trim()
    || (override?.owner === "agent" ? override.model?.trim() : "")
    || selected.models.find((candidate) => candidate.id !== "default")?.id
    || selected.models[0]?.id
    || "default";

  const assignment = (await aimStore.listAssignments(detail.goal.id)).find((row) => row.milestone_id === milestone.id) ?? null;
  const orchestrationRun = await aimStore.createRun({
    goalId: detail.goal.id,
    milestoneId: milestone.id,
    assignmentId: assignment?.id ?? null,
    actorKind: "agent",
    status: "running",
    sandbox: "read-only",
    networkEnabled: false,
    model: selectedModel,
    summary: `Local agent ${selected.name} started with ${selectedModel}: ${milestone.title}`,
  });
  const run = await runLocalAgent({
    agentId: selected.id,
    prompt: milestoneAgentPrompt(detail.goal, milestone, req.prompt),
    model: selectedModel,
    permission: { sandbox: "read-only", network: false },
  });

  await aimStore.addEvidence({
    goalId: detail.goal.id,
    milestoneId: milestone.id,
    kind: "mcp_report",
    emitterId: null,
    sourceEventId: `local-agent:${selected.id}:${Date.now()}:${milestonePlanKey(milestone)}`,
    summary: run.ok
      ? `Local agent ${selected.name} worked on: ${milestone.title}`
      : `Local agent ${selected.name} failed on: ${milestone.title}`,
      payload: {
        agent_id: selected.id,
        model: selectedModel,
        command: run.command,
        args: run.args,
        ok: run.ok,
      output: run.outputText,
      events: run.events.map((event) => ({ type: event.type, summary: event.summary })),
      error: run.error,
    },
    trustScore: 0.6,
    runId: orchestrationRun.id,
    assignmentId: orchestrationRun.assignment_id,
  });
  await aimStore.finishRun({
    runId: orchestrationRun.id,
    status: run.ok ? "completed" : "failed",
    summary: run.ok
      ? `Local agent ${selected.name} completed its run for: ${milestone.title}`
      : `Local agent ${selected.name} failed its run for: ${milestone.title}`,
    error: run.error,
  });
  await aimStore.sedimentContextFromGoal(detail.goal.id);

  return {
    ok: run.ok,
    run,
    detail: await aimStore.getGoal(detail.goal.id),
    error: run.error,
  };
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

export function registerIpc(): void {
  ipcMain.handle(IPC.getWindowChromeState, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return {
      fullscreen: Boolean(win?.isFullScreen()),
      colorScheme: nativeTheme.shouldUseDarkColors ? "dark" : "light",
    };
  });

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

  ipcMain.handle(IPC.deleteGoal, (_e, id: string): Promise<void> => aimStore.deleteGoal(id));

  ipcMain.handle(IPC.listAimDrafts, () => aimStore.listAimDrafts());

  ipcMain.handle(IPC.getAimDraft, (_e, id: string) => aimStore.getAimDraft(id));

  ipcMain.handle(IPC.upsertAimDraft, (_e, req: UpsertAimDraftRequest) => aimStore.upsertAimDraft(req));

  ipcMain.handle(IPC.discardAimDraft, (_e, id: string): Promise<void> => aimStore.discardAimDraft(id));

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

  ipcMain.handle(IPC.listLocalAgents, () => listLocalAgents());

  ipcMain.handle(IPC.runLocalAgent, (_e, req: LocalAgentRunRequest): Promise<LocalAgentRunResult> =>
    runLocalAgent(req),
  );

  ipcMain.handle(IPC.runMilestoneAgent, (_e, req: RunMilestoneAgentRequest): Promise<RunMilestoneAgentResult> =>
    runMilestoneAgent(req),
  );

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
      parentGoalId: req.parentGoalId,
      parentMilestoneId: req.parentMilestoneId,
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
        ...(req.debugTrace ? { planning_debug_trace: req.debugTrace } : {}),
        ...(req.parentGoalId && req.parentMilestoneId
          ? {
              parent_goal_id: req.parentGoalId,
              parent_milestone_id: req.parentMilestoneId,
            }
          : {}),
        ...(answerImpact ? { clarify_answer_impact: answerImpact } : {}),
        ...(captureFulfillment.total > 0 ? { context_capture_fulfillment: captureFulfillment } : {}),
      },
      memories,
    });
    const contextCandidates = [
      ...(await recordSedimentationAimContextForStore(aimStore, saved.goal, contextSedimentation)),
      ...(await recordSedimentationMemoryCandidatesForStore(aimStore, contextSedimentation)),
      ...(await recordAssumptionContextCandidatesForStore(aimStore, saved.goal, req.assumptions ?? [])),
      ...(await recordReviewContextCandidatesForStore(aimStore, saved.goal, req.review)),
    ];
    if (req.draftId) await aimStore.discardAimDraft(req.draftId);
    return {
      ...saved,
      answerImpact,
      contextCandidates,
    };
  });
}
