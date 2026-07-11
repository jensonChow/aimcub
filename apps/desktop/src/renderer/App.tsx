import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

import {
  validateExecutablePlan,
  validatePlanRouting,
  type AimProgressReadModel,
} from "@core/domain";
import type { ClarifyAnswer, ClarifyOutput } from "@core/llm";
import type {
  AimDraft,
  AimDraftSaveBlock,
  DecompositionOutput,
  Goal,
  Memory,
  Milestone,
} from "@core/types";
import type {
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
  aimSurfaceAfterSubmit,
  deriveAimHelperProfile,
  hasPlanningRuntime,
  routeAfterAimSubmit,
  routeAfterRefresh,
  type AimHelperProfile,
} from "./firstRunFlow";
import { I18nProvider, useI18n, type I18n } from "./i18n";
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
import { DraftAimOverviewPanel } from "./stages/aim/DraftAimOverviewPanel";
import { EvalStage } from "./stages/eval/EvalStage";
import { ExecutePanel } from "./stages/execute/ExecutePanel";
import { HomeView } from "./stages/home/HomeView";
import { JourneyView } from "./stages/journey/JourneyView";
import { MemoryView } from "./stages/memory/MemoryView";
import { WebResearchForm } from "./WebResearchForm";
import { PlanPanel } from "./stages/plan/PlanPanel";
import { Button, Panel } from "./ui";
import { C } from "./styles";
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
  buildSettingsModel,
  settingsSectionForFocus,
  type SettingsHelper,
  type SettingsHelperTone,
  type SettingsModel,
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

export { buildSettingsModel };

type AimSurfaceMode = "idle" | "compose" | "summary" | "edit";
const MAX_ADAPTIVE_INTAKE_TURNS = 6;

interface AimEditBuffer {
  title: string;
  description: string;
}

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
  const [provider, setProvider] = useState<ProviderStatus | null>(null);
  const [webResearch, setWebResearch] = useState<WebResearchStatus | null>(null);
  const [contextSources, setContextSources] = useState<ContextSourceStatus | null>(null);
  const [localAgents, setLocalAgents] = useState<LocalAgentDetection[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [aimSurfaceMode, setAimSurfaceMode] = useState<AimSurfaceMode>("idle");
  const [aimTitle, setAimTitle] = useState("");
  const [aimDescription, setAimDescription] = useState("");
  const [aimEditBuffer, setAimEditBuffer] = useState<AimEditBuffer | null>(null);
  const [restoreAimEditFocus, setRestoreAimEditFocus] = useState(false);
  const [parent, setParent] = useState<{ goalId: string; milestoneId: string } | null>(null);
  const [draft, setDraft] = useState<DecompositionOutput | null>(null);
  const [finalPlan, setFinalPlan] = useState<DecompositionOutput | null>(null);
  const [planResult, setPlanResult] = useState<PlanResult | null>(null);
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
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>("overview");
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
    if (aimSurfaceMode === "edit") {
      setError({
        title: t("aimDraft.edit.navigationTitle"),
        message: t("aimDraft.edit.navigationMessage"),
        recovery: t("aimDraft.edit.navigationRecovery"),
        details: [],
      });
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

  async function refreshAll(options: { autoOpenFirstGoal?: boolean } = {}) {
    const transitionAtStart = navigationConcurrencyRef.current.workspace;
    const surfaceAtStart = navigationConcurrencyRef.current.surface;
    const configurationRefresh = Promise.all([
      window.aimcub.getProviderConfig().then(setProvider).catch(() => setProvider(null)),
      window.aimcub.getWebResearchConfig().then(setWebResearch).catch(() => setWebResearch(null)),
      window.aimcub.getContextSourceConfig().then(setContextSources).catch(() => setContextSources(null)),
      window.aimcub.listLocalAgents().then(setLocalAgents).catch(() => setLocalAgents([])),
      window.aimcub.listMemories().then(setMemories).catch(() => setMemories([])),
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
      setAimEditBuffer(null);
      setRestoreAimEditFocus(false);
      setActiveDraftId(null);
      setDetail(null);
      setProgress(null);
      setStageOverride("aim");
      setError(null);
      setDraftSaveBlock(null);
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
    const [nextDetail, nextProgress] = await Promise.all([
      window.aimcub.getGoal(goal.id),
      window.aimcub.getAimProgress(goal.id),
    ]);
    if (!isCurrentWorkspaceTransition(transition)) return;
    setDetail(nextDetail);
    setProgress(nextProgress);
    if (options.route !== false && isCurrentSurfaceTransition(surfaceTransition)) {
      setStageOverride(stageForOpenedAim(nextProgress));
    }
  }

  async function refreshGoalAfterSideEffect(
    goal: Goal,
    transition: number,
    surfaceTransition: number,
  ) {
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
    setAimEditBuffer(null);
    setRestoreAimEditFocus(false);
    setAimTitle("");
    setAimDescription("");
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
    setRuntimeGuidanceVisible(false);
    setContextNote("");
    setDraftSaveBlock(null);
    setSelected(null);
    setBusy(null);
    setDetail(null);
    setProgress(null);
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

  async function startDraft(options: { skipIntakeGate?: boolean; aim?: AimEditBuffer } = {}) {
    if (workflowMutationIsLocked()) return;
    const transition = navigationConcurrencyRef.current.workspace;
    const requestedTitle = options.aim?.title ?? aimTitle;
    const requestedDescription = options.aim?.description ?? aimDescription;
    const title = requestedTitle.trim();
    const route = routeAfterAimSubmit({ title, provider, localAgents });
    if (route === "missing_aim") return;
    const nextAimSurface = aimSurfaceAfterSubmit({
      action: route,
      current: aimSurfaceMode === "edit" ? "edit" : "compose",
    });
    if (nextAimSurface === "summary" && !(await checkpointSubmittedAim({
      title: requestedTitle,
      description: requestedDescription,
      resetPlanning: Boolean(options.aim),
    }))) return;
    setAimSurfaceMode(nextAimSurface);
    if (nextAimSurface === "summary") setAimEditBuffer(null);
    if (route === "show_helper_guidance") {
      setError(null);
      setRuntimeGuidanceVisible(true);
      setMode("cockpit");
      setStageOverride("aim");
      return;
    }
    if (options.aim) {
      setAimTitle(options.aim.title);
      setAimDescription(options.aim.description);
      resetPlanningForAimUpdate();
    }
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
      const planningDescription = options.aim
        ? buildDescriptionWithContext({
          baseDescription: requestedDescription,
          intakeClarify: null,
          intakeAnswers: {},
          contextNote: "",
        })
        : descriptionWithContext(requestedDescription);
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

  async function checkpointSubmittedAim(input: {
    title: string;
    description: string;
    resetPlanning: boolean;
  }): Promise<boolean> {
    const transition = navigationConcurrencyRef.current.workspace;
    draftPersistence.pauseAutosave();
    setBusy(t("os.busy.captureAim"));
    try {
      const saved = await persistCurrentDraftNow({
        title: input.title,
        description: input.description,
        aimSurface: "summary",
        resetPlanning: input.resetPlanning,
      }, { navigation: true, throwOnError: true });
      if (!isCurrentWorkspaceTransition(transition)) return false;
      if (saved) return true;
      throw new Error("Submitted Aim checkpoint did not persist.");
    } catch (err) {
      if (!isCurrentWorkspaceTransition(transition)) return false;
      setError({
        title: t("aimDraft.checkpointErrorTitle"),
        message: t("aimDraft.checkpointErrorMessage"),
        recovery: t("aimDraft.checkpointErrorRecovery"),
        details: [err instanceof Error ? err.message : String(err)],
      });
      return false;
    } finally {
      draftPersistence.resumeAutosave();
      if (isCurrentWorkspaceTransition(transition)) setBusy(null);
    }
  }

  async function refreshAimDrafts() {
    setAimDrafts(await window.aimcub.listAimDrafts().catch(() => []));
  }

  function productErrorFromSaveBlock(saveBlock: AimDraftSaveBlock): ProductError {
    return {
      title: saveBlock.title,
      message: saveBlock.message,
      recovery: saveBlock.recovery,
      details: [],
    };
  }

  function applyHydratedDraft(hydrated: HydratedAimDraft) {
    bumpWorkspaceRevision();
    draftPersistence.beginSession(hydrated.id);
    setSelected(null);
    setBusy(null);
    setDetail(null);
    setProgress(null);
    setActiveDraftId(hydrated.id);
    setAimSurfaceMode(hydrated.aimSurface);
    setAimEditBuffer(null);
    setRestoreAimEditFocus(false);
    setAimTitle(hydrated.title);
    setAimDescription(hydrated.description);
    setParent(hydrated.parent);
    setDraft(hydrated.draft);
    setFinalPlan(hydrated.finalPlan);
    setPlanResult(hydrated.finalPlan || hydrated.draft ? {
      ok: true,
      output: hydrated.finalPlan ?? hydrated.draft,
      errors: [],
    } : null);
    setPlanningDebugTraces([]);
    setPlanningLiveEvents([]);
    clearPlanningRun();
    setIntakeClarify(hydrated.intakeClarify);
    setIntakeAnswers(hydrated.intakeAnswers);
    setClarifyPhase(hydrated.phase);
    setClarify(hydrated.phase === "intake"
      ? hydrated.intakeClarify
      : hydrated.phase === "postDraft"
        ? hydrated.clarify ?? { questions: [], assumptions: [] }
        : hydrated.clarify);
    setAnswers(hydrated.clarifyAnswers);
    setContextNote(hydrated.contextNote);
    setDraftSaveBlock(hydrated.saveBlock);
    setError(hydrated.saveBlock ? productErrorFromSaveBlock(hydrated.saveBlock) : null);
    setRuntimeGuidanceVisible(false);
    setMode(hydrated.stage === "contracts"
      ? "reviewing"
      : hydrated.stage === "context"
        ? hydrated.phase === "postDraft" ? "answering" : "contexting"
        : "cockpit");
    setStageOverride(hydrated.stage);
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
    const priorQuestions = intakeClarify?.questions ?? [];
    if (priorQuestions.length === 0 || priorQuestions.length >= MAX_ADAPTIVE_INTAKE_TURNS) {
      setClarifyPhase(null);
      await startDraft({ skipIntakeGate: true });
      return;
    }

    const transition = navigationConcurrencyRef.current.workspace;
    const runId = navigationConcurrencyRef.current.planningRunId ?? startPlanningRun();
    setBusy(t("os.busy.context"));
    setError(null);
    try {
      const intake = await window.aimcub.intake({
        title: aimTitle.trim(),
        description: aimDescription.trim() || undefined,
        clientRunId: runId,
        priorQuestions,
        answers: answersFor(intakeClarify, intakeAnswers),
        maxQuestions: 1,
      });
      if (!isCurrentPlanningRun(runId, transition)) return;
      setPlanResult({ ok: false, output: null, errors: [], intake });
      const next = intakeToClarifyOutput(intake, hasCjkText(`${aimTitle}\n${aimDescription}`));
      const merged = appendIntakeQuestions(intakeClarify, next);
      if (next.questions.length > 0 && merged.questions.length > priorQuestions.length) {
        setIntakeClarify(merged);
        setClarify(merged);
        setClarifyPhase("intake");
        return;
      }

      setClarifyPhase(null);
      setBusy(null);
      await startDraft({ skipIntakeGate: true });
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
    try {
      const refined = await window.aimcub.refine({
        title: aimTitle.trim(),
        description: descriptionWithContext(),
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

  function breakDown(milestone: Milestone) {
    if (workflowMutationIsLocked()) return;
    const plan = detail?.goal.plan_json as DecompositionOutput | null | undefined;
    const node = planNodeForMilestone(plan, milestone);
    beginWorkspaceTransition();
    resetComposer({ openComposer: true });
    setParent({ goalId: milestone.goal_id, milestoneId: milestone.id });
    setAimTitle(milestone.title);
    setAimDescription([
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
    ].filter(Boolean).join("\n"));
    setMode("cockpit");
    setStageOverride("aim");
  }

  const activePlan = (finalPlan ?? draft ?? detail?.goal.plan_json ?? null) as DecompositionOutput | null;
  const activePlanValidation = activePlan ? validateExecutablePlan(activePlan) : null;
  const planningRuntimeReady = hasPlanningRuntime(provider, localAgents);
  const draftAimOverviewState = draftSaveBlock
    ? "saveBlocked"
    : activePlanValidation?.ok === false
      ? "needsRepair"
      : activePlan && clarifyPhase === null
        ? "planReady"
        : !activePlan && clarifyPhase === null && !planningRuntimeReady
          ? "helperSetup"
          : "context";
  const draftAimNextSurface = draftAimOverviewState === "context" ? "context" : "contracts";
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
  const showAimEditor = aimSurfaceMode === "compose" || aimSurfaceMode === "edit";
  const activeStage = stageOverride ?? cockpitStageFor(mode, selected, activePlan);
  const workspaceTarget = deriveWorkspaceTarget({
    selectedGoalId: selected?.id ?? null,
    activeDraftId: aimSurfaceMode === "compose" ? null : activeDraftId,
    showAimComposer: hasTransientAimWork,
  });
  const activeAimTitle = aimSurfaceMode === "edit" && aimEditBuffer
    ? aimEditBuffer.title.trim()
    : selected?.title ?? aimTitle.trim();
  const activeAimDescription = aimSurfaceMode === "edit" && aimEditBuffer
    ? aimEditBuffer.description
    : selected?.description ?? aimDescription;
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
    if (aimSurfaceMode === "edit" && stage === "aim") return true;
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
      setSettingsSection("overview");
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

  function beginAimEdit() {
    if (pendingTargetNavigationRef.current || !openCockpitStage("aim")) return;
    setAimEditBuffer({ title: aimTitle, description: aimDescription });
    setRestoreAimEditFocus(false);
    setAimSurfaceMode("edit");
    setRuntimeGuidanceVisible(false);
    setError(null);
  }

  function resetPlanningForAimUpdate() {
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
  }

  function changeAimTitle(value: string) {
    setAimEditBuffer((current) => current ? { ...current, title: value } : current);
  }

  function changeAimDescription(value: string) {
    setAimEditBuffer((current) => current ? { ...current, description: value } : current);
  }

  function cancelAimEdit() {
    if (!aimEditBuffer) return;
    setAimEditBuffer(null);
    setRestoreAimEditFocus(true);
    setAimSurfaceMode("summary");
    setMode("cockpit");
    setRuntimeGuidanceVisible(false);
    setError(draftSaveBlock ? productErrorFromSaveBlock(draftSaveBlock) : null);
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
    if ((aimSurfaceMode !== "edit" && navigationIsLocked()) || pendingTargetNavigationRef.current) return;
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
    setSettingsSection("context");
    setMode("settings");
    setStageOverride("settings");
  }

  function returnFromSettings() {
    if (planningRuntimeReady) setRuntimeGuidanceVisible(false);
    if (aimSurfaceMode === "edit") {
      beginSurfaceTransition();
      setStageOverride("aim");
      setMode("cockpit");
      return;
    }
    openCockpitStage(settingsReturnStageRef.current);
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
        openCockpitStage("contracts");
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
      onBreakDown={breakDown}
      onReviewEval={() => openCockpitStage("eval")}
      onProofDraftActiveChange={handleProofDraftActiveChange}
    />
  ) : null;

  const evalPanel = selected && detail ? (
    <EvalStage
      goalTitle={detail.goal.title}
      rows={progressRows(detail, progress)}
      progress={progress}
      disabled={Boolean(busy)}
      onAcceptContextCandidate={(candidate, content, scope) => void acceptContextCandidate(candidate, content, scope)}
      onRejectContextCandidate={(candidate) => void rejectContextCandidate(candidate)}
    />
  ) : null;

  const settingsModel = buildSettingsModel({ provider, webResearch, contextSources, localAgents }, t);
  const settingsPanel = (
    <SettingsPanel
      provider={provider}
      webResearch={webResearch}
      contextSources={contextSources}
      localAgents={localAgents}
      model={settingsModel}
      activeSection={settingsSection}
      onSection={setSettingsSection}
      onProvider={setProvider}
      onWeb={setWebResearch}
      onContextSources={setContextSources}
      onRefreshAgents={async () => setLocalAgents(await window.aimcub.listLocalAgents())}
      aimContext={activeAimTitle ? {
        title: activeAimTitle,
        profile: activeAimHelper,
        runtimeReady: planningRuntimeReady,
      } : null}
      onReturnToAim={activeAimTitle ? returnFromSettings : undefined}
    />
  );
  const settingsSidebar = (
    <SettingsPrimarySidebar
      model={settingsModel}
      activeSection={settingsSection}
      onSection={setSettingsSection}
      onBack={returnFromSettings}
    />
  );
  const continueContextToPlan = () => {
    if (activePlan || selected) {
      openCockpitStage("contracts");
      return;
    }
    void startDraft();
  };

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
          onEditAim={selected || busy ? undefined : beginAimEdit}
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
    if (selected && !draft && !parent) {
      return (
        <JourneyView
          key={selected.id}
          goal={selected}
          progress={progress}
          disabled={Boolean(busy)}
          onOpenStage={openCockpitStage}
          onRunAgent={(milestone) => void runAgent(milestone)}
          onNewAim={startNewAim}
        />
      );
    }
    if (showAimEditor) {
      return (
        <AimIntakePanel
          title={aimEditBuffer?.title ?? aimTitle}
          description={aimEditBuffer?.description ?? aimDescription}
          parent={parent}
          mode={mode}
          disabled={Boolean(busy)}
          editing={aimSurfaceMode === "edit"}
          restartsPlanning={Boolean(activePlan || clarifyPhase || draftSaveBlock)}
          onTitle={aimSurfaceMode === "edit" ? changeAimTitle : setAimTitle}
          onDescription={aimSurfaceMode === "edit" ? changeAimDescription : setAimDescription}
          onDraft={() => void startDraft(aimSurfaceMode === "edit" && aimEditBuffer ? { aim: aimEditBuffer } : {})}
          onCancelEdit={cancelAimEdit}
          runtimeGuidance={runtimeGuidanceVisible && !planningRuntimeReady ? activeAimHelper : null}
          onOpenSettings={openSettingsForAim}
          onKeepEditing={() => setRuntimeGuidanceVisible(false)}
        />
      );
    }
    if (hasTransientAimWork) {
      return (
        <DraftAimOverviewPanel
          title={aimTitle}
          description={aimDescription}
          child={Boolean(parent)}
          state={draftAimOverviewState}
          disabled={Boolean(busy)}
          focusEditAction={restoreAimEditFocus}
          onEditFocusRestored={() => setRestoreAimEditFocus(false)}
          onEdit={beginAimEdit}
          onContinue={draftAimOverviewState === "helperSetup"
            ? openSettingsForAim
            : () => openCockpitStage(draftAimNextSurface)}
        />
      );
    }
    return (
      <HomeView
        goals={goals}
        drafts={aimDrafts}
        planningRuntimeReady={planningRuntimeReady}
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
      settingsSidebar={settingsSidebar}
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

function AimIntakePanel(props: {
  title: string;
  description: string;
  parent: { goalId: string; milestoneId: string } | null;
  mode: AppMode;
  disabled: boolean;
  editing: boolean;
  restartsPlanning: boolean;
  runtimeGuidance: AimHelperProfile | null;
  onTitle: (value: string) => void;
  onDescription: (value: string) => void;
  onDraft: () => void;
  onCancelEdit: () => void;
  onOpenSettings: () => void;
  onKeepEditing: () => void;
}) {
  const { t } = useI18n();
  const titleInputRef = useRef<HTMLTextAreaElement | null>(null);
  const contextInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [contextOpen, setContextOpen] = useState(() => props.description.trim().length > 0);
  const hasAim = props.title.trim().length > 0;
  const submitting = props.mode === "contexting" || props.mode === "drafting";
  const disabled = props.disabled || !hasAim;
  const intakeTitle = props.parent ? t("os.breakdownTitle") : t("aimIntake.workbenchTitle");
  const intakeBody = props.parent ? t("aimIntake.subAimBody") : t("aimIntake.workbenchBody");
  const composerPlaceholder = props.parent ? t("aimIntake.composerPlaceholder") : t("aimIntake.workbenchTitle");
  const submitLabel = props.editing
    ? t(props.restartsPlanning ? "aimDraft.edit.regenerate" : "aimDraft.edit.update")
    : t("aimIntake.cta");

  useEffect(() => {
    if (props.description.trim().length > 0) setContextOpen(true);
  }, [props.description]);

  useEffect(() => {
    if (!props.editing) return;
    const timer = window.setTimeout(() => titleInputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [props.editing]);

  function openContextInput() {
    setContextOpen(true);
    window.setTimeout(() => contextInputRef.current?.focus(), 0);
  }

  return (
    <section className={props.parent ? "od-aim-intake od-aim-intake-child" : "od-aim-intake"}>
      {props.editing ? (
        <div className="od-aim-edit-mode" data-od-id="aim-edit-mode">
          <div>
            <div className="od-aim-kicker">{t("aimDraft.edit.kicker")}</div>
            <p>{t(props.restartsPlanning ? "aimDraft.edit.regenerateBody" : "aimDraft.edit.updateBody")}</p>
          </div>
          <button className="od-aim-secondary" type="button" disabled={props.disabled} onClick={props.onCancelEdit}>
            {t("aimDraft.edit.cancel")}
          </button>
        </div>
      ) : props.parent ? (
        <div className="od-aim-intake-head">
          <div>
            <div className="od-aim-kicker">{t("os.subAimMode")}</div>
            <h1>{intakeTitle}</h1>
            <p>{intakeBody}</p>
          </div>
        </div>
      ) : null}

      <div className="od-aim-composer">
        <textarea
          id="aim-title"
          ref={titleInputRef}
          className="od-aim-title-input"
          value={props.title}
          onChange={(event) => props.onTitle(event.target.value)}
          placeholder={composerPlaceholder}
          aria-label={t("aimIntake.titleLabel")}
          rows={2}
        />
        {contextOpen ? (
          <textarea
            id="aim-context"
            ref={contextInputRef}
            className="od-aim-context-input"
            value={props.description}
            onChange={(event) => props.onDescription(event.target.value)}
            placeholder={t("aimIntake.contextPlaceholder")}
            aria-label={t("aimIntake.contextLabel")}
            rows={2}
          />
        ) : null}
        <div className="od-aim-composer-toolbar">
          <button
            className="od-aim-composer-icon-button"
            type="button"
            onClick={openContextInput}
            aria-label={t("aimIntake.addContext")}
            title={t("aimIntake.addContext")}
          >
            <ComposerPlusIcon />
          </button>
          <span aria-hidden={!hasAim}>
            {hasAim ? t(props.editing && props.restartsPlanning ? "aimDraft.edit.regenerateHint" : "aimIntake.readyHint") : null}
          </span>
          <button
            className="od-aim-primary od-aim-send-button"
            type="button"
            onClick={props.onDraft}
            disabled={disabled}
            aria-label={submitting ? t("os.drafting") : submitLabel}
            title={submitting ? t("os.drafting") : submitLabel}
          >
            <ComposerArrowUpIcon />
          </button>
        </div>
      </div>

      {props.runtimeGuidance ? (
        <AimHelperGuidancePanel
          title={props.title}
          profile={props.runtimeGuidance}
          onOpenSettings={props.onOpenSettings}
          onKeepEditing={props.onKeepEditing}
        />
      ) : null}
    </section>
  );
}

function ComposerPlusIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" focusable="false">
      <path d="M10 4.2v11.6M4.2 10h11.6" />
    </svg>
  );
}

function ComposerArrowUpIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" focusable="false">
      <path d="M10 15.8V4.8M5.8 9l4.2-4.2L14.2 9" />
    </svg>
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

export function SettingsPanel(props: {
  provider: ProviderStatus | null;
  webResearch: WebResearchStatus | null;
  contextSources: ContextSourceStatus | null;
  localAgents: LocalAgentDetection[];
  model: SettingsModel;
  activeSection: SettingsSectionId;
  onSection: (section: SettingsSectionId) => void;
  aimContext: {
    title: string;
    profile: AimHelperProfile;
    runtimeReady: boolean;
  } | null;
  onProvider: (status: ProviderStatus) => void;
  onWeb: (status: WebResearchStatus) => void;
  onContextSources: (status: ContextSourceStatus) => void;
  onRefreshAgents: () => Promise<void>;
  onReturnToAim?: () => void;
}) {
  const { activeSection, model } = props;
  const activeHelper = model.navItems.find((item) => item.id === activeSection) ?? model.overviewHelper;

  let detailPane: ReactNode;
  if (activeSection === "overview") {
    detailPane = (
      <SettingsOverviewPane
        helper={model.overviewHelper}
        helpers={model.helpers}
        planningReady={model.planningReady}
        overallNext={model.overallNext}
        aimContext={props.aimContext}
        onReturnToAim={props.onReturnToAim}
        onSection={props.onSection}
      />
    );
  } else if (activeSection === "provider") {
    detailPane = (
      <SettingsDetailPane helper={model.providerHelper}>
        <ProviderForm status={props.provider} onSaved={props.onProvider} />
      </SettingsDetailPane>
    );
  } else if (activeSection === "local") {
    detailPane = (
      <SettingsDetailPane helper={model.localAgentHelper}>
        <LocalAgentForm agents={props.localAgents} onRefresh={props.onRefreshAgents} />
      </SettingsDetailPane>
    );
  } else if (activeSection === "web") {
    detailPane = (
      <SettingsDetailPane helper={model.webResearchHelper}>
        <WebResearchForm
          status={props.webResearch}
          localAgentReady={props.localAgents.some((agent) => agent.available && agent.authStatus !== "missing")}
          onSaved={props.onWeb}
        />
      </SettingsDetailPane>
    );
  } else {
    detailPane = (
      <SettingsDetailPane helper={model.contextHelper}>
        <ContextSourcesPanel status={props.contextSources} compact onSaved={props.onContextSources} />
      </SettingsDetailPane>
    );
  }

  return (
    <Panel variant="plain" style={panelStyle()}>
      <div className="od-settings-detail" aria-live="polite" aria-label={activeHelper.title}>
        {detailPane}
      </div>
    </Panel>
  );
}

function SettingsPrimarySidebar(props: {
  model: SettingsModel;
  activeSection: SettingsSectionId;
  onSection: (section: SettingsSectionId) => void;
  onBack: () => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const visibleItems = props.model.navItems.filter((item) => {
    if (!normalizedQuery) return true;
    return `${item.title} ${item.body}`.toLowerCase().includes(normalizedQuery);
  });

  return (
    <div className="od-settings-sidebar-content">
      <button className="od-settings-back" type="button" onClick={props.onBack}>
        <SettingsBackIcon />
        <span>{t("settings.backToAims")}</span>
      </button>

      <label className="od-settings-search">
        <SettingsSearchIcon />
        <span>{t("settings.searchLabel")}</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("settings.searchPlaceholder")}
        />
      </label>

      <nav className="od-settings-nav" aria-label={t("settings.navigationLabel")}>
        <div className="od-settings-nav-section">{t("settings.group.aim")}</div>
        {visibleItems.length === 0 ? <div className="od-settings-nav-empty">{t("settings.searchEmpty")}</div> : null}
        {visibleItems.map((item) => (
          <button
            key={item.id}
            type="button"
            className="od-settings-nav-item"
            data-active={item.id === props.activeSection ? "true" : "false"}
            data-tone={item.tone || "neutral"}
            aria-current={item.id === props.activeSection ? "page" : undefined}
            onClick={() => props.onSection(item.id)}
          >
            <SettingsNavIcon section={item.id} />
            <span className="od-settings-nav-label">{item.title}</span>
            <span className={`od-settings-nav-dot ${item.tone}`} title={item.status} aria-label={item.status} />
          </button>
        ))}
      </nav>
    </div>
  );
}

function SettingsBackIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" focusable="false">
      <path d="M12.5 5.5 8 10l4.5 4.5" />
      <path d="M8.5 10H16" />
    </svg>
  );
}

function SettingsSearchIcon() {
  return (
    <svg className="od-settings-search-icon" aria-hidden="true" viewBox="0 0 20 20" focusable="false">
      <circle cx="8.5" cy="8.5" r="4.75" />
      <path d="m12.25 12.25 3.25 3.25" />
    </svg>
  );
}

function SettingsNavIcon(props: { section: SettingsSectionId }) {
  const pathBySection: Record<SettingsSectionId, ReactNode> = {
    overview: (
      <>
        <circle cx="7" cy="7" r="2.5" />
        <circle cx="13" cy="7" r="2.5" />
        <path d="M4.5 13.5h11" />
      </>
    ),
    provider: (
      <>
        <path d="M4.5 5.5h11v9h-11z" />
        <path d="M7.5 8.5h5" />
        <path d="M7.5 11.5h3" />
      </>
    ),
    local: (
      <>
        <path d="M4 6.5h12v7H4z" />
        <path d="M7 16h6" />
        <path d="M10 13.5V16" />
      </>
    ),
    web: (
      <>
        <circle cx="10" cy="10" r="5.5" />
        <path d="M4.5 10h11" />
        <path d="M10 4.5c1.5 1.6 2.2 3.4 2.2 5.5s-.7 3.9-2.2 5.5" />
        <path d="M10 4.5C8.5 6.1 7.8 7.9 7.8 10s.7 3.9 2.2 5.5" />
      </>
    ),
    context: (
      <>
        <path d="M5 5.5h10v9H5z" />
        <path d="M7.5 8h5" />
        <path d="M7.5 11h4" />
      </>
    ),
  };

  return (
    <svg className="od-settings-nav-icon" aria-hidden="true" viewBox="0 0 20 20" focusable="false">
      {pathBySection[props.section]}
    </svg>
  );
}

function SettingsOverviewPane(props: {
  helper: SettingsHelper;
  helpers: SettingsHelper[];
  planningReady: boolean;
  overallNext: string;
  aimContext: {
    title: string;
    profile: AimHelperProfile;
    runtimeReady: boolean;
  } | null;
  onReturnToAim?: () => void;
  onSection: (section: SettingsSectionId) => void;
}) {
  const { t } = useI18n();
  const planningStatus = props.planningReady ? t("settings.status.readyToPlan") : t("os.blocked");
  return (
    <section className="od-settings-pane">
      <SettingsPaneHeader title={props.helper.title} body={props.helper.body} />

      {props.aimContext ? (
        <SettingsAimContextPanel
          title={props.aimContext.title}
          profile={props.aimContext.profile}
          runtimeReady={props.aimContext.runtimeReady}
          onReturnToAim={props.onReturnToAim}
        />
      ) : null}

      <SettingsRowSection title={t("settings.section.aim")} body={t("settings.section.aimBody")}>
        <SettingsRow
          title={t("settings.row.planningStatus")}
          body={t("settings.intakeNote")}
          detail={props.overallNext}
          status={planningStatus}
          tone={props.planningReady ? "success" : "warn"}
          actionLabel={props.onReturnToAim ? t("settings.action.openAim") : undefined}
          onAction={props.onReturnToAim}
        />
        {props.helpers.map((helper) => (
          <SettingsRow
            key={helper.id}
            title={helper.title}
            body={helper.body}
            detail={helper.next}
            status={helper.status}
            tone={helper.tone}
            actionLabel={settingsActionLabel(helper.id, t)}
            onAction={() => props.onSection(helper.id)}
          />
        ))}
      </SettingsRowSection>
    </section>
  );
}

function SettingsDetailPane(props: { helper: SettingsHelper; children: ReactNode }) {
  return (
    <section className="od-settings-pane">
      <SettingsPaneHeader title={props.helper.title} body={props.helper.body} />
      <div className="od-settings-pane-body">
        {props.children}
      </div>
    </section>
  );
}

function SettingsPaneHeader(props: { title: string; body: string }) {
  return (
    <header className="od-settings-pane-head">
      <div>
        <h3>{props.title}</h3>
        <p>{props.body}</p>
      </div>
    </header>
  );
}

function SettingsRowSection(props: { title: string; body?: string; children: ReactNode }) {
  return (
    <section className="od-settings-row-section">
      <div className="od-settings-row-section-head">
        <h4>{props.title}</h4>
        {props.body ? <p>{props.body}</p> : null}
      </div>
      <div className="od-settings-row-list">
        {props.children}
      </div>
    </section>
  );
}

function SettingsRow(props: {
  title: string;
  body: string;
  detail?: string;
  status?: string;
  tone?: SettingsHelperTone;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="od-settings-row">
      <div className="od-settings-row-copy">
        <strong>{props.title}</strong>
        <span>{props.body}</span>
        {props.detail ? <small>{props.detail}</small> : null}
      </div>
      <div className="od-settings-row-control">
        {props.status ? <span className={`od-settings-status-pill ${props.tone || ""}`}>{props.status}</span> : null}
        {props.actionLabel && props.onAction ? (
          <button className="od-settings-row-button" type="button" onClick={props.onAction}>
            {props.actionLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function settingsActionLabel(section: SettingsSectionId, t: I18n["t"]): string {
  if (section === "local") return t("settings.action.manage");
  return t("settings.action.configure");
}

function SettingsAimContextPanel(props: {
  title: string;
  profile: AimHelperProfile;
  runtimeReady: boolean;
  onReturnToAim?: () => void;
}) {
  const { t } = useI18n();
  return (
    <section className="od-settings-current-aim" data-state={props.runtimeReady ? "ready" : "blocked"}>
      <div className="od-settings-current-aim-copy">
        <span>{t("firstRun.settingsEyebrow")}</span>
        <strong>{shortText(props.title, 140)}</strong>
        <small>{helperReason(props.profile, t)}</small>
      </div>
      <div className="od-settings-current-aim-control">
        <span className="od-settings-status-pill">{helperPreferenceLabel(props.profile, t)}</span>
        <span className={`od-settings-status-pill ${props.runtimeReady ? "success" : "warn"}`}>
          {props.runtimeReady ? t("settings.status.readyToPlan") : t("os.blocked")}
        </span>
        {props.onReturnToAim ? (
          <button className="od-settings-row-button" type="button" onClick={props.onReturnToAim}>
            {t("firstRun.returnToAim")}
          </button>
        ) : null}
      </div>
    </section>
  );
}

function panelStyle(): CSSProperties {
  return {
    background: C.surface,
    border: "none",
    borderRadius: 0,
    padding: 0,
  };
}
