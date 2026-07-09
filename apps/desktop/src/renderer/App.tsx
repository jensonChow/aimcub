import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

import {
  validateExecutablePlan,
  validatePlanRouting,
  type AimProgressReadModel,
} from "@core/domain";
import type { ClarifyAnswer, ClarifyOutput } from "@core/llm";
import type {
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

import { CockpitShell, type CockpitStage, type SidebarAction } from "./CockpitShell";
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
import { EvalStage } from "./stages/eval/EvalStage";
import { ExecutePanel } from "./stages/execute/ExecutePanel";
import { WebResearchForm } from "./WebResearchForm";
import { PlanPanel } from "./stages/plan/PlanPanel";
import { Button, Panel } from "./ui";
import { C, TYPE, WEIGHT, inputStyle, primaryButton } from "./styles";
import {
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
  pct,
  planNodeForMilestone,
  progressRows,
  type AppMode,
} from "./workflow/stageRouting";
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
import { shortText } from "./workflow/text";

export { buildSettingsModel };

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
  const [selected, setSelected] = useState<Goal | null>(null);
  const [detail, setDetail] = useState<GoalDetail | null>(null);
  const [progress, setProgress] = useState<AimProgressReadModel | null>(null);
  const [provider, setProvider] = useState<ProviderStatus | null>(null);
  const [webResearch, setWebResearch] = useState<WebResearchStatus | null>(null);
  const [contextSources, setContextSources] = useState<ContextSourceStatus | null>(null);
  const [localAgents, setLocalAgents] = useState<LocalAgentDetection[]>([]);
  const [aimComposerOpen, setAimComposerOpen] = useState(false);
  const [aimTitle, setAimTitle] = useState("");
  const [aimDescription, setAimDescription] = useState("");
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
  const [error, setError] = useState<string | ProductError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [stageOverride, setStageOverride] = useState<CockpitStage | null>(null);
  const [runtimeGuidanceVisible, setRuntimeGuidanceVisible] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>("overview");
  const planningRunIdRef = useRef<string | null>(null);

  useEffect(() => {
    void refreshAll();
  }, []);

  useEffect(() => {
    return window.aimcub.onPlanningLiveEvent((event) => {
      const activeRunId = planningRunIdRef.current;
      if (!activeRunId || event.runId !== activeRunId) return;
      setPlanningLiveEvents((current) => [...current, event].slice(-80));
    });
  }, []);

  function startPlanningRun(): string {
    const runId = createPlanningRunId();
    planningRunIdRef.current = runId;
    setPlanningLiveEvents([]);
    return runId;
  }

  function clearPlanningRun() {
    planningRunIdRef.current = null;
  }

  async function refreshAll() {
    const [nextGoals, nextProvider, nextWeb, nextSources, nextAgents] = await Promise.all([
      window.aimcub.listGoals().catch(() => []),
      window.aimcub.getProviderConfig().catch(() => null),
      window.aimcub.getWebResearchConfig().catch(() => null),
      window.aimcub.getContextSourceConfig().catch(() => null),
      window.aimcub.listLocalAgents().catch(() => []),
    ]);
    setGoals(nextGoals);
    setProvider(nextProvider);
    setWebResearch(nextWeb);
    setContextSources(nextSources);
    setLocalAgents(nextAgents);
    const route = routeAfterRefresh({ hasSelectedAim: Boolean(selected), hasGoals: nextGoals.length > 0 });
    if (route.autoOpenFirstGoal && nextGoals[0]) void openGoal(nextGoals[0]);
    if (route.stageOverride) {
      setMode("cockpit");
      setStageOverride(route.stageOverride);
    }
  }

  async function openGoal(goal: Goal) {
    setSelected(goal);
    setMode("cockpit");
    setAimComposerOpen(false);
    setError(null);
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
    await refreshGoalState(goal);
  }

  async function refreshGoalState(goal: Goal | null = selected) {
    if (!goal) return;
    const [nextDetail, nextProgress] = await Promise.all([
      window.aimcub.getGoal(goal.id),
      window.aimcub.getAimProgress(goal.id),
    ]);
    setDetail(nextDetail);
    setProgress(nextProgress);
    setStageOverride(stageForOpenedAim(nextProgress));
  }

  function resetComposer(options: { openComposer?: boolean } = {}) {
    setStageOverride("aim");
    setAimComposerOpen(Boolean(options.openComposer));
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
    setSelected(null);
    setDetail(null);
    setProgress(null);
    setError(null);
  }

  function descriptionWithContext(): string | undefined {
    return buildDescriptionWithContext({
      baseDescription: aimDescription,
      intakeClarify,
      intakeAnswers,
      contextNote,
    });
  }

  async function startDraft(options: { skipIntakeGate?: boolean } = {}) {
    const title = aimTitle.trim();
    const route = routeAfterAimSubmit({ title, provider, localAgents });
    if (route === "missing_aim") return;
    if (route === "show_helper_guidance") {
      setError(null);
      setRuntimeGuidanceVisible(true);
      setMode("cockpit");
      setStageOverride("aim");
      return;
    }
    setRuntimeGuidanceVisible(false);
    setError(null);
    setPlanningDebugTraces([]);
    const runId = startPlanningRun();
    try {
      if (!options.skipIntakeGate) {
        setBusy(t("os.busy.context"));
        setMode("contexting");
        setStageOverride("context");
        const intake = await window.aimcub.intake({ title, description: aimDescription.trim() || undefined, clientRunId: runId });
        setPlanResult({ ok: false, output: null, errors: [], intake });
        if (shouldBlockForIntake(intake) && intake.questions.length > 0) {
          const intakeOutput = intakeToClarifyOutput(intake, hasCjkText(`${title}\n${aimDescription}`));
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
      const req = { title, description: descriptionWithContext(), clientRunId: runId };
      const nextDraft = await window.aimcub.draft(req);
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
      setBusy(null);
    }
  }

  const builtAnswers = useMemo<ClarifyAnswer[]>(() => {
    return answersFor(clarifyPhase === "postDraft" ? clarify : null, answers);
  }, [answers, clarify, clarifyPhase]);

  const builtIntakeAnswers = useMemo<ClarifyAnswer[]>(() => {
    return answersFor(intakeClarify, intakeAnswers);
  }, [intakeAnswers, intakeClarify]);

  async function continueFromContext() {
    await startDraft({ skipIntakeGate: true });
  }

  async function refinePlan() {
    if (!draft) return;
    setBusy(t("os.busy.refine"));
    setError(null);
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
      setMode("reviewing");
      setStageOverride("contracts");
    } catch (err) {
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
      setBusy(null);
    }
  }

  async function savePlan() {
    const plan = finalPlan ?? draft;
    if (!plan) return;
    const validation = validateExecutablePlan(plan);
    if (!validation.ok) {
      setError(formatPlanningFailure({ stage: "save", errors: validation.errors, t, fallback: t("plan.validationFailed") }));
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
      setError(formatRoutingValidation(routingValidation));
      setStageOverride("contracts");
      setMode("reviewing");
      return;
    }
    setBusy(t("os.busy.save"));
    setError(null);
    try {
      const saved = await window.aimcub.saveGoal({
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
          ...(clarifyPhase === "postDraft" ? clarify?.questions ?? [] : []),
        ],
        answers: [...builtIntakeAnswers, ...builtAnswers],
        assumptions: clarify?.assumptions ?? [],
      });
      resetComposer();
      await refreshAll();
      await openGoal(saved.goal);
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

  async function runAgent(milestone: Milestone) {
    if (!selected) return;
    setBusy(t("os.busy.agent"));
    setError(null);
    try {
      const result = await window.aimcub.runMilestoneAgent({ goalId: selected.id, milestoneId: milestone.id });
      if (!result.ok && result.error) setError(result.error);
      await refreshGoalState(selected);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function confirmMilestone(milestone: Milestone, submission: Omit<ConfirmMilestoneRequest, "goalId" | "milestoneId">) {
    if (!selected) return;
    setBusy(t("os.busy.confirm"));
    setError(null);
    try {
      const nextDetail = await window.aimcub.confirmMilestone({
        goalId: selected.id,
        milestoneId: milestone.id,
        ...submission,
      });
      const nextProgress = await window.aimcub.getAimProgress(selected.id);
      setDetail(nextDetail);
      setProgress(nextProgress);
      if (hasCompletionRecap(nextProgress)) {
        setMode("reviewing");
        setStageOverride("eval");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function acceptContextCandidate(candidate: Memory, content: string, scope: ContextInboxScope) {
    setBusy(t("os.busy.contextReview"));
    setError(null);
    try {
      await window.aimcub.acceptContextCandidate(buildContextCandidateAcceptRequest(candidate, content, scope));
      await refreshGoalState();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function rejectContextCandidate(candidate: Memory) {
    setBusy(t("os.busy.contextReview"));
    setError(null);
    try {
      await window.aimcub.rejectContextCandidate(candidate.id);
      await refreshGoalState();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  function breakDown(milestone: Milestone) {
    const plan = detail?.goal.plan_json as DecompositionOutput | null | undefined;
    const node = planNodeForMilestone(plan, milestone);
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
  const activePlanValidationMessages = activePlanValidation?.ok === false
    ? formatPlanValidationIssues(activePlanValidation.errors, t)
    : [];
  const routingAgents = useMemo(() => routingAgentsFromDetections(localAgents), [localAgents]);
  const planRoutingValidation = useMemo(
    () => activePlan ? validatePlanRouting({ plan: activePlan, agents: routingAgents, allowHuman: true }) : null,
    [activePlan, routingAgents],
  );
  const completed = progress?.completed_milestones ?? detail?.milestones.filter((m) => m.status === "completed").length ?? 0;
  const total = progress?.total_milestones ?? detail?.milestones.length ?? 0;
  const aimComplete = hasCompletionRecap(progress) || (total > 0 && completed === total);
  const hasUnsavedAim = aimTitle.trim().length > 0;
  const showAimComposer = aimComposerOpen || hasUnsavedAim || Boolean(parent) || Boolean(draft);
  const activeStage = stageOverride ?? cockpitStageFor(mode, selected, activePlan);
  const activeSidebarAction: SidebarAction = selected ? null : showAimComposer ? "newAim" : activeStage === "aim" ? "home" : null;
  const planningRuntimeReady = hasPlanningRuntime(provider, localAgents);
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
    setFinalPlan(nextPlan);
    setPlanResult((current) => (current ? { ...current, output: nextPlan } : current));
  }

  function openCockpitStage(stage: CockpitStage) {
    setStageOverride(stage);
    if (stage === "settings") {
      setSettingsSection("overview");
      setMode("settings");
      return;
    }
    if (stage === "context") {
      setMode("contexting");
      return;
    }
    if (stage === "contracts") {
      setMode(activePlan ? "reviewing" : "contexting");
      return;
    }
    if (stage === "run" || stage === "eval") {
      setMode(selected || activePlan ? "reviewing" : "cockpit");
      return;
    }
    setMode("cockpit");
  }

  function startNewAim() {
    resetComposer({ openComposer: true });
    setMode("cockpit");
    setStageOverride("aim");
  }

  function openHomePanel() {
    resetComposer();
    setMode("cockpit");
    setStageOverride("aim");
  }

  function openSettingsForAim() {
    setSettingsSection(settingsSectionForFocus(activeAimHelper.settingsFocus));
    setMode("settings");
    setStageOverride("settings");
  }

  function openContextSettings() {
    setSettingsSection("context");
    setMode("settings");
    setStageOverride("settings");
  }

  function returnToAim() {
    if (planningRuntimeReady) setRuntimeGuidanceVisible(false);
    setMode("cockpit");
    setStageOverride("aim");
  }

  const composerPanel = (
    <ComposerPanel
      title={aimTitle}
      description={aimDescription}
      parent={parent}
      mode={mode}
      disabled={Boolean(busy)}
      onTitle={setAimTitle}
      onDescription={setAimDescription}
      onDraft={() => void startDraft()}
    />
  );

  const clarifyPanel = clarify && (mode === "contexting" || mode === "answering" || mode === "reviewing") ? (
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
      onSkip={clarifyPhase === "intake" ? undefined : () => setMode("reviewing")}
    />
  ) : null;

  const planPanel = activePlan ? (
    <PlanPanel
      plan={activePlan}
      quality={planResult?.quality ?? null}
      review={planResult?.review ?? null}
      saved={Boolean(selected)}
      disabled={Boolean(busy) || activePlanValidation?.ok === false}
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
      onReturnToAim={activeAimTitle ? returnToAim : undefined}
    />
  );
  const settingsSidebar = (
    <SettingsPrimarySidebar
      model={settingsModel}
      activeSection={settingsSection}
      onSection={setSettingsSection}
      onBack={() => openCockpitStage("aim")}
    />
  );
  const continueContextToPlan = parent ? undefined : () => {
    if (activePlan || selected) {
      openCockpitStage("contracts");
      return;
    }
    void startDraft();
  };

  const mainStageContent = (() => {
    if (activeStage === "settings") return settingsPanel;
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
          parentComposer={parent ? composerPanel : null}
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
          onEditAim={selected ? undefined : () => openCockpitStage("aim")}
          onOpenSettings={openContextSettings}
          onContextSources={setContextSources}
          onContinueToPlan={continueContextToPlan}
        />
      );
    }
    if (activeStage === "contracts") {
      return planPanel ? (
        <>
          <ContextReviewPanel bundle={contextReview} running={mode === "drafting" && Boolean(busy)} />
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
      return executePanel ?? planPanel ?? (
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
      return evalPanel ?? planPanel ?? (
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
        <AimOverviewPanel
          goal={selected}
          progress={progress}
          completed={completed}
          total={total}
          complete={aimComplete}
          onContext={() => openCockpitStage("context")}
          onRecap={() => openCockpitStage("eval")}
          onNewAim={startNewAim}
        />
      );
    }
    return showAimComposer ? (
      <AimIntakePanel
        title={aimTitle}
        description={aimDescription}
        parent={parent}
        mode={mode}
        disabled={Boolean(busy)}
        onTitle={setAimTitle}
        onDescription={setAimDescription}
        onDraft={() => void startDraft()}
        runtimeGuidance={runtimeGuidanceVisible && !planningRuntimeReady ? activeAimHelper : null}
        onOpenSettings={openSettingsForAim}
        onKeepEditing={() => setRuntimeGuidanceVisible(false)}
      />
    ) : (
      <InitialWorkspacePanel />
    );
  })();

  return (
    <CockpitShell
      goals={goals}
      selected={selected}
      activeStage={activeStage}
      activeSidebarAction={activeSidebarAction}
      onHome={openHomePanel}
      onNewAim={startNewAim}
      onOpenGoal={(goal) => void openGoal(goal)}
      onStage={openCockpitStage}
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

export function InitialWorkspacePanel() {
  const { t } = useI18n();
  return (
    <section className="od-initial-workspace" aria-label={t("initialWorkspace.label")}>
      <div className="od-initial-workspace-copy">
        <h1>{t("initialWorkspace.title")}</h1>
        <p>{t("initialWorkspace.body")}</p>
      </div>
    </section>
  );
}

function AimOverviewPanel(props: {
  goal: Goal;
  progress: AimProgressReadModel | null;
  completed: number;
  total: number;
  complete: boolean;
  onContext: () => void;
  onRecap: () => void;
  onNewAim: () => void;
}) {
  const { t } = useI18n();
  const completion = pct(props.completed, props.total);
  const nextAction = props.complete ? t("completion.nextAction") : props.progress?.next_action || t("shell.noNextAction");
  const summary = props.goal.description?.trim() || nextAction;
  return (
    <section className="od-aim-overview">
      <div className="od-aim-intake-head">
        <div>
          <div className="od-aim-kicker">{t("shell.currentAim")}</div>
          <h1>{props.goal.title}</h1>
          <p>{shortText(summary, 260)}</p>
        </div>
        <ProgressDonut done={props.completed} total={props.total} />
      </div>

      <div className="od-aim-overview-strip">
        <div>
          <span>{t("shell.progress")}</span>
          <strong>{completion}%</strong>
          <small>{t("shell.progressValue", { done: props.completed, total: props.total })}</small>
        </div>
        <div>
          <span>{t("shell.nextAction")}</span>
          <strong>{shortText(nextAction, 120)}</strong>
          <small>{props.complete ? t("completion.reuseShort") : t("aimIntake.contextGate")}</small>
        </div>
      </div>

      <div className="od-aim-intake-footer">
        <p>{props.complete ? t("completion.overviewHint") : t("aimIntake.currentHint")}</p>
        <div className="od-aim-intake-actions">
          <button className="od-aim-secondary" type="button" onClick={props.onNewAim}>
            {t("os.newAim")}
          </button>
          <button className="od-aim-primary" type="button" onClick={props.complete ? props.onRecap : props.onContext}>
            {props.complete ? t("completion.reviewRecap") : t("aimIntake.cta")}
          </button>
        </div>
      </div>
    </section>
  );
}

function AimIntakePanel(props: {
  title: string;
  description: string;
  parent: { goalId: string; milestoneId: string } | null;
  mode: AppMode;
  disabled: boolean;
  runtimeGuidance: AimHelperProfile | null;
  onTitle: (value: string) => void;
  onDescription: (value: string) => void;
  onDraft: () => void;
  onOpenSettings: () => void;
  onKeepEditing: () => void;
}) {
  const { t } = useI18n();
  const contextInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [contextOpen, setContextOpen] = useState(() => props.description.trim().length > 0);
  const hasAim = props.title.trim().length > 0;
  const submitting = props.mode === "contexting" || props.mode === "drafting";
  const disabled = props.disabled || !hasAim;
  const intakeTitle = props.parent ? t("os.breakdownTitle") : t("aimIntake.workbenchTitle");
  const intakeBody = props.parent ? t("aimIntake.subAimBody") : t("aimIntake.workbenchBody");
  const composerPlaceholder = props.parent ? t("aimIntake.composerPlaceholder") : t("aimIntake.workbenchTitle");

  useEffect(() => {
    if (props.description.trim().length > 0) setContextOpen(true);
  }, [props.description]);

  function openContextInput() {
    setContextOpen(true);
    window.setTimeout(() => contextInputRef.current?.focus(), 0);
  }

  return (
    <section className={props.parent ? "od-aim-intake od-aim-intake-child" : "od-aim-intake"}>
      {props.parent ? (
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
          <span aria-hidden={!hasAim}>{hasAim ? t("aimIntake.readyHint") : null}</span>
          <button
            className="od-aim-primary od-aim-send-button"
            type="button"
            onClick={props.onDraft}
            disabled={disabled}
            aria-label={submitting ? t("os.drafting") : t("aimIntake.cta")}
            title={submitting ? t("os.drafting") : t("aimIntake.cta")}
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

function ComposerPanel(props: {
  title: string;
  description: string;
  parent: { goalId: string; milestoneId: string } | null;
  mode: AppMode;
  disabled: boolean;
  onTitle: (value: string) => void;
  onDescription: (value: string) => void;
  onDraft: () => void;
}) {
  const { t } = useI18n();
  return (
    <section style={panelStyle()}>
      <div style={sectionHeaderStyle()}>
        <div>
          <div style={eyebrowStyle()}>{props.parent ? t("os.subAimMode") : t("os.stepAim")}</div>
          <h2 style={sectionTitleStyle()}>{props.parent ? t("os.subAimHeading") : t("os.composeHeading")}</h2>
        </div>
        <button
          onClick={props.onDraft}
          disabled={props.disabled || !props.title.trim()}
          style={{ ...primaryButton(props.disabled || !props.title.trim()), marginTop: 0 }}
        >
          {props.mode === "contexting" ? t("os.stepContext") : props.mode === "drafting" ? t("os.drafting") : t("os.startPlanning")}
        </button>
      </div>
      <input
        value={props.title}
        onChange={(event) => props.onTitle(event.target.value)}
        placeholder={t("os.aimPlaceholder")}
        style={inputStyle()}
      />
      <textarea
        value={props.description}
        onChange={(event) => props.onDescription(event.target.value)}
        placeholder={t("os.contextPlaceholder")}
        rows={4}
        style={{ ...inputStyle(), marginTop: 10, resize: "vertical" }}
      />
    </section>
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
        <WebResearchForm status={props.webResearch} onSaved={props.onWeb} />
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

function ProgressDonut({ done, total }: { done: number; total: number }) {
  const value = pct(done, total);
  return (
    <div style={donutWrapStyle()}>
      <div style={donutStyle(value)}>
        <div style={donutInnerStyle()}>
          <strong>{value}%</strong>
          <span>{done}/{total}</span>
        </div>
      </div>
    </div>
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

function sectionHeaderStyle(): CSSProperties {
  return {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 16,
    marginBottom: 14,
  };
}

function sectionTitleStyle(): CSSProperties {
  return { margin: "4px 0 0", fontSize: TYPE.title, letterSpacing: 0 };
}

function eyebrowStyle(): CSSProperties {
  return {
    color: C.accent,
    fontSize: TYPE.meta,
    fontWeight: WEIGHT.strong,
    textTransform: "uppercase",
    letterSpacing: 0,
  };
}

function donutWrapStyle(): CSSProperties {
  return { display: "grid", placeItems: "center", flex: "0 0 auto" };
}

function donutStyle(value: number): CSSProperties {
  return {
    width: 96,
    height: 96,
    borderRadius: "50%",
    background: `conic-gradient(${C.accent} ${value * 3.6}deg, ${C.border} 0deg)`,
    display: "grid",
    placeItems: "center",
  };
}

function donutInnerStyle(): CSSProperties {
  return {
    width: 70,
    height: 70,
    borderRadius: "50%",
    background: C.surface,
    display: "grid",
    placeItems: "center",
    alignContent: "center",
    fontSize: TYPE.meta,
    color: C.muted,
  };
}
