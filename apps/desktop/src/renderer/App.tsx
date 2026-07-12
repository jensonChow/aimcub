import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  validateExecutablePlan,
  validatePlanRouting,
  type AimProgressReadModel,
  type AimProgressSummary,
} from "@core/domain";
import type { ClarifyAnswer, ClarifyOutput } from "@core/llm";
import type {
  AimDraft,
  AimDraftSaveBlock,
  DecompositionOutput,
  Goal,
  Memory,
  Milestone,
  RunEvent,
} from "@core/types";
import type {
  AppInfo,
  ClarifyIpcResult,
  ConfirmMilestoneRequest,
  ContextSourceStatus,
  GoalDetail,
  LocalAgentDetection,
  PlanningDebugTrace,
  PlanningLiveEvent,
  PlanResult,
  ProviderStatus,
  WebResearchStatus,
} from "../shared/ipc";

import { CockpitShell, type CockpitStage, type WorkbenchStage } from "./CockpitShell";
import { hasCompletionRecap, stageForOpenedAim } from "./completionRecap";
import { buildContextCandidateAcceptRequest, type ContextInboxScope } from "./ContextInbox";
import { ContextSourcesPanel } from "./ContextSourcesPanel";
import { buildContextBundleReview } from "./contextReview";
import {
  deriveAimHelperProfile,
  hasPlanningRuntime,
  routeAfterAimSubmit,
  routeAfterRefresh,
  type AimHelperProfile,
} from "./firstRunFlow";
import { I18nProvider, useI18n, type StringKey } from "./i18n";
import {
  aimIntakeOf,
  planningContextOf,
  planningToolsOf,
  reviewOf,
} from "./labels";
import { LocalAgentForm } from "./LocalAgentForm";
import { Notice } from "./Notice";
import { mergePlanningDebugTraces } from "./PlanningDebugPanel";
import { ProviderForm } from "./ProviderForm";
import { ContextClarifyPanel } from "./stages/context/ContextClarifyPanel";
import { buildContextLoopModel } from "./stages/context/contextLoop";
import { ContextReviewPanel } from "./stages/context/ContextReviewPanel";
import { ContextStage } from "./stages/context/ContextStage";
import type { ClarifyPhase, ContextAnswerMap } from "./stages/context/types";
import { EvalStage } from "./stages/eval/EvalStage";
import { ExecutePanel } from "./stages/execute/ExecutePanel";
import { NewAimComposer } from "./stages/aim/NewAimComposer";
import { HomeView } from "./stages/home/HomeView";
import { JourneyView } from "./stages/journey/JourneyView";
import { MemoryView } from "./stages/memory/MemoryView";
import { WebResearchForm } from "./WebResearchForm";
import { PlanPanel } from "./stages/plan/PlanPanel";
import { setThemePref, useThemePref } from "./theme";
import { Button, Panel } from "./ui";
import {
  appendIntakeQuestions,
  answersFor,
  buildDescriptionWithContext,
  hasCjkText,
  intakeToClarifyOutput,
  shouldBlockForIntake,
} from "./workflow/intakeClarify";
import { createPlanningRunId, latestLiveValue } from "./workflow/planningLiveEvents";
import { formatRoutingValidation, routingAgentsFromDetections } from "./workflow/routingAgents";
import {
  cockpitStageFor,
  planNodeForMilestone,
  progressRows,
  type AppMode,
} from "./workflow/stageRouting";
import {
  buildAimDraftUpsertRequest,
  hydrateAimDraft,
  persistedAimSurface,
  saveBlockFromProductError,
  type AimDraftBuildInput,
  type HydratedAimDraft,
} from "./workflow/aimDrafts";
import {
  formatPlanValidationIssues,
  formatPlanningFailure,
  routeAfterPlanningFailure,
  type ProductError,
} from "./workflow/planningErrors";
import {
  activeContextSourceCount,
  CONTEXT_SOURCE_TOTAL,
  settingsSectionForFocus,
  type SettingsSectionId,
} from "./workflow/settingsModel";
import {
  createDraftPersistenceQueue,
  type DraftPersistenceQueue,
} from "./workflow/draftPersistenceQueue";
import { confirmMilestoneAndRefresh } from "./workflow/confirmationFlow";
import {
  beginNavigation,
  beginPlanningActivity,
  canActivateGoal,
  canApplyDeferredSurfaceRoute,
  canApplyDeferredWorkspaceResponse,
  canStartWorkflowMutation,
  createNavigationConcurrencyState,
  finishSaveInFlight,
  withSaveInFlight,
} from "./workflow/navigationConcurrency";
import {
  createDraftActivationTracker,
  deriveWorkspaceTarget,
  isWorkbenchStageAvailable,
  settingsReturnStage,
} from "./workflow/workspaceNavigation";
import { shortText } from "./workflow/text";

type AimSurfaceMode = "idle" | "compose";
const MAX_ADAPTIVE_INTAKE_TURNS = 6;

interface AimDraftPersistenceOverrides {
  title?: string;
  description?: string;
  aimSurface?: AimDraftBuildInput["aimSurface"];
  resetPlanning?: boolean;
  saveBlock?: AimDraftSaveBlock | null;
}

export function App() {
  return (
    <I18nProvider>
      <AimOsApp />
    </I18nProvider>
  );
}

function AimOsApp() {
  const { t } = useI18n();
  const [mode, setMode] = useState<AppMode>("cockpit");
  const [goals, setGoals] = useState<Goal[]>([]);
  const [aimDrafts, setAimDrafts] = useState<AimDraft[]>([]);
  const [selected, setSelectedState] = useState<Goal | null>(null);
  const [detail, setDetail] = useState<GoalDetail | null>(null);
  const [progress, setProgress] = useState<AimProgressReadModel | null>(null);
  const [journalEvents, setJournalEvents] = useState<RunEvent[]>([]);
  const [progressSummaries, setProgressSummaries] = useState<Record<string, AimProgressSummary>>({});
  const [provider, setProvider] = useState<ProviderStatus | null>(null);
  const [webResearch, setWebResearch] = useState<WebResearchStatus | null>(null);
  const [contextSources, setContextSources] = useState<ContextSourceStatus | null>(null);
  const [localAgents, setLocalAgents] = useState<LocalAgentDetection[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [aimSurfaceMode, setAimSurfaceMode] = useState<AimSurfaceMode>("idle");
  const [aimTitle, setAimTitle] = useState("");
  const [aimDescription, setAimDescription] = useState("");
  const [parent, setParent] = useState<{ goalId: string; milestoneId: string } | null>(null);
  const [draft, setDraft] = useState<DecompositionOutput | null>(null);
  const [finalPlan, setFinalPlan] = useState<DecompositionOutput | null>(null);
  const [planResult, setPlanResult] = useState<PlanResult | null>(null);
  // Goal-first: when set, an in-Journey planning run is building the FIRST plan for this plan-less
  // shell goal. It keeps the Journey mounted (the research/clarify/plan-review interaction renders
  // in-Journey) and routes the commit to `updateGoalPlan` (land on the same goal) instead of
  // `saveGoal` (which would fork). Derived `isPlanningShell` gates all of that.
  const [planningShellId, setPlanningShellId] = useState<string | null>(null);
  const [planningDebugTraces, setPlanningDebugTraces] = useState<PlanningDebugTrace[]>([]);
  const [planningLiveEvents, setPlanningLiveEvents] = useState<PlanningLiveEvent[]>([]);
  const [intakeClarify, setIntakeClarify] = useState<ClarifyOutput | null>(null);
  const [intakeAnswers, setIntakeAnswers] = useState<ContextAnswerMap>({});
  const [clarifyPhase, setClarifyPhase] = useState<ClarifyPhase>(null);
  const [clarify, setClarify] = useState<ClarifyOutput | null>(null);
  const [answers, setAnswers] = useState<ContextAnswerMap>({});
  const [contextNote, setContextNote] = useState("");
  const [draftSaveBlock, setDraftSaveBlock] = useState<AimDraftSaveBlock | null>(null);
  const [error, setError] = useState<string | ProductError | null>(null);
  const [busy, setBusyState] = useState<string | null>(null);
  const [stageOverride, setStageOverride] = useState<CockpitStage | null>(null);
  const [runtimeGuidanceVisible, setRuntimeGuidanceVisible] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>("general");
  const [manualProofDraftActive, setManualProofDraftActive] = useState(false);
  const proofNavigationErrorRef = useRef<string | null>(null);
  const [workspaceRevision, setWorkspaceRevision] = useState(0);
  const handleProofDraftActiveChange = useCallback((active: boolean) => {
    setManualProofDraftActive(active);
    if (!active) {
      const blockedMessage = proofNavigationErrorRef.current;
      setError((current) => current === blockedMessage ? null : current);
      proofNavigationErrorRef.current = null;
    }
  }, []);
  const navigationConcurrencyRef = useRef(createNavigationConcurrencyState<string>());
  const selectedGoalRef = useRef<Goal | null>(null);
  const draftActivationTrackerRef = useRef(createDraftActivationTracker());
  const sideEffectOperationRef = useRef<{ id: string; busy: string } | null>(null);
  const pendingTargetNavigationRef = useRef<{
    transition: number;
    busy: string;
    targetDraftId?: string;
  } | null>(null);
  const discardInFlightDraftIdRef = useRef<string | null>(null);
  const settingsReturnStageRef = useRef<WorkbenchStage>("aim");
  const draftPersistenceRef = useRef<DraftPersistenceQueue | null>(null);
  const activeDraftIdRef = useRef<string | null>(null);
  const [activeDraftId, setActiveDraftIdState] = useState<string | null>(null);
  if (!draftPersistenceRef.current) {
    draftPersistenceRef.current = createDraftPersistenceQueue((req) => window.aimcub.upsertAimDraft(req));
  }
  const draftPersistence = draftPersistenceRef.current;

  function setSelected(goal: Goal | null) {
    selectedGoalRef.current = goal;
    setSelectedState(goal);
  }

  function setActiveDraftId(id: string | null) {
    activeDraftIdRef.current = id;
    setActiveDraftIdState(id);
  }

  function setBusy(nextBusy: string | null) {
    const lockedBusy = sideEffectOperationRef.current?.busy
      ?? pendingTargetNavigationRef.current?.busy
      ?? (discardInFlightDraftIdRef.current ? t("os.busy.discardDraft") : null)
      ?? (navigationConcurrencyRef.current.saveInFlight ? navigationConcurrencyRef.current.busy : null);
    const guardedBusy = nextBusy === null && lockedBusy
      ? lockedBusy
      : nextBusy;
    navigationConcurrencyRef.current = {
      ...navigationConcurrencyRef.current,
      busy: guardedBusy,
    };
    setBusyState(guardedBusy);
  }

  function beginSideEffectOperation(id: string, busyMessage: string): boolean {
    if (sideEffectOperationRef.current) return false;
    sideEffectOperationRef.current = { id, busy: busyMessage };
    setBusy(busyMessage);
    return true;
  }

  function finishSideEffectOperation(id: string) {
    if (sideEffectOperationRef.current?.id !== id) return;
    sideEffectOperationRef.current = null;
    setBusy(null);
  }

  function beginPendingTargetNavigation(transition: number, targetDraftId?: string) {
    const pending = { transition, busy: t("os.busy.navigation"), targetDraftId };
    pendingTargetNavigationRef.current = pending;
    setBusy(pending.busy);
  }

  function finishPendingTargetNavigation(transition: number) {
    if (pendingTargetNavigationRef.current?.transition !== transition) return;
    pendingTargetNavigationRef.current = null;
    setBusy(null);
  }

  function cancelPendingTargetNavigation() {
    if (!pendingTargetNavigationRef.current) return;
    pendingTargetNavigationRef.current = null;
    setBusy(null);
  }

  function navigationIsLocked(): boolean {
    if (manualProofDraftActive) {
      const message = t("os.proofNavigationBlocked");
      proofNavigationErrorRef.current = message;
      setError(message);
      return true;
    }
    return navigationConcurrencyRef.current.saveInFlight || Boolean(discardInFlightDraftIdRef.current);
  }

  function workflowMutationIsLocked(): boolean {
    return !canStartWorkflowMutation({
      saveInFlight: navigationConcurrencyRef.current.saveInFlight,
      discardInFlight: Boolean(discardInFlightDraftIdRef.current),
      pendingTargetNavigation: Boolean(pendingTargetNavigationRef.current),
      sideEffectInFlight: Boolean(sideEffectOperationRef.current),
    });
  }

  function beginWorkspaceTransition(): number {
    const next = beginNavigation(navigationConcurrencyRef.current, "target");
    navigationConcurrencyRef.current = next;
    setBusyState(next.busy);
    return next.workspace;
  }

  function bumpWorkspaceRevision() {
    setWorkspaceRevision((current) => current + 1);
  }

  function isCurrentWorkspaceTransition(transition: number): boolean {
    const current = navigationConcurrencyRef.current;
    return canApplyDeferredWorkspaceResponse({ workspace: transition, surface: current.surface }, current);
  }

  function beginSurfaceTransition(): number {
    const next = beginNavigation(navigationConcurrencyRef.current, "surface");
    navigationConcurrencyRef.current = next;
    setBusyState(next.busy);
    return next.surface;
  }

  function isCurrentSurfaceTransition(transition: number): boolean {
    const current = navigationConcurrencyRef.current;
    return canApplyDeferredSurfaceRoute({ workspace: current.workspace, surface: transition }, current);
  }

  function isCurrentPlanningRun(runId: string, transition: number): boolean {
    return navigationConcurrencyRef.current.planningRunId === runId && isCurrentWorkspaceTransition(transition);
  }

  useEffect(() => {
    void refreshAll();
  }, []);

  useEffect(() => {
    return window.aimcub.onPlanningLiveEvent((event) => {
      const activeRunId = navigationConcurrencyRef.current.planningRunId;
      if (!activeRunId || event.runId !== activeRunId) return;
      setPlanningLiveEvents((current) => [...current, event].slice(-80));
    });
  }, []);

  function startPlanningRun(): string {
    const runId = createPlanningRunId();
    navigationConcurrencyRef.current = beginPlanningActivity(
      navigationConcurrencyRef.current,
      runId,
      navigationConcurrencyRef.current.busy,
    );
    setPlanningLiveEvents([]);
    return runId;
  }

  function clearPlanningRun() {
    navigationConcurrencyRef.current = {
      ...navigationConcurrencyRef.current,
      planningRunId: null,
    };
  }

  function interruptPlanningForNavigation() {
    if (!navigationConcurrencyRef.current.planningRunId) return;
    clearPlanningRun();
    setBusy(null);
  }

  function applyProgressSummaries(summaries: AimProgressSummary[]) {
    setProgressSummaries(Object.fromEntries(summaries.map((summary) => [summary.goal_id, summary])));
  }

  async function refreshProgressSummaries() {
    // Goal-independent list rollup (all aims): safe to fire-and-forget after any side
    // effect. On failure keep the last known dots rather than clearing them.
    try {
      applyProgressSummaries(await window.aimcub.listAimProgressSummaries());
    } catch {
      /* keep last-known summaries */
    }
  }

  async function refreshListSurfaces() {
    // The goal-independent list rollups that Stage-D surfaces read: the sidebar/Home
    // status dots (progressSummaries) and the Journey research station + memory count
    // (memories). Fire-and-forget after any side effect that can change them; keep the
    // last-known values on failure rather than clearing a live surface.
    await Promise.all([
      refreshProgressSummaries(),
      window.aimcub.listMemories().then(setMemories).catch(() => undefined),
    ]);
  }

  async function refreshAll(options: { autoOpenFirstGoal?: boolean } = {}) {
    const transitionAtStart = navigationConcurrencyRef.current.workspace;
    const surfaceAtStart = navigationConcurrencyRef.current.surface;
    const configurationRefresh = Promise.all([
      window.aimcub.getProviderConfig().then(setProvider).catch(() => setProvider(null)),
      window.aimcub.getWebResearchConfig().then(setWebResearch).catch(() => setWebResearch(null)),
      window.aimcub.getContextSourceConfig().then(setContextSources).catch(() => setContextSources(null)),
      window.aimcub.listLocalAgents().then(setLocalAgents).catch(() => setLocalAgents([])),
      window.aimcub.listMemories().then(setMemories).catch(() => setMemories([])),
      window.aimcub.listAimProgressSummaries().then(applyProgressSummaries).catch(() => setProgressSummaries({})),
    ]).then(() => undefined);
    const [nextGoals, nextDrafts] = await Promise.all([
      window.aimcub.listGoals().catch(() => []),
      window.aimcub.listAimDrafts().catch(() => []),
    ]);
    if (!isCurrentWorkspaceTransition(transitionAtStart)) {
      await configurationRefresh;
      return;
    }
    setGoals(nextGoals);
    setAimDrafts(nextDrafts);
    const route = routeAfterRefresh({
      hasSelectedAim: Boolean(selected),
      hasActiveDraft: Boolean(activeDraftIdRef.current),
      hasDrafts: nextDrafts.length > 0,
      hasGoals: nextGoals.length > 0,
    });
    if (
      options.autoOpenFirstGoal !== false
      && route.autoOpenFirstGoal
      && nextGoals[0]
      && isCurrentWorkspaceTransition(transitionAtStart)
      && isCurrentSurfaceTransition(surfaceAtStart)
    ) {
      await openGoal(nextGoals[0]);
      await configurationRefresh;
      return;
    }
    if (route.stageOverride && isCurrentSurfaceTransition(surfaceAtStart)) {
      setMode("cockpit");
      setStageOverride(route.stageOverride);
    }
    await configurationRefresh;
  }

  async function openGoal(
    goal: Goal,
    options: { allowDuringSave?: boolean; checkpointDraft?: boolean } = {},
  ) {
    if (!options.allowDuringSave && navigationIsLocked()) return;
    if (discardInFlightDraftIdRef.current || !canActivateGoal(
      navigationConcurrencyRef.current,
      options.allowDuringSave ? "save_success" : "external_navigation",
    )) return;
    interruptPlanningForNavigation();
    const transition = beginWorkspaceTransition();
    const surfaceTransition = navigationConcurrencyRef.current.surface;
    beginPendingTargetNavigation(transition);
    try {
      if (options.checkpointDraft !== false && !(await checkpointCurrentDraftBeforeNavigation())) return;
      if (!isCurrentWorkspaceTransition(transition)) return;
      finishPendingTargetNavigation(transition);
      draftPersistence.invalidateSession();
      bumpWorkspaceRevision();
      setSelected(goal);
      setBusy(null);
      setMode("cockpit");
      setAimSurfaceMode("idle");
      setActiveDraftId(null);
      setDetail(null);
      setProgress(null);
      setJournalEvents([]);
      setStageOverride("aim");
      setError(null);
      setDraftSaveBlock(null);
      setDraft(null);
      setFinalPlan(null);
      setPlanResult(null);
      setPlanningDebugTraces([]);
      setPlanningLiveEvents([]);
      clearPlanningRun();
      setPlanningShellId(null);
      setIntakeClarify(null);
      setIntakeAnswers({});
      setClarifyPhase(null);
      setClarify(null);
      setAnswers({});
      setRuntimeGuidanceVisible(false);
      setContextNote("");
      try {
        await refreshGoalState(goal, transition, surfaceTransition);
      } catch (err) {
        if (isCurrentWorkspaceTransition(transition)) setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      finishPendingTargetNavigation(transition);
    }
  }

  async function refreshGoalState(
    goal: Goal | null = selected,
    transition = navigationConcurrencyRef.current.workspace,
    surfaceTransition = navigationConcurrencyRef.current.surface,
    options: { route?: boolean } = {},
  ) {
    if (!goal) return;
    const [nextDetail, nextProgress, nextJournal] = await Promise.all([
      window.aimcub.getGoal(goal.id),
      window.aimcub.getAimProgress(goal.id),
      // The run-lifecycle journal is non-critical: a failure here must not break goal loading.
      window.aimcub.getAimJournal(goal.id).catch(() => [] as RunEvent[]),
    ]);
    if (!isCurrentWorkspaceTransition(transition)) return;
    setDetail(nextDetail);
    setProgress(nextProgress);
    setJournalEvents(nextJournal);
    if (options.route !== false && isCurrentSurfaceTransition(surfaceTransition)) {
      setStageOverride(stageForOpenedAim(nextProgress));
    }
  }

  async function refreshGoalAfterSideEffect(
    goal: Goal,
    transition: number,
    surfaceTransition: number,
  ) {
    void refreshListSurfaces();
    if (isCurrentWorkspaceTransition(transition)) {
      await refreshGoalState(goal, transition, surfaceTransition, { route: false });
      return;
    }
    if (selectedGoalRef.current?.id !== goal.id) return;
    await refreshGoalState(
      goal,
      navigationConcurrencyRef.current.workspace,
      navigationConcurrencyRef.current.surface,
      { route: false },
    );
  }

  function resetComposer(options: { openComposer?: boolean } = {}) {
    bumpWorkspaceRevision();
    draftPersistence.invalidateSession();
    setStageOverride("aim");
    setActiveDraftId(null);
    setAimSurfaceMode(options.openComposer ? "compose" : "idle");
    setAimTitle("");
    setAimDescription("");
    setParent(null);
    setDraft(null);
    setFinalPlan(null);
    setPlanResult(null);
    setPlanningDebugTraces([]);
    setPlanningLiveEvents([]);
    clearPlanningRun();
    setPlanningShellId(null);
    setIntakeClarify(null);
    setIntakeAnswers({});
    setClarifyPhase(null);
    setClarify(null);
    setAnswers({});
    setRuntimeGuidanceVisible(false);
    setContextNote("");
    setDraftSaveBlock(null);
    setSelected(null);
    setBusy(null);
    setDetail(null);
    setProgress(null);
    setJournalEvents([]);
    setError(null);
  }

  function descriptionWithContext(baseDescription = aimDescription): string | undefined {
    return buildDescriptionWithContext({
      baseDescription,
      intakeClarify,
      intakeAnswers,
      contextNote,
    });
  }

  async function startDraft(
    options: { skipIntakeGate?: boolean; shell: { goalId: string; title: string; description: string } },
  ) {
    if (workflowMutationIsLocked()) return;
    const transition = navigationConcurrencyRef.current.workspace;
    const requestedDescription = options.shell.description;
    const title = options.shell.title.trim();
    // Goal-first: the shell aim already exists — run the planning orchestration in-Journey against it.
    // The composer-surface + draft-checkpoint funnel is gone (no draft is persisted here; the autosave
    // effect is inert while a goal is `selected`).
    setRuntimeGuidanceVisible(false);
    setError(null);
    setDraftSaveBlock(null);
    setPlanningDebugTraces([]);
    const runId = startPlanningRun();
    try {
      if (!options.skipIntakeGate) {
        setBusy(t("os.busy.context"));
        setMode("contexting");
        setStageOverride("context");
        const intake = await window.aimcub.intake({
          title,
          description: requestedDescription.trim() || undefined,
          clientRunId: runId,
          maxQuestions: 1,
        });
        if (!isCurrentPlanningRun(runId, transition)) return;
        setPlanResult({ ok: false, output: null, errors: [], intake });
        if (shouldBlockForIntake(intake) && intake.questions.length > 0) {
          const intakeOutput = intakeToClarifyOutput(intake, hasCjkText(`${title}\n${requestedDescription}`));
          setIntakeClarify(intakeOutput);
          setClarify(intakeOutput);
          setClarifyPhase("intake");
          setBusy(null);
          return;
        }
      }

      setBusy(t("os.busy.draft"));
      setMode("drafting");
      setStageOverride("contracts");
      const planningDescription = descriptionWithContext(requestedDescription);
      const req = { title, description: planningDescription, clientRunId: runId };
      const nextDraft = await window.aimcub.draft(req);
      if (!isCurrentPlanningRun(runId, transition)) return;
      setPlanResult(nextDraft);
      setPlanningDebugTraces(nextDraft.debugTrace ? [nextDraft.debugTrace] : []);
      if (!nextDraft.ok || !nextDraft.output) {
        setError(formatPlanningFailure({ stage: "draft", errors: nextDraft.errors, t, fallback: t("os.err.draft") }));
        const route = routeAfterPlanningFailure("draft");
        setMode(route.mode);
        setStageOverride(route.stageOverride);
        return;
      }
      setDraft(nextDraft.output);
      setFinalPlan(nextDraft.output);
      const nextClarify: ClarifyIpcResult = await window.aimcub.clarify({ ...req, draft: nextDraft.output }).catch((err: unknown) => ({
        ok: false,
        output: null,
        errors: [err instanceof Error ? err.message : String(err)],
      }));
      if (!isCurrentPlanningRun(runId, transition)) return;
      const clarifyTrace = nextClarify.debugTrace;
      if (clarifyTrace) {
        setPlanningDebugTraces((current) => [...current, clarifyTrace]);
      }
      setClarify(nextClarify.output ?? { questions: [], assumptions: [] });
      setClarifyPhase("postDraft");
      setAnswers({});
      setMode("answering");
      setStageOverride("context");
    } catch (err) {
      if (!isCurrentPlanningRun(runId, transition)) return;
      setError(formatPlanningFailure({
        stage: "draft",
        errors: [err instanceof Error ? err.message : String(err)],
        t,
        fallback: t("os.err.draft"),
      }));
      const route = routeAfterPlanningFailure("draft");
      setMode(route.mode);
      setStageOverride(route.stageOverride);
    } finally {
      if (isCurrentPlanningRun(runId, transition)) setBusy(null);
    }
  }

  const builtAnswers = useMemo<ClarifyAnswer[]>(() => {
    return answersFor(clarifyPhase === "intake" ? null : clarify, answers);
  }, [answers, clarify, clarifyPhase]);

  const builtIntakeAnswers = useMemo<ClarifyAnswer[]>(() => {
    return answersFor(intakeClarify, intakeAnswers);
  }, [intakeAnswers, intakeClarify]);

  function currentAimDraftInput(overrides: AimDraftPersistenceOverrides = {}): AimDraftBuildInput {
    const resetPlanning = overrides.resetPlanning === true;
    return {
      id: activeDraftIdRef.current,
      title: overrides.title ?? aimTitle,
      description: overrides.description ?? aimDescription,
      parent,
      activeStage: resetPlanning
        ? "aim"
        : stageOverride === "settings"
        ? settingsReturnStageRef.current
        : stageOverride ?? cockpitStageFor(mode, selected, (finalPlan ?? draft ?? detail?.goal.plan_json ?? null) as DecompositionOutput | null),
      aimSurface: overrides.aimSurface ?? persistedAimSurface(aimSurfaceMode),
      phase: resetPlanning ? null : clarifyPhase,
      contextNote: resetPlanning ? "" : contextNote,
      intakeClarify: resetPlanning ? null : intakeClarify,
      intakeAnswers: resetPlanning ? [] : builtIntakeAnswers,
      clarify: resetPlanning || clarifyPhase === "intake" ? null : clarify,
      clarifyAnswers: resetPlanning ? [] : builtAnswers,
      draft: resetPlanning ? null : draft,
      finalPlan: resetPlanning ? null : finalPlan,
      saveBlock: overrides.saveBlock !== undefined
        ? overrides.saveBlock
        : resetPlanning
          ? null
          : draftSaveBlock,
    };
  }

  async function persistCurrentDraftNow(
    overrides: AimDraftPersistenceOverrides = {},
    options: { navigation?: boolean; throwOnError?: boolean; allowDuringDiscard?: boolean } = {},
  ): Promise<AimDraft | null> {
    const discardingCurrentDraft = Boolean(discardInFlightDraftIdRef.current)
      && discardInFlightDraftIdRef.current === activeDraftIdRef.current;
    if (selected || (discardingCurrentDraft && !options.allowDuringDiscard)) return null;
    const transition = navigationConcurrencyRef.current.workspace;
    const req = buildAimDraftUpsertRequest(currentAimDraftInput(overrides));
    if (!req) return null;
    if (!draftPersistence.currentDraftId()) {
      draftPersistence.beginSession(activeDraftIdRef.current);
      if (options.navigation) draftPersistence.pauseAutosave();
    }
    try {
      const result = options.navigation
        ? await draftPersistence.flushForNavigation(req)
        : await draftPersistence.enqueue(req);
      if (result.status !== "persisted") return null;
      const saved = result.draft;
      if (!isCurrentWorkspaceTransition(transition)) return saved;
      setActiveDraftId(saved.id);
      setAimDrafts((current) => [saved, ...current.filter((row) => row.id !== saved.id)]
        .sort((a, b) => (b.updated_at ?? b.created_at ?? "").localeCompare(a.updated_at ?? a.created_at ?? "")));
      return saved;
    } catch (err) {
      if (options.throwOnError) throw err;
      return null;
    }
  }

  async function checkpointCurrentDraftBeforeNavigation(): Promise<boolean> {
    if (selected) return true;
    const transition = navigationConcurrencyRef.current.workspace;
    draftPersistence.pauseAutosave();
    try {
      await persistCurrentDraftNow({}, { navigation: true, throwOnError: true });
      return true;
    } catch (err) {
      if (!isCurrentWorkspaceTransition(transition)) return false;
      draftPersistence.resumeAutosave();
      clearPlanningRun();
      setBusy(null);
      setError({
        title: t("aimDraft.checkpointErrorTitle"),
        message: t("aimDraft.checkpointErrorMessage"),
        recovery: t("aimDraft.checkpointErrorRecovery"),
        details: [err instanceof Error ? err.message : String(err)],
      });
      return false;
    }
  }

  async function refreshAimDrafts() {
    setAimDrafts(await window.aimcub.listAimDrafts().catch(() => []));
  }

  function applyHydratedDraft(hydrated: HydratedAimDraft) {
    bumpWorkspaceRevision();
    draftPersistence.beginSession(hydrated.id);
    setSelected(null);
    setBusy(null);
    setDetail(null);
    setProgress(null);
    setJournalEvents([]);
    setActiveDraftId(hydrated.id);
    // Goal-first: every resume lands back in the composer with the aim's title/description. The
    // legacy plan/clarify/parent/summary hydration fed the removed intake funnel and is dropped;
    // submitting from the composer mints a shell and planning happens in-Journey.
    setAimSurfaceMode("compose");
    setAimTitle(hydrated.title);
    setAimDescription(hydrated.description);
    setParent(null);
    setDraft(null);
    setFinalPlan(null);
    setPlanResult(null);
    setPlanningDebugTraces([]);
    setPlanningLiveEvents([]);
    clearPlanningRun();
    setIntakeClarify(null);
    setIntakeAnswers({});
    setClarifyPhase(null);
    setClarify(null);
    setAnswers({});
    setContextNote("");
    setDraftSaveBlock(null);
    setError(null);
    setRuntimeGuidanceVisible(false);
    setMode("cockpit");
    setStageOverride("aim");
  }

  async function openAimDraft(draftRow: AimDraft) {
    if (navigationIsLocked()) return;
    if (activeDraftIdRef.current === draftRow.id && !pendingTargetNavigationRef.current) return;
    const activation = draftActivationTrackerRef.current.capture(draftRow.id);
    interruptPlanningForNavigation();
    const transition = beginWorkspaceTransition();
    beginPendingTargetNavigation(transition, draftRow.id);
    try {
      if (!(await checkpointCurrentDraftBeforeNavigation())) return;
      if (!isCurrentWorkspaceTransition(transition)) return;
      if (!draftActivationTrackerRef.current.isCurrent(activation)) {
        draftPersistence.resumeAutosave();
        return;
      }
      const fresh = await window.aimcub.getAimDraft(draftRow.id).catch(() => undefined);
      if (!isCurrentWorkspaceTransition(transition)) return;
      if (!draftActivationTrackerRef.current.isCurrent(activation)) {
        draftPersistence.resumeAutosave();
        return;
      }
      if (fresh === null) {
        draftPersistence.resumeAutosave();
        await refreshAimDrafts();
        return;
      }
      finishPendingTargetNavigation(transition);
      applyHydratedDraft(hydrateAimDraft(fresh ?? draftRow));
    } finally {
      finishPendingTargetNavigation(transition);
    }
  }

  async function discardAimDraft(draftRow: AimDraft) {
    if (navigationIsLocked() || sideEffectOperationRef.current) return;
    draftActivationTrackerRef.current.invalidate(draftRow.id);
    const discardingActiveDraft = activeDraftIdRef.current === draftRow.id;
    const cancelsPendingDraftActivation = pendingTargetNavigationRef.current?.targetDraftId === draftRow.id;
    if (discardingActiveDraft) {
      cancelPendingTargetNavigation();
      interruptPlanningForNavigation();
    } else if (cancelsPendingDraftActivation) {
      cancelPendingTargetNavigation();
      draftPersistence.resumeAutosave();
    }
    discardInFlightDraftIdRef.current = draftRow.id;
    setBusy(t("os.busy.discardDraft"));
    const transition = discardingActiveDraft ? beginWorkspaceTransition() : navigationConcurrencyRef.current.workspace;
    if (discardingActiveDraft) {
      draftPersistence.pauseAutosave();
      await persistCurrentDraftNow({}, { navigation: true, allowDuringDiscard: true });
      draftPersistence.invalidateSession();
    }
    try {
      await window.aimcub.discardAimDraft(draftRow.id);
      if (discardingActiveDraft && isCurrentWorkspaceTransition(transition)) resetComposer();
      await refreshAimDrafts();
    } catch (err) {
      if (discardingActiveDraft && isCurrentWorkspaceTransition(transition)) {
        draftPersistence.beginSession(draftRow.id);
      }
      if (isCurrentWorkspaceTransition(transition)) setError(err instanceof Error ? err.message : String(err));
    } finally {
      discardInFlightDraftIdRef.current = null;
      setBusy(null);
    }
  }

  useEffect(() => {
    if (selected) return;
    const timer = window.setTimeout(() => {
      void persistCurrentDraftNow();
    }, 500);
    return () => window.clearTimeout(timer);
  }, [
    activeDraftId,
    aimDescription,
    aimSurfaceMode,
    aimTitle,
    builtAnswers,
    builtIntakeAnswers,
    clarify,
    clarifyPhase,
    contextNote,
    draft,
    draftSaveBlock,
    finalPlan,
    detail,
    mode,
    parent,
    selected,
    stageOverride,
  ]);

  async function continueFromContext() {
    if (workflowMutationIsLocked()) return;
    // Goal-first: planning only ever runs against a shell now (the unsaved-aim funnel is gone), so the
    // aim's title/description live on the shell goal.
    const shellOpt = isPlanningShell && selected
      ? { goalId: selected.id, title: selected.title, description: selected.description ?? "" }
      : undefined;
    if (!shellOpt) return;
    const runTitle = shellOpt.title;
    const runDescription = shellOpt.description;
    const priorQuestions = intakeClarify?.questions ?? [];
    if (priorQuestions.length === 0 || priorQuestions.length >= MAX_ADAPTIVE_INTAKE_TURNS) {
      setClarifyPhase(null);
      await startDraft({ skipIntakeGate: true, shell: shellOpt });
      return;
    }

    const transition = navigationConcurrencyRef.current.workspace;
    const runId = navigationConcurrencyRef.current.planningRunId ?? startPlanningRun();
    setBusy(t("os.busy.context"));
    setError(null);
    try {
      const intake = await window.aimcub.intake({
        title: runTitle.trim(),
        description: runDescription.trim() || undefined,
        clientRunId: runId,
        priorQuestions,
        answers: answersFor(intakeClarify, intakeAnswers),
        maxQuestions: 1,
      });
      if (!isCurrentPlanningRun(runId, transition)) return;
      setPlanResult({ ok: false, output: null, errors: [], intake });
      const next = intakeToClarifyOutput(intake, hasCjkText(`${runTitle}\n${runDescription}`));
      const merged = appendIntakeQuestions(intakeClarify, next);
      if (next.questions.length > 0 && merged.questions.length > priorQuestions.length) {
        setIntakeClarify(merged);
        setClarify(merged);
        setClarifyPhase("intake");
        return;
      }

      setClarifyPhase(null);
      setBusy(null);
      await startDraft({ skipIntakeGate: true, shell: shellOpt });
    } catch (err) {
      if (!isCurrentPlanningRun(runId, transition)) return;
      setError(formatPlanningFailure({
        stage: "draft",
        errors: [err instanceof Error ? err.message : String(err)],
        t,
        fallback: t("os.err.draft"),
      }));
      setMode("contexting");
      setStageOverride("context");
    } finally {
      if (isCurrentPlanningRun(runId, transition)) setBusy(null);
    }
  }

  async function refinePlan() {
    if (workflowMutationIsLocked()) return;
    if (!draft) return;
    const transition = navigationConcurrencyRef.current.workspace;
    setBusy(t("os.busy.refine"));
    setError(null);
    setDraftSaveBlock(null);
    const runId = startPlanningRun();
    // Goal-first: while planning a shell, the aim's title/description live on the shell goal.
    const shellGoal = isPlanningShell ? selected : null;
    try {
      const refined = await window.aimcub.refine({
        title: (shellGoal?.title ?? aimTitle).trim(),
        description: descriptionWithContext(shellGoal ? (shellGoal.description ?? "") : undefined),
        draft,
        questions: clarify?.questions ?? [],
        answers: builtAnswers,
        clientRunId: runId,
      });
      if (!isCurrentPlanningRun(runId, transition)) return;
      if (!refined.ok || !refined.output) {
        setPlanResult(refined);
        const refineTrace = refined.debugTrace;
        if (refineTrace) {
          setPlanningDebugTraces((current) => [...current, refineTrace]);
        }
        setError(formatPlanningFailure({ stage: "refine", errors: refined.errors, t, fallback: t("os.err.refine") }));
        const route = routeAfterPlanningFailure("refine");
        setMode(route.mode);
        setStageOverride(route.stageOverride);
        return;
      }
      setFinalPlan(refined.output);
      setPlanResult(refined);
      const refineTrace = refined.debugTrace;
      if (refineTrace) {
        setPlanningDebugTraces((current) => [...current, refineTrace]);
      }
      setClarifyPhase(null);
      setMode("reviewing");
      setStageOverride("contracts");
    } catch (err) {
      if (!isCurrentPlanningRun(runId, transition)) return;
      setError(formatPlanningFailure({
        stage: "refine",
        errors: [err instanceof Error ? err.message : String(err)],
        t,
        fallback: t("os.err.refine"),
      }));
      const route = routeAfterPlanningFailure("refine");
      setMode(route.mode);
      setStageOverride(route.stageOverride);
    } finally {
      if (isCurrentPlanningRun(runId, transition)) setBusy(null);
    }
  }

  async function savePlan() {
    if (workflowMutationIsLocked()) return;
    const transition = navigationConcurrencyRef.current.workspace;
    const plan = finalPlan ?? draft;
    if (!plan) return;
    const validation = validateExecutablePlan(plan);
    if (!validation.ok) {
      const productError = formatPlanningFailure({ stage: "save", errors: validation.errors, t, fallback: t("plan.validationFailed") });
      const saveBlock = saveBlockFromProductError(productError);
      setError(productError);
      setDraftSaveBlock(saveBlock);
      await persistCurrentDraftNow({ saveBlock });
      if (!isCurrentWorkspaceTransition(transition)) return;
      const route = routeAfterPlanningFailure("save");
      setMode(route.mode);
      setStageOverride(route.stageOverride);
      return;
    }
    const routingValidation = validatePlanRouting({
      plan,
      agents: routingAgentsFromDetections(localAgents),
      allowHuman: true,
    });
    if (!routingValidation.ok) {
      const message = formatRoutingValidation(routingValidation);
      const saveBlock: AimDraftSaveBlock = {
        title: t("planningError.save.title"),
        message: t("planningError.save.message"),
        recovery: t("planningError.save.recovery"),
        issues: routingValidation.issues.slice(0, 3).map((issue) => issue.title),
      };
      setError(message);
      setDraftSaveBlock(saveBlock);
      await persistCurrentDraftNow({ saveBlock });
      if (!isCurrentWorkspaceTransition(transition)) return;
      setStageOverride("contracts");
      setMode("reviewing");
      return;
    }
    setBusy(t("os.busy.save"));
    setError(null);
    navigationConcurrencyRef.current = withSaveInFlight(navigationConcurrencyRef.current, true);
    try {
      const savedDraft = await persistCurrentDraftNow({}, { throwOnError: true });
      if (!isCurrentWorkspaceTransition(transition)) return;
      draftPersistence.pauseAutosave();
      const saved = await window.aimcub.saveGoal({
        draftId: savedDraft?.id ?? draftPersistence.currentDraftId() ?? activeDraftIdRef.current ?? undefined,
        title: aimTitle.trim(),
        description: aimDescription.trim() || undefined,
        parentGoalId: parent?.goalId,
        parentMilestoneId: parent?.milestoneId,
        draft,
        plan,
        quality: planResult?.quality ?? null,
        review: planResult?.review ?? null,
        qualityRetry: planResult?.qualityRetry ?? undefined,
        debugTrace: mergePlanningDebugTraces(planningDebugTraces.length ? planningDebugTraces : [planResult?.debugTrace]),
        questions: [
          ...(intakeClarify?.questions ?? []),
          ...(clarifyPhase === "intake" ? [] : clarify?.questions ?? []),
        ],
        answers: [...builtIntakeAnswers, ...builtAnswers],
        assumptions: clarify?.assumptions ?? [],
      });
      if (!isCurrentWorkspaceTransition(transition)) {
        await refreshAll({ autoOpenFirstGoal: false });
        return;
      }
      setActiveDraftId(null);
      setDraftSaveBlock(null);
      setBusy(null);
      resetComposer();
      await refreshAll({ autoOpenFirstGoal: false });
      if (!isCurrentWorkspaceTransition(transition)) return;
      await openGoal(saved.goal, { allowDuringSave: true, checkpointDraft: false });
    } catch (err) {
      if (!isCurrentWorkspaceTransition(transition)) return;
      setError(formatPlanningFailure({
        stage: "save",
        errors: [err instanceof Error ? err.message : String(err)],
        t,
        fallback: t("planningError.save.message"),
      }));
    } finally {
      navigationConcurrencyRef.current = finishSaveInFlight(navigationConcurrencyRef.current);
      draftPersistence.resumeAutosave();
      setBusy(null);
    }
  }

  // ── Goal-first (Stage 6): submit → shell → Journey → in-Journey planning → land on the same goal ──

  /** Submit from the New Aim composer: mint a plan-less shell and open its Journey immediately. */
  async function createAimAndOpenJourney() {
    if (workflowMutationIsLocked()) return;
    const title = aimTitle.trim();
    // Port the composer's submit gate: no aim → no-op; no planning runtime → show the helper and
    // create nothing. Only a real, plannable aim mints a shell.
    const route = routeAfterAimSubmit({ title, provider, localAgents });
    if (route === "missing_aim") return;
    if (route === "show_helper_guidance") {
      setError(null);
      setRuntimeGuidanceVisible(true);
      setMode("cockpit");
      setStageOverride("aim");
      return;
    }
    const description = aimDescription.trim() || undefined;
    // Discard any draft this composer autosaved, and pause autosave so the in-flight 500ms timer
    // can't re-mint one while the shell is created (mirrors `savePlan`). The session is left intact
    // so a pending autosave skips `beginSession` and honors the pause rather than un-pausing.
    const pendingDraftId = draftPersistence.currentDraftId() ?? activeDraftIdRef.current ?? undefined;
    draftPersistence.pauseAutosave();
    setError(null);
    setBusy(t("os.busy.save"));
    try {
      const created = await window.aimcub.createAim({ title, description, draftId: pendingDraftId });
      resetComposer();
      await refreshAll({ autoOpenFirstGoal: false });
      await openGoal(created.goal, { checkpointDraft: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      draftPersistence.resumeAutosave();
      setBusy(null);
    }
  }

  /** "Build the plan" on a plan-less shell: run the planning funnel in-Journey against the shell. */
  async function startShellResearch() {
    if (workflowMutationIsLocked() || !selected) return;
    const goal = selected;
    setPlanningShellId(goal.id);
    await startDraft({ shell: { goalId: goal.id, title: goal.title, description: goal.description ?? "" } });
  }

  /** Commit the in-Journey generated plan onto the SAME shell goal (no fork) via `updateGoalPlan`. */
  async function commitShellPlan() {
    if (workflowMutationIsLocked() || !selected) return;
    const goal = selected;
    const plan = finalPlan ?? draft;
    if (!plan) return;
    const transition = navigationConcurrencyRef.current.workspace;
    const validation = validateExecutablePlan(plan);
    if (!validation.ok) {
      setError(formatPlanningFailure({ stage: "save", errors: validation.errors, t, fallback: t("plan.validationFailed") }));
      return;
    }
    const routingValidation = validatePlanRouting({ plan, agents: routingAgentsFromDetections(localAgents), allowHuman: true });
    if (!routingValidation.ok) {
      setError(formatRoutingValidation(routingValidation));
      return;
    }
    setBusy(t("os.busy.save"));
    setError(null);
    try {
      const updated = await window.aimcub.updateGoalPlan({
        goalId: goal.id,
        title: goal.title,
        description: goal.description || undefined,
        draft,
        plan,
        quality: planResult?.quality ?? null,
        review: planResult?.review ?? null,
        qualityRetry: planResult?.qualityRetry ?? undefined,
        debugTrace: mergePlanningDebugTraces(planningDebugTraces.length ? planningDebugTraces : [planResult?.debugTrace]),
        questions: [
          ...(intakeClarify?.questions ?? []),
          ...(clarifyPhase === "intake" ? [] : clarify?.questions ?? []),
        ],
        answers: [...builtIntakeAnswers, ...builtAnswers],
        assumptions: clarify?.assumptions ?? [],
      });
      if (!isCurrentWorkspaceTransition(transition)) {
        await refreshAll({ autoOpenFirstGoal: false });
        return;
      }
      if (!updated) {
        setError(t("planningError.save.message"));
        return;
      }
      setPlanningShellId(null);
      resetPlanningForAimUpdate();
      setSelected(updated.goal);
      // Route back to the Journey: clear the leftover "contracts"/"reviewing" the planning run set,
      // else `mainStageContent`'s `activeStage === "contracts"` branch would intercept the render.
      setMode("cockpit");
      setStageOverride("aim");
      setBusy(null);
      await refreshGoalState(updated.goal, transition, navigationConcurrencyRef.current.surface, { route: false });
      void refreshListSurfaces();
    } catch (err) {
      setError(formatPlanningFailure({
        stage: "save",
        errors: [err instanceof Error ? err.message : String(err)],
        t,
        fallback: t("planningError.save.message"),
      }));
    } finally {
      setBusy(null);
    }
  }

  /** Persist an in-place manual plan edit onto the current saved goal (Stage 6B, manual-edit mode). */
  async function commitPlanEdit(plan: DecompositionOutput) {
    if (workflowMutationIsLocked() || !selected) return;
    const goal = selected;
    const transition = navigationConcurrencyRef.current.workspace;
    const validation = validateExecutablePlan(plan);
    if (!validation.ok) {
      setError(formatPlanningFailure({ stage: "save", errors: validation.errors, t, fallback: t("plan.validationFailed") }));
      return;
    }
    const routingValidation = validatePlanRouting({ plan, agents: routingAgentsFromDetections(localAgents), allowHuman: true });
    if (!routingValidation.ok) {
      setError(formatRoutingValidation(routingValidation));
      return;
    }
    setBusy(t("os.busy.save"));
    setError(null);
    try {
      // No `questions` → manual-edit mode: merge the plan (completed milestones frozen), keep the
      // existing intake/synthesis metadata (no fabricated critique for a hand edit).
      const updated = await window.aimcub.updateGoalPlan({ goalId: goal.id, plan });
      if (!isCurrentWorkspaceTransition(transition)) {
        await refreshAll({ autoOpenFirstGoal: false });
        return;
      }
      if (!updated) {
        setError(t("planningError.save.message"));
        return;
      }
      setSelected(updated.goal);
      setBusy(null);
      await refreshGoalState(updated.goal, transition, navigationConcurrencyRef.current.surface, { route: false });
      void refreshListSurfaces();
    } catch (err) {
      setError(formatPlanningFailure({
        stage: "save",
        errors: [err instanceof Error ? err.message : String(err)],
        t,
        fallback: t("planningError.save.message"),
      }));
    } finally {
      setBusy(null);
    }
  }

  /** Rename the selected aim's title/description in place (shell or planned) — no plan change. */
  async function renameAim(input: { title: string; description: string }) {
    if (workflowMutationIsLocked() || !selected) return;
    const goal = selected;
    const transition = navigationConcurrencyRef.current.workspace;
    const title = input.title.trim();
    if (!title) return;
    setBusy(t("os.busy.save"));
    setError(null);
    try {
      const updated = await window.aimcub.renameGoal({ goalId: goal.id, title, description: input.description });
      if (!isCurrentWorkspaceTransition(transition)) {
        await refreshAll({ autoOpenFirstGoal: false });
        return;
      }
      if (!updated) {
        setError(t("planningError.save.message"));
        return;
      }
      setSelected(updated);
      setBusy(null);
      await refreshGoalState(updated, transition, navigationConcurrencyRef.current.surface, { route: false });
      void refreshListSurfaces();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function runAgent(milestone: Milestone) {
    if (workflowMutationIsLocked()) return;
    if (!selected) return;
    const goal = selected;
    const operationId = `agent:${goal.id}:${milestone.id}`;
    if (!beginSideEffectOperation(operationId, t("os.busy.agent"))) return;
    const transition = navigationConcurrencyRef.current.workspace;
    const surfaceTransition = navigationConcurrencyRef.current.surface;
    setError(null);
    try {
      const result = await window.aimcub.runMilestoneAgent({ goalId: goal.id, milestoneId: milestone.id });
      const resultTargetIsCurrent = isCurrentWorkspaceTransition(transition) || selectedGoalRef.current?.id === goal.id;
      if (resultTargetIsCurrent && !result.ok && result.error) setError(result.error);
      await refreshGoalAfterSideEffect(goal, transition, surfaceTransition);
    } catch (err) {
      if (!isCurrentWorkspaceTransition(transition) && selectedGoalRef.current?.id !== goal.id) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      finishSideEffectOperation(operationId);
    }
  }

  async function confirmMilestone(
    milestone: Milestone,
    submission: Omit<ConfirmMilestoneRequest, "goalId" | "milestoneId">,
  ): Promise<boolean> {
    if (workflowMutationIsLocked()) return false;
    if (!selected) return false;
    const goal = selected;
    const operationId = `confirm:${goal.id}:${milestone.id}`;
    if (!beginSideEffectOperation(operationId, t("os.busy.confirm"))) return false;
    const transition = navigationConcurrencyRef.current.workspace;
    const surfaceTransition = navigationConcurrencyRef.current.surface;
    setError(null);
    try {
      const outcome = await confirmMilestoneAndRefresh(
        () => window.aimcub.confirmMilestone({
          goalId: goal.id,
          milestoneId: milestone.id,
          ...submission,
        }),
        () => window.aimcub.getAimProgress(goal.id),
      );
      if (outcome.status === "confirmation_failed") {
        if (isCurrentWorkspaceTransition(transition) || selectedGoalRef.current?.id === goal.id) {
          setError(outcome.error instanceof Error ? outcome.error.message : String(outcome.error));
        }
        return false;
      }
      // Confirmation mutated the store (a milestone completed → the aim's rollup can flip
      // to complete): this path bypasses refreshGoalAfterSideEffect, so refresh the
      // list-surface dots/counts explicitly. Goal-independent, safe to fire-and-forget.
      void refreshListSurfaces();
      const mutationTargetIsCurrent = isCurrentWorkspaceTransition(transition)
        || selectedGoalRef.current?.id === goal.id;
      if (mutationTargetIsCurrent) setDetail(outcome.detail);
      if (outcome.status === "refresh_failed") {
        if (mutationTargetIsCurrent) {
          setError(outcome.error instanceof Error ? outcome.error.message : String(outcome.error));
        }
        return true;
      }
      const nextProgress = outcome.progress;
      const originalTargetIsCurrent = isCurrentWorkspaceTransition(transition);
      if (!originalTargetIsCurrent && selectedGoalRef.current?.id !== goal.id) return true;
      setProgress(nextProgress);
      if (originalTargetIsCurrent && hasCompletionRecap(nextProgress) && isCurrentSurfaceTransition(surfaceTransition)) {
        setMode("reviewing");
        setStageOverride("eval");
      }
      return true;
    } finally {
      finishSideEffectOperation(operationId);
    }
  }

  async function acceptContextCandidate(candidate: Memory, content: string, scope: ContextInboxScope) {
    if (workflowMutationIsLocked()) return;
    const goal = selected;
    const operationId = `context-accept:${candidate.id}`;
    if (!beginSideEffectOperation(operationId, t("os.busy.contextReview"))) return;
    const transition = navigationConcurrencyRef.current.workspace;
    const surfaceTransition = navigationConcurrencyRef.current.surface;
    setError(null);
    try {
      await window.aimcub.acceptContextCandidate(buildContextCandidateAcceptRequest(candidate, content, scope));
      if (goal) await refreshGoalAfterSideEffect(goal, transition, surfaceTransition);
    } catch (err) {
      if (!isCurrentWorkspaceTransition(transition) && (!goal || selectedGoalRef.current?.id !== goal.id)) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      finishSideEffectOperation(operationId);
    }
  }

  async function rejectContextCandidate(candidate: Memory) {
    if (workflowMutationIsLocked()) return;
    const goal = selected;
    const operationId = `context-reject:${candidate.id}`;
    if (!beginSideEffectOperation(operationId, t("os.busy.contextReview"))) return;
    const transition = navigationConcurrencyRef.current.workspace;
    const surfaceTransition = navigationConcurrencyRef.current.surface;
    setError(null);
    try {
      await window.aimcub.rejectContextCandidate(candidate.id);
      if (goal) await refreshGoalAfterSideEffect(goal, transition, surfaceTransition);
    } catch (err) {
      if (!isCurrentWorkspaceTransition(transition) && (!goal || selectedGoalRef.current?.id !== goal.id)) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      finishSideEffectOperation(operationId);
    }
  }

  async function breakDown(milestone: Milestone) {
    if (workflowMutationIsLocked()) return;
    const plan = detail?.goal.plan_json as DecompositionOutput | null | undefined;
    const node = planNodeForMilestone(plan, milestone);
    // Goal-first: mint a linked CHILD shell (parent link carried on the create request) and open its
    // Journey, exactly like a top-level aim — the child lands on the "build the plan" card. The rich
    // decomposition-contract context becomes the child's persisted description so in-Journey planning
    // has it. Captured before `resetComposer` clears `selected`.
    const title = milestone.title;
    const description = [
      selected ? `Parent aim: ${selected.title}` : "",
      milestone.description ? `Sub-aim context: ${milestone.description}` : "",
      node?.decomposition_contract?.definition_of_done
        ? `Definition of done: ${node.decomposition_contract.definition_of_done}`
        : "",
      node?.decomposition_contract?.required_evidence?.length
        ? `Required evidence: ${node.decomposition_contract.required_evidence.join("; ")}`
        : "",
      node?.decomposition_contract?.eval_signal ? `Eval signal: ${node.decomposition_contract.eval_signal}` : "",
      "Break this sub-aim into smaller sub-aims with concrete eval rules.",
    ].filter(Boolean).join("\n");
    setError(null);
    setBusy(t("os.busy.save"));
    try {
      resetComposer();
      const created = await window.aimcub.createAim({
        title,
        description,
        parentGoalId: milestone.goal_id,
        parentMilestoneId: milestone.id,
      });
      await refreshAll({ autoOpenFirstGoal: false });
      await openGoal(created.goal, { checkpointDraft: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const activePlan = (finalPlan ?? draft ?? detail?.goal.plan_json ?? null) as DecompositionOutput | null;
  const activePlanValidation = activePlan ? validateExecutablePlan(activePlan) : null;
  const planningRuntimeReady = hasPlanningRuntime(provider, localAgents);
  // Goal-first: this selected goal is a plan-less shell mid first-plan (an in-Journey planning run is
  // active), so the Journey stays mounted and hosts the research/clarify/plan-review interaction.
  const isPlanningShell = planningShellId !== null && planningShellId === selected?.id;
  const activePlanValidationMessages = activePlanValidation?.ok === false
    ? formatPlanValidationIssues(activePlanValidation.errors, t)
    : [];
  const routingAgents = useMemo(() => routingAgentsFromDetections(localAgents), [localAgents]);
  const planRoutingValidation = useMemo(
    () => activePlan ? validatePlanRouting({ plan: activePlan, agents: routingAgents, allowHuman: true }) : null,
    [activePlan, routingAgents],
  );
  const hasUnsavedAim = aimTitle.trim().length > 0;
  const hasTransientAimWork = aimSurfaceMode !== "idle"
    || hasUnsavedAim
    || Boolean(parent)
    || Boolean(draft)
    || Boolean(activeDraftId);
  const showAimEditor = aimSurfaceMode === "compose";
  const activeStage = stageOverride ?? cockpitStageFor(mode, selected, activePlan);
  const workspaceTarget = deriveWorkspaceTarget({
    selectedGoalId: selected?.id ?? null,
    activeDraftId: aimSurfaceMode === "compose" ? null : activeDraftId,
    showAimComposer: hasTransientAimWork,
  });
  const activeAimTitle = selected?.title ?? aimTitle.trim();
  const activeAimDescription = selected?.description ?? aimDescription;
  const activeAimHelper = useMemo(
    () => deriveAimHelperProfile({ title: activeAimTitle, description: activeAimDescription }),
    [activeAimDescription, activeAimTitle],
  );
  const livePlanningContext = latestLiveValue(planningLiveEvents, (event) => event.planningContext);
  const livePlanningTools = latestLiveValue(planningLiveEvents, (event) => event.planningTools);
  const liveIntake = latestLiveValue(planningLiveEvents, (event) => event.intake);
  const currentPlanningContext = planResult?.planningContext ?? livePlanningContext ?? (selected ? planningContextOf(selected) : null);
  const currentPlanningTools = planResult?.planningTools ?? livePlanningTools ?? (selected ? planningToolsOf(selected) : null);
  const currentIntake = planResult?.intake ?? liveIntake ?? (selected ? aimIntakeOf(selected) : null);
  const currentReview = planResult?.review ?? (selected ? reviewOf(selected) : null);
  const contextReview = useMemo(() => buildContextBundleReview({
    planningContext: currentPlanningContext,
    planningTools: currentPlanningTools,
    intake: currentIntake,
    review: currentReview,
    plan: activePlan,
    answeredQuestionIds: [...builtIntakeAnswers, ...builtAnswers].map((answer) => answer.question_id),
  }), [activePlan, builtAnswers, builtIntakeAnswers, currentIntake, currentPlanningContext, currentPlanningTools, currentReview]);
  const contextReviewItemCount = contextReview.usedContext.length
    + contextReview.skippedContext.length
    + contextReview.permissionGaps.length
    + contextReview.decompositionRisks.length;
  const shouldShowContextReviewInContext = clarifyPhase !== "intake"
    && (contextReviewItemCount > 0
      || (mode === "contexting" && Boolean(busy))
      || mode === "drafting");
  const contextLoop = useMemo(() => buildContextLoopModel({
    contextSources,
    review: contextReview,
    planningContext: currentPlanningContext,
    planningTools: currentPlanningTools,
    intake: currentIntake,
    liveEvents: planningLiveEvents,
    running: (mode === "contexting" || mode === "drafting") && Boolean(busy),
    answeredQuestionCount: builtIntakeAnswers.length + builtAnswers.length,
    questionCount: clarify?.questions.length ?? currentIntake?.questions.length ?? 0,
    contextNote,
  }), [
    builtAnswers.length,
    builtIntakeAnswers.length,
    busy,
    clarify,
    contextNote,
    contextReview,
    contextSources,
    currentIntake,
    currentPlanningContext,
    currentPlanningTools,
    mode,
    planningLiveEvents,
  ]);

  function applyPlanEdit(nextPlan: DecompositionOutput) {
    setDraftSaveBlock(null);
    setFinalPlan(nextPlan);
    setPlanResult((current) => (current ? { ...current, output: nextPlan } : current));
  }

  function openCockpitStage(stage: CockpitStage): boolean {
    if (navigationIsLocked() || pendingTargetNavigationRef.current) return false;
    if (stage !== "settings" && !isWorkbenchStageAvailable(workspaceTarget, stage)) return false;
    if (stage !== activeStage) {
      beginSurfaceTransition();
      interruptPlanningForNavigation();
    }
    if (stage === "settings") {
      settingsReturnStageRef.current = settingsReturnStage(
        workspaceTarget,
        activeStage,
        settingsReturnStageRef.current,
      );
      setStageOverride(stage);
      setSettingsSection("general");
      setMode("settings");
      return true;
    }
    setStageOverride(stage);
    if (stage === "context") {
      setMode("contexting");
      return true;
    }
    if (stage === "contracts") {
      setMode(activePlan ? "reviewing" : "contexting");
      return true;
    }
    if (stage === "run" || stage === "eval") {
      setMode(selected || activePlan ? "reviewing" : "cockpit");
      return true;
    }
    setMode("cockpit");
    return true;
  }

  function resetPlanningForAimUpdate() {
    setDraft(null);
    setFinalPlan(null);
    setPlanResult(null);
    setPlanningDebugTraces([]);
    setPlanningLiveEvents([]);
    clearPlanningRun();
    setPlanningShellId(null);
    setIntakeClarify(null);
    setIntakeAnswers({});
    setClarifyPhase(null);
    setClarify(null);
    setAnswers({});
    setContextNote("");
    setDraftSaveBlock(null);
    setError(null);
  }


  async function startNewAim() {
    if (navigationIsLocked()) return;
    interruptPlanningForNavigation();
    const transition = beginWorkspaceTransition();
    beginPendingTargetNavigation(transition);
    try {
      if (!(await checkpointCurrentDraftBeforeNavigation())) return;
      if (!isCurrentWorkspaceTransition(transition)) return;
      finishPendingTargetNavigation(transition);
      resetComposer({ openComposer: true });
      setMode("cockpit");
      setStageOverride("aim");
    } finally {
      finishPendingTargetNavigation(transition);
    }
  }

  async function openHomePanel() {
    if (navigationIsLocked()) return;
    interruptPlanningForNavigation();
    const transition = beginWorkspaceTransition();
    beginPendingTargetNavigation(transition);
    try {
      if (!(await checkpointCurrentDraftBeforeNavigation())) return;
      if (!isCurrentWorkspaceTransition(transition)) return;
      finishPendingTargetNavigation(transition);
      resetComposer();
      setMode("cockpit");
      setStageOverride("aim");
    } finally {
      finishPendingTargetNavigation(transition);
    }
  }

  function openSettingsForAim() {
    if (navigationIsLocked() || pendingTargetNavigationRef.current) return;
    beginSurfaceTransition();
    interruptPlanningForNavigation();
    settingsReturnStageRef.current = settingsReturnStage(
      workspaceTarget,
      activeStage,
      settingsReturnStageRef.current,
    );
    setSettingsSection(settingsSectionForFocus(activeAimHelper.settingsFocus));
    setMode("settings");
    setStageOverride("settings");
  }

  function openContextSettings() {
    if (navigationIsLocked() || pendingTargetNavigationRef.current) return;
    beginSurfaceTransition();
    interruptPlanningForNavigation();
    settingsReturnStageRef.current = "context";
    setSettingsSection("research");
    setMode("settings");
    setStageOverride("settings");
  }

  async function refreshMemories() {
    setMemories(await window.aimcub.listMemories().catch(() => []));
  }

  function openMemory() {
    if (navigationIsLocked() || pendingTargetNavigationRef.current) return;
    beginSurfaceTransition();
    interruptPlanningForNavigation();
    void refreshMemories();
    setStageOverride("memory");
  }

  async function forgetMemory(memory: Memory) {
    setMemories((current) => current.filter((row) => row.id !== memory.id));
    try {
      await window.aimcub.archiveContextMemory(memory.id);
    } finally {
      await refreshMemories();
    }
  }

  const clarifyPanelActive = clarifyPhase !== null;
  const clarifyPanel = clarify && clarifyPanelActive ? (
    <ContextClarifyPanel
      clarify={clarify}
      phase={clarifyPhase}
      answers={clarifyPhase === "intake" ? intakeAnswers : answers}
      contextNote={contextNote}
      conversationEnabled={clarifyPhase !== "intake" || contextSources?.userSession.enabled !== false}
      questionnaireEnabled={clarifyPhase !== "intake" || contextSources?.questionnaire.enabled !== false}
      disabled={Boolean(busy)}
      onAnswer={(id, value) => {
        if (clarifyPhase === "intake") {
          setIntakeAnswers((current) => ({ ...current, [id]: value }));
        } else {
          setAnswers((current) => ({ ...current, [id]: value }));
        }
      }}
      onContextNote={setContextNote}
      onRefine={() => void (clarifyPhase === "intake" ? continueFromContext() : refinePlan())}
      onSkip={clarifyPhase === "intake" ? undefined : () => {
        setClarifyPhase(null);
        // In-Journey shell planning stays in the Journey (the plan review then shows in place);
        // the funnel path still hops to the old contracts stage.
        if (!isPlanningShell) openCockpitStage("contracts");
      }}
      onOpenSettings={openContextSettings}
      flowKey={activeDraftId ?? selected?.id ?? "new-aim"}
    />
  ) : null;

  const planPanel = activePlan ? (
    <PlanPanel
      key={`plan-workspace-${workspaceRevision}`}
      plan={activePlan}
      quality={planResult?.quality ?? null}
      review={planResult?.review ?? null}
      saved={Boolean(selected)}
      disabled={Boolean(busy)}
      validationErrors={activePlanValidationMessages}
      routingAgents={routingAgents}
      routingValidation={planRoutingValidation}
      onChange={selected ? undefined : applyPlanEdit}
      onSave={() => void savePlan()}
    />
  ) : null;

  const executePanel = selected && detail ? (
    <ExecutePanel
      detail={detail}
      progress={progress}
      disabled={Boolean(busy)}
      onRunAgent={(milestone) => void runAgent(milestone)}
      onConfirm={confirmMilestone}
      onPickFiles={async () => {
        const result = await window.aimcub.pickLocalContextFiles();
        return result.canceled ? [] : result.paths;
      }}
      onBreakDown={(milestone) => void breakDown(milestone)}
      onReviewEval={() => openCockpitStage("eval")}
      onProofDraftActiveChange={handleProofDraftActiveChange}
    />
  ) : null;

  const evalPanel = selected && detail ? (
    <EvalStage
      rows={progressRows(detail, progress)}
      progress={progress}
    />
  ) : null;

  const settingsPanel = (
    <SettingsPanel
      provider={provider}
      webResearch={webResearch}
      contextSources={contextSources}
      localAgents={localAgents}
      activeSection={settingsSection}
      onSection={setSettingsSection}
      onProvider={setProvider}
      onWeb={setWebResearch}
      onContextSources={setContextSources}
      onRefreshAgents={async () => setLocalAgents(await window.aimcub.listLocalAgents())}
    />
  );
  const continueContextToPlan = () => {
    // Goal-first: the Context stage is only reachable for a saved goal now, so continuing always
    // opens the Plan (contracts) stage — the old unsaved-aim `startDraft` funnel is gone.
    openCockpitStage("contracts");
  };

  // Aims (other than the selected one) with a turn waiting on the user → the header "N turns
  // elsewhere" jump chip. `needs_you` is the faithful "your move waiting" signal; blocked aims are
  // excluded (they may be waiting on an agent/dependency, not the user).
  const journeyElsewhere = selected
    ? goals.filter((candidate) => candidate.id !== selected.id && progressSummaries[candidate.id]?.status === "needs_you")
    : [];
  // The Journey element, computed once so it can render both normally (a planned goal) and, during a
  // shell's first-plan run (`isPlanningShell`), in place of the funnel Context/Plan stages.
  const journeyView = selected && !parent ? (
    <JourneyView
      key={selected.id}
      goal={selected}
      progress={progress}
      runEvents={journalEvents}
      researchMemories={memories.filter((memory) => memory.goal_id === selected.id || memory.goal_id === null)}
      contextLoop={contextLoop}
      contextReview={contextReview}
      planReview={activePlan ? {
        plan: activePlan,
        quality: planResult?.quality ?? null,
        review: planResult?.review ?? null,
        validationErrors: activePlanValidationMessages,
        routingAgents,
        routingValidation: planRoutingValidation,
        // Editable in place only for a saved planned goal (not a shell being planned, Stage 6B).
        onCommitPlan: isPlanningShell ? undefined : (plan) => void commitPlanEdit(plan),
      } : undefined}
      onReplan={!isPlanningShell && (progress?.total_milestones ?? 0) > 0 ? () => void startShellResearch() : undefined}
      onRenameAim={isPlanningShell ? undefined : (input) => void renameAim(input)}
      disabled={Boolean(busy)}
      elsewhereCount={journeyElsewhere.length}
      planningRuntimeReady={planningRuntimeReady}
      onStartResearch={() => void startShellResearch()}
      planning={isPlanningShell ? {
        busy: Boolean(busy),
        clarifyPanel: clarifyPhase !== null && clarify ? clarifyPanel : null,
        planReady: Boolean(finalPlan ?? draft) && clarifyPhase === null,
        onCommitPlan: () => void commitShellPlan(),
      } : undefined}
      onOpenStage={openCockpitStage}
      onRunAgent={(milestone) => void runAgent(milestone)}
      onConfirmMilestone={confirmMilestone}
      onPickEvidenceFiles={async () => {
        const result = await window.aimcub.pickLocalContextFiles();
        return result.canceled ? [] : result.paths;
      }}
      onNewAim={startNewAim}
      onAcceptContextCandidate={acceptContextCandidate}
      onRejectContextCandidate={rejectContextCandidate}
      onJumpElsewhere={() => {
        const next = journeyElsewhere[0];
        if (next) void openGoal(next);
      }}
    />
  ) : null;

  const mainStageContent = (() => {
    if (activeStage === "settings") return settingsPanel;
    if (activeStage === "memory") {
      return (
        <MemoryView
          memories={memories}
          goals={goals}
          disabled={Boolean(busy)}
          onForget={(memory) => void forgetMemory(memory)}
        />
      );
    }
    // Goal-first: a shell mid first-plan keeps the Journey mounted (the research/clarify/plan-review
    // interaction renders in-Journey) instead of falling through to the funnel Context/Plan stages.
    if (isPlanningShell && journeyView) return journeyView;
    if (activeStage === "context") {
      if (!selected && !parent && !hasUnsavedAim) {
        return (
          <LockedStagePanel
            eyebrow={t("os.stepContext")}
            title={t("cockpit.contextLockedTitle")}
            body={t("cockpit.contextLockedBody")}
            action={t("os.stepAim")}
            onAction={() => openCockpitStage("aim")}
          />
        );
      }
      return (
        <ContextStage
          title={selected?.title ?? aimTitle}
          description={selected?.description ?? aimDescription}
          saved={Boolean(selected)}
          disabled={Boolean(busy)}
          clarifyPhase={clarifyPhase}
          clarifyPanel={clarifyPanel}
          contextSources={contextSources}
          review={contextReview}
          loop={contextLoop}
          showReview={shouldShowContextReviewInContext}
          reviewRunning={mode === "contexting" && Boolean(busy)}
          onOpenSettings={openContextSettings}
          onContextSources={setContextSources}
          onContinueToPlan={continueContextToPlan}
        />
      );
    }
    if (activeStage === "contracts") {
      return planPanel ? (
        <>
          <ContextReviewPanel bundle={contextReview} running={mode === "drafting" && Boolean(busy)} compact />
          {planPanel}
        </>
      ) : (
        <LockedStagePanel
          eyebrow={t("os.stepPlan")}
          title={t("cockpit.contractsLockedTitle")}
          body={t("cockpit.contractsLockedBody")}
          action={t("cockpit.next.context")}
          onAction={() => openCockpitStage("context")}
        />
      );
    }
    if (activeStage === "run") {
      return executePanel ?? (
        <LockedStagePanel
          eyebrow={t("os.stepExecute")}
          title={t("cockpit.runLockedTitle")}
          body={t("cockpit.runLockedBody")}
          action={t("os.stepAim")}
          onAction={() => openCockpitStage("aim")}
        />
      );
    }
    if (activeStage === "eval") {
      return evalPanel ?? (
        <LockedStagePanel
          eyebrow={t("os.stepEval")}
          title={t("cockpit.runLockedTitle")}
          body={t("cockpit.runLockedBody")}
          action={t("os.stepAim")}
          onAction={() => openCockpitStage("aim")}
        />
      );
    }
    if (journeyView && !draft) return journeyView;
    if (showAimEditor) {
      // Goal-first: the composer is the only intake surface. Editing a saved aim happens in the
      // Journey (rename); child breakdown mints a linked shell — both skip this funnel.
      const composerGuidance = runtimeGuidanceVisible && !planningRuntimeReady && activeAimHelper ? (
        <AimHelperGuidancePanel
          title={aimTitle}
          profile={activeAimHelper}
          onOpenSettings={openSettingsForAim}
          onKeepEditing={() => setRuntimeGuidanceVisible(false)}
        />
      ) : null;
      return (
        <NewAimComposer
          title={aimTitle}
          description={aimDescription}
          disabled={Boolean(busy)}
          memoryCount={memories.length}
          guidance={composerGuidance}
          onTitle={setAimTitle}
          onDescription={setAimDescription}
          onSubmit={() => void createAimAndOpenJourney()}
        />
      );
    }
    return (
      <HomeView
        goals={goals}
        drafts={aimDrafts}
        progressSummaries={progressSummaries}
        planningRuntimeReady={planningRuntimeReady}
        planningModelLabel={provider?.configured ? provider.model ?? undefined : undefined}
        onOpenGoal={(goal) => void openGoal(goal)}
        onNewAim={() => void startNewAim()}
        onResumeDraft={(draftRow) => void openAimDraft(draftRow)}
        onDiscardDraft={(draftRow) => void discardAimDraft(draftRow)}
        onOpenSettings={() => openCockpitStage("settings")}
      />
    );
  })();

  return (
    <CockpitShell
      goals={goals}
      drafts={aimDrafts}
      progressSummaries={progressSummaries}
      activeStage={activeStage}
      workspaceTarget={workspaceTarget}
      onHome={() => void openHomePanel()}
      onNewAim={() => void startNewAim()}
      onOpenGoal={(goal) => void openGoal(goal)}
      onOpenDraft={(draftRow) => void openAimDraft(draftRow)}
      onDiscardDraft={(draftRow) => void discardAimDraft(draftRow)}
      onStage={openCockpitStage}
      onMemory={openMemory}
      memoryCount={memories.length}
      main={(
        <>
          {error ? <ProductErrorNotice error={error} /> : null}
          {busy ? <Notice tone="info">{busy}</Notice> : null}
          {mainStageContent}
        </>
      )}
    />
  );
}

function ProductErrorNotice(props: { error: string | ProductError }) {
  const { t } = useI18n();
  if (typeof props.error === "string") {
    return <Notice tone="error">{props.error}</Notice>;
  }
  return (
    <Notice tone="error">
      <div className="od-notice-copy">
        <strong>{props.error.title}</strong>
        <span>{props.error.message}</span>
        <small>{props.error.recovery}</small>
      </div>
      {props.error.details.length > 0 ? (
        <details className="od-notice-details">
          <summary>{t("plan.developerDetails")}</summary>
          <pre>{props.error.details.join("\n")}</pre>
        </details>
      ) : null}
    </Notice>
  );
}

function helperCapabilityLabel(profile: AimHelperProfile, t: ReturnType<typeof useI18n>["t"]): string {
  switch (profile.capability) {
    case "code_execution":
      return t("firstRun.capability.code");
    case "current_research":
      return t("firstRun.capability.research");
    case "source_context":
      return t("firstRun.capability.context");
    case "general_planning":
      return t("firstRun.capability.planning");
  }
}

function helperPreferenceLabel(profile: AimHelperProfile, t: ReturnType<typeof useI18n>["t"]): string {
  switch (profile.preferredHelper) {
    case "local_agent":
      return t("firstRun.helper.localAgent");
    case "provider_with_web":
      return t("firstRun.helper.providerWithWeb");
    case "provider":
      return t("firstRun.helper.provider");
    case "either":
      return t("firstRun.helper.either");
  }
}

function helperReason(profile: AimHelperProfile, t: ReturnType<typeof useI18n>["t"]): string {
  switch (profile.capability) {
    case "code_execution":
      return t("firstRun.reason.code");
    case "current_research":
      return t("firstRun.reason.research");
    case "source_context":
      return t("firstRun.reason.context");
    case "general_planning":
      return t("firstRun.reason.planning");
  }
}

function AimHelperGuidancePanel(props: {
  title: string;
  profile: AimHelperProfile;
  onOpenSettings: () => void;
  onKeepEditing: () => void;
}) {
  const { t } = useI18n();
  return (
    <section className="od-first-run-helper">
      <div className="od-first-run-helper-head">
        <div>
          <div className="od-aim-kicker">{t("firstRun.eyebrow")}</div>
          <h2>{t("firstRun.heading")}</h2>
          <p>{t("firstRun.body", { aim: shortText(props.title, 120) })}</p>
        </div>
      </div>
      <div className="od-first-run-helper-grid">
        <HelperFact label={t("firstRun.requiredLabel")} value={t("firstRun.requiredValue")} />
        <HelperFact label={t("firstRun.capabilityLabel")} value={helperCapabilityLabel(props.profile, t)} />
        <HelperFact label={t("firstRun.bestHelperLabel")} value={helperPreferenceLabel(props.profile, t)} />
      </div>
      <p className="od-first-run-helper-reason">{helperReason(props.profile, t)}</p>
      <div className="od-aim-intake-actions">
        <button className="od-aim-primary" type="button" onClick={props.onOpenSettings}>
          {t("firstRun.openSettings")}
        </button>
        <button className="od-aim-secondary" type="button" onClick={props.onKeepEditing}>
          {t("firstRun.keepEditing")}
        </button>
      </div>
    </section>
  );
}

function HelperFact(props: { label: string; value: string }) {
  return (
    <div className="od-first-run-helper-fact">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function LockedStagePanel(props: {
  eyebrow: string;
  title: string;
  body: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <Panel variant="plain" className="od-stage-panel od-locked-stage-panel">
      <div className="od-stage-panel-head">
        <div>
          <div className="od-stage-kicker">{props.eyebrow}</div>
          <h2>{props.title}</h2>
        </div>
        <Button variant="primary" size="lg" onClick={props.onAction}>
          {props.action}
        </Button>
      </div>
      <p>{props.body}</p>
    </Panel>
  );
}

/**
 * Settings — the re-synced Glass IA: the aim sidebar stays put; the workspace hosts a
 * "Settings" title + category rail (General / Planning brain / Workers / Research / About)
 * beside one detail pane. Forms keep their full capability; this component only arranges
 * them and owns the two General controls (appearance pref + workspace reveal).
 */
const SETTINGS_TABS: Array<{ id: SettingsSectionId; labelKey: StringKey }> = [
  { id: "general", labelKey: "settings.tab.general" },
  { id: "brain", labelKey: "settings.tab.brain" },
  { id: "workers", labelKey: "settings.tab.workers" },
  { id: "research", labelKey: "settings.tab.research" },
  { id: "about", labelKey: "settings.tab.about" },
];

export function SettingsPanel(props: {
  provider: ProviderStatus | null;
  webResearch: WebResearchStatus | null;
  contextSources: ContextSourceStatus | null;
  localAgents: LocalAgentDetection[];
  activeSection: SettingsSectionId;
  onSection: (section: SettingsSectionId) => void;
  onProvider: (status: ProviderStatus) => void;
  onWeb: (status: WebResearchStatus) => void;
  onContextSources: (status: ContextSourceStatus) => void;
  onRefreshAgents: () => Promise<void>;
}) {
  const { t } = useI18n();
  const { activeSection } = props;
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    let active = true;
    window.aimcub?.getAppInfo?.().then((info) => {
      if (active) setAppInfo(info);
    }).catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  let detailPane: ReactNode;
  if (activeSection === "general") {
    detailPane = <SettingsGeneralPane workspacePath={appInfo?.workspacePath ?? null} />;
  } else if (activeSection === "brain") {
    detailPane = (
      <SettingsTabPane title={t("settings.tab.brain")} sub={t("settings.brain.sub")}>
        <div className="od-settings-card od-settings-card-form">
          <ProviderForm status={props.provider} onSaved={props.onProvider} />
        </div>
      </SettingsTabPane>
    );
  } else if (activeSection === "workers") {
    detailPane = (
      <SettingsTabPane title={t("settings.tab.workers")} sub={t("settings.workers.sub")}>
        <div className="od-settings-you-row">
          <i className="od-settings-ready-dot" aria-hidden="true" />
          <span className="od-settings-you-name">{t("glass.actor.you")}</span>
          <span className="od-settings-you-meta">{t("settings.workers.youMeta")}</span>
        </div>
        <LocalAgentForm agents={props.localAgents} onRefresh={props.onRefreshAgents} />
      </SettingsTabPane>
    );
  } else if (activeSection === "research") {
    detailPane = (
      <SettingsResearchPane
        webResearch={props.webResearch}
        contextSources={props.contextSources}
        localAgents={props.localAgents}
        onWeb={props.onWeb}
        onContextSources={props.onContextSources}
      />
    );
  } else {
    detailPane = <SettingsAboutPane version={appInfo?.version ?? null} />;
  }

  return (
    <section className="od-settings" data-od-id="settings-view">
      <div className="od-settings-rail">
        <h1 className="od-settings-title">{t("os.settings")}</h1>
        <nav className="od-settings-rail-nav" aria-label={t("os.settings")}>
          {SETTINGS_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className="od-settings-rail-item"
              aria-current={tab.id === activeSection ? "page" : undefined}
              onClick={() => props.onSection(tab.id)}
            >
              <SettingsTabIcon section={tab.id} />
              <span>{t(tab.labelKey)}</span>
            </button>
          ))}
        </nav>
      </div>
      <div className="od-settings-detail" aria-live="polite">
        {detailPane}
      </div>
    </section>
  );
}

function SettingsTabPane(props: { title: string; sub: string; children: ReactNode }) {
  return (
    <section className="od-settings-pane">
      <header className="od-settings-pane-head">
        <h3>{props.title}</h3>
        <p>{props.sub}</p>
      </header>
      <div className="od-settings-pane-body">{props.children}</div>
    </section>
  );
}

function SettingsGeneralPane(props: { workspacePath: string | null }) {
  const { t } = useI18n();
  const themePref = useThemePref();
  const options: Array<{ pref: "light" | "dark" | "system"; label: string }> = [
    { pref: "light", label: t("userMenu.appearanceLight") },
    { pref: "dark", label: t("userMenu.appearanceDark") },
    { pref: "system", label: t("userMenu.appearanceSystem") },
  ];

  return (
    <SettingsTabPane title={t("settings.tab.general")} sub={t("settings.general.sub")}>
      <div className="od-settings-card">
        <div className="od-settings-card-row">
          <div className="od-settings-card-copy">
            <strong>{t("userMenu.appearance")}</strong>
            <span>{t("settings.general.appearanceBody")}</span>
          </div>
          <div className="od-settings-seg" role="radiogroup" aria-label={t("userMenu.appearance")}>
            {options.map((option) => (
              <button
                key={option.pref}
                type="button"
                role="radio"
                aria-checked={themePref === option.pref}
                data-active={themePref === option.pref ? "true" : "false"}
                onClick={() => setThemePref(option.pref)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="od-settings-card-row">
          <div className="od-settings-card-copy">
            <strong>{t("settings.general.workspace")}</strong>
            <span>{t("settings.general.workspaceBody")}</span>
          </div>
          <code className="od-settings-path">{props.workspacePath ?? "~/.aimcub"}</code>
          <button
            className="od-settings-mini-button"
            type="button"
            onClick={() => void window.aimcub?.revealWorkspace?.()}
          >
            {t("settings.general.reveal")}
          </button>
        </div>
      </div>
    </SettingsTabPane>
  );
}

function SettingsResearchPane(props: {
  webResearch: WebResearchStatus | null;
  contextSources: ContextSourceStatus | null;
  localAgents: LocalAgentDetection[];
  onWeb: (status: WebResearchStatus) => void;
  onContextSources: (status: ContextSourceStatus) => void;
}) {
  const { t } = useI18n();
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const activeSources = activeContextSourceCount(props.contextSources);

  return (
    <SettingsTabPane title={t("settings.tab.research")} sub={t("settings.research.sub")}>
      <div className="od-settings-card od-settings-card-form">
        <WebResearchForm
          status={props.webResearch}
          localAgentReady={props.localAgents.some((agent) => agent.available && agent.authStatus !== "missing")}
          onSaved={props.onWeb}
        />
      </div>
      <div className="od-settings-card">
        <div className="od-settings-card-row">
          <div className="od-settings-card-copy">
            <strong>{t("settings.research.sources")}</strong>
            <span>{t("settings.research.sourcesMeta", { n: activeSources, total: CONTEXT_SOURCE_TOTAL })}</span>
          </div>
          <button
            className="od-settings-mini-button"
            type="button"
            aria-expanded={sourcesOpen}
            onClick={() => setSourcesOpen((open) => !open)}
          >
            {t(sourcesOpen ? "settings.research.manageClose" : "settings.research.manage")}
          </button>
        </div>
      </div>
      {sourcesOpen ? (
        <ContextSourcesPanel status={props.contextSources} compact onSaved={props.onContextSources} />
      ) : null}
    </SettingsTabPane>
  );
}

function SettingsAboutPane(props: { version: string | null }) {
  const { t } = useI18n();
  return (
    <SettingsTabPane title={t("settings.tab.about")} sub={t("settings.about.sub")}>
      <div className="od-settings-card">
        <div className="od-settings-card-row">
          <div className="od-settings-card-copy">
            <strong>{t("glass.shell.brand")}</strong>
            <span>{t("settings.about.appBody")}</span>
          </div>
          {props.version ? (
            <code className="od-settings-path">{t("settings.about.version", { version: props.version })}</code>
          ) : null}
        </div>
        <div className="od-settings-card-row">
          <div className="od-settings-card-copy">
            <strong>{t("settings.about.data")}</strong>
            <span>{t("settings.about.dataBody")}</span>
          </div>
          <i className="od-settings-ready-dot" aria-hidden="true" />
        </div>
      </div>
    </SettingsTabPane>
  );
}

function SettingsTabIcon(props: { section: SettingsSectionId }) {
  const pathBySection: Record<SettingsSectionId, ReactNode> = {
    general: (
      <>
        <circle cx="10" cy="10" r="3.2" />
        <path d="M10 2.5v2M10 15.5v2M17.5 10h-2M4.5 10h-2M14.9 5.1l-1.4 1.4M6.5 13.5 5.1 14.9M14.9 14.9l-1.4-1.4M6.5 6.5 5.1 5.1" />
      </>
    ),
    brain: (
      <>
        <rect x="6" y="6" width="8" height="8" rx="1.6" />
        <path d="M8.4 6V4M11.6 6V4M8.4 16v-2M11.6 16v-2M6 8.4H4M6 11.6H4M16 8.4h-2M16 11.6h-2" />
      </>
    ),
    workers: (
      <>
        <circle cx="7.4" cy="8" r="2.2" />
        <path d="M3.4 15.4c.4-2 1.9-3.1 4-3.1s3.6 1.1 4 3.1" />
        <path d="M12.6 6.2A1.9 1.9 0 1 1 13.6 10" />
        <path d="M13 12.4c1.7-.1 3.2.9 3.6 3" />
      </>
    ),
    research: (
      <>
        <circle cx="10" cy="10" r="6.5" />
        <path d="M3.5 10h13M10 3.5c2 2.2 2 10.8 0 13M10 3.5c-2 2.2-2 10.8 0 13" />
      </>
    ),
    about: (
      <>
        <circle cx="10" cy="10" r="6.8" />
        <path d="M10 9.2v3.6" />
        <path d="M10 6.7h.01" />
      </>
    ),
  };

  return (
    <svg className="od-settings-rail-icon" aria-hidden="true" viewBox="0 0 20 20" focusable="false">
      {pathBySection[props.section]}
    </svg>
  );
}
