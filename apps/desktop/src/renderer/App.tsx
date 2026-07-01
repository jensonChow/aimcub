import { useEffect, useMemo, useState } from "react";

import type { DecompositionOutput, Goal, Memory } from "@core/types";
import { reviewAimLearning, reviewContextLineage } from "@core/domain";
import type { AimIntakeReport, AimLearningReport, ContextCaptureFulfillmentReport, ContextHealthRow, ContextLineageLearningReport, ContextLineageReport, ContextProfileReport, DecompositionLearningReport, DecompositionStrategyReport, PlanQualityDimensionReport } from "@core/domain";
import type { ClarifyOutput, ClarifyAnswer, ClarifyAnswerImpactReport, ClarifyLearningReport, PlanningContextSelectionReport } from "@core/llm";
import type { PlanResult, ProviderStatus } from "../shared/ipc";

import { summarizeRule } from "./summarize";
import { HomeView } from "./HomeView";
import { I18nProvider, useI18n } from "./i18n";
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
  providerLabel,
  qualityTone,
  reviewOf,
  shortUiText,
} from "./labels";
import {
  C,
  card,
  chipButton,
  inputStyle,
  labelStyle,
  linkButton,
  optionButton,
  primaryButton,
  secondaryButton,
} from "./styles";

type Step = "home" | "aim" | "drafting" | "clarifying" | "questions" | "refining" | "plan";

type AnswerMap = Record<string, { label: string | null; other: string }>;

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
    clearWizard();
    setStep("aim");
  }

  function openGoal(g: Goal) {
    setError(null);
    setViewing(g);
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
      setError(e instanceof Error ? e.message : String(e));
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

  async function startDraft() {
    if (!title.trim()) return;
    if (!configured) {
      setShowSettings(true);
      return;
    }
    setError(null);
    setStep("drafting");
    try {
      const d = await withUiTimeout(
        window.aimcub.draft({ title: title.trim(), description: description.trim() || undefined }),
        DRAFT_UI_TIMEOUT_MS,
        t("err.draftTimeout", { seconds: Math.round(DRAFT_UI_TIMEOUT_MS / 1000) }),
      );
      setAimIntake(d.intake ?? null);
      if (!d.ok || !d.output) throw new Error(d.errors.join("; ") || t("err.draft"));
      setDraft(d.output);
      setPlanQuality(d.quality ?? null);
      setPlanReview(d.review ?? null);
      setPlanQualityRetry(d.qualityRetry ?? null);
      setPlanningContext(d.planningContext ?? null);
      setStep("clarifying");
      try {
        const c = await withUiTimeout(
          window.aimcub.clarify({
            title: title.trim(),
            description: description.trim() || undefined,
            draft: d.output,
          }),
          CLARIFY_UI_TIMEOUT_MS,
          t("err.clarifyTimeout", { seconds: Math.round(CLARIFY_UI_TIMEOUT_MS / 1000) }),
        );
        // Clarify is best-effort: if the model returns nothing usable, proceed with the draft
        // and an empty question set rather than blocking — the draft is already valid.
        setClarifyOut(c.output ?? { questions: [], assumptions: [] });
        if (!c.ok) setError(c.errors.join("; ") || t("err.clarify"));
      } catch (e) {
        setClarifyOut({ questions: [], assumptions: [] });
        setError(e instanceof Error ? e.message : String(e));
      }
      setStep("questions");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep("aim");
    }
  }

  async function refine(useDraftAsIs: boolean, reviewPrompt?: string) {
    const sourcePlan = finalPlan ?? draft;
    if (!sourcePlan) return;
    setError(null);
    if (useDraftAsIs) {
      setFinalPlan(sourcePlan);
      setStep("plan");
      return;
    }
    setStep("refining");
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
        setError(r.errors.join("; ") || t("err.refine"));
        setStep("questions");
        return;
      }
      setFinalPlan(r.output);
      setPlanQuality(r.quality ?? null);
      setPlanReview(r.review ?? null);
      setPlanQualityRetry(r.qualityRetry ?? null);
      setPlanningContext(r.planningContext ?? null);
      setAimIntake(r.intake ?? null);
      setStep("plan");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep("questions");
    }
  }

  async function save() {
    if (!finalPlan) return;
    setError(null);
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

  return (
    <div style={{ fontFamily: "system-ui, -apple-system, sans-serif", color: C.text, background: C.page, minHeight: "100vh" }}>
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "28px 24px 64px" }}>
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0, cursor: "pointer" }} onClick={goHome} title="Home">
            Aimcub
          </h1>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <LangToggle />
            <button onClick={() => setShowSettings((v) => !v)} style={chipButton()}>
              {provider?.configured ? providerLabel(provider, t) : t("provider.setup")}
            </button>
          </div>
        </header>

        {showSettings && (
          <ProviderForm
            status={provider}
            onSaved={(s) => {
              setProvider(s);
              if (s.configured) setShowSettings(false);
            }}
            onClose={() => setShowSettings(false)}
          />
        )}

        {error && <Notice tone="error">{error}</Notice>}

        {step === "home" && (
          <HomeView
            goals={goals}
            contextCandidates={contextCandidates}
            contextProfile={contextProfile}
            contextHealth={contextHealth}
            contextLearning={contextLearning}
            contextLineageLearning={contextLineageLearning}
            contextDecompositionLearning={contextDecompositionLearning}
            onNew={startNew}
            onOpen={openGoal}
            onDelete={removeGoal}
            onAcceptContext={acceptContextCandidate}
            onRejectContext={rejectContextCandidate}
            onArchiveContext={archiveContextMemory}
            onDeprioritizeContext={deprioritizeContextMemory}
          />
        )}

        {step === "aim" && (
          <>
            <AimForm
              title={title}
              description={description}
              disabled={!configured}
              onTitle={setTitle}
              onDescription={setDescription}
              onSubmit={startDraft}
              onCancel={goHome}
            />
            <AimIntakePanel report={aimIntake} />
            <DecompositionStrategyPanel report={decompositionStrategy} />
          </>
        )}

        {(step === "drafting" || step === "clarifying" || step === "refining") && (
          <Notice tone="info">
            {step === "drafting" ? t("status.drafting") : step === "clarifying" ? t("status.clarifying") : t("status.refining")}
          </Notice>
        )}

        {step === "questions" && clarifyOut && (
          <QuestionsStep
            clarify={clarifyOut}
            intake={aimIntake}
            answers={answers}
            onAnswer={(id, patch) => setAnswers((m) => ({ ...m, [id]: { label: null, other: "", ...m[id], ...patch } }))}
            onRefine={() => refine(false)}
            onUseDraft={() => refine(true)}
          />
        )}

        {step === "plan" && viewing && (
          <SavedGoalView
            goal={viewing}
            contextCandidates={contextCandidates}
            contextHistory={contextHistory}
            onBack={goHome}
            onDelete={() => removeGoal(viewing)}
          />
        )}

        {step === "plan" && !viewing && finalPlan && (
          <PlanView
            plan={finalPlan}
            review={planReview}
            intake={savedGoal ? aimIntakeOf(savedGoal) ?? aimIntake : aimIntake}
            learning={savedGoal
              ? reviewAimLearning({
                  goal: savedGoal,
                  pendingContext: pendingContextForGoal(savedGoal, savedContextCandidates),
                  contextOutcomes: contextHistory,
                })
              : null}
            answerImpact={savedGoal ? clarifyImpactOf(savedGoal) : null}
            captureFulfillment={savedGoal ? contextCaptureFulfillmentOf(savedGoal) : null}
            contextLineage={savedGoal
              ? reviewContextLineage({
                  goal: savedGoal,
                  pendingContext: pendingContextForGoal(savedGoal, savedContextCandidates),
                  contextOutcomes: contextHistory,
                })
              : null}
            planningContext={savedGoal ? planningContextOf(savedGoal) ?? planningContext : planningContext}
            savedAt={savedAt}
            contextCandidateCount={savedContextCandidateCount}
            onSave={save}
            onRefineWithReview={(prompt) => refine(false, prompt)}
            onReset={startNew}
            onHome={goHome}
          />
        )}
      </div>
    </div>
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

function AimForm(props: {
  title: string;
  description: string;
  disabled: boolean;
  onTitle: (v: string) => void;
  onDescription: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  return (
    <section style={card()}>
      <label style={labelStyle()}>{t("aim.titleLabel")}</label>
      <input
        autoFocus
        value={props.title}
        onChange={(e) => props.onTitle(e.target.value)}
        placeholder={t("aim.titlePlaceholder")}
        style={inputStyle()}
        onKeyDown={(e) => { if (e.key === "Enter" && props.title.trim()) props.onSubmit(); }}
      />
      <label style={{ ...labelStyle(), marginTop: 14 }}>{t("aim.descLabel")}</label>
      <textarea
        value={props.description}
        onChange={(e) => props.onDescription(e.target.value)}
        placeholder={t("aim.descPlaceholder")}
        rows={3}
        style={{ ...inputStyle(), resize: "vertical" }}
      />
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button onClick={props.onSubmit} disabled={!props.title.trim()} style={primaryButton(!props.title.trim())}>
          {t("aim.draft")}
        </button>
        <button onClick={props.onCancel} style={secondaryButton()}>{t("common.cancel")}</button>
      </div>
      {props.disabled && <div style={{ fontSize: 12, color: C.muted, marginTop: 10 }}>{t("aim.needProvider")}</div>}
    </section>
  );
}

function QuestionsStep(props: {
  clarify: ClarifyOutput;
  intake?: AimIntakeReport | null;
  answers: AnswerMap;
  onAnswer: (id: string, patch: Partial<{ label: string | null; other: string }>) => void;
  onRefine: () => void;
  onUseDraft: () => void;
}) {
  const { t } = useI18n();
  const { clarify, answers } = props;
  return (
    <section>
      <AimIntakePanel report={props.intake} />
      <p style={{ color: C.muted, fontSize: 14, margin: "4px 0 16px" }}>{t("q.intro")}</p>

      {clarify.questions.length === 0 && <Notice tone="info">{t("q.none")}</Notice>}

      {clarify.questions.map((q) => {
        const sourceLabel = q.source_dimension ? dimensionLabel(q.source_dimension, t) : null;
        return (
          <div key={q.id} style={card()}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <div style={{ fontWeight: 500, fontSize: 15 }}>{q.question}</div>
              {sourceLabel && (
                <span
                  style={{
                    border: `1px solid ${C.border}`,
                    borderRadius: 999,
                    color: C.muted,
                    fontSize: 11,
                    padding: "2px 7px",
                    whiteSpace: "nowrap",
                  }}
                >
                  {sourceLabel}
                </span>
              )}
            </div>
            {q.why_high_impact && <div style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>{q.why_high_impact}</div>}
            {q.why_asked && q.why_asked.length > 0 && (
              <div style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>
                {t("q.askedBecause")} {q.why_asked.map((why) => clarifyWhyLabel(why, t)).join(" · ")}
              </div>
            )}
            {q.capture && (
              <div style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>
                {captureContractLabel(q.capture, t)}
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
              {q.options.map((opt) => {
                const selected = answers[q.id]?.label === opt.label;
                return (
                  <button
                    key={opt.label}
                    onClick={() => props.onAnswer(q.id, { label: selected ? null : opt.label })}
                    style={optionButton(selected)}
                  >
                    <div style={{ fontWeight: 500 }}>{opt.label}</div>
                    {opt.tradeoff && <div style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>{opt.tradeoff}</div>}
                  </button>
                );
              })}
            </div>
            <input
              value={answers[q.id]?.other ?? ""}
              onChange={(e) => props.onAnswer(q.id, { other: e.target.value })}
              placeholder={t("q.other")}
              style={{ ...inputStyle(), marginTop: 8, fontSize: 13 }}
            />
          </div>
        );
      })}

      {clarify.assumptions.length > 0 && (
        <div style={{ ...card(), background: "#f6f5f1" }}>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>{t("q.assuming")}</div>
          {clarify.assumptions.map((a, i) => (
            <div key={i} style={{ fontSize: 13, marginBottom: 4 }}>
              • {a.statement} {a.default_value && <span style={{ color: C.muted }}>({a.default_value})</span>}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
        <button onClick={props.onRefine} style={primaryButton(false)}>{t("q.refine")}</button>
        <button onClick={props.onUseDraft} style={secondaryButton()}>{t("q.useDraft")}</button>
      </div>
    </section>
  );
}

/** The milestone list — shared by the fresh-plan view and the saved-goal view. */
function MilestoneCards(props: { plan: DecompositionOutput }) {
  const { t } = useI18n();
  return (
    <>
      {props.plan.nodes.map((n, i) => {
        const contract = n.decomposition_contract;
        return (
          <div key={n.key} style={card()}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <div style={{ fontWeight: 500 }}>
                <span style={{ color: C.muted, marginRight: 8 }}>{i + 1}.</span>
                {n.title}
              </div>
              <span style={{ color: C.muted, fontSize: 12, whiteSpace: "nowrap" }}>+{n.xp_reward} xp</span>
            </div>
            {n.description && <div style={{ color: C.muted, fontSize: 13, marginTop: 4 }}>{n.description}</div>}
            <div style={{ fontSize: 12, color: C.accent, marginTop: 8, fontFamily: "ui-monospace, monospace" }}>
              ✓ {summarizeRule(n.acceptance_rule)}
            </div>
            {contract && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.border}`, color: C.muted, fontSize: 12 }}>
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
    </>
  );
}

function PlanView(props: {
  plan: DecompositionOutput;
  review?: PlanResult["review"] | null;
  intake?: AimIntakeReport | null;
  learning?: AimLearningReport | null;
  answerImpact?: ClarifyAnswerImpactReport | null;
  captureFulfillment?: ContextCaptureFulfillmentReport | null;
  contextLineage?: ContextLineageReport | null;
  planningContext?: PlanningContextSelectionReport | null;
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
  return (
    <section>
      <p style={{ color: C.muted, fontSize: 14, margin: "4px 0 16px" }}>
        {t(n === 1 ? "plan.summary_one" : "plan.summary_other", { n })}
      </p>
      <AimIntakePanel report={props.intake} />
      <AimLearningPanel report={props.learning} />
      <ClarifyImpactPanel report={props.answerImpact} plan={plan} />
      <ContextCaptureFulfillmentPanel report={props.captureFulfillment} />
      <ContextLineagePanel report={props.contextLineage} />
      {props.review && <PlanReviewPanel review={props.review} />}
      <PlanningContextPanel report={props.planningContext} />
      <MilestoneCards plan={plan} />

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8 }}>
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
            <button onClick={props.onHome} style={secondaryButton()}>{t("plan.backToAims")}</button>
          </>
        ) : (
          <>
            <button onClick={props.onSave} style={primaryButton(false)}>{t("plan.save")}</button>
            {reviewPrompt && <button onClick={() => props.onRefineWithReview(reviewPrompt)} style={secondaryButton()}>{t("plan.refineReview")}</button>}
            <button onClick={props.onReset} style={secondaryButton()}>{t("plan.startOver")}</button>
          </>
        )}
      </div>
    </section>
  );
}

function SavedGoalView(props: {
  goal: Goal;
  contextCandidates: Memory[];
  contextHistory: Memory[];
  onBack: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const { goal } = props;
  const plan = planOf(goal);
  const review = reviewOf(goal);
  const intake = aimIntakeOf(goal);
  const learning = reviewAimLearning({
    goal,
    pendingContext: pendingContextForGoal(goal, props.contextCandidates),
    contextOutcomes: props.contextHistory,
  });
  const answerImpact = clarifyImpactOf(goal);
  const captureFulfillment = contextCaptureFulfillmentOf(goal);
  const contextLineage = reviewContextLineage({
    goal,
    pendingContext: pendingContextForGoal(goal, props.contextCandidates),
    contextOutcomes: props.contextHistory,
  });
  const planningContext = planningContextOf(goal);
  const n = plan?.nodes.length ?? 0;
  return (
    <section>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, margin: "4px 0 12px" }}>
        <h2 style={{ fontSize: 17, fontWeight: 600, margin: 0 }}>{goal.title}</h2>
        <button onClick={props.onBack} style={linkButton()}>{t("common.back")}</button>
      </div>
      {goal.description && <p style={{ color: C.muted, fontSize: 13, margin: "0 0 14px" }}>{goal.description}</p>}

      {plan && plan.nodes.length > 0 ? (
        <>
          <p style={{ color: C.muted, fontSize: 13, margin: "0 0 12px" }}>
            {t(n === 1 ? "saved.count_one" : "saved.count_other", { n })}
          </p>
          <AimIntakePanel report={intake} />
          <AimLearningPanel report={learning} />
          <ClarifyImpactPanel report={answerImpact} plan={plan} />
          <ContextCaptureFulfillmentPanel report={captureFulfillment} />
          <ContextLineagePanel report={contextLineage} />
          {review && <PlanReviewPanel review={review} />}
          <PlanningContextPanel report={planningContext} />
          <MilestoneCards plan={plan} />
        </>
      ) : (
        <Notice tone="info">{t("saved.noPlan")}</Notice>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
        <button onClick={props.onBack} style={secondaryButton()}>{t("plan.backToAims")}</button>
        <button onClick={props.onDelete} style={{ ...secondaryButton(), color: C.danger, borderColor: "#e7c9c9" }}>{t("common.delete")}</button>
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
