import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import type { DecompositionOutput, Goal, Memory } from "@core/types";
import { reviewAimLearning, reviewContextLineage } from "@core/domain";
import type { AimIntakeReport, AimLearningReport, ContextCaptureFulfillmentReport, ContextHealthRow, ContextLineageLearningReport, ContextLineageReport, ContextProfileReport, DecompositionLearningReport, DecompositionStrategyReport, PlanQualityDimensionReport } from "@core/domain";
import type { ClarifyOutput, ClarifyAnswer, ClarifyAnswerImpactReport, ClarifyLearningReport, PlanningContextSelectionReport } from "@core/llm";
import type { PlanResult, PlanningToolIpcTrace, ProviderStatus } from "../shared/ipc";

import { ContextInbox } from "./ContextInbox";
import {
  ContextHealthPanel,
  ContextLearningPanel,
  ContextLineageLearningPanel,
  ContextProfilePanel,
  DecompositionLearningPanel,
} from "./HomeView";
import { I18nProvider, useI18n, type StringKey } from "./i18n";
import { LangToggle } from "./LangToggle";
import { Notice } from "./Notice";
import { ProviderForm } from "./ProviderForm";
import {
  actionLabel,
  aimIntakeOf,
  aimLearningRowOrder,
  aimLearningSourceLabel,
  aimLearningStatusColor,
  aimLearningStatusMark,
  captureContractLabel,
  capturePurposeLabel,
  clarifyImpactOf,
  clarifyWhyLabel,
  contextCaptureFulfillmentOf,
  contextCategoryLabel,
  decompositionOwnerLabel,
  decompositionStrategyFocusLabel,
  decompositionStrategyPriorityLabel,
  dimensionLabel,
  fulfillmentStatusColor,
  fulfillmentStatusLabel,
  fulfillmentStatusMark,
  impactSignalLabel,
  intakeQuestionSourceLabel,
  intakeReadinessLabel,
  pendingContextForGoal,
  planOf,
  planningContextOf,
  planningToolsOf,
  providerLabel,
  qualityTone,
  reviewOf,
  shortUiText,
} from "./labels";
import {
  C,
  card,
  primaryButton,
  secondaryButton,
} from "./styles";

type Step = "home" | "aim" | "drafting" | "clarifying" | "questions" | "refining" | "plan";
type InspectorTab = "process" | "context" | "quality" | "activity";
type IconName = "chat" | "panelClose" | "panelOpen" | "plus" | "send";

type AnswerMap = Record<string, { label: string | null; other: string }>;
type PlanningTraceStatus = "pending" | "running" | "done" | "warning" | "error";
type BusyStep = Extract<Step, "drafting" | "clarifying" | "refining">;
type ElectronDragStyle = CSSProperties & { WebkitAppRegion?: "drag" | "no-drag" };
type PlanningTraceEvent = {
  id: string;
  status: PlanningTraceStatus;
  title: string;
  detail: string;
  at: string;
};

type SpinnerVerb = {
  verbKey: StringKey;
  detailKey: StringKey;
};

const SPINNER_VERBS = {
  drafting: [
    { verbKey: "spinner.drafting.reading", detailKey: "spinner.drafting.readingDetail" },
    { verbKey: "spinner.drafting.selecting", detailKey: "spinner.drafting.selectingDetail" },
    { verbKey: "spinner.drafting.shaping", detailKey: "spinner.drafting.shapingDetail" },
    { verbKey: "spinner.drafting.checking", detailKey: "spinner.drafting.checkingDetail" },
  ],
  clarifying: [
    { verbKey: "spinner.clarifying.reviewing", detailKey: "spinner.clarifying.reviewingDetail" },
    { verbKey: "spinner.clarifying.finding", detailKey: "spinner.clarifying.findingDetail" },
    { verbKey: "spinner.clarifying.compressing", detailKey: "spinner.clarifying.compressingDetail" },
    { verbKey: "spinner.clarifying.preparing", detailKey: "spinner.clarifying.preparingDetail" },
  ],
  refining: [
    { verbKey: "spinner.refining.applying", detailKey: "spinner.refining.applyingDetail" },
    { verbKey: "spinner.refining.rebalancing", detailKey: "spinner.refining.rebalancingDetail" },
    { verbKey: "spinner.refining.tightening", detailKey: "spinner.refining.tighteningDetail" },
    { verbKey: "spinner.refining.reviewing", detailKey: "spinner.refining.reviewingDetail" },
  ],
} satisfies Record<BusyStep, readonly SpinnerVerb[]>;

const DRAFT_UI_TIMEOUT_MS = 150_000;
const CLARIFY_UI_TIMEOUT_MS = 75_000;

function withUiTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function traceTime(): string {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function isBusyStep(step: Step | null): step is BusyStep {
  return step === "drafting" || step === "clarifying" || step === "refining";
}

function useSpinnerVerb(step: Step | null): { tick: number; item: SpinnerVerb } | null {
  const [tick, setTick] = useState(0);
  const busyStep = isBusyStep(step) ? step : null;
  useEffect(() => {
    setTick(0);
    if (!busyStep) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 1300);
    return () => window.clearInterval(timer);
  }, [busyStep]);
  if (!busyStep) return null;
  const verbs = SPINNER_VERBS[busyStep];
  return { tick, item: verbs[tick % verbs.length]! };
}

function useViewportWidth(): number {
  const [width, setWidth] = useState(() => (typeof window === "undefined" ? 1440 : window.innerWidth));
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}

export function App() {
  return (
    <I18nProvider>
      <AppInner />
    </I18nProvider>
  );
}

function AppInner() {
  const { t } = useI18n();
  const [step, setStep] = useState<Step>("home");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [draft, setDraft] = useState<DecompositionOutput | null>(null);
  const [clarifyOut, setClarifyOut] = useState<ClarifyOutput | null>(null);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [finalPlan, setFinalPlan] = useState<DecompositionOutput | null>(null);
  const [planQuality, setPlanQuality] = useState<PlanResult["quality"]>(null);
  const [planReview, setPlanReview] = useState<PlanResult["review"]>(null);
  const [planQualityRetry, setPlanQualityRetry] = useState<PlanResult["qualityRetry"] | null>(null);
  const [planningContext, setPlanningContext] = useState<PlanningContextSelectionReport | null>(null);
  const [planningTools, setPlanningTools] = useState<PlanningToolIpcTrace | null>(null);
  const [planningTrace, setPlanningTrace] = useState<PlanningTraceEvent[]>([]);
  const [aimIntake, setAimIntake] = useState<AimIntakeReport | null>(null);
  const [decompositionStrategy, setDecompositionStrategy] = useState<DecompositionStrategyReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [savedGoal, setSavedGoal] = useState<Goal | null>(null);
  const [savedContextCandidateCount, setSavedContextCandidateCount] = useState(0);
  const [savedContextCandidates, setSavedContextCandidates] = useState<Memory[]>([]);
  const [provider, setProvider] = useState<ProviderStatus | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [contextCandidates, setContextCandidates] = useState<Memory[]>([]);
  const [contextHistory, setContextHistory] = useState<Memory[]>([]);
  const [contextProfile, setContextProfile] = useState<ContextProfileReport | null>(null);
  const [contextHealth, setContextHealth] = useState<ContextHealthRow[]>([]);
  const [contextLearning, setContextLearning] = useState<ClarifyLearningReport | null>(null);
  const [contextLineageLearning, setContextLineageLearning] = useState<ContextLineageLearningReport | null>(null);
  const [contextDecompositionLearning, setContextDecompositionLearning] = useState<DecompositionLearningReport | null>(null);
  const [viewing, setViewing] = useState<Goal | null>(null);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("process");
  const [composerText, setComposerText] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const viewportWidth = useViewportWidth();

  useEffect(() => {
    window.aimcub
      .getProviderConfig()
      .then((s) => {
        setProvider(s);
        if (!s.configured) setShowSettings(true);
      })
      .catch(() => {});
    refreshGoals();
    refreshContextCandidates();
    refreshContextHistory();
    refreshContextProfile();
    refreshContextHealth();
    refreshContextLearning();
    refreshContextLineageLearning();
    refreshContextDecompositionLearning();
  }, []);

  useEffect(() => {
    if (step !== "aim" || !title.trim()) {
      if (step === "aim") {
        setAimIntake(null);
        setDecompositionStrategy(null);
      }
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const req = { title: title.trim(), description: description.trim() || undefined };
      window.aimcub
        .intake(req)
        .then((report) => {
          if (!cancelled) setAimIntake(report);
        })
        .catch(() => {});
      window.aimcub
        .listContextDecompositionStrategy(req)
        .then((report) => {
          if (!cancelled) setDecompositionStrategy(report);
        })
        .catch(() => {});
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [description, step, title]);

  function refreshGoals() {
    window.aimcub.listGoals().then(setGoals).catch(() => {});
  }

  function refreshContextCandidates() {
    window.aimcub.listContextCandidates().then(setContextCandidates).catch(() => {});
  }

  function refreshContextHistory() {
    window.aimcub.listContextHistory().then(setContextHistory).catch(() => {});
  }

  function refreshContextProfile() {
    window.aimcub.listContextProfile().then(setContextProfile).catch(() => {});
  }

  function refreshContextHealth() {
    window.aimcub.listContextHealth().then(setContextHealth).catch(() => {});
  }

  function refreshContextLearning() {
    window.aimcub.listContextLearning().then(setContextLearning).catch(() => {});
  }

  function refreshContextLineageLearning() {
    window.aimcub.listContextLineageLearning().then(setContextLineageLearning).catch(() => {});
  }

  function refreshContextDecompositionLearning() {
    window.aimcub.listContextDecompositionLearning().then(setContextDecompositionLearning).catch(() => {});
  }

  const configured = provider?.configured ?? false;

  const builtAnswers = useMemo<ClarifyAnswer[]>(() => {
    if (!clarifyOut) return [];
    return clarifyOut.questions
      .map((q) => {
        const a = answers[q.id];
        const other = a?.other.trim() ? a.other.trim() : null;
        return { question_id: q.id, selected_label: a?.label ?? null, other_text: other };
      })
      .filter((a) => a.selected_label || a.other_text);
  }, [clarifyOut, answers]);

  function traceEvent(
    id: string,
    status: PlanningTraceStatus,
    titleText: string,
    detail: string,
  ): PlanningTraceEvent {
    return { id, status, title: titleText, detail, at: traceTime() };
  }

  function updatePlanningTrace(
    id: string,
    patch: Partial<Omit<PlanningTraceEvent, "id">>,
  ) {
    setPlanningTrace((events) =>
      events.map((event) =>
        event.id === id ? { ...event, ...patch, at: patch.at ?? traceTime() } : event,
      ),
    );
  }

  function upsertPlanningTrace(event: PlanningTraceEvent) {
    setPlanningTrace((events) => {
      const next = events.filter((item) => item.id !== event.id);
      return [...next, event];
    });
  }

  function planningToolObservationTitle(observation: PlanningToolIpcTrace["observations"][number]): string {
    const sourceKinds = new Set(observation.sources.map((source) => source.kind));
    const summary = observation.summary.toLowerCase();
    if (summary.includes("distill") || summary.includes("context")) return t("trace.tool.context");
    if (sourceKinds.has("web")) return t("trace.tool.web");
    if (sourceKinds.has("file") || sourceKinds.has("workspace")) return t("trace.tool.local");
    if (sourceKinds.has("memory")) return t("trace.tool.memory");
    return t("trace.tool.observation");
  }

  function planningToolObservationDetail(
    observation: PlanningToolIpcTrace["observations"][number],
    trace?: PlanningToolIpcTrace | null,
  ): string {
    const parts = [
      shortUiText(observation.summary),
      t("trace.tool.sources", { n: observation.sources.length }),
    ];
    const warningCount = observation.warnings?.length ?? 0;
    if (warningCount > 0) parts.push(t("trace.tool.warnings", { n: warningCount }));
    if (trace?.distillation && observation.summary.toLowerCase().includes("distill")) {
      parts.push(t("trace.tool.missing", { n: trace.distillation.missingQuestions.length }));
      parts.push(t("trace.tool.candidates", { n: trace.distillation.durableMemoryCandidates.length }));
    }
    return parts.join(" · ");
  }

  function appendPlanningToolTrace(phase: "draft" | "clarify" | "refine", trace?: PlanningToolIpcTrace | null) {
    if (!trace || (trace.observations.length === 0 && trace.failures.length === 0)) return;
    const toolEvents: PlanningTraceEvent[] = [
      ...trace.observations.map((observation, index) =>
        traceEvent(
          `${phase}-tool-observation-${index}`,
          observation.warnings?.length ? "warning" : "done",
          planningToolObservationTitle(observation),
          planningToolObservationDetail(observation, trace),
        ),
      ),
      ...trace.failures.map((failure, index) =>
        traceEvent(
          `${phase}-tool-failure-${index}-${failure.toolName}`,
          "warning",
          t("trace.tool.failure"),
          `${failure.toolName}: ${shortUiText(failure.error.message)}`,
        ),
      ),
    ];
    setPlanningTrace((events) => {
      const toolEventIds = new Set(toolEvents.map((event) => event.id));
      return [...events.filter((event) => !toolEventIds.has(event.id)), ...toolEvents];
    });
  }

  function describeContextTrace(report?: PlanningContextSelectionReport | null, intake?: AimIntakeReport | null): string {
    return t("trace.contextDone", {
      selected: report?.selected.length ?? 0,
      ignored: report?.ignored.length ?? 0,
      score: intake?.score ?? "-",
    });
  }

  function describePlanTrace(plan: DecompositionOutput): string {
    const summary = shortUiText(plan.rationale ?? plan.goal_summary ?? "");
    return t(plan.nodes.length === 1 ? "trace.draftDone_one" : "trace.draftDone_other", {
      n: plan.nodes.length,
      summary: summary || "-",
    });
  }

  function describeQualityTrace(
    quality: PlanResult["quality"] | null | undefined,
    retry: PlanResult["qualityRetry"] | null | undefined,
  ): string {
    if (!quality) return t("trace.qualityNone");
    const retryText = retry?.retried
      ? t("trace.retryYes", { attempts: retry.attempts })
      : t("trace.retryNo", { attempts: retry?.attempts ?? 1 });
    return t("trace.qualityDone", {
      grade: quality.grade,
      score: quality.score,
      retry: retryText,
    });
  }

  function clearWizard() {
    setTitle("");
    setDescription("");
    setDraft(null);
    setClarifyOut(null);
    setAnswers({});
    setFinalPlan(null);
    setPlanQuality(null);
    setPlanReview(null);
    setPlanQualityRetry(null);
    setPlanningContext(null);
    setPlanningTools(null);
    setPlanningTrace([]);
    setAimIntake(null);
    setDecompositionStrategy(null);
    setSavedAt(null);
    setSavedGoal(null);
    setSavedContextCandidateCount(0);
    setSavedContextCandidates([]);
  }

  function goHome() {
    setError(null);
    setViewing(null);
    setComposerText("");
    setInspectorTab("context");
    clearWizard();
    refreshGoals();
    refreshContextCandidates();
    refreshContextHistory();
    refreshContextProfile();
    refreshContextHealth();
    refreshContextLearning();
    refreshContextLineageLearning();
    refreshContextDecompositionLearning();
    setStep("home");
  }

  function startNew() {
    setError(null);
    setViewing(null);
    setComposerText("");
    setInspectorTab("context");
    clearWizard();
    setStep("aim");
  }

  function openGoal(g: Goal) {
    setError(null);
    setViewing(g);
    setInspectorTab(reviewOf(g) ? "quality" : "context");
    setStep("plan");
  }

  async function removeGoal(g: Goal) {
    try {
      await window.aimcub.deleteGoal(g.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    if (viewing?.id === g.id) goHome();
    else {
      refreshGoals();
      refreshContextCandidates();
      refreshContextHistory();
      refreshContextProfile();
      refreshContextHealth();
      refreshContextLearning();
      refreshContextLineageLearning();
      refreshContextDecompositionLearning();
    }
  }

  async function acceptContextCandidate(candidate: Memory, content: string, scope: "aim" | "global") {
    setError(null);
    try {
      await window.aimcub.acceptContextCandidate({ id: candidate.id, content, scope });
      refreshContextCandidates();
      refreshContextHistory();
      refreshContextProfile();
      refreshContextHealth();
      refreshContextLineageLearning();
      refreshContextDecompositionLearning();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      updatePlanningTrace("save", { status: "error", detail: message });
      setError(message);
    }
  }

  async function rejectContextCandidate(candidate: Memory) {
    setError(null);
    try {
      await window.aimcub.rejectContextCandidate(candidate.id);
      refreshContextCandidates();
      refreshContextHistory();
      refreshContextProfile();
      refreshContextHealth();
      refreshContextLineageLearning();
      refreshContextDecompositionLearning();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function archiveContextMemory(id: string) {
    setError(null);
    try {
      await window.aimcub.archiveContextMemory(id);
      refreshContextCandidates();
      refreshContextHistory();
      refreshContextProfile();
      refreshContextHealth();
      refreshContextLineageLearning();
      refreshContextDecompositionLearning();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function deprioritizeContextMemory(id: string) {
    setError(null);
    try {
      await window.aimcub.deprioritizeContextMemory({ id });
      refreshContextHistory();
      refreshContextHealth();
      refreshContextLineageLearning();
      refreshContextDecompositionLearning();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function runDraft(req: { title: string; description?: string }) {
    if (!configured) {
      setShowSettings(true);
      return;
    }
    setDraft(null);
    setClarifyOut(null);
    setAnswers({});
    setFinalPlan(null);
    setPlanQuality(null);
    setPlanReview(null);
    setPlanQualityRetry(null);
    setPlanningContext(null);
    setPlanningTools(null);
    setAimIntake(null);
    setDecompositionStrategy(null);
    setTitle(req.title);
    setDescription(req.description ?? "");
    setViewing(null);
    setSavedGoal(null);
    setSavedAt(null);
    const providerText = provider ? providerLabel(provider, t) : "LLM";
    setError(null);
    setInspectorTab("process");
    setPlanningTrace([
      traceEvent("intake", "running", t("trace.intake"), t("trace.intakePending")),
      traceEvent("context", "pending", t("trace.context"), t("trace.contextPending")),
      traceEvent("draft", "pending", t("trace.draft"), t("trace.draftPending", { provider: providerText })),
      traceEvent("quality", "pending", t("trace.quality"), t("trace.qualityPending")),
      traceEvent("clarify", "pending", t("trace.clarify"), t("trace.clarifyPending")),
    ]);
    setStep("drafting");
    try {
      const d = await withUiTimeout(
        window.aimcub.draft(req),
        DRAFT_UI_TIMEOUT_MS,
        t("err.draftTimeout", { seconds: Math.round(DRAFT_UI_TIMEOUT_MS / 1000) }),
      );
      setAimIntake(d.intake ?? null);
      setPlanningContext(d.planningContext ?? null);
      setPlanningTools(d.planningTools ?? null);
      appendPlanningToolTrace("draft", d.planningTools);
      updatePlanningTrace("intake", {
        status: "done",
        detail: t("trace.intakeDone", {
          score: d.intake?.score ?? "-",
          questions: d.intake?.questions.length ?? 0,
        }),
      });
      updatePlanningTrace("context", {
        status: "done",
        detail: describeContextTrace(d.planningContext, d.intake ?? null),
      });
      if (!d.ok || !d.output) {
        const message = d.errors.join("; ") || t("err.draft");
        updatePlanningTrace("draft", { status: "error", detail: message });
        throw new Error(message);
      }
      setDraft(d.output);
      setPlanQuality(d.quality ?? null);
      setPlanReview(d.review ?? null);
      setPlanQualityRetry(d.qualityRetry ?? null);
      updatePlanningTrace("draft", { status: "done", detail: describePlanTrace(d.output) });
      updatePlanningTrace("quality", {
        status: d.quality?.grade === "fail" ? "warning" : "done",
        detail: describeQualityTrace(d.quality, d.qualityRetry),
      });
      setStep("clarifying");
      updatePlanningTrace("clarify", { status: "running", detail: t("trace.clarifyRunning") });
      try {
        const c = await withUiTimeout(
          window.aimcub.clarify({
            title: req.title,
            description: req.description,
            draft: d.output,
          }),
          CLARIFY_UI_TIMEOUT_MS,
          t("err.clarifyTimeout", { seconds: Math.round(CLARIFY_UI_TIMEOUT_MS / 1000) }),
        );
        setPlanningTools(c.planningTools ?? d.planningTools ?? null);
        appendPlanningToolTrace("clarify", c.planningTools);
        // Clarify is best-effort: if the model returns nothing usable, proceed with the draft
        // and an empty question set rather than blocking — the draft is already valid.
        setClarifyOut(c.output ?? { questions: [], assumptions: [] });
        if (!c.ok) {
          const message = c.errors.join("; ") || t("err.clarify");
          updatePlanningTrace("clarify", { status: "warning", detail: message });
          setError(message);
        } else {
          const questionCount = c.output?.questions.length ?? 0;
          updatePlanningTrace("clarify", {
            status: "done",
            detail: t(questionCount === 1 ? "trace.clarifyDone_one" : "trace.clarifyDone_other", { n: questionCount }),
          });
        }
      } catch (e) {
        setClarifyOut({ questions: [], assumptions: [] });
        const message = e instanceof Error ? e.message : String(e);
        updatePlanningTrace("clarify", { status: "warning", detail: message });
        setError(message);
      }
      setStep("questions");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep("aim");
    }
  }

  async function startDraftFromComposer(prompt: string) {
    const nextTitle = prompt.trim();
    if (!nextTitle) return;
    setComposerText("");
    await runDraft({ title: nextTitle });
  }

  async function refine(useDraftAsIs: boolean, reviewPrompt?: string) {
    const sourcePlan = finalPlan ?? draft;
    if (!sourcePlan) return;
    setError(null);
    if (useDraftAsIs) {
      setFinalPlan(sourcePlan);
      upsertPlanningTrace(traceEvent("accept-draft", "done", t("trace.acceptDraft"), t("trace.acceptDraftDone")));
      setInspectorTab("quality");
      setStep("plan");
      return;
    }
    setStep("refining");
    setInspectorTab("process");
    upsertPlanningTrace(traceEvent(
      "refine",
      "running",
      t("trace.refine"),
      t("trace.refinePending", { answers: builtAnswers.length, review: reviewPrompt ? 1 : 0 }),
    ));
    try {
      const r = await window.aimcub.refine({
        title: title.trim(),
        description: description.trim() || undefined,
        draft: sourcePlan,
        questions: clarifyOut?.questions ?? [],
        answers: builtAnswers,
        reviewPrompt,
      });
      if (!r.ok || !r.output) {
        const message = r.errors.join("; ") || t("err.refine");
        updatePlanningTrace("refine", { status: "error", detail: message });
        setError(message);
        setStep("questions");
        return;
      }
      setFinalPlan(r.output);
      setPlanQuality(r.quality ?? null);
      setPlanReview(r.review ?? null);
      setPlanQualityRetry(r.qualityRetry ?? null);
      setPlanningContext(r.planningContext ?? null);
      setPlanningTools(r.planningTools ?? null);
      appendPlanningToolTrace("refine", r.planningTools);
      setAimIntake(r.intake ?? null);
      updatePlanningTrace("context", {
        status: "done",
        detail: describeContextTrace(r.planningContext, r.intake ?? null),
      });
      updatePlanningTrace("refine", { status: "done", detail: describePlanTrace(r.output) });
      updatePlanningTrace("quality", {
        status: r.quality?.grade === "fail" ? "warning" : "done",
        detail: describeQualityTrace(r.quality, r.qualityRetry),
      });
      setInspectorTab("quality");
      setStep("plan");
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      updatePlanningTrace("refine", { status: "error", detail: message });
      setError(message);
      setStep("questions");
    }
  }

  async function save() {
    if (!finalPlan) return;
    setError(null);
    upsertPlanningTrace(traceEvent("save", "running", t("trace.save"), t("trace.savePending")));
    try {
      const res = await window.aimcub.saveGoal({
        title: title.trim(),
        description: description.trim() || undefined,
        draft,
        plan: finalPlan,
        quality: planQuality,
        review: planReview,
        qualityRetry: planQualityRetry ?? undefined,
        questions: clarifyOut?.questions ?? [],
        answers: builtAnswers,
        assumptions: clarifyOut?.assumptions ?? [],
      });
      setSavedAt(res.goal.created_at ?? new Date().toISOString());
      setSavedGoal(res.goal);
      setSavedContextCandidateCount(res.contextCandidates?.length ?? 0);
      setSavedContextCandidates(res.contextCandidates ?? []);
      updatePlanningTrace("save", {
        status: "done",
        detail: t("trace.saveDone", { n: res.contextCandidates?.length ?? 0 }),
      });
      setInspectorTab("activity");
      refreshGoals();
      refreshContextCandidates();
      refreshContextHistory();
      refreshContextProfile();
      refreshContextHealth();
      refreshContextLearning();
      refreshContextLineageLearning();
      refreshContextDecompositionLearning();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const compactShell = viewportWidth < 900;
  const shellSidebarCollapsed = !compactShell && sidebarCollapsed;
  const activeBusyStep = isBusyStep(step) ? step : null;
  const activeGoal = viewing ?? savedGoal;
  const activeGoalPending = activeGoal
    ? pendingContextForGoal(activeGoal, activeGoal.id === savedGoal?.id ? savedContextCandidates : contextCandidates)
    : [];
  const activePlan = viewing ? planOf(viewing) : finalPlan;
  const activeReview = viewing ? reviewOf(viewing) : planReview;
  const activeIntake = viewing ? aimIntakeOf(viewing) : savedGoal ? aimIntakeOf(savedGoal) ?? aimIntake : aimIntake;
  const activePlanningContext = viewing
    ? planningContextOf(viewing)
    : savedGoal
      ? planningContextOf(savedGoal) ?? planningContext
      : planningContext;
  const activePlanningTools = viewing
    ? planningToolsOf(viewing)
    : savedGoal
      ? planningToolsOf(savedGoal) ?? planningTools
      : planningTools;
  const activeLearning = activeGoal
    ? reviewAimLearning({ goal: activeGoal, pendingContext: activeGoalPending, contextOutcomes: contextHistory })
    : null;
  const activeAnswerImpact = activeGoal ? clarifyImpactOf(activeGoal) : null;
  const activeCaptureFulfillment = activeGoal ? contextCaptureFulfillmentOf(activeGoal) : null;
  const activeContextLineage = activeGoal
    ? reviewContextLineage({ goal: activeGoal, pendingContext: activeGoalPending, contextOutcomes: contextHistory })
    : null;
  const workspaceTitle = (viewing?.title ?? savedGoal?.title ?? title.trim()) || t(step === "home" ? "home.recent" : "shell.currentAim");
  const showSessionDetails = step !== "home" && step !== "aim";
  const showTopBar = showSessionDetails;
  const providerMeta = provider?.configured ? providerLabel(provider, t) : t("provider.setup");
  const composerDisabled = Boolean(activeBusyStep);
  const composerPlaceholder = step === "plan" && !viewing && finalPlan
    ? t("chat.followupPlaceholder")
    : t("chat.placeholder");

  async function submitComposerPrompt(prompt: string) {
    const nextPrompt = prompt.trim();
    if (!nextPrompt || composerDisabled) return;
    setComposerText("");
    if (step === "plan" && !viewing && finalPlan) {
      await refine(false, nextPrompt);
      return;
    }
    if (step === "questions") {
      await refine(false, nextPrompt);
      return;
    }
    await startDraftFromComposer(nextPrompt);
  }

  return (
    <div style={appRootStyle()}>
      <div style={classicShellStyle(compactShell, shellSidebarCollapsed)}>
        <ClassicSidebar
          compact={compactShell}
          collapsed={shellSidebarCollapsed}
          goals={goals}
          currentGoal={activeGoal}
          step={step}
          onHome={goHome}
          onNew={startNew}
          onOpen={openGoal}
          onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
          providerMeta={providerMeta}
          onProviderSettings={() => setShowSettings((v) => !v)}
        />

        <section style={mainShellStyle()}>
          {showTopBar && (
            <header style={mainTopBarStyle(compactShell)}>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: C.text, fontSize: 13, fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {workspaceTitle}
                </div>
              </div>
            </header>
          )}

          {showSettings && (
            <div style={settingsPanelWrapStyle(compactShell)}>
              <ProviderForm
                status={provider}
                onSaved={(s) => {
                  setProvider(s);
                  if (s.configured) setShowSettings(false);
                }}
                onClose={() => setShowSettings(false)}
              />
            </div>
          )}

          {error && (
            <div style={{ marginBottom: 14 }}>
              <Notice tone="error">{error}</Notice>
            </div>
          )}

          <main style={contentSurfaceStyle(compactShell)}>
            <section style={agentWorkspaceStyle()}>
              <div style={conversationStreamStyle()}>
                {step === "home" && (
                  <HomeDashboard
                    goals={goals}
                    onNew={startNew}
                    onOpen={openGoal}
                  />
                )}

                {step === "aim" && (
                  <NewAimPanel
                    title={title}
                    description={description}
                    configured={configured}
                    aimIntake={aimIntake}
                    onTitle={setTitle}
                    onDescription={setDescription}
                    onDraft={() => runDraft({ title: title.trim(), description: description.trim() || undefined })}
                  />
                )}

                {(step === "drafting" || step === "clarifying" || step === "refining") && (
                  <BusyPlanState step={step} title={title.trim()} description={description.trim()} />
                )}

                {step === "questions" && clarifyOut && (
                  <QuestionsStep
                    clarify={clarifyOut}
                    answers={answers}
                    onAnswer={(id, patch) => setAnswers((m) => ({ ...m, [id]: { label: null, other: "", ...m[id], ...patch } }))}
                    onRefine={() => refine(false)}
                    onUseDraft={() => refine(true)}
                  />
                )}

                {step === "plan" && viewing && (
                  <SavedGoalView
                    goal={viewing}
                    onBack={goHome}
                    onDelete={() => removeGoal(viewing)}
                  />
                )}

                {step === "plan" && !viewing && finalPlan && (
                  <PlanView
                    plan={finalPlan}
                    title={title.trim() || t("shell.currentAim")}
                    description={description.trim() || undefined}
                    review={planReview}
                    savedAt={savedAt}
                    contextCandidateCount={savedContextCandidateCount}
                    onSave={save}
                    onRefineWithReview={(prompt) => refine(false, prompt)}
                    onReset={startNew}
                    onHome={goHome}
                  />
                )}

                {showSessionDetails && (
                  <SessionDetails
                    activeTab={inspectorTab}
                    onTab={setInspectorTab}
                    events={planningTrace}
                    busyStep={activeBusyStep}
                    aimIntake={activeIntake}
                    decompositionStrategy={decompositionStrategy}
                    contextCandidates={contextCandidates}
                    contextProfile={contextProfile}
                    contextHealth={contextHealth}
                    contextLearning={contextLearning}
                    contextLineageLearning={contextLineageLearning}
                    contextDecompositionLearning={contextDecompositionLearning}
                    planningContext={activePlanningContext}
                    planningTools={activePlanningTools}
                    review={activeReview}
                    planQuality={planQuality}
                    qualityRetry={planQualityRetry}
                    plan={activePlan}
                    learning={activeLearning}
                    answerImpact={activeAnswerImpact}
                    captureFulfillment={activeCaptureFulfillment}
                    contextLineage={activeContextLineage}
                    onAcceptContext={acceptContextCandidate}
                    onRejectContext={rejectContextCandidate}
                    onArchiveContext={archiveContextMemory}
                    onDeprioritizeContext={deprioritizeContextMemory}
                  />
                )}
              </div>
              <ChatComposer
                value={composerText}
                placeholder={composerPlaceholder}
                disabled={composerDisabled}
                onChange={setComposerText}
                onSubmit={submitComposerPrompt}
                meta={providerMeta}
                onMetaClick={() => setShowSettings((v) => !v)}
              />
            </section>
          </main>
        </section>
      </div>
    </div>
  );
}

type WorkflowStage = "aim" | "draft" | "questions" | "refine" | "save";

function HomeDashboard(props: {
  goals: Goal[];
  onNew: () => void;
  onOpen: (goal: Goal) => void;
}) {
  const { t } = useI18n();
  const recent = props.goals.slice(0, 6);
  return (
    <section style={mvpPanelStyle()}>
      <div style={mvpHeroRowStyle()}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: C.accent, fontSize: 12, fontWeight: 700, marginBottom: 10 }}>Aimcub</div>
          <h1 style={mvpTitleStyle()}>{t("mvp.homeTitle")}</h1>
          <p style={mvpBodyStyle()}>{t("mvp.homeBody")}</p>
        </div>
        <button onClick={props.onNew} style={{ ...primaryButton(false), marginTop: 0, whiteSpace: "nowrap" }}>
          {t("home.new")}
        </button>
      </div>

      <WorkflowStrip active="aim" completed={new Set()} />

      <div style={recentListShellStyle()}>
        <div style={recentListHeaderStyle()}>
          <span>{t("mvp.recentTitle")}</span>
          <span style={{ color: C.muted, fontSize: 12 }}>
            {t(props.goals.length === 1 ? "home.aim_one" : "home.aim_other", { n: props.goals.length })}
          </span>
        </div>
        {recent.length > 0 ? (
          <div style={{ display: "grid", gap: 6 }}>
            {recent.map((goal) => {
              const plan = planOf(goal);
              return (
                <button key={goal.id} onClick={() => props.onOpen(goal)} style={recentGoalRowStyle()}>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{goal.title}</span>
                  <span style={{ color: C.muted, fontSize: 12, whiteSpace: "nowrap" }}>
                    {t((plan?.nodes.length ?? 0) === 1 ? "common.milestone_one" : "common.milestone_other", { n: plan?.nodes.length ?? 0 })}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div style={{ color: C.muted, fontSize: 13, padding: "8px 0" }}>{t("mvp.noRecent")}</div>
        )}
      </div>
    </section>
  );
}

function NewAimPanel(props: {
  title: string;
  description: string;
  configured: boolean;
  aimIntake: AimIntakeReport | null;
  onTitle: (value: string) => void;
  onDescription: (value: string) => void;
  onDraft: () => void;
}) {
  const { t } = useI18n();
  const canDraft = props.title.trim().length > 0;
  return (
    <section style={mvpPanelStyle()}>
      <div style={{ marginBottom: 18 }}>
        <div style={{ color: C.accent, fontSize: 12, fontWeight: 700, marginBottom: 10 }}>{t("mvp.formTitle")}</div>
        <h1 style={mvpTitleStyle()}>{t("chat.greeting")}</h1>
        <p style={mvpBodyStyle()}>{t("mvp.formBody")}</p>
      </div>

      <WorkflowStrip active="aim" completed={props.title.trim() ? new Set<WorkflowStage>(["aim"]) : new Set()} />

      <div style={newAimFormStyle()}>
        <label style={aimFieldLabelStyle()} htmlFor="aim-title">{t("aim.titleLabel")}</label>
        <textarea
          id="aim-title"
          value={props.title}
          onChange={(event) => props.onTitle(event.target.value)}
          placeholder={t("aim.titlePlaceholder")}
          rows={3}
          style={aimTitleInputStyle()}
        />

        <label style={aimFieldLabelStyle()} htmlFor="aim-description">{t("aim.descLabel")}</label>
        <textarea
          id="aim-description"
          value={props.description}
          onChange={(event) => props.onDescription(event.target.value)}
          placeholder={t("aim.descPlaceholder")}
          rows={4}
          style={aimDescriptionInputStyle()}
        />

        {props.aimIntake && (
          <div style={intakeMiniStyle()}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
              <span style={{ color: C.text, fontSize: 13, fontWeight: 650 }}>{t("mvp.intakeReady")}</span>
              <span style={{ color: C.muted, fontSize: 12 }}>{props.aimIntake.score}/100</span>
            </div>
            <div style={{ color: C.muted, fontSize: 12, lineHeight: 1.45, marginTop: 5 }}>
              {intakeReadinessLabel(props.aimIntake.readiness, t)} · {t("mvp.intakeRows", { n: props.aimIntake.coverage.selectedTotal })}
            </div>
            {props.aimIntake.questions[0] && (
              <div style={{ color: C.muted, fontSize: 12, lineHeight: 1.45, marginTop: 5 }}>
                {shortUiText(props.aimIntake.questions[0].prompt)}
              </div>
            )}
          </div>
        )}

        {!props.configured && <Notice tone="info">{t("aim.needProvider")}</Notice>}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 4 }}>
          <button onClick={props.onDraft} disabled={!canDraft} style={{ ...primaryButton(!canDraft), marginTop: 0 }}>
            {t("aim.draft")}
          </button>
        </div>
      </div>
    </section>
  );
}

function WorkflowStrip(props: { active: WorkflowStage; completed: ReadonlySet<WorkflowStage> }) {
  const { t } = useI18n();
  const stages: WorkflowStage[] = ["aim", "draft", "questions", "refine", "save"];
  const labels = {
    aim: "mvp.flow.aim",
    draft: "mvp.flow.draft",
    questions: "mvp.flow.questions",
    refine: "mvp.flow.refine",
    save: "mvp.flow.save",
  } as const satisfies Record<WorkflowStage, StringKey>;
  return (
    <div style={workflowShellStyle()} aria-label={t("mvp.workflow")}>
      {stages.map((stage, index) => {
        const active = props.active === stage;
        const done = props.completed.has(stage);
        return (
          <div key={stage} style={workflowItemStyle(active, done)}>
            <span style={workflowDotStyle(active, done)}>{done ? "OK" : index + 1}</span>
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t(labels[stage])}</span>
          </div>
        );
      })}
    </div>
  );
}

function ChatComposer(props: {
  value: string;
  placeholder: string;
  disabled: boolean;
  meta: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onMetaClick: () => void;
}) {
  const { t } = useI18n();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const canSubmit = props.value.trim().length > 0 && !props.disabled;

  function resizeComposer() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const nextHeight = Math.min(150, Math.max(44, el.scrollHeight));
    el.style.height = `${nextHeight}px`;
    el.style.overflowY = el.scrollHeight > 150 ? "auto" : "hidden";
  }

  useEffect(() => {
    resizeComposer();
  }, [props.value]);

  useEffect(() => {
    if (!props.disabled) textareaRef.current?.focus();
  }, [props.disabled, props.placeholder]);

  return (
    <div style={composerShellStyle()}>
      <textarea
        ref={textareaRef}
        value={props.value}
        disabled={props.disabled}
        onChange={(event) => {
          props.onChange(event.target.value);
          resizeComposer();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            if (canSubmit) props.onSubmit(props.value);
          }
        }}
        placeholder={props.placeholder}
        rows={1}
        aria-label={props.placeholder}
        style={composerInputStyle()}
      />
      <div style={composerFooterStyle()}>
        <button onClick={props.onMetaClick} style={composerMetaButton()}>
          {props.meta}
        </button>
        <button
          onClick={() => props.onSubmit(props.value)}
          disabled={!canSubmit}
          style={composerSendButton(!canSubmit)}
          title={t("chat.send")}
          aria-label={t("chat.send")}
        >
          <Icon name="send" size={15} />
        </button>
      </div>
    </div>
  );
}

function Icon(props: { name: IconName; size?: number }): JSX.Element {
  const size = props.size ?? 16;
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: 1.8,
  } as const;
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" style={{ display: "block", flex: "0 0 auto" }}>
      {props.name === "chat" && (
        <>
          <path {...common} d="M5 6.5h14a2 2 0 0 1 2 2v6.2a2 2 0 0 1-2 2H9.4L5 20v-3.3a2 2 0 0 1-2-2V8.5a2 2 0 0 1 2-2Z" />
          <path {...common} d="M8 10h8M8 13h5" />
        </>
      )}
      {props.name === "panelClose" && (
        <>
          <path {...common} d="M4 5h16v14H4zM9 5v14" />
          <path {...common} d="m16 9-3 3 3 3" />
        </>
      )}
      {props.name === "panelOpen" && (
        <>
          <path {...common} d="M4 5h16v14H4zM9 5v14" />
          <path {...common} d="m13 9 3 3-3 3" />
        </>
      )}
      {props.name === "plus" && <path {...common} d="M12 5v14M5 12h14" />}
      {props.name === "send" && <path {...common} d="M5 12h13M13 6l6 6-6 6" />}
    </svg>
  );
}

function SessionDetails(props: {
  activeTab: InspectorTab;
  onTab: (tab: InspectorTab) => void;
  events: PlanningTraceEvent[];
  busyStep: BusyStep | null;
  aimIntake: AimIntakeReport | null;
  decompositionStrategy: DecompositionStrategyReport | null;
  contextCandidates: Memory[];
  contextProfile: ContextProfileReport | null;
  contextHealth: ContextHealthRow[];
  contextLearning: ClarifyLearningReport | null;
  contextLineageLearning: ContextLineageLearningReport | null;
  contextDecompositionLearning: DecompositionLearningReport | null;
  planningContext: PlanningContextSelectionReport | null;
  planningTools: PlanningToolIpcTrace | null;
  review: PlanResult["review"] | null;
  planQuality: PlanResult["quality"] | null;
  qualityRetry: PlanResult["qualityRetry"] | null;
  plan: DecompositionOutput | null;
  learning: AimLearningReport | null;
  answerImpact: ClarifyAnswerImpactReport | null;
  captureFulfillment: ContextCaptureFulfillmentReport | null;
  contextLineage: ContextLineageReport | null;
  onAcceptContext: (candidate: Memory, content: string, scope: "aim" | "global") => void;
  onRejectContext: (candidate: Memory) => void;
  onArchiveContext: (id: string) => void;
  onDeprioritizeContext: (id: string) => void;
}) {
  const { t } = useI18n();
  const doneCount = props.events.filter((event) => event.status === "done").length;
  const hasRunning = props.events.some((event) => event.status === "running") || Boolean(props.busyStep);
  return (
    <details style={sessionDetailsStyle()} open={props.events.length > 0 || Boolean(props.busyStep)}>
      <summary style={sessionDetailsSummaryStyle()}>
        <span>{t("trace.title")}</span>
        <span style={sessionDetailsSummaryMetaStyle()}>
          {hasRunning ? t("spinner.live") : t("trace.count", { n: doneCount, total: props.events.length })}
        </span>
      </summary>
      <InspectorRail
        activeTab={props.activeTab}
        onTab={props.onTab}
        events={props.events}
        busyStep={props.busyStep}
        aimIntake={props.aimIntake}
        decompositionStrategy={props.decompositionStrategy}
        contextCandidates={props.contextCandidates}
        contextProfile={props.contextProfile}
        contextHealth={props.contextHealth}
        contextLearning={props.contextLearning}
        contextLineageLearning={props.contextLineageLearning}
        contextDecompositionLearning={props.contextDecompositionLearning}
        planningContext={props.planningContext}
        planningTools={props.planningTools}
        review={props.review}
        planQuality={props.planQuality}
        qualityRetry={props.qualityRetry}
        plan={props.plan}
        learning={props.learning}
        answerImpact={props.answerImpact}
        captureFulfillment={props.captureFulfillment}
        contextLineage={props.contextLineage}
        onAcceptContext={props.onAcceptContext}
        onRejectContext={props.onRejectContext}
        onArchiveContext={props.onArchiveContext}
        onDeprioritizeContext={props.onDeprioritizeContext}
        showTabs={false}
        sticky={false}
        compact
      />
    </details>
  );
}

function ClassicSidebar(props: {
  compact: boolean;
  collapsed: boolean;
  goals: Goal[];
  currentGoal: Goal | null;
  step: Step;
  onHome: () => void;
  onNew: () => void;
  onOpen: (goal: Goal) => void;
  onToggleCollapsed: () => void;
  providerMeta: string;
  onProviderSettings: () => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const filteredGoals = props.goals.filter((goal) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return `${goal.title} ${goal.description ?? ""}`.toLowerCase().includes(q);
  });
  if (props.collapsed) {
    return (
      <aside style={classicSidebarStyle(props.compact, true)}>
        <button onClick={props.onToggleCollapsed} style={collapsedSidebarButtonStyle(props.step === "home")} title={t("chat.showSidebar")} aria-label={t("chat.showSidebar")}>
          <Icon name="panelOpen" />
        </button>
        <button onClick={props.onNew} style={collapsedSidebarButtonStyle(false)} title={t("chat.new")} aria-label={t("chat.new")}>
          <Icon name="plus" />
        </button>
        <button onClick={props.onHome} style={collapsedSidebarButtonStyle(props.step === "home")} title={t("chat.home")} aria-label={t("chat.home")}>
          <Icon name="chat" />
        </button>
      </aside>
    );
  }
  return (
    <aside style={classicSidebarStyle(props.compact, false)}>
      <div>
        <div style={sidebarHeaderRowStyle()}>
          <button onClick={props.onHome} style={sidebarBrandButton()}>
            <span style={{ fontSize: 17, fontWeight: 750, letterSpacing: 0 }}>Aimcub</span>
          </button>
          {!props.compact && (
            <button onClick={props.onToggleCollapsed} style={shellIconButtonStyle()} title={t("chat.hideSidebar")} aria-label={t("chat.hideSidebar")}>
              <Icon name="panelClose" size={15} />
            </button>
          )}
        </div>
        <div style={{ display: "grid", gap: 8, marginTop: 18 }}>
          <button onClick={props.onNew} style={sidebarCommandButton(true)}>
            <span style={sidebarButtonContentStyle()}>
              <Icon name="plus" size={14} />
              <span>{t("chat.new")}</span>
            </span>
          </button>
          <button onClick={props.onHome} style={sidebarNavButton(props.step === "home")}>
            <span style={sidebarButtonContentStyle()}>
              <Icon name="chat" size={14} />
              <span>{t("chat.home")}</span>
            </span>
          </button>
        </div>
      </div>

      <div style={sidebarSessionsPaneStyle(props.compact)}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("chat.search")}
          style={sidebarSearchInputStyle()}
        />
        <SidebarSectionLabel label={t("chat.sessions")} value={t(props.goals.length === 1 ? "chat.session_one" : "chat.session_other", { n: props.goals.length })} />
        <div style={{ display: "grid", gap: 7, minHeight: 0, maxHeight: props.compact ? 220 : "none", overflow: "auto", paddingRight: 2 }}>
          {filteredGoals.map((goal) => {
            const selected = props.currentGoal?.id === goal.id;
            const plan = planOf(goal);
            return (
              <button key={goal.id} onClick={() => props.onOpen(goal)} style={sidebarGoalButton(selected)}>
                <span style={{ display: "block", fontWeight: 620, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{goal.title}</span>
                <span style={{ display: "block", color: C.muted, fontSize: 12, marginTop: 3 }}>
                  {t((plan?.nodes.length ?? 0) === 1 ? "common.milestone_one" : "common.milestone_other", { n: plan?.nodes.length ?? 0 })}
                </span>
              </button>
            );
          })}
          {filteredGoals.length === 0 && (
            <div style={{ color: C.muted, fontSize: 13, padding: "8px 2px" }}>{t("shell.noSearchResults")}</div>
          )}
        </div>
      </div>

      <div style={sidebarFooterStyle(props.compact)}>
        <LangToggle />
        <button onClick={props.onProviderSettings} style={sidebarProviderButtonStyle()}>
          {props.providerMeta}
        </button>
      </div>
    </aside>
  );
}

function SidebarSectionLabel(props: { label: string; value?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline", marginBottom: 8 }}>
      <div style={{ color: C.muted, fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase" }}>{props.label}</div>
      {props.value ? <div style={{ color: C.muted, fontSize: 11, whiteSpace: "nowrap" }}>{props.value}</div> : null}
    </div>
  );
}

function agentWorkspaceStyle(): CSSProperties {
  return {
    display: "grid",
    gridTemplateRows: "minmax(0, 1fr) auto",
    height: "100%",
    maxHeight: "100%",
    minHeight: 0,
    overflow: "hidden",
  };
}

function conversationStreamStyle(): CSSProperties {
  return {
    minHeight: 0,
    height: "100%",
    overflowY: "auto",
    overscrollBehavior: "contain",
    padding: "24px 0 22px",
    boxSizing: "border-box",
  };
}

function mvpPanelStyle(): CSSProperties {
  return {
    maxWidth: 760,
    margin: "0 auto",
    padding: "36px 0 88px",
    boxSizing: "border-box",
  };
}

function mvpHeroRowStyle(): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    gap: 18,
    alignItems: "start",
    marginBottom: 22,
  };
}

function mvpTitleStyle(): CSSProperties {
  return {
    margin: 0,
    color: C.text,
    fontSize: 30,
    lineHeight: 1.14,
    letterSpacing: 0,
    fontWeight: 720,
  };
}

function mvpBodyStyle(): CSSProperties {
  return {
    margin: "10px 0 0",
    color: C.muted,
    fontSize: 14,
    lineHeight: 1.55,
  };
}

function workflowShellStyle(): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
    gap: 6,
    margin: "18px 0",
  };
}

function workflowItemStyle(active: boolean, done: boolean): CSSProperties {
  return {
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    gap: 7,
    border: `1px solid ${active ? "#b7d7df" : C.border}`,
    background: active ? C.accentBg : done ? "#f6f8fa" : C.surface,
    color: active ? C.accent : done ? C.text : C.muted,
    borderRadius: 8,
    padding: "8px 9px",
    fontSize: 12,
    fontWeight: active || done ? 700 : 560,
    overflow: "hidden",
  };
}

function workflowDotStyle(active: boolean, done: boolean): CSSProperties {
  return {
    width: 20,
    height: 20,
    flex: "0 0 20px",
    display: "inline-grid",
    placeItems: "center",
    borderRadius: 999,
    background: active ? C.accent : done ? C.text : "#eceff1",
    color: active || done ? "#fff" : C.muted,
    fontSize: done ? 8 : 11,
    fontWeight: 800,
    fontVariantNumeric: "tabular-nums",
  };
}

function recentListShellStyle(): CSSProperties {
  return {
    borderTop: `1px solid ${C.border}`,
    paddingTop: 16,
    marginTop: 22,
  };
}

function recentListHeaderStyle(): CSSProperties {
  return {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: 12,
    color: C.text,
    fontSize: 13,
    fontWeight: 700,
    marginBottom: 10,
  };
}

function recentGoalRowStyle(): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    alignItems: "baseline",
    gap: 12,
    width: "100%",
    border: "none",
    borderRadius: 8,
    background: "transparent",
    color: C.text,
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 14,
    fontWeight: 620,
    padding: "9px 0",
    textAlign: "left",
  };
}

function newAimFormStyle(): CSSProperties {
  return {
    display: "grid",
    gap: 10,
    borderTop: `1px solid ${C.border}`,
    paddingTop: 16,
  };
}

function aimFieldLabelStyle(): CSSProperties {
  return {
    color: C.muted,
    fontSize: 12,
    fontWeight: 700,
    marginTop: 4,
  };
}

function aimTitleInputStyle(): CSSProperties {
  return {
    width: "100%",
    minHeight: 88,
    resize: "vertical",
    border: `1px solid ${C.border}`,
    borderRadius: 10,
    background: C.surface,
    color: C.text,
    fontFamily: "inherit",
    fontSize: 17,
    lineHeight: 1.45,
    outline: "none",
    padding: "12px 13px",
    boxSizing: "border-box",
  };
}

function aimDescriptionInputStyle(): CSSProperties {
  return {
    ...aimTitleInputStyle(),
    minHeight: 104,
    fontSize: 14,
  };
}

function intakeMiniStyle(): CSSProperties {
  return {
    border: `1px solid ${C.border}`,
    borderRadius: 10,
    background: "#f7fbfb",
    padding: "11px 12px",
  };
}

function composerShellStyle(): CSSProperties {
  return {
    width: "min(820px, 100%)",
    margin: "0 auto",
    border: `1px solid ${C.border}`,
    background: "#fff",
    borderRadius: 16,
    boxShadow: "0 10px 34px rgba(31, 35, 40, 0.08), 0 1px 2px rgba(31, 35, 40, 0.06)",
    padding: 10,
    boxSizing: "border-box",
  };
}

function composerInputStyle(): CSSProperties {
  return {
    width: "100%",
    height: 44,
    minHeight: 44,
    maxHeight: 150,
    overflowY: "hidden",
    resize: "none",
    border: 0,
    outline: "none",
    background: "transparent",
    color: C.text,
    fontFamily: "inherit",
    fontSize: 15,
    lineHeight: 1.45,
    boxSizing: "border-box",
    padding: "8px 6px",
  };
}

function composerFooterStyle(): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  };
}

function composerMetaButton(): CSSProperties {
  return {
    border: "none",
    background: "transparent",
    color: C.muted,
    fontSize: 12,
    cursor: "pointer",
    padding: "4px 6px",
  };
}

function composerSendButton(disabled: boolean): CSSProperties {
  return {
    border: "none",
    background: disabled ? "#d8d8d3" : C.text,
    color: "#fff",
    borderRadius: 999,
    display: "inline-grid",
    placeItems: "center",
    minWidth: 32,
    height: 32,
    padding: 0,
    cursor: disabled ? "default" : "pointer",
    fontSize: 12,
    fontWeight: 700,
  };
}

function sessionDetailsStyle(): CSSProperties {
  return {
    width: "min(820px, 100%)",
    margin: "16px auto 0",
    color: C.muted,
  };
}

function sessionDetailsSummaryStyle(): CSSProperties {
  return {
    cursor: "pointer",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: 12,
    fontSize: 13,
    fontWeight: 600,
    color: C.muted,
    padding: "8px 0 10px",
    listStyle: "none",
  };
}

function sessionDetailsSummaryMetaStyle(): CSSProperties {
  return {
    color: C.muted,
    fontSize: 12,
    fontWeight: 500,
    whiteSpace: "nowrap",
  };
}

function threadSectionStyle(): CSSProperties {
  return {
    width: "min(820px, 100%)",
    margin: "0 auto 16px",
  };
}

function userTurnStyle(): CSSProperties {
  return {
    display: "flex",
    justifyContent: "flex-end",
    marginBottom: 18,
  };
}

function userBubbleStyle(): CSSProperties {
  return {
    maxWidth: "min(640px, 82%)",
    background: "#eeeeea",
    color: C.text,
    borderRadius: 16,
    padding: "11px 14px",
    fontSize: 14,
    lineHeight: 1.5,
  };
}

function assistantTurnStyle(): CSSProperties {
  return {
    color: C.text,
    fontSize: 14,
    lineHeight: 1.55,
  };
}

function assistantMetaStyle(): CSSProperties {
  return {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    color: C.muted,
    fontSize: 12,
    fontWeight: 650,
  };
}

function milestoneListStyle(): CSSProperties {
  return {
    width: "min(820px, 100%)",
    margin: "0 auto",
    borderTop: `1px solid ${C.border}`,
  };
}

function milestoneRowStyle(open: boolean): CSSProperties {
  return {
    borderBottom: `1px solid ${C.border}`,
    background: open ? "rgba(255, 255, 255, 0.62)" : "transparent",
    padding: "14px 0",
  };
}

function milestoneIndexStyle(): CSSProperties {
  return {
    width: 20,
    height: 22,
    display: "inline-grid",
    placeItems: "center",
    color: C.muted,
    fontSize: 12,
    fontWeight: 600,
    fontVariantNumeric: "tabular-nums",
  };
}

function inlineDetailButtonStyle(): CSSProperties {
  return {
    border: "none",
    background: "transparent",
    color: C.muted,
    cursor: "pointer",
    fontSize: 12,
    padding: "2px 0",
  };
}

function planActionRowStyle(): CSSProperties {
  return {
    width: "min(820px, 100%)",
    margin: "14px auto 0",
    display: "flex",
    gap: 10,
    alignItems: "center",
    flexWrap: "wrap",
  };
}

function clarifyListStyle(): CSSProperties {
  return {
    display: "grid",
    marginTop: 16,
    borderTop: `1px solid ${C.border}`,
  };
}

function clarifyQuestionRowStyle(): CSSProperties {
  return {
    display: "grid",
    gap: 10,
    padding: "15px 0",
    borderBottom: `1px solid ${C.border}`,
  };
}

function clarifyQuestionHeaderStyle(): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: "20px minmax(0, 1fr)",
    gap: 10,
    alignItems: "start",
  };
}

function clarifyQuestionNumberStyle(): CSSProperties {
  return {
    color: C.muted,
    fontSize: 12,
    fontWeight: 600,
    paddingTop: 3,
    fontVariantNumeric: "tabular-nums",
  };
}

function clarifyChoicesStyle(): CSSProperties {
  return {
    display: "grid",
    gap: 7,
    marginLeft: 30,
  };
}

function clarifyChoiceButtonStyle(selected: boolean): CSSProperties {
  return {
    display: "grid",
    gap: 2,
    width: "100%",
    textAlign: "left",
    border: "none",
    borderLeft: `2px solid ${selected ? C.accent : C.border}`,
    background: selected ? "rgba(47, 113, 135, 0.06)" : "transparent",
    color: C.text,
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 13,
    lineHeight: 1.4,
    padding: "7px 10px",
  };
}

function clarifyFreeformInputStyle(): CSSProperties {
  return {
    width: "calc(100% - 30px)",
    marginLeft: 30,
    border: "none",
    borderBottom: `1px solid ${C.border}`,
    background: "transparent",
    color: C.text,
    fontFamily: "inherit",
    fontSize: 13,
    outline: "none",
    padding: "8px 0",
  };
}

function clarifyDetailsStyle(): CSSProperties {
  return {
    color: C.muted,
    fontSize: 12,
    lineHeight: 1.45,
    marginLeft: 30,
  };
}

function clarifyAssumptionsStyle(): CSSProperties {
  return {
    color: C.muted,
    fontSize: 12,
    lineHeight: 1.45,
    marginTop: 14,
  };
}

function clarifyEmptyStyle(): CSSProperties {
  return {
    color: C.muted,
    fontSize: 13,
    lineHeight: 1.45,
    marginTop: 14,
  };
}

function clarifyActionRowStyle(): CSSProperties {
  return {
    display: "flex",
    gap: 10,
    alignItems: "center",
    flexWrap: "wrap",
    marginTop: 14,
  };
}

function appRootStyle(): CSSProperties {
  return {
    position: "fixed",
    inset: 0,
    fontFamily: "system-ui, -apple-system, sans-serif",
    color: C.text,
    background: C.page,
    width: "100%",
    height: "100%",
    minHeight: 0,
    overflow: "hidden",
    overscrollBehavior: "none",
  };
}

function classicShellStyle(compact: boolean, collapsed: boolean): CSSProperties {
  return {
    position: "absolute",
    inset: 0,
    display: "grid",
    gridTemplateColumns: compact ? "1fr" : collapsed ? "52px minmax(0, 1fr)" : "264px minmax(0, 1fr)",
    gridTemplateRows: compact ? "auto minmax(0, 1fr)" : undefined,
    width: "100%",
    height: "100%",
    maxHeight: "100%",
    minHeight: 0,
    background: C.page,
    overflow: "hidden",
    overscrollBehavior: "none",
  };
}

function classicSidebarStyle(compact: boolean, collapsed: boolean): ElectronDragStyle {
  return {
    position: compact ? "relative" : "sticky",
    top: 0,
    display: "grid",
    gridTemplateRows: collapsed ? "repeat(3, 36px) minmax(0, 1fr)" : compact ? "auto auto auto" : "auto minmax(0, 1fr) auto",
    alignContent: collapsed ? "start" : undefined,
    gap: collapsed ? 8 : 18,
    background: C.page,
    borderRight: compact ? "none" : `1px solid ${C.border}`,
    borderBottom: compact ? `1px solid ${C.border}` : "none",
    boxShadow: "none",
    padding: collapsed ? "54px 8px 12px" : compact ? "16px 14px" : "56px 12px 14px",
    boxSizing: "border-box",
    minWidth: 0,
    height: compact ? "auto" : "100%",
    maxHeight: compact ? undefined : "100%",
    minHeight: 0,
    overflowY: compact ? "visible" : "auto",
    overscrollBehavior: "contain",
    WebkitAppRegion: compact ? undefined : "drag",
  };
}

function mainShellStyle(): CSSProperties {
  return {
    minWidth: 0,
    minHeight: 0,
    padding: 0,
    boxSizing: "border-box",
    height: "100%",
    maxHeight: "100%",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    background: C.page,
    overscrollBehavior: "none",
  };
}

function mainTopBarStyle(compact: boolean): ElectronDragStyle {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: compact ? "wrap" : "nowrap",
    minHeight: 44,
    padding: compact ? "10px 14px" : "8px 28px",
    boxSizing: "border-box",
    flex: "0 0 auto",
    borderBottom: `1px solid ${C.border}`,
    background: C.page,
    WebkitAppRegion: compact ? undefined : "drag",
  };
}

function contentSurfaceStyle(compact: boolean): CSSProperties {
  return {
    minWidth: 0,
    padding: compact ? "0 14px 18px" : "0 28px 24px",
    minHeight: 0,
    flex: 1,
    boxSizing: "border-box",
    overflow: "hidden",
    display: "grid",
    gridTemplateRows: "minmax(0, 1fr)",
    overscrollBehavior: "none",
  };
}

function settingsPanelWrapStyle(compact: boolean): CSSProperties {
  return {
    flex: "0 0 auto",
    padding: compact ? "12px 14px 0" : "14px 28px 0",
  };
}

function sidebarBrandButton(): CSSProperties {
  return {
    display: "grid",
    gap: 1,
    width: "100%",
    border: 0,
    background: "transparent",
    color: C.text,
    padding: "0 2px",
    cursor: "pointer",
    textAlign: "left",
  };
}

function sidebarSessionsPaneStyle(compact: boolean): CSSProperties {
  return {
    minHeight: 0,
    overflow: "hidden",
    display: "grid",
    gridTemplateRows: compact ? "auto auto auto" : "auto auto minmax(0, 1fr)",
    alignContent: compact ? "start" : undefined,
  };
}

function sidebarFooterStyle(compact: boolean): CSSProperties {
  return {
    display: "grid",
    gap: 10,
    alignContent: "end",
    borderTop: compact ? "none" : `1px solid ${C.border}`,
    paddingTop: compact ? 0 : 12,
  };
}

function sidebarProviderButtonStyle(): CSSProperties {
  return {
    width: "100%",
    minWidth: 0,
    border: "1px solid transparent",
    borderRadius: 8,
    background: "rgba(31, 35, 40, 0.045)",
    color: C.muted,
    padding: "8px 10px",
    cursor: "pointer",
    fontSize: 12,
    fontFamily: "inherit",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    textAlign: "left",
  };
}

function sidebarHeaderRowStyle(): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 32px",
    gap: 8,
    alignItems: "start",
  };
}

function sidebarButtonContentStyle(): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
  };
}

function shellIconButtonStyle(): CSSProperties {
  return {
    width: 32,
    height: 32,
    display: "inline-grid",
    placeItems: "center",
    border: "1px solid transparent",
    borderRadius: 7,
    background: "transparent",
    color: C.muted,
    cursor: "pointer",
    fontSize: 11,
    fontWeight: 700,
    fontFamily: "ui-monospace, monospace",
  };
}

function collapsedSidebarButtonStyle(selected: boolean): CSSProperties {
  return {
    width: 36,
    height: 36,
    display: "grid",
    placeItems: "center",
    border: "1px solid transparent",
    borderRadius: 8,
    background: selected ? "rgba(31, 35, 40, 0.08)" : "transparent",
    color: selected ? C.text : C.muted,
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 750,
    fontFamily: "system-ui, -apple-system, sans-serif",
  };
}

function sidebarSearchInputStyle(): CSSProperties {
  return {
    width: "100%",
    boxSizing: "border-box",
    padding: "9px 10px",
    border: "1px solid transparent",
    borderRadius: 8,
    fontSize: 13,
    fontFamily: "inherit",
    background: "rgba(31, 35, 40, 0.045)",
    color: C.text,
    marginBottom: 13,
    outline: "none",
  };
}

function sidebarCommandButton(primary: boolean): CSSProperties {
  return {
    width: "100%",
    border: "1px solid transparent",
    background: primary ? "rgba(255, 255, 255, 0.78)" : "transparent",
    color: primary ? C.text : C.muted,
    borderRadius: 8,
    padding: "8px 10px",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: primary ? 700 : 560,
    textAlign: "left",
    boxShadow: primary ? "0 1px 1px rgba(31, 35, 40, 0.06)" : "none",
  };
}

function sidebarNavButton(selected: boolean): CSSProperties {
  return {
    width: "100%",
    border: `1px solid ${selected ? "#d4e5eb" : "transparent"}`,
    background: selected ? C.accentBg : "transparent",
    color: selected ? C.accent : C.muted,
    borderRadius: 8,
    padding: "8px 10px",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: selected ? 720 : 560,
    textAlign: "left",
  };
}

function sidebarGoalButton(selected: boolean): CSSProperties {
  return {
    width: "100%",
    minWidth: 0,
    boxSizing: "border-box",
    overflow: "hidden",
    textAlign: "left",
    border: "1px solid transparent",
    background: selected ? "rgba(31, 35, 40, 0.065)" : "transparent",
    borderRadius: 8,
    padding: "8px 10px",
    cursor: "pointer",
    color: C.text,
    boxShadow: "none",
  };
}

function AimHeader(props: {
  title: string;
  description?: string | null;
  status: string;
  milestoneCount: number;
  nextAction: string;
}) {
  const { t } = useI18n();
  return (
    <section style={threadSectionStyle()}>
      <div style={userTurnStyle()}>
        <div style={userBubbleStyle()}>
          {props.title}
        </div>
      </div>
      <div style={assistantTurnStyle()}>
        <div style={assistantMetaStyle()}>
          <span>Aimcub</span>
          <span>{props.status}</span>
          <span>{t(props.milestoneCount === 1 ? "common.milestone_one" : "common.milestone_other", { n: props.milestoneCount })}</span>
        </div>
        {props.description ? <div style={{ color: C.muted, fontSize: 14, lineHeight: 1.6, marginTop: 8 }}>{props.description}</div> : null}
        <div style={{ color: C.text, fontSize: 13, marginTop: 12, lineHeight: 1.45 }}>
          <span style={{ color: C.muted }}>{t("shell.nextAction")} </span>
          {props.nextAction}
        </div>
      </div>
    </section>
  );
}

function SpinnerVerbLine(props: { step: Step | null; detail?: string; compact?: boolean }) {
  const { lang, t } = useI18n();
  const spinner = useSpinnerVerb(props.step);
  if (!spinner) return null;
  const frame = [".", "..", "..."][spinner.tick % 3]!;
  const gap = lang === "zh" ? "" : " ";
  return (
    <div style={spinnerLineStyle(props.compact)}>
      <div style={spinnerFrameStyle()}>{frame}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ color: C.text, fontSize: props.compact ? 12 : 13, lineHeight: 1.35 }}>
          <span style={{ color: C.accent, fontWeight: 700 }}>{t(spinner.item.verbKey)}</span>
          {gap}
          <span>{t(spinner.item.detailKey)}</span>
        </div>
        {props.detail ? (
          <div style={{ color: C.muted, fontSize: 12, lineHeight: 1.4, marginTop: 2, wordBreak: "break-word" }}>
            {props.detail}
          </div>
        ) : (
          <div style={{ color: C.muted, fontSize: 12, lineHeight: 1.4, marginTop: 2 }}>
            {t("spinner.live")}
          </div>
        )}
      </div>
    </div>
  );
}

function spinnerLineStyle(compact?: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: "34px minmax(0, 1fr)",
    gap: 10,
    alignItems: "start",
    background: compact ? "transparent" : "#f6f8fa",
    border: compact ? "none" : `1px solid ${C.border}`,
    borderRadius: 8,
    padding: compact ? "8px 0" : "12px 14px",
    marginTop: compact ? 8 : 14,
  };
}

function spinnerFrameStyle(): CSSProperties {
  return {
    color: C.accent,
    fontFamily: "ui-monospace, monospace",
    fontSize: 13,
    fontWeight: 800,
    letterSpacing: 1,
    textAlign: "center",
    paddingTop: 1,
  };
}

function BusyPlanState(props: { step: Step; title: string; description: string }) {
  const { t } = useI18n();
  const message = props.step === "drafting"
    ? t("status.drafting")
    : props.step === "clarifying"
      ? t("status.clarifying")
      : t("status.refining");
  const active: WorkflowStage = props.step === "refining" ? "refine" : props.step === "clarifying" ? "questions" : "draft";
  const completed = new Set<WorkflowStage>(
    props.step === "drafting"
      ? ["aim"]
      : props.step === "clarifying"
        ? ["aim", "draft"]
        : ["aim", "draft", "questions"],
  );
  return (
    <section style={threadSectionStyle()}>
      <div style={userTurnStyle()}>
        <div style={userBubbleStyle()}>{props.title || t("shell.untitledAim")}</div>
      </div>
      <div style={assistantTurnStyle()}>
        <div style={assistantMetaStyle()}>
          <span>Aimcub</span>
          <span>{message}</span>
        </div>
        <WorkflowStrip active={active} completed={completed} />
        <SpinnerVerbLine step={props.step} />
        {props.description ? <div style={{ color: C.muted, fontSize: 14, lineHeight: 1.55, marginTop: 10 }}>{props.description}</div> : null}
      </div>
    </section>
  );
}

function InspectorRail(props: {
  activeTab: InspectorTab;
  onTab: (tab: InspectorTab) => void;
  events: PlanningTraceEvent[];
  busyStep: BusyStep | null;
  aimIntake: AimIntakeReport | null;
  decompositionStrategy: DecompositionStrategyReport | null;
  contextCandidates: Memory[];
  contextProfile: ContextProfileReport | null;
  contextHealth: ContextHealthRow[];
  contextLearning: ClarifyLearningReport | null;
  contextLineageLearning: ContextLineageLearningReport | null;
  contextDecompositionLearning: DecompositionLearningReport | null;
  planningContext: PlanningContextSelectionReport | null;
  planningTools: PlanningToolIpcTrace | null;
  review: PlanResult["review"] | null;
  planQuality: PlanResult["quality"] | null;
  qualityRetry: PlanResult["qualityRetry"] | null;
  plan: DecompositionOutput | null;
  learning: AimLearningReport | null;
  answerImpact: ClarifyAnswerImpactReport | null;
  captureFulfillment: ContextCaptureFulfillmentReport | null;
  contextLineage: ContextLineageReport | null;
  onAcceptContext: (candidate: Memory, content: string, scope: "aim" | "global") => void;
  onRejectContext: (candidate: Memory) => void;
  onArchiveContext: (id: string) => void;
  onDeprioritizeContext: (id: string) => void;
  showTabs?: boolean;
  sticky: boolean;
  compact?: boolean;
}) {
  const { t } = useI18n();
  if (props.compact) {
    return (
      <aside style={compactTraceSurfaceStyle()}>
        {props.events.length > 0 ? (
          <PlanningProcessPanel events={props.events} busyStep={props.busyStep} embedded />
        ) : (
          <InspectorEmpty title={t("shell.noProcess")} body={t("shell.noProcessBody")} />
        )}
      </aside>
    );
  }
  const tabs: InspectorTab[] = ["process", "context", "quality", "activity"];
  const tabLabels = {
    process: "shell.tab.process",
    context: "shell.tab.context",
    quality: "shell.tab.quality",
    activity: "shell.tab.activity",
  } as const;
  const hasContext = true;
  const hasQuality = Boolean(props.review || props.planQuality || props.decompositionStrategy);
  const hasActivity = Boolean(props.learning || props.answerImpact || props.captureFulfillment || props.contextLineage);
  return (
    <aside style={{ ...railSurface(), position: props.sticky ? "sticky" : "static", top: props.sticky ? 18 : undefined }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
        <h2 style={{ fontSize: 13, fontWeight: 650, margin: 0, color: C.text }}>{t("shell.inspector")}</h2>
        <span style={{ color: C.muted, fontSize: 11 }}>{t("shell.auditLayer")}</span>
      </div>
      {props.showTabs !== false && (
        <div style={{ display: "flex", gap: 4, marginBottom: 14, flexWrap: "wrap" }}>
          {tabs.map((tab) => (
            <button key={tab} onClick={() => props.onTab(tab)} style={inspectorTabButton(props.activeTab === tab)}>
              {t(tabLabels[tab])}
            </button>
          ))}
        </div>
      )}

      {props.activeTab === "process" && (
        props.events.length > 0 ? <PlanningProcessPanel events={props.events} busyStep={props.busyStep} /> : <InspectorEmpty title={t("shell.noProcess")} body={t("shell.noProcessBody")} />
      )}

      {props.activeTab === "context" && (
        hasContext ? (
          <div>
            <InspectorSectionTitle title={t("shell.context.sources")} />
            <ContextSourcesPanel
              contextProfile={props.contextProfile}
              planningTools={props.planningTools}
            />
            <InspectorSectionTitle title={t("shell.context.pending")} />
            <ContextInbox candidates={props.contextCandidates} onAccept={props.onAcceptContext} onReject={props.onRejectContext} />
            <InspectorSectionTitle title={t("shell.context.usedMissing")} />
            <AimIntakePanel report={props.aimIntake} />
            <PlanningContextPanel report={props.planningContext} />
            <InspectorSectionTitle title={t("shell.context.learned")} />
            <ContextProfilePanel report={props.contextProfile} />
            <ContextHealthPanel rows={props.contextHealth} onArchive={props.onArchiveContext} onDeprioritize={props.onDeprioritizeContext} />
            <ContextLearningPanel report={props.contextLearning} />
            <ContextLineageLearningPanel report={props.contextLineageLearning} />
            <DecompositionLearningPanel report={props.contextDecompositionLearning} />
          </div>
        ) : (
          <InspectorEmpty title={t("shell.noContext")} body={t("shell.noContextBody")} />
        )
      )}

      {props.activeTab === "quality" && (
        hasQuality ? (
          <div>
            {props.review && <PlanReviewPanel review={props.review} />}
            {!props.review && props.planQuality && <QualitySnapshot quality={props.planQuality} retry={props.qualityRetry} />}
            <DecompositionStrategyPanel report={props.decompositionStrategy} />
          </div>
        ) : (
          <InspectorEmpty title={t("shell.noQuality")} body={t("shell.noQualityBody")} />
        )
      )}

      {props.activeTab === "activity" && (
        hasActivity ? (
          <div>
            <AimLearningPanel report={props.learning} />
            <ClarifyImpactPanel report={props.answerImpact} plan={props.plan} />
            <ContextCaptureFulfillmentPanel report={props.captureFulfillment} />
            <ContextLineagePanel report={props.contextLineage} />
          </div>
        ) : (
          <InspectorEmpty title={t("shell.noActivity")} body={t("shell.noActivityBody")} />
        )
      )}
    </aside>
  );
}

function QualitySnapshot(props: { quality: NonNullable<PlanResult["quality"]>; retry: PlanResult["qualityRetry"] | null }) {
  const { t } = useI18n();
  const tone = props.quality.grade === "fail" ? C.danger : props.quality.grade === "warn" ? "#8a6517" : "#1a7f4b";
  return (
    <div style={{ ...card(), background: "#fbfaf7" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{t("review.quality")}</div>
        <div style={{ color: tone, fontSize: 13 }}>{props.quality.grade} · {props.quality.score}/100</div>
      </div>
      <div style={{ color: C.muted, fontSize: 12, marginTop: 8 }}>
        {props.retry?.retried ? t("trace.retryYes", { attempts: props.retry.attempts }) : t("trace.retryNo", { attempts: props.retry?.attempts ?? 1 })}
      </div>
    </div>
  );
}

function InspectorSectionTitle(props: { title: string }) {
  return <div style={{ color: C.muted, fontSize: 11, fontWeight: 700, letterSpacing: 0, textTransform: "uppercase", margin: "2px 0 8px" }}>{props.title}</div>;
}

function InspectorEmpty(props: { title: string; body: string }) {
  return (
    <div style={emptyInspectorStyle()}>
      <div style={{ color: C.text, fontWeight: 600, fontSize: 14 }}>{props.title}</div>
      <div style={{ fontSize: 13, lineHeight: 1.5, marginTop: 6 }}>{props.body}</div>
    </div>
  );
}

function ContextSourcesPanel(props: {
  contextProfile: ContextProfileReport | null;
  planningTools: PlanningToolIpcTrace | null;
}) {
  const { t } = useI18n();
  const observations = props.planningTools?.observations ?? [];
  const failures = props.planningTools?.failures ?? [];
  const memoryObservations = observations.filter((observation) =>
    observation.sources.some((source) => source.kind === "memory"),
  ).length;
  const memoryCount = props.contextProfile?.totalActive ?? memoryObservations;
  const localObservations = observations.filter((observation) =>
    observation.sources.some((source) => source.kind === "file" || source.kind === "workspace"),
  ).length;
  const webObservations = observations.filter((observation) =>
    observation.sources.some((source) => source.kind === "web"),
  ).length;
  const webFailures = failures.filter((failure) => failure.toolName === "web.search" || failure.toolName === "web.fetch").length;
  return (
    <div style={{ display: "grid", gap: 8, marginBottom: 14 }}>
      <ContextSourceCard
        title={t("context.source.memory")}
        body={t("context.source.memoryBody", { n: memoryCount })}
        status={memoryCount > 0 ? t("context.source.active") : t("context.source.ready")}
        tone={memoryCount > 0 ? "#1a7f4b" : C.muted}
      />
      <ContextSourceCard
        title={t("context.source.folder")}
        body={localObservations > 0
          ? t("context.source.folderBodyActive", { n: localObservations })
          : t("context.source.folderBody")}
        status={localObservations > 0 ? t("context.source.active") : t("context.source.comingSoon")}
        tone={localObservations > 0 ? "#1a7f4b" : C.muted}
      />
      <ContextSourceCard
        title={t("context.source.connector")}
        body={t("context.source.connectorBody")}
        status={t("context.source.comingSoon")}
        tone={C.muted}
      />
      <ContextSourceCard
        title={t("context.source.web")}
        body={webObservations > 0
          ? t("context.source.webBodyActive", { n: webObservations })
          : webFailures > 0
            ? t("context.source.webBodyBlocked", { n: webFailures })
            : t("context.source.webBody")}
        status={webObservations > 0 ? t("context.source.active") : t("context.source.optional")}
        tone={webObservations > 0 ? "#1a7f4b" : webFailures > 0 ? "#8a6517" : C.muted}
      />
    </div>
  );
}

function ContextSourceCard(props: { title: string; body: string; status: string; tone: string }) {
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, background: C.surface, padding: "10px 11px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
        <div style={{ color: C.text, fontSize: 13, fontWeight: 600 }}>{props.title}</div>
        <div style={{ color: props.tone, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>{props.status}</div>
      </div>
      <div style={{ color: C.muted, fontSize: 12, lineHeight: 1.45, marginTop: 4 }}>{props.body}</div>
    </div>
  );
}

function railSurface(): CSSProperties {
  return {
    background: "transparent",
    borderTop: `1px solid ${C.border}`,
    padding: "12px 0 0",
    boxSizing: "border-box",
    minWidth: 0,
  };
}

function compactTraceSurfaceStyle(): CSSProperties {
  return {
    borderTop: `1px solid ${C.border}`,
    paddingTop: 6,
    color: C.text,
  };
}

function emptyInspectorStyle(): CSSProperties {
  return {
    color: C.muted,
    borderTop: `1px solid ${C.border}`,
    padding: "12px 0 2px",
  };
}

function inspectorTabButton(selected: boolean): CSSProperties {
  return {
    border: "none",
    background: selected ? "rgba(31, 35, 40, 0.08)" : "transparent",
    color: selected ? C.text : C.muted,
    borderRadius: 6,
    padding: "6px 8px",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: selected ? 700 : 560,
  };
}

function processPanelStyle(): CSSProperties {
  return {
    padding: "2px 0 4px",
  };
}

function processEventRowStyle(): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: "30px minmax(0, 1fr) 62px",
    gap: 8,
    alignItems: "start",
    borderTop: `1px solid ${C.border}`,
    padding: "10px 0",
  };
}

function traceStatusMark(status: PlanningTraceStatus): string {
  switch (status) {
    case "done":
      return "OK";
    case "running":
      return "...";
    case "warning":
      return "!";
    case "error":
      return "x";
    case "pending":
      return "-";
  }
}

function traceStatusColor(status: PlanningTraceStatus): string {
  switch (status) {
    case "done":
      return "#1a7f4b";
    case "running":
      return C.accent;
    case "warning":
      return "#8a6517";
    case "error":
      return C.danger;
    case "pending":
      return C.muted;
  }
}

function PlanningProcessPanel(props: { events: PlanningTraceEvent[]; busyStep: BusyStep | null; embedded?: boolean }) {
  const { t } = useI18n();
  if (props.events.length === 0) return null;
  const currentEvent = props.events.find((event) => event.status === "running")
    ?? props.events.find((event) => event.status === "pending")
    ?? null;
  return (
    <section style={processPanelStyle()}>
      {!props.embedded && (
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{t("trace.title")}</div>
          <div style={{ color: C.muted, fontSize: 12 }}>
            {t("trace.count", { n: props.events.filter((event) => event.status === "done").length, total: props.events.length })}
          </div>
        </div>
      )}
      <SpinnerVerbLine step={props.busyStep} detail={currentEvent?.detail} compact />
      <div style={{ display: "grid", gap: 0, marginTop: 8 }}>
        {props.events.map((event) => {
          const tone = traceStatusColor(event.status);
          return (
            <div key={event.id} style={processEventRowStyle()}>
              <div style={{ color: tone, fontFamily: "ui-monospace, monospace", fontSize: 12, fontWeight: 700 }}>
                {traceStatusMark(event.status)}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: C.text, fontSize: 13, fontWeight: 600 }}>{event.title}</div>
                <div style={{ color: C.muted, fontSize: 12, lineHeight: 1.4, marginTop: 2, wordBreak: "break-word" }}>
                  {event.detail}
                </div>
              </div>
              <div style={{ color: C.muted, fontSize: 11, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {event.at}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function DecompositionStrategyPanel(props: { report: DecompositionStrategyReport | null }) {
  const { t } = useI18n();
  const report = props.report;
  if (!report || report.actions.length === 0) return null;
  return (
    <section style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>{t("context.decompositionStrategy")}</h2>
        <span style={{ color: C.muted, fontSize: 12 }}>
          {t("context.decompositionStrategyCounts", { actions: report.actionCount })}
        </span>
      </div>
      <div style={{ ...card(), background: "#f7f9fb" }}>
        <div style={{ display: "grid", gap: 10 }}>
          {report.actions.slice(0, 5).map((action) => (
            <div key={action.focus} style={{ display: "grid", gap: 3 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
                <div style={{ color: C.text, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {decompositionStrategyFocusLabel(action.focus, t)} · {decompositionStrategyPriorityLabel(action.priority, t)}
                </div>
                <div style={{ color: C.muted, fontSize: 12, whiteSpace: "nowrap" }}>
                  {t(action.sourceRows === 1 ? "context.decompositionStrategySource_one" : "context.decompositionStrategySource_other", { n: action.sourceRows })}
                </div>
              </div>
              <div style={{ color: C.muted, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {shortUiText(action.recommendation)}
              </div>
              <div style={{ color: C.muted, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {shortUiText(action.reason)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function QuestionsStep(props: {
  clarify: ClarifyOutput;
  answers: AnswerMap;
  onAnswer: (id: string, patch: Partial<{ label: string | null; other: string }>) => void;
  onRefine: () => void;
  onUseDraft: () => void;
}) {
  const { t } = useI18n();
  const { clarify, answers } = props;
  return (
    <section style={threadSectionStyle()}>
      <div style={assistantTurnStyle()}>
        <div style={assistantMetaStyle()}>
          <span>Aimcub</span>
          <span>{t("trace.clarify")}</span>
        </div>
        <WorkflowStrip active="questions" completed={new Set<WorkflowStage>(["aim", "draft"])} />
        <div style={{ color: C.muted, fontSize: 14, lineHeight: 1.55, marginTop: 8 }}>{t("q.intro")}</div>

        {clarify.questions.length === 0 && <div style={clarifyEmptyStyle()}>{t("q.none")}</div>}

        <div style={clarifyListStyle()}>
          {clarify.questions.map((q, i) => {
            const sourceLabel = q.source_dimension ? dimensionLabel(q.source_dimension, t) : null;
            return (
              <div key={q.id} style={clarifyQuestionRowStyle()}>
                <div style={clarifyQuestionHeaderStyle()}>
                  <span style={clarifyQuestionNumberStyle()}>{i + 1}</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ color: C.text, fontSize: 15, fontWeight: 600, lineHeight: 1.45 }}>{q.question}</div>
                    {sourceLabel && <div style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>{sourceLabel}</div>}
                  </div>
                </div>
                <div style={clarifyChoicesStyle()}>
                  {q.options.map((opt) => {
                    const selected = answers[q.id]?.label === opt.label;
                    return (
                      <button
                        key={opt.label}
                        onClick={() => props.onAnswer(q.id, { label: selected ? null : opt.label })}
                        style={clarifyChoiceButtonStyle(selected)}
                      >
                        <span style={{ fontWeight: 600 }}>{opt.label}</span>
                        {opt.tradeoff && <span style={{ color: C.muted, fontSize: 12 }}>{opt.tradeoff}</span>}
                      </button>
                    );
                  })}
                </div>
                <input
                  value={answers[q.id]?.other ?? ""}
                  onChange={(e) => props.onAnswer(q.id, { other: e.target.value })}
                  placeholder={t("q.other")}
                  style={clarifyFreeformInputStyle()}
                />
                {(q.why_high_impact || (q.why_asked && q.why_asked.length > 0) || q.capture) && (
                  <details style={clarifyDetailsStyle()}>
                    <summary style={{ cursor: "pointer", color: C.muted, fontWeight: 600 }}>{t("q.details")}</summary>
                    {q.why_high_impact && <div style={{ marginTop: 6 }}>{q.why_high_impact}</div>}
                    {q.why_asked && q.why_asked.length > 0 && (
                      <div style={{ marginTop: 4 }}>
                        {t("q.askedBecause")} {q.why_asked.map((why) => clarifyWhyLabel(why, t)).join(" · ")}
                      </div>
                    )}
                    {q.capture && (
                      <div style={{ marginTop: 4 }}>
                        {captureContractLabel(q.capture, t)}
                      </div>
                    )}
                  </details>
                )}
              </div>
            );
          })}
        </div>

        {clarify.assumptions.length > 0 && (
          <details style={clarifyAssumptionsStyle()}>
            <summary style={{ cursor: "pointer", color: C.muted, fontWeight: 600 }}>{t("q.assuming")}</summary>
            {clarify.assumptions.map((a, i) => (
              <div key={i} style={{ marginTop: 5 }}>
                {a.statement} {a.default_value && <span style={{ color: C.muted }}>({a.default_value})</span>}
              </div>
            ))}
          </details>
        )}

        <div style={clarifyActionRowStyle()}>
          <button onClick={props.onRefine} style={{ ...primaryButton(false), marginTop: 0 }}>{t("q.refine")}</button>
          <button onClick={props.onUseDraft} style={{ ...secondaryButton(), marginTop: 0 }}>{t("q.useDraft")}</button>
        </div>
      </div>
    </section>
  );
}

/** The milestone list — shared by the fresh-plan view and the saved-goal view. */
function MilestoneCards(props: { plan: DecompositionOutput }) {
  const { t } = useI18n();
  const [openKey, setOpenKey] = useState<string | null>(null);
  return (
    <div style={milestoneListStyle()}>
      {props.plan.nodes.map((n, i) => {
        const contract = n.decomposition_contract;
        const open = openKey === n.key;
        const completionStandard = contract?.definition_of_done || n.description || n.title;
        return (
          <div key={n.key} style={milestoneRowStyle(open)}>
            <div style={{ display: "grid", gridTemplateColumns: "26px minmax(0, 1fr) auto", gap: 10, alignItems: "start" }}>
              <div style={milestoneIndexStyle()}>{i + 1}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis" }}>{n.title}</div>
                <div style={{ fontSize: 13, color: C.muted, marginTop: 5, lineHeight: 1.45 }}>
                  {shortUiText(completionStandard)}
                </div>
              </div>
              <button onClick={() => setOpenKey(open ? null : n.key)} style={inlineDetailButtonStyle()}>
                {t(open ? "plan.hideDetails" : "plan.details")}
              </button>
            </div>
            {open && n.description && <div style={{ color: C.muted, fontSize: 13, marginTop: 10, lineHeight: 1.5, paddingLeft: 36 }}>{n.description}</div>}
            {open && contract && (
              <div style={{ marginTop: 10, marginLeft: 36, paddingTop: 10, borderTop: `1px solid ${C.border}`, color: C.muted, fontSize: 12 }}>
                <div style={{ fontWeight: 600, color: C.text, marginBottom: 4 }}>
                  {t("plan.contract")} · {decompositionOwnerLabel(contract.likely_owner, t)}
                </div>
                <div>{t("plan.contractDone")} {shortUiText(contract.definition_of_done)}</div>
                <div>{t("plan.contractEvidence")} {contract.required_evidence.map(shortUiText).join(" · ")}</div>
                <div>{t("plan.contractEval")} {shortUiText(contract.eval_signal)}</div>
                {contract.context_gaps.slice(0, 2).map((gap, index) => (
                  <div key={`${gap.category}-${index}`}>
                    {t("plan.contractGap")} {contextCategoryLabel(gap.category, t)} · {shortUiText(gap.question)}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function PlanView(props: {
  plan: DecompositionOutput;
  title: string;
  description?: string;
  review?: PlanResult["review"] | null;
  savedAt: string | null;
  contextCandidateCount: number;
  onSave: () => void;
  onRefineWithReview: (prompt: string) => void;
  onReset: () => void;
  onHome: () => void;
}) {
  const { t } = useI18n();
  const { plan, savedAt } = props;
  const n = plan.nodes.length;
  const reviewPrompt = props.review?.actions.find((action) => action.refinePrompt)?.refinePrompt;
  const nextNode = plan.nodes[0];
  return (
    <section>
      <AimHeader
        title={props.title}
        description={props.description || plan.goal_summary}
        status={savedAt ? t("shell.savedAim") : t("shell.currentAim")}
        milestoneCount={n}
        nextAction={nextNode?.title ?? t("shell.noNextAction")}
      />
      <div style={threadSectionStyle()}>
        <WorkflowStrip
          active="save"
          completed={new Set<WorkflowStage>(savedAt ? ["aim", "draft", "questions", "refine", "save"] : ["aim", "draft", "questions", "refine"])}
        />
      </div>
      <MilestoneCards plan={plan} />

      <div style={planActionRowStyle()}>
        {savedAt ? (
          <>
            <span style={{ color: "#1a7f4b", fontSize: 14 }}>{t("plan.saved")}</span>
            {props.contextCandidateCount > 0 && (
              <span style={{ color: C.muted, fontSize: 12 }}>
                {t(props.contextCandidateCount === 1 ? "plan.contextCandidates_one" : "plan.contextCandidates_other", {
                  n: props.contextCandidateCount,
                })}
              </span>
            )}
            <button onClick={props.onHome} style={{ ...secondaryButton(), marginTop: 0 }}>{t("plan.backToAims")}</button>
          </>
        ) : (
          <>
            <button onClick={props.onSave} style={{ ...primaryButton(false), marginTop: 0 }}>{t("plan.save")}</button>
            {reviewPrompt && <button onClick={() => props.onRefineWithReview(reviewPrompt)} style={{ ...secondaryButton(), marginTop: 0 }}>{t("plan.refineReview")}</button>}
            <button onClick={props.onReset} style={{ ...secondaryButton(), marginTop: 0 }}>{t("plan.startOver")}</button>
          </>
        )}
      </div>
    </section>
  );
}

function SavedGoalView(props: {
  goal: Goal;
  onBack: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const { goal } = props;
  const plan = planOf(goal);
  const n = plan?.nodes.length ?? 0;
  const nextNode = plan?.nodes[0];
  return (
    <section>
      {plan && plan.nodes.length > 0 ? (
        <>
          <AimHeader
            title={goal.title}
            description={goal.description}
            status={t("shell.savedAim")}
            milestoneCount={n}
            nextAction={nextNode?.title ?? t("shell.noNextAction")}
          />
          <div style={threadSectionStyle()}>
            <WorkflowStrip active="save" completed={new Set<WorkflowStage>(["aim", "draft", "questions", "refine", "save"])} />
          </div>
          <MilestoneCards plan={plan} />
        </>
      ) : (
        <>
          <AimHeader
            title={goal.title}
            description={goal.description}
            status={t("shell.savedAim")}
            milestoneCount={0}
            nextAction={t("shell.noNextAction")}
          />
          <div style={threadSectionStyle()}>
            <WorkflowStrip active="save" completed={new Set<WorkflowStage>(["aim", "save"])} />
          </div>
          <Notice tone="info">{t("saved.noPlan")}</Notice>
        </>
      )}

      <div style={planActionRowStyle()}>
        <button onClick={props.onBack} style={{ ...secondaryButton(), marginTop: 0 }}>{t("plan.backToAims")}</button>
        <button onClick={props.onDelete} style={{ ...secondaryButton(), marginTop: 0, color: C.danger, borderColor: "#e7c9c9" }}>{t("common.delete")}</button>
      </div>
    </section>
  );
}

function AimIntakePanel(props: { report?: AimIntakeReport | null }) {
  const { t } = useI18n();
  const report = props.report;
  if (!report) return null;
  const tone = report.readiness === "needs_plan_refinement"
    ? "#8a6517"
    : report.readiness === "needs_targeted_context"
      ? C.accent
      : "#1a7f4b";
  const selected = report.coverage.selectedByCategory.slice(0, 3);
  const questions = report.questions.slice(0, 3);
  return (
    <div style={{ ...card(), background: "#f7fbf8" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{t("intake.title")}</div>
        <div style={{ color: tone, fontSize: 13 }}>
          {intakeReadinessLabel(report.readiness, t)} · {report.score}/100
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
        <div style={{ color: C.muted, fontSize: 12 }}>
          {t("intake.profile", { score: report.coverage.profile.coverageScore })}
        </div>
        <div style={{ color: C.muted, fontSize: 12, textAlign: "right" }}>
          {t("intake.selected", { n: report.coverage.selectedTotal })}
        </div>
      </div>
      {selected.length > 0 && (
        <div style={{ color: C.muted, fontSize: 12, marginTop: 6 }}>
          {selected.map((row) => `${contextCategoryLabel(row.category, t)} ${row.count}`).join(" · ")}
        </div>
      )}
      {report.coverage.missingCoreCategories.length > 0 && (
        <div style={{ color: C.muted, fontSize: 12, marginTop: 6 }}>
          {t("intake.missingCore")} {report.coverage.missingCoreCategories.map((category) => contextCategoryLabel(category, t)).join(", ")}
        </div>
      )}
      {questions.length > 0 && (
        <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
          {questions.map((question) => (
            <div key={question.id} style={{ fontSize: 13 }}>
              <div style={{ color: tone, fontSize: 12 }}>
                {t("intake.question")} · {contextCategoryLabel(question.category, t)} · {intakeQuestionSourceLabel(question.source, t)}
              </div>
              <div style={{ marginTop: 2 }}>{question.prompt}</div>
              {question.capture && (
                <div style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>
                  {captureContractLabel(question.capture, t)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {report.nextActions.length > 0 && (
        <div style={{ color: C.muted, fontSize: 12, marginTop: 10 }}>
          {t("intake.action")} {report.nextActions[0]}
        </div>
      )}
    </div>
  );
}

function AimLearningPanel(props: { report?: AimLearningReport | null }) {
  const { t } = useI18n();
  const report = props.report;
  if (!report || (report.rows.length === 0 && report.nextActions.length === 0)) return null;
  const rows = [...report.rows].sort(aimLearningRowOrder).slice(0, 4);
  return (
    <div style={{ ...card(), background: "#f7fbf8" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{t("aimLearning.title")}</div>
        <div style={{ color: C.muted, fontSize: 12 }}>
          {t("aimLearning.counts", {
            learned: report.learnedCount,
            pending: report.pendingContextCount,
            gaps: report.gapCount,
          })}
        </div>
      </div>

      {report.intake && (
        <div style={{ color: C.muted, fontSize: 12, marginTop: 8 }}>
          {t("aimLearning.intake", {
            readiness: intakeReadinessLabel(report.intake.readiness, t),
            score: report.intake.score,
            questions: report.intake.questionCount,
          })}
        </div>
      )}

      {report.clarify && (
        <div style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>
          {t("aimLearning.clarify", {
            answered: report.clarify.answeredCount,
            impacted: report.clarify.impactedCount,
            changed: report.clarify.changedNodeCount,
          })}
        </div>
      )}

      {rows.length > 0 && (
        <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
          {rows.map((row, i) => (
            <div key={`${row.status}-${row.source}-${row.category}-${i}`} style={{ display: "grid", gridTemplateColumns: "18px 1fr", gap: 8 }}>
              <div style={{ color: aimLearningStatusColor(row.status), fontFamily: "ui-monospace, monospace", fontSize: 13 }}>
                {aimLearningStatusMark(row.status)}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: C.muted, fontSize: 12 }}>
                  {contextCategoryLabel(row.category, t)} · {aimLearningSourceLabel(row.source, t)}
                </div>
                <div style={{ fontSize: 13, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {shortUiText(row.content)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {report.nextActions.length > 0 && (
        <div style={{ color: C.muted, fontSize: 12, marginTop: 10 }}>
          {t("aimLearning.next")} {report.nextActions[0]}
        </div>
      )}
    </div>
  );
}

function ClarifyImpactPanel(props: { report?: ClarifyAnswerImpactReport | null; plan?: DecompositionOutput | null }) {
  const { t } = useI18n();
  const report = props.report;
  if (!report || report.answered_count === 0) return null;
  const titleByKey = new Map((props.plan?.nodes ?? []).map((node) => [node.key, node.title]));
  const improved = report.quality_delta.filter((row) => typeof row.delta === "number" && row.delta > 0);
  return (
    <div style={{ ...card(), background: "#fbfaf7" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{t("impact.title")}</div>
        <div style={{ color: C.muted, fontSize: 12 }}>
          {t("impact.counts", {
            answered: report.answered_count,
            impacted: report.impacted_count,
            changed: report.changed_node_count,
          })}
        </div>
      </div>

      {improved.length > 0 && (
        <div style={{ color: C.muted, fontSize: 12, marginTop: 8 }}>
          {t("impact.eval")} {improved.map((row) => `${dimensionLabel(row.dimension, t)} +${row.delta}`).join(" · ")}
        </div>
      )}

      <div style={{ display: "grid", gap: 9, marginTop: 10 }}>
        {report.rows.slice(0, 4).map((row) => {
          const affected = row.affected_node_keys
            .map((key) => titleByKey.get(key) ?? key)
            .filter((value) => value.trim().length > 0);
          const source = row.source_dimension ? ` · ${dimensionLabel(row.source_dimension, t)}` : "";
          return (
            <div key={`${row.question_id}-${row.answer}`} style={{ display: "grid", gridTemplateColumns: "18px 1fr", gap: 8 }}>
              <div style={{ color: row.affected_node_keys.length > 0 ? "#1a7f4b" : C.accent, fontFamily: "ui-monospace, monospace", fontSize: 13 }}>
                {row.affected_node_keys.length > 0 ? "+" : "?"}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: C.muted, fontSize: 12 }}>
                  {contextCategoryLabel(row.memory_category, t)}{source}
                </div>
                <div style={{ fontSize: 13, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {shortUiText(row.answer)}
                </div>
                {affected.length > 0 && (
                  <div style={{ color: C.muted, fontSize: 12, marginTop: 3 }}>
                    {t("impact.changed")} {affected.slice(0, 3).join(", ")}
                  </div>
                )}
                {row.signals.length > 0 && (
                  <div style={{ color: C.muted, fontSize: 12, marginTop: 3 }}>
                    {t("impact.signals")} {row.signals.slice(0, 3).map((signal) => impactSignalLabel(signal, t)).join(", ")}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ContextCaptureFulfillmentPanel(props: { report?: ContextCaptureFulfillmentReport | null }) {
  const { t } = useI18n();
  const report = props.report;
  if (!report || report.total === 0) return null;
  return (
    <div style={{ ...card(), background: "#fbfaf7" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{t("fulfillment.title")}</div>
        <div style={{ color: C.muted, fontSize: 12 }}>
          {t("fulfillment.counts", {
            answered: report.answeredCount,
            total: report.total,
            captured: report.memoryCapturedCount,
            impacted: report.impactedCount,
          })}
        </div>
      </div>
      <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
        {report.rows.slice(0, 5).map((row) => (
          <div key={row.questionId} style={{ display: "grid", gridTemplateColumns: "18px 1fr", gap: 8 }}>
            <div style={{ color: fulfillmentStatusColor(row.status), fontFamily: "ui-monospace, monospace", fontSize: 13 }}>
              {fulfillmentStatusMark(row.status)}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ color: C.muted, fontSize: 12 }}>
                {fulfillmentStatusLabel(row.status, t)} · {captureContractLabel(row.capture, t)}
              </div>
              <div style={{ fontSize: 13, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {shortUiText(row.answer ?? row.question)}
              </div>
              {row.affectedNodeKeys.length > 0 && (
                <div style={{ color: C.muted, fontSize: 12, marginTop: 3 }}>
                  {t("fulfillment.impacted")} {row.affectedNodeKeys.slice(0, 4).join(", ")}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ContextLineagePanel(props: { report?: ContextLineageReport | null }) {
  const { t } = useI18n();
  const report = props.report;
  if (!report || report.total === 0) return null;
  return (
    <div style={{ ...card(), background: "#f7fbfb" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{t("lineage.title")}</div>
        <div style={{ color: C.muted, fontSize: 12 }}>
          {t("lineage.counts", {
            total: report.total,
            captured: report.memoryCapturedCount,
            impacted: report.impactedCount,
            pending: report.pendingContextCount,
          })}
        </div>
      </div>
      <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
        {report.rows.slice(0, 4).map((row) => {
          const from = row.originNode
            ? `${row.originNode.key} · ${row.originNode.title}`
            : row.source !== "unknown"
              ? row.source.replace("_", "-")
              : "";
          const affected = row.affectedNodes.map((node) => node.title || node.key).filter(Boolean);
          return (
            <div key={row.questionId} style={{ display: "grid", gridTemplateColumns: "18px 1fr", gap: 8 }}>
              <div style={{ color: fulfillmentStatusColor(row.captureStatus), fontFamily: "ui-monospace, monospace", fontSize: 13 }}>
                {fulfillmentStatusMark(row.captureStatus)}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: C.muted, fontSize: 12 }}>
                  {fulfillmentStatusLabel(row.captureStatus, t)} · {contextCategoryLabel(row.category, t)} · {capturePurposeLabel(row.capturePurpose, t)} · {dimensionLabel(row.improvesDimension, t)}
                </div>
                {from && (
                  <div style={{ color: C.muted, fontSize: 12, marginTop: 3 }}>
                    {t("lineage.from")} {shortUiText(from)}
                  </div>
                )}
                <div style={{ fontSize: 13, marginTop: 3 }}>
                  {t("lineage.question")} {shortUiText(row.question)}
                </div>
                {row.answer && (
                  <div style={{ color: C.muted, fontSize: 12, marginTop: 3 }}>
                    {t("lineage.answer")} {shortUiText(row.answer)}
                  </div>
                )}
                {row.memoryContent && (
                  <div style={{ color: C.muted, fontSize: 12, marginTop: 3 }}>
                    {t("lineage.memory")} {shortUiText(row.memoryContent)}
                  </div>
                )}
                {affected.length > 0 && (
                  <div style={{ color: C.muted, fontSize: 12, marginTop: 3 }}>
                    {t("lineage.affects")} {affected.slice(0, 3).join(", ")}
                  </div>
                )}
                {row.pendingContext.length > 0 && (
                  <div style={{ color: C.muted, fontSize: 12, marginTop: 3 }}>
                    {t("lineage.pending")} {shortUiText(row.pendingContext[0]!.content)}
                  </div>
                )}
                <div style={{ color: C.muted, fontSize: 12, marginTop: 3 }}>
                  {t("lineage.next")} {row.nextAction}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PlanReviewPanel(props: { review: NonNullable<PlanResult["review"]> }) {
  const { t } = useI18n();
  const { review } = props;
  const tone = review.quality.grade === "fail" ? C.danger : review.quality.grade === "warn" ? "#8a6517" : "#1a7f4b";
  const dimensions = review.quality.dimensions ?? [];
  return (
    <div style={{ ...card(), background: "#fbfaf7" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{t("review.quality")}</div>
        <div style={{ color: tone, fontSize: 13 }}>{review.quality.grade} · {review.quality.score}/100</div>
      </div>
      {dimensions.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ color: C.muted, fontSize: 12, fontWeight: 600 }}>{t("review.scorecard")}</div>
          <div style={{ display: "grid", gap: 6, marginTop: 7 }}>
            {dimensions.map((dimension) => (
              <ScorecardDimensionRow key={dimension.dimension} dimension={dimension} />
            ))}
          </div>
        </div>
      )}
      <div style={{ color: C.muted, fontSize: 13, marginTop: 8 }}>
        {t("review.context")}: {t("review.contextCounts", {
          applied: review.context.applied.length,
          unapplied: review.context.unapplied.length,
        })}
      </div>
      <div style={{ color: C.muted, fontSize: 12, marginTop: 8 }}>
        {review.guidance.length > 0
          ? t(review.guidance.length === 1 ? "review.notes_one" : "review.notes_other", { n: review.guidance.length })
          : t("review.noGuidance")}
      </div>
      {review.actions.length > 0 && (
        <div style={{ color: C.text, fontSize: 13, marginTop: 8 }}>
          {t(review.actions.length === 1 ? "review.actions_one" : "review.actions_other", { n: review.actions.length })}
          <div style={{ color: tone, fontSize: 12, marginTop: 3 }}>{actionLabel(review.actions[0]!.code, t)}</div>
        </div>
      )}
    </div>
  );
}

function ScorecardDimensionRow(props: { dimension: PlanQualityDimensionReport }) {
  const { t } = useI18n();
  const { dimension } = props;
  const tone = qualityTone(dimension.grade);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "104px minmax(80px, 1fr) 48px", gap: 8, alignItems: "center" }}>
      <div style={{ color: C.text, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {dimensionLabel(dimension.dimension, t)}
      </div>
      <div style={{ height: 6, background: "#ede9df", borderRadius: 999, overflow: "hidden" }}>
        <div style={{ width: `${dimension.score}%`, height: "100%", background: tone }} />
      </div>
      <div style={{ color: tone, fontSize: 12, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
        {dimension.score}
      </div>
    </div>
  );
}

function PlanningContextPanel(props: { report?: PlanningContextSelectionReport | null }) {
  const { t } = useI18n();
  const report = props.report;
  if (!report || report.total === 0) return null;
  const selected = report.selected.slice(0, 3);
  const ignored = report.ignored.filter((row) => row.reason !== "empty_content").slice(0, 2);
  return (
    <div style={{ ...card(), background: "#f7fbf8" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{t("context.trace")}</div>
        <div style={{ color: C.muted, fontSize: 12 }}>
          {t("context.traceCounts", {
            selected: report.selected.length,
            ignored: report.ignored.length,
            limit: report.limit,
          })}
        </div>
      </div>
      {selected.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ color: C.muted, fontSize: 12, marginBottom: 6 }}>{t("context.selected")}</div>
          {selected.map((row, i) => <PlanningContextRow key={`selected-${i}`} mark="+" row={row} />)}
        </div>
      )}
      {ignored.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ color: C.muted, fontSize: 12, marginBottom: 6 }}>{t("context.ignored")}</div>
          {ignored.map((row, i) => <PlanningContextRow key={`ignored-${i}`} mark="-" row={row} />)}
        </div>
      )}
    </div>
  );
}

function PlanningContextRow(props: {
  mark: "+" | "-";
  row: PlanningContextSelectionReport["selected"][number];
}) {
  const row = props.row;
  const confidence = typeof row.confidence === "number" ? `${Math.round(row.confidence * 100)}%` : "";
  const matches = row.matchedTokens.length > 0 ? `matches: ${row.matchedTokens.slice(0, 4).join(", ")}` : "";
  const meta = [row.category, row.scope, `score ${Math.round(row.score)}`, confidence, row.reason, matches]
    .filter(Boolean)
    .join(" · ");
  return (
    <div style={{ display: "grid", gridTemplateColumns: "18px 1fr", gap: 8, fontSize: 13, marginTop: 6 }}>
      <div style={{ color: props.mark === "+" ? "#1a7f4b" : C.muted, fontFamily: "ui-monospace, monospace" }}>
        {props.mark}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.content}</div>
        <div style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>{meta}</div>
      </div>
    </div>
  );
}
