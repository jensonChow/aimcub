import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import type { ContextCategory, DecompositionContract, DecompositionOutput, Goal, Memory } from "@core/types";
import { isPromptLikeContextCandidate, recommendContextScope, reviewAimLearning, reviewContextLineage } from "@core/domain";
import type { AimIntakeReport, AimLearningReport, ContextCaptureContract, ContextCaptureFulfillmentReport, ContextHealthRow, ContextLineageLearningReport, ContextLineageReport, ContextProfileReport, DecompositionLearningReport, DecompositionStrategyReport, PlanQualityDimensionReport } from "@core/domain";
import type { ClarifyOutput, ClarifyAnswer, ClarifyAnswerImpactReport, ClarifyLearningReport, PlanningContextSelectionReport } from "@core/llm";
import type { LlmProvider, PlanResult, ProviderConfig, ProviderStatus } from "../shared/ipc";

import { summarizeRule } from "./summarize";
import { I18nProvider, useI18n, type Lang, type StringKey } from "./i18n";

type Step = "home" | "aim" | "drafting" | "questions" | "refining" | "plan";

type AnswerMap = Record<string, { label: string | null; other: string }>;

const C = {
  text: "#1a1a19",
  muted: "#6b6a65",
  border: "#e3e1d9",
  accent: "#3266ad",
  accentBg: "#eef3fb",
  surface: "#ffffff",
  page: "#faf9f6",
  danger: "#a32d2d",
};

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
      const d = await window.aimcub.draft({ title: title.trim(), description: description.trim() || undefined });
      setAimIntake(d.intake ?? null);
      if (!d.ok || !d.output) throw new Error(d.errors.join("; ") || t("err.draft"));
      setDraft(d.output);
      setPlanQuality(d.quality ?? null);
      setPlanReview(d.review ?? null);
      setPlanQualityRetry(d.qualityRetry ?? null);
      setPlanningContext(d.planningContext ?? null);
      const c = await window.aimcub.clarify({
        title: title.trim(),
        description: description.trim() || undefined,
        draft: d.output,
      });
      // Clarify is best-effort: if the model returns nothing usable, proceed with the draft
      // and an empty question set rather than blocking — the draft is already valid.
      setClarifyOut(c.output ?? { questions: [], assumptions: [] });
      if (!c.ok) setError(c.errors.join("; ") || t("err.clarify"));
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

        {(step === "drafting" || step === "refining") && (
          <Notice tone="info">{step === "drafting" ? t("status.drafting") : t("status.refining")}</Notice>
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

function LangToggle() {
  const { lang, setLang } = useI18n();
  return (
    <div style={{ display: "flex", border: `1px solid ${C.border}`, borderRadius: 999, overflow: "hidden" }}>
      {(["en", "zh"] as Lang[]).map((l) => (
        <button
          key={l}
          onClick={() => setLang(l)}
          style={{
            padding: "5px 10px",
            border: "none",
            background: lang === l ? C.accent : "#fff",
            color: lang === l ? "#fff" : C.muted,
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          {l === "en" ? "EN" : "中"}
        </button>
      ))}
    </div>
  );
}

function HomeView(props: {
  goals: Goal[];
  contextCandidates: Memory[];
  contextProfile: ContextProfileReport | null;
  contextHealth: ContextHealthRow[];
  contextLearning: ClarifyLearningReport | null;
  contextLineageLearning: ContextLineageLearningReport | null;
  contextDecompositionLearning: DecompositionLearningReport | null;
  onNew: () => void;
  onOpen: (g: Goal) => void;
  onDelete: (g: Goal) => void;
  onAcceptContext: (candidate: Memory, content: string, scope: "aim" | "global") => void;
  onRejectContext: (candidate: Memory) => void;
  onArchiveContext: (id: string) => void;
  onDeprioritizeContext: (id: string) => void;
}) {
  const { t } = useI18n();
  const { goals } = props;
  return (
    <section>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <span style={{ color: C.muted, fontSize: 14 }}>
          {goals.length === 0 ? t("home.none") : t(goals.length === 1 ? "home.aim_one" : "home.aim_other", { n: goals.length })}
        </span>
        <button onClick={props.onNew} style={{ ...primaryButton(false), marginTop: 0 }}>{t("home.new")}</button>
      </div>

      <ContextInbox
        candidates={props.contextCandidates}
        onAccept={props.onAcceptContext}
        onReject={props.onRejectContext}
      />

      <ContextProfilePanel report={props.contextProfile} />

      <ContextHealthPanel
        rows={props.contextHealth}
        onArchive={props.onArchiveContext}
        onDeprioritize={props.onDeprioritizeContext}
      />

      <ContextLearningPanel report={props.contextLearning} />

      <ContextLineageLearningPanel report={props.contextLineageLearning} />

      <DecompositionLearningPanel report={props.contextDecompositionLearning} />

      {goals.length === 0 && (
        <div style={{ ...card(), color: C.muted, fontSize: 14 }}>{t("home.emptyHelp")}</div>
      )}

      {goals.map((g) => {
        const n = planOf(g)?.nodes.length ?? 0;
        return (
          <div key={g.id} style={{ ...card(), display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, cursor: "pointer" }} onClick={() => props.onOpen(g)}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.title}</div>
              <div style={{ color: C.muted, fontSize: 12, marginTop: 3 }}>
                {t(n === 1 ? "common.milestone_one" : "common.milestone_other", { n })}
                {g.created_at ? ` · ${formatDate(g.created_at)}` : ""}
              </div>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); props.onDelete(g); }}
              style={{ ...linkButton(), color: C.muted }}
              title={t("common.delete")}
            >
              {t("common.delete")}
            </button>
          </div>
        );
      })}
    </section>
  );
}

function ContextProfilePanel(props: { report: ContextProfileReport | null }) {
  const { t } = useI18n();
  const report = props.report;
  if (!report || report.totalActive + report.totalPending === 0) return null;
  const gaps = report.gaps.slice(0, 3);
  return (
    <section style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>{t("context.profile")}</h2>
        <span style={{ color: C.muted, fontSize: 12 }}>
          {t("context.profileScore", { score: report.coverageScore })}
        </span>
      </div>
      <div style={{ ...card(), background: "#fbfaf7" }}>
        <div style={{ display: "grid", gap: 8 }}>
          {report.rows.slice(0, 6).map((row) => (
            <div
              key={row.category}
              style={{ display: "grid", gridTemplateColumns: "112px minmax(80px, 1fr) 72px", gap: 8, alignItems: "center" }}
            >
              <div style={{ color: C.text, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {contextCategoryLabel(row.category, t)}
              </div>
              <div style={{ color: C.muted, fontSize: 12 }}>
                {contextProfileStrengthLabel(row.strength, t)}
              </div>
              <div style={{ color: C.muted, fontSize: 12, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {row.highConfidenceCount}/{row.activeCount}
              </div>
            </div>
          ))}
        </div>
        {gaps.length > 0 && (
          <div style={{ color: C.muted, fontSize: 12, marginTop: 10 }}>
            {t("context.profileNext")} {gaps.map((row) => contextCategoryLabel(row.category, t)).join(", ")}
          </div>
        )}
      </div>
    </section>
  );
}

function ContextLearningPanel(props: { report: ClarifyLearningReport | null }) {
  const { t } = useI18n();
  const report = props.report;
  if (!report || report.total_answered === 0) return null;
  const rows = report.rows.filter((row) => row.answered_count > 0);
  if (rows.length === 0) return null;
  return (
    <section style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>{t("context.learning")}</h2>
        <span style={{ color: C.muted, fontSize: 12 }}>
          {t("context.learningCounts", { answered: report.total_answered, impacted: report.total_impacted })}
        </span>
      </div>
      <div style={{ ...card(), background: "#f7fbf8" }}>
        <div style={{ display: "grid", gap: 8 }}>
          {rows.map((row) => (
            <div
              key={row.source_dimension}
              style={{ display: "grid", gridTemplateColumns: "112px minmax(90px, 1fr) 72px", gap: 8, alignItems: "center" }}
            >
              <div style={{ fontSize: 12, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {dimensionLabel(row.source_dimension, t)}
              </div>
              <div style={{ color: C.muted, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {contextLearningRecommendationLabel(row.recommendation, t)}
              </div>
              <div style={{ color: C.muted, fontSize: 12, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {row.impacted_count}/{row.answered_count}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ContextLineageLearningPanel(props: { report: ContextLineageLearningReport | null }) {
  const { t } = useI18n();
  const report = props.report;
  if (!report || report.totalQuestions === 0) return null;
  const rows = report.rows.filter((row) => row.askedCount > 0).slice(0, 5);
  if (rows.length === 0) return null;
  return (
    <section style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>{t("context.lineageLearning")}</h2>
        <span style={{ color: C.muted, fontSize: 12 }}>
          {t("context.lineageLearningCounts", {
            questions: report.totalQuestions,
            captured: report.totalCaptured,
            impacted: report.totalImpacted,
            pending: report.totalPending,
          })}
        </span>
      </div>
      <div style={{ ...card(), background: "#f7fbfb" }}>
        <div style={{ display: "grid", gap: 10 }}>
          {rows.map((row, index) => {
            const source = row.gapSource?.replace("_", "-") ?? row.source.replace("_", "-");
            return (
              <div key={`${row.source}-${row.category}-${row.capturePurpose}-${index}`} style={{ display: "grid", gap: 3 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
                  <div style={{ color: C.text, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {source} · {contextCategoryLabel(row.category, t)} · {dimensionLabel(row.improvesDimension, t)}
                  </div>
                  <div style={{ color: C.muted, fontSize: 12, whiteSpace: "nowrap" }}>
                    {row.impactedCount}/{row.memoryCapturedCount}
                  </div>
                </div>
                <div style={{ color: C.muted, fontSize: 12 }}>
                  {lineageLearningRecommendationLabel(row.recommendation, t)} · {capturePurposeLabel(row.capturePurpose, t)}
                  {row.pendingContextCount > 0 ? ` · ${t("context.lineageLearningPending", { n: row.pendingContextCount })}` : ""}
                  {row.acceptedContextCount ? ` · ${t("context.lineageLearningAccepted", { n: row.acceptedContextCount })}` : ""}
                  {(row.rejectedContextCount ?? 0) + (row.deprioritizedContextCount ?? 0) > 0
                    ? ` · ${t("context.lineageLearningRejected", { n: (row.rejectedContextCount ?? 0) + (row.deprioritizedContextCount ?? 0) })}`
                    : ""}
                </div>
                <div style={{ color: C.muted, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {shortUiText(row.exampleQuestion)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function DecompositionLearningPanel(props: { report: DecompositionLearningReport | null }) {
  const { t } = useI18n();
  const report = props.report;
  if (!report || report.rows.length === 0) return null;
  const rows = report.rows.slice(0, 5);
  return (
    <section style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>{t("context.decompositionLearning")}</h2>
        <span style={{ color: C.muted, fontSize: 12 }}>
          {t("context.decompositionLearningCounts", {
            aims: report.totalAims,
            completed: report.completedMilestones,
            total: report.totalMilestones,
            issues: report.qualityIssueCount,
            evidence: report.evidenceAttributionCount,
          })}
        </span>
      </div>
      <div style={{ ...card(), background: "#f8faf6" }}>
        <div style={{ display: "grid", gap: 10 }}>
          {rows.map((row, index) => {
            const context = row.acceptedContextCount || row.rejectedContextCount || row.deprioritizedContextCount
              ? ` · ${t("context.decompositionLearningContext", {
                  accepted: row.acceptedContextCount ?? 0,
                  rejected: (row.rejectedContextCount ?? 0) + (row.deprioritizedContextCount ?? 0),
                })}`
              : "";
            const evidence = row.evidenceKinds?.length
              ? ` · ${t("context.decompositionLearningEvidence", {
                  evidence: row.evidenceKinds.join(", "),
                  evaluator: row.evaluatorKinds?.join(", ") || "unknown",
                })}`
              : "";
            return (
              <div key={`${row.source}-${row.recommendation}-${row.aimId}-${index}`} style={{ display: "grid", gap: 3 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
                  <div style={{ color: C.text, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {decompositionLearningRecommendationLabel(row.recommendation, t)} · {row.source.replace("_", "-")}
                  </div>
                  <div style={{ color: C.muted, fontSize: 12, whiteSpace: "nowrap" }}>
                    {row.dimension ? dimensionLabel(row.dimension, t) : row.category ? contextCategoryLabel(row.category, t) : t("context.decompositionLearningContract")}
                  </div>
                </div>
                <div style={{ color: C.muted, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {row.nodeTitle ?? row.aimTitle}{context}{evidence}
                </div>
                <div style={{ color: C.muted, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {shortUiText(row.example)}
                </div>
              </div>
            );
          })}
        </div>
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

function ContextHealthPanel(props: {
  rows: ContextHealthRow[];
  onArchive: (id: string) => void;
  onDeprioritize: (id: string) => void;
}) {
  const { t } = useI18n();
  const actionable = props.rows.filter((row) => row.action !== "keep");
  if (props.rows.length === 0) return null;
  if (actionable.length === 0) {
    const traced = props.rows.filter((row) => row.selectedCount + row.ignoredCount > 0).length;
    return (
      <section style={{ marginBottom: 18 }}>
        <div style={{ ...card(), background: "#f7fbf8", color: "#1a7f4b", fontSize: 13 }}>
          {t("context.healthClean", { traced, total: props.rows.length })}
        </div>
      </section>
    );
  }

  return (
    <section style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>{t("context.health")}</h2>
        <span style={{ color: C.muted, fontSize: 12 }}>
          {t(actionable.length === 1 ? "context.healthAttention_one" : "context.healthAttention_other", { n: actionable.length })}
        </span>
      </div>
      {actionable.slice(0, 5).map((row) => (
        <div key={row.memoryId} style={{ ...card(), background: "#fffaf1" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
            <div style={{ color: C.muted, fontSize: 12 }}>
              {row.category} · {contextHealthActionLabel(row.action, t)}
            </div>
            <div style={{ color: C.muted, fontSize: 12, whiteSpace: "nowrap" }}>
              {t("context.healthCounts", { selected: row.selectedCount, ignored: row.ignoredCount })}
            </div>
          </div>
          <div style={{ fontSize: 13, marginTop: 6 }}>{row.content}</div>
          <div style={{ color: C.muted, fontSize: 12, marginTop: 6 }}>
            {contextHealthReasonLabel(row.reason, t)}
            {row.lastReasons.length > 0 ? ` · ${row.lastReasons.slice(-2).join(", ")}` : ""}
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
            <button onClick={() => props.onDeprioritize(row.memoryId)} style={{ ...secondaryButton(), marginTop: 0 }}>
              {t("context.health.deprioritize")}
            </button>
            <button
              onClick={() => props.onArchive(row.memoryId)}
              style={{ ...secondaryButton(), marginTop: 0, color: C.danger, borderColor: "#e7c9c9" }}
            >
              {t("context.health.archive")}
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}

function contextLearningRecommendationLabel(
  recommendation: ClarifyLearningReport["rows"][number]["recommendation"],
  t: (key: StringKey, vars?: Record<string, string | number>) => string,
): string {
  switch (recommendation) {
    case "ask_more":
      return t("context.learning.askMore");
    case "ask_less":
      return t("context.learning.askLess");
    case "ask_selectively":
      return t("context.learning.askSelectively");
  }
}

function lineageLearningRecommendationLabel(
  recommendation: ContextLineageLearningReport["rows"][number]["recommendation"],
  t: (key: StringKey, vars?: Record<string, string | number>) => string,
): string {
  switch (recommendation) {
    case "reuse_pattern":
      return t("context.lineageLearning.reusePattern");
    case "ask_selectively":
      return t("context.learning.askSelectively");
    case "fix_capture":
      return t("context.lineageLearning.fixCapture");
    case "resolve_pending":
      return t("context.lineageLearning.resolvePending");
  }
}

function decompositionLearningRecommendationLabel(
  recommendation: DecompositionLearningReport["rows"][number]["recommendation"],
  t: (key: StringKey, vars?: Record<string, string | number>) => string,
): string {
  switch (recommendation) {
    case "reuse_pattern":
      return t("context.decompositionLearning.reusePattern");
    case "tighten_contract":
      return t("context.decompositionLearning.tightenContract");
    case "ask_context_earlier":
      return t("context.decompositionLearning.askContextEarlier");
    case "improve_acceptance":
      return t("context.decompositionLearning.improveAcceptance");
    case "reconsider_granularity":
      return t("context.decompositionLearning.reconsiderGranularity");
  }
}

function decompositionStrategyFocusLabel(
  focus: DecompositionStrategyReport["actions"][number]["focus"],
  t: (key: StringKey, vars?: Record<string, string | number>) => string,
): string {
  switch (focus) {
    case "verifiability":
      return t("context.decompositionStrategy.verifiability");
    case "granularity":
      return t("context.decompositionStrategy.granularity");
    case "context_fit":
      return t("context.decompositionStrategy.contextFit");
    case "evidence_pattern":
      return t("context.decompositionStrategy.evidencePattern");
    case "contract_specificity":
      return t("context.decompositionStrategy.contractSpecificity");
  }
}

function decompositionStrategyPriorityLabel(
  priority: DecompositionStrategyReport["actions"][number]["priority"],
  t: (key: StringKey, vars?: Record<string, string | number>) => string,
): string {
  switch (priority) {
    case "high":
      return t("context.decompositionStrategy.high");
    case "medium":
      return t("context.decompositionStrategy.medium");
    case "low":
      return t("context.decompositionStrategy.low");
  }
}

function contextProfileStrengthLabel(
  strength: ContextProfileReport["rows"][number]["strength"],
  t: (key: StringKey, vars?: Record<string, string | number>) => string,
): string {
  switch (strength) {
    case "strong":
      return t("context.profile.strong");
    case "ready":
      return t("context.profile.ready");
    case "thin":
      return t("context.profile.thin");
    case "missing":
      return t("context.profile.missing");
  }
}

function contextCategoryLabel(
  category: ContextCategory,
  t: (key: StringKey, vars?: Record<string, string | number>) => string,
): string {
  switch (category) {
    case "eval_signal":
      return t("context.category.evalSignal");
    case "project_fact":
      return t("context.category.projectFact");
    case "preference":
      return t("context.category.preference");
    case "constraint":
      return t("context.category.constraint");
    case "capability":
      return t("context.category.capability");
    case "procedure":
      return t("context.category.procedure");
  }
}

function decompositionOwnerLabel(
  owner: DecompositionContract["likely_owner"],
  t: (key: StringKey, vars?: Record<string, string | number>) => string,
): string {
  switch (owner) {
    case "human":
      return t("plan.owner.human");
    case "agent":
      return t("plan.owner.agent");
    case "either":
      return t("plan.owner.either");
    case "mixed":
      return t("plan.owner.mixed");
  }
}

function clarifyWhyLabel(
  why: NonNullable<ClarifyOutput["questions"][number]["why_asked"]>[number],
  t: (key: StringKey, vars?: Record<string, string | number>) => string,
): string {
  switch (why.code) {
    case "review_gap":
      return why.category
        ? `${t("q.why.reviewGap")} ${why.category.replace("_", "-")}`
        : t("q.why.reviewGap");
    case "quality_dimension":
      return t("q.why.qualityDimension");
    case "historical_learning":
      return t("q.why.historicalLearning");
    case "aim_intake":
      return why.category
        ? `${t("q.why.aimIntake")} ${why.category.replace("_", "-")}`
        : t("q.why.aimIntake");
    case "context_lineage":
      return why.category
        ? `${t("q.why.contextLineage")} ${why.category.replace("_", "-")}`
        : t("q.why.contextLineage");
    case "decomposition_strategy":
      return why.strategyFocus
        ? `${t("q.why.decompositionStrategy")} ${why.strategyFocus.replace("_", "-")}`
        : t("q.why.decompositionStrategy");
  }
}

function capturePurposeLabel(
  purpose: ContextCaptureContract["purpose"],
  t: (key: StringKey, vars?: Record<string, string | number>) => string,
): string {
  switch (purpose) {
    case "shape_plan":
      return t("capture.purpose.shapePlan");
    case "define_eval":
      return t("capture.purpose.defineEval");
    case "route_work":
      return t("capture.purpose.routeWork");
    case "reuse_preference":
      return t("capture.purpose.reusePreference");
    case "document_procedure":
      return t("capture.purpose.documentProcedure");
  }
}

function captureContractLabel(
  capture: ContextCaptureContract,
  t: (key: StringKey, vars?: Record<string, string | number>) => string,
): string {
  const scope = capture.scope === "global" ? t("context.scopeGlobal") : t("context.scopeAim");
  const parts = [t("capture.label", {
    scope,
    category: contextCategoryLabel(capture.category, t),
    purpose: capturePurposeLabel(capture.purpose, t),
    dimension: dimensionLabel(capture.improvesDimension, t),
  })];
  if (capture.origin?.nodeKey) parts.push(t("capture.originNode", { node: capture.origin.nodeKey }));
  if (typeof capture.origin?.roiScore === "number") parts.push(t("capture.originRoi", { score: capture.origin.roiScore }));
  return parts.join(" · ");
}

function ContextInbox(props: {
  candidates: Memory[];
  onAccept: (candidate: Memory, content: string, scope: "aim" | "global") => void;
  onReject: (candidate: Memory) => void;
}) {
  const { t } = useI18n();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [scopes, setScopes] = useState<Record<string, "aim" | "global">>({});
  const candidates = props.candidates;
  if (candidates.length === 0) return null;
  return (
    <section style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>{t("context.inbox")}</h2>
        <span style={{ color: C.muted, fontSize: 12 }}>
          {t(candidates.length === 1 ? "context.pending_one" : "context.pending_other", { n: candidates.length })}
        </span>
      </div>

      {candidates.map((candidate) => {
        const value = edits[candidate.id] ?? candidate.content;
        const editRequired = isPromptLikeContextCandidate(value);
        const recommendedScope = recommendContextScope(candidate).scope;
        const scope = scopes[candidate.id] ?? recommendedScope;
        const confidence = Number.isFinite(candidate.confidence) ? `${Math.round(candidate.confidence * 100)}%` : "";
        const scopeLabel = scope === "global" ? t("context.scopeGlobal") : t("context.scopeAim");
        const meta = [candidate.category, candidate.source, scopeLabel, confidence].filter(Boolean).join(" · ");
        return (
          <div key={candidate.id} style={{ ...card(), background: "#fbfaf7" }}>
            <div style={{ color: C.muted, fontSize: 12, marginBottom: 8 }}>{meta}</div>
            <textarea
              value={value}
              onChange={(e) => setEdits((m) => ({ ...m, [candidate.id]: e.target.value }))}
              rows={3}
              style={{ ...inputStyle(), resize: "vertical", fontSize: 13 }}
            />
            {editRequired ? (
              <div style={{ color: "#8a5a10", fontSize: 12, marginTop: 8 }}>
                {t("context.editRequired")}
              </div>
            ) : null}
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              {(candidate.goal_id ? (["aim", "global"] as const) : (["global"] as const)).map((nextScope) => (
                <button
                  key={nextScope}
                  onClick={() => setScopes((m) => ({ ...m, [candidate.id]: nextScope }))}
                  style={scopeButton(scope === nextScope)}
                >
                  {nextScope === "global" ? t("context.scopeGlobal") : t("context.scopeAim")}
                  {nextScope === recommendedScope ? ` ${t("context.recommended")}` : ""}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <button
                onClick={() => props.onAccept(candidate, value, scope)}
                disabled={!value.trim() || editRequired}
                style={{ ...primaryButton(!value.trim() || editRequired), marginTop: 0 }}
              >
                {t("context.accept")}
              </button>
              <button onClick={() => props.onReject(candidate)} style={{ ...secondaryButton(), marginTop: 0 }}>{t("context.reject")}</button>
            </div>
          </div>
        );
      })}
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

function qualityTone(grade: PlanQualityDimensionReport["grade"]): string {
  if (grade === "fail") return C.danger;
  if (grade === "warn") return "#8a6517";
  return "#1a7f4b";
}

function dimensionLabel(
  dimension: PlanQualityDimensionReport["dimension"],
  t: (key: StringKey, vars?: Record<string, string | number>) => string,
): string {
  switch (dimension) {
    case "verifiability":
      return t("review.dimension.verifiability");
    case "granularity":
      return t("review.dimension.granularity");
    case "distinctness":
      return t("review.dimension.distinctness");
    case "context_fit":
      return t("review.dimension.contextFit");
  }
}

function intakeReadinessLabel(
  readiness: AimIntakeReport["readiness"],
  t: (key: StringKey, vars?: Record<string, string | number>) => string,
): string {
  switch (readiness) {
    case "ready":
      return t("intake.ready");
    case "needs_targeted_context":
      return t("intake.needsContext");
    case "needs_plan_refinement":
      return t("intake.needsRefinement");
  }
}

function intakeQuestionSourceLabel(
  source: AimIntakeReport["questions"][number]["source"],
  t: (key: StringKey, vars?: Record<string, string | number>) => string,
): string {
  switch (source) {
    case "aim_text":
      return t("intake.source.aimText");
    case "context_profile":
      return t("intake.source.contextProfile");
    case "planning_context":
      return t("intake.source.planningContext");
    case "draft_review":
      return t("intake.source.draftReview");
  }
}

function aimLearningSourceLabel(
  source: AimLearningReport["rows"][number]["source"],
  t: (key: StringKey, vars?: Record<string, string | number>) => string,
): string {
  switch (source) {
    case "clarify_answer":
      return t("aimLearning.source.clarifyAnswer");
    case "reviewed_context":
      return t("aimLearning.source.reviewedContext");
    case "pending_context":
      return t("aimLearning.source.pendingContext");
    case "intake_gap":
      return t("aimLearning.source.intakeGap");
    case "review_gap":
      return t("aimLearning.source.reviewGap");
  }
}

function aimLearningStatusMark(status: AimLearningReport["rows"][number]["status"]): string {
  switch (status) {
    case "learned":
      return "+";
    case "pending":
      return "?";
    case "gap":
      return "!";
  }
}

function aimLearningStatusColor(status: AimLearningReport["rows"][number]["status"]): string {
  switch (status) {
    case "learned":
      return "#1a7f4b";
    case "pending":
      return C.accent;
    case "gap":
      return "#8a6517";
  }
}

function aimLearningRowOrder(a: AimLearningReport["rows"][number], b: AimLearningReport["rows"][number]): number {
  const statusRank = { pending: 0, gap: 1, learned: 2 } satisfies Record<AimLearningReport["rows"][number]["status"], number>;
  const priorityRank = { high: 0, medium: 1, low: 2 } as const;
  const byStatus = statusRank[a.status] - statusRank[b.status];
  if (byStatus !== 0) return byStatus;
  return priorityRank[a.priority ?? "medium"] - priorityRank[b.priority ?? "medium"];
}

function shortUiText(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > 140 ? `${text.slice(0, 137)}...` : text;
}

function impactSignalLabel(
  signal: ClarifyAnswerImpactReport["rows"][number]["signals"][number],
  t: (key: StringKey, vars?: Record<string, string | number>) => string,
): string {
  switch (signal) {
    case "quality_dimension_improved":
      return t("impact.signal.qualityImproved");
    case "milestone_added":
      return t("impact.signal.milestoneAdded");
    case "milestone_text_changed":
      return t("impact.signal.milestoneChanged");
    case "acceptance_rule_changed":
      return t("impact.signal.acceptanceChanged");
    case "node_matched_answer_terms":
      return t("impact.signal.answerMatched");
    case "node_matched_question_terms":
      return t("impact.signal.questionMatched");
  }
}

function fulfillmentStatusLabel(
  status: ContextCaptureFulfillmentReport["rows"][number]["status"],
  t: (key: StringKey, vars?: Record<string, string | number>) => string,
): string {
  switch (status) {
    case "captured_and_impacted":
      return t("fulfillment.status.capturedAndImpacted");
    case "captured":
      return t("fulfillment.status.captured");
    case "answered_without_memory":
      return t("fulfillment.status.answeredNoMemory");
    case "unanswered":
      return t("fulfillment.status.unanswered");
  }
}

function fulfillmentStatusMark(status: ContextCaptureFulfillmentReport["rows"][number]["status"]): string {
  switch (status) {
    case "captured_and_impacted":
    case "captured":
      return "+";
    case "answered_without_memory":
      return "?";
    case "unanswered":
      return "-";
  }
}

function fulfillmentStatusColor(status: ContextCaptureFulfillmentReport["rows"][number]["status"]): string {
  switch (status) {
    case "captured_and_impacted":
    case "captured":
      return "#1a7f4b";
    case "answered_without_memory":
      return "#8a6517";
    case "unanswered":
      return C.muted;
  }
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

function actionLabel(code: NonNullable<PlanResult["review"]>["actions"][number]["code"], t: (key: StringKey, vars?: Record<string, string | number>) => string): string {
  return t(`review.action.${code}` as StringKey);
}

function contextHealthActionLabel(action: ContextHealthRow["action"], t: (key: StringKey, vars?: Record<string, string | number>) => string): string {
  return t(`context.health.action.${action}` as StringKey);
}

function contextHealthReasonLabel(reason: string, t: (key: StringKey, vars?: Record<string, string | number>) => string): string {
  switch (reason) {
    case "memory_confidence_below_planning_threshold":
      return t("context.health.reason.memory_confidence_below_planning_threshold");
    case "aim_scoped_context_repeatedly_unrelated":
      return t("context.health.reason.aim_scoped_context_repeatedly_unrelated");
    case "global_context_repeatedly_unrelated":
      return t("context.health.reason.global_context_repeatedly_unrelated");
    case "ignored_without_selection":
      return t("context.health.reason.ignored_without_selection");
    case "empty_memory":
      return t("context.health.reason.empty_memory");
    default:
      return reason;
  }
}

/** OpenRouter is the easy default for the OpenAI-compatible path (one key, 50+ models). */
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

function ProviderForm(props: { status: ProviderStatus | null; onSaved: (s: ProviderStatus) => void; onClose: () => void }) {
  const { t } = useI18n();
  const { status } = props;
  const [providerKind, setProviderKind] = useState<LlmProvider>(status?.provider ?? "anthropic");
  const [apiKey, setApiKey] = useState("");
  const [baseURL, setBaseURL] = useState(status?.baseURL ?? "");
  const [model, setModel] = useState(status?.model ?? "");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const isOpenAi = providerKind === "openai-compatible";
  // A stored key only counts for the provider it was saved under — after switching
  // providers the user must enter a fresh key (the merge won't carry the old one over).
  const hasStoredKey = (status?.hasApiKey ?? false) && status?.provider === providerKind;
  const keyOk = apiKey.trim().length > 0 || hasStoredKey;
  const modelOk = !isOpenAi || model.trim().length > 0;
  const canSave = keyOk && modelOk && !busy;

  async function save() {
    setFormError(null);
    setBusy(true);
    try {
      const config: ProviderConfig = {
        provider: providerKind,
        apiKey: apiKey.trim(),
        baseURL: isOpenAi ? baseURL.trim() || undefined : undefined,
        model: isOpenAi ? model.trim() || undefined : undefined,
      };
      const s = await window.aimcub.setProviderConfig(config);
      if (!s.configured) {
        setFormError(t(isOpenAi ? "pf.notUsableKeyModel" : "pf.notUsableKey"));
        return;
      }
      props.onSaved(s);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ ...card(), background: "#fbfaf7" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div style={{ fontWeight: 600, fontSize: 15 }}>{t("pf.title")}</div>
        <button onClick={props.onClose} style={{ ...linkButton() }}>{t("common.close")}</button>
      </div>
      <div style={{ fontSize: 12, color: C.muted, margin: "4px 0 14px" }}>{t("pf.blurb")}</div>

      <label style={labelStyle()}>{t("pf.providerLabel")}</label>
      <div style={{ display: "flex", gap: 8 }}>
        {(["anthropic", "openai-compatible"] as LlmProvider[]).map((p) => (
          <button key={p} onClick={() => setProviderKind(p)} style={optionButton(providerKind === p)}>
            <div style={{ fontWeight: 500 }}>{p === "anthropic" ? t("pf.anthropic") : t("pf.openai")}</div>
            <div style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>
              {p === "anthropic" ? t("pf.anthropicDesc") : t("pf.openaiDesc")}
            </div>
          </button>
        ))}
      </div>

      {isOpenAi && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 14 }}>
            <label style={labelStyle()}>{t("pf.baseUrl")}</label>
            <button onClick={() => setBaseURL(OPENROUTER_BASE_URL)} style={linkButton()}>{t("pf.useOpenRouter")}</button>
          </div>
          <input
            value={baseURL}
            onChange={(e) => setBaseURL(e.target.value)}
            placeholder={t("pf.baseUrlPlaceholder")}
            style={inputStyle()}
          />
          <label style={{ ...labelStyle(), marginTop: 14 }}>{t("pf.model")}</label>
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={t("pf.modelPlaceholder")}
            style={inputStyle()}
          />
        </>
      )}

      <label style={{ ...labelStyle(), marginTop: 14 }}>{t("pf.apiKey")}</label>
      <input
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        placeholder={hasStoredKey ? t("pf.keyKeep") : isOpenAi ? "sk-or-… / sk-…" : "sk-ant-…"}
        type="password"
        style={inputStyle()}
      />

      {formError && <div style={{ color: C.danger, fontSize: 13, marginTop: 10 }}>{formError}</div>}

      <button onClick={save} disabled={!canSave} style={primaryButton(!canSave)}>
        {busy ? t("pf.saving") : t("pf.saveProvider")}
      </button>
    </div>
  );
}

function providerLabel(s: ProviderStatus, t: (key: "provider.anthropicShort" | "provider.openaiShort") => string): string {
  if (s.provider === "anthropic") return `${t("provider.anthropicShort")} ⚙`;
  const model = s.model ? ` · ${s.model}` : "";
  return `${t("provider.openaiShort")}${model} ⚙`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString();
}

/** `Goal.plan_json` is an `unknown` Json column; the desktop always stores a plan there. */
function planOf(g: Goal): DecompositionOutput | null {
  const p = g.plan_json as DecompositionOutput | null | undefined;
  return p && Array.isArray(p.nodes) ? p : null;
}

function reviewOf(g: Goal): PlanResult["review"] | null {
  const review = g.metadata?.plan_review as PlanResult["review"] | undefined;
  return review && review.quality && review.context ? review : null;
}

function aimIntakeOf(g: Goal): AimIntakeReport | null {
  const report = g.metadata?.aim_intake as Partial<AimIntakeReport> | undefined;
  if (!report || typeof report.score !== "number" || !Array.isArray(report.questions)) return null;
  return report as AimIntakeReport;
}

function clarifyImpactOf(g: Goal): ClarifyAnswerImpactReport | null {
  const report = g.metadata?.clarify_answer_impact as Partial<ClarifyAnswerImpactReport> | undefined;
  if (!report || report.version !== 1 || !Array.isArray(report.rows)) return null;
  return {
    version: 1,
    answered_count: typeof report.answered_count === "number" ? report.answered_count : report.rows.length,
    impacted_count: typeof report.impacted_count === "number" ? report.impacted_count : 0,
    changed_node_count: typeof report.changed_node_count === "number" ? report.changed_node_count : 0,
    quality_delta: Array.isArray(report.quality_delta) ? report.quality_delta as ClarifyAnswerImpactReport["quality_delta"] : [],
    rows: report.rows as ClarifyAnswerImpactReport["rows"],
  };
}

function contextCaptureFulfillmentOf(g: Goal): ContextCaptureFulfillmentReport | null {
  const report = g.metadata?.context_capture_fulfillment as Partial<ContextCaptureFulfillmentReport> | undefined;
  if (!report || report.version !== 1 || !Array.isArray(report.rows)) return null;
  return {
    version: 1,
    total: typeof report.total === "number" ? report.total : report.rows.length,
    answeredCount: typeof report.answeredCount === "number" ? report.answeredCount : 0,
    memoryCapturedCount: typeof report.memoryCapturedCount === "number" ? report.memoryCapturedCount : 0,
    impactedCount: typeof report.impactedCount === "number" ? report.impactedCount : 0,
    rows: report.rows as ContextCaptureFulfillmentReport["rows"],
  };
}

function planningContextOf(g: Goal): PlanningContextSelectionReport | null {
  const report = g.metadata?.planning_context as Partial<PlanningContextSelectionReport> | undefined;
  if (!report || !Array.isArray(report.selected) || !Array.isArray(report.ignored)) return null;
  return {
    total: typeof report.total === "number" ? report.total : report.selected.length + report.ignored.length,
    limit: typeof report.limit === "number" ? report.limit : report.selected.length,
    selected: report.selected as PlanningContextSelectionReport["selected"],
    ignored: report.ignored as PlanningContextSelectionReport["ignored"],
  };
}

function pendingContextForGoal(goal: Goal, candidates: readonly Memory[]): Memory[] {
  return candidates.filter((candidate) => candidate.goal_id === goal.id && candidate.status === "pending");
}

function Notice(props: { tone: "info" | "error"; children: ReactNode }) {
  const bg = props.tone === "error" ? "#fcebeb" : C.accentBg;
  const fg = props.tone === "error" ? C.danger : C.accent;
  return <div style={{ ...card(), background: bg, color: fg, fontSize: 14 }}>{props.children}</div>;
}

// ── inline style helpers ─────────────────────────────────────────────────────
function card(): CSSProperties {
  return { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px 18px", marginBottom: 12 };
}
function labelStyle(): CSSProperties {
  return { display: "block", fontSize: 13, color: C.muted, marginBottom: 6 };
}
function inputStyle(): CSSProperties {
  return { width: "100%", boxSizing: "border-box", padding: "10px 12px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 14, fontFamily: "inherit", background: "#fff", color: C.text };
}
function primaryButton(disabled: boolean): CSSProperties {
  return { marginTop: 16, padding: "10px 16px", borderRadius: 8, border: "none", background: disabled ? "#b9c6d8" : C.accent, color: "#fff", fontSize: 14, fontWeight: 500, cursor: disabled ? "default" : "pointer" };
}
function secondaryButton(): CSSProperties {
  return { marginTop: 16, padding: "10px 16px", borderRadius: 8, border: `1px solid ${C.border}`, background: "#fff", color: C.text, fontSize: 14, cursor: "pointer" };
}
function optionButton(selected: boolean): CSSProperties {
  return { flex: 1, textAlign: "left", padding: "10px 12px", borderRadius: 8, border: `1px solid ${selected ? C.accent : C.border}`, background: selected ? C.accentBg : "#fff", color: C.text, cursor: "pointer" };
}
function scopeButton(selected: boolean): CSSProperties {
  return { padding: "6px 10px", borderRadius: 8, border: `1px solid ${selected ? C.accent : C.border}`, background: selected ? C.accentBg : "#fff", color: selected ? C.accent : C.muted, fontSize: 12, cursor: "pointer" };
}
function chipButton(): CSSProperties {
  return { padding: "6px 12px", borderRadius: 999, border: `1px solid ${C.border}`, background: "#fff", color: C.muted, fontSize: 12, cursor: "pointer" };
}
function linkButton(): CSSProperties {
  return { border: "none", background: "none", color: C.accent, fontSize: 12, cursor: "pointer", padding: 0 };
}
