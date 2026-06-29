import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import type { DecompositionOutput, Goal } from "@core/types";
import type { ClarifyOutput, ClarifyAnswer } from "@core/llm";
import type { LlmProvider, ProviderConfig, ProviderStatus } from "../shared/ipc";

import { summarizeRule } from "./summarize";
import { I18nProvider, useI18n, type Lang } from "./i18n";

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
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [provider, setProvider] = useState<ProviderStatus | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [goals, setGoals] = useState<Goal[]>([]);
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
  }, []);

  function refreshGoals() {
    window.aimcub.listGoals().then(setGoals).catch(() => {});
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
    setSavedAt(null);
  }

  function goHome() {
    setError(null);
    setViewing(null);
    clearWizard();
    refreshGoals();
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
    else refreshGoals();
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
      if (!d.ok || !d.output) throw new Error(d.errors.join("; ") || t("err.draft"));
      setDraft(d.output);
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

  async function refine(useDraftAsIs: boolean) {
    if (!draft) return;
    setError(null);
    if (useDraftAsIs) {
      setFinalPlan(draft);
      setStep("plan");
      return;
    }
    setStep("refining");
    try {
      const r = await window.aimcub.refine({
        title: title.trim(),
        description: description.trim() || undefined,
        draft,
        questions: clarifyOut?.questions ?? [],
        answers: builtAnswers,
      });
      if (!r.ok || !r.output) {
        setError(r.errors.join("; ") || t("err.refine"));
        setStep("questions");
        return;
      }
      setFinalPlan(r.output);
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
        plan: finalPlan,
        questions: clarifyOut?.questions ?? [],
        answers: builtAnswers,
      });
      setSavedAt(res.goal.created_at ?? new Date().toISOString());
      refreshGoals();
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
          <HomeView goals={goals} onNew={startNew} onOpen={openGoal} onDelete={removeGoal} />
        )}

        {step === "aim" && (
          <AimForm
            title={title}
            description={description}
            disabled={!configured}
            onTitle={setTitle}
            onDescription={setDescription}
            onSubmit={startDraft}
            onCancel={goHome}
          />
        )}

        {(step === "drafting" || step === "refining") && (
          <Notice tone="info">{step === "drafting" ? t("status.drafting") : t("status.refining")}</Notice>
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
          <SavedGoalView goal={viewing} onBack={goHome} onDelete={() => removeGoal(viewing)} />
        )}

        {step === "plan" && !viewing && finalPlan && (
          <PlanView plan={finalPlan} savedAt={savedAt} onSave={save} onReset={startNew} onHome={goHome} />
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

function HomeView(props: { goals: Goal[]; onNew: () => void; onOpen: (g: Goal) => void; onDelete: (g: Goal) => void }) {
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
  answers: AnswerMap;
  onAnswer: (id: string, patch: Partial<{ label: string | null; other: string }>) => void;
  onRefine: () => void;
  onUseDraft: () => void;
}) {
  const { t } = useI18n();
  const { clarify, answers } = props;
  return (
    <section>
      <p style={{ color: C.muted, fontSize: 14, margin: "4px 0 16px" }}>{t("q.intro")}</p>

      {clarify.questions.length === 0 && <Notice tone="info">{t("q.none")}</Notice>}

      {clarify.questions.map((q) => (
        <div key={q.id} style={card()}>
          <div style={{ fontWeight: 500, fontSize: 15 }}>{q.question}</div>
          {q.why_high_impact && <div style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>{q.why_high_impact}</div>}
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
      ))}

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
  return (
    <>
      {props.plan.nodes.map((n, i) => (
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
        </div>
      ))}
    </>
  );
}

function PlanView(props: {
  plan: DecompositionOutput;
  savedAt: string | null;
  onSave: () => void;
  onReset: () => void;
  onHome: () => void;
}) {
  const { t } = useI18n();
  const { plan, savedAt } = props;
  const n = plan.nodes.length;
  return (
    <section>
      <p style={{ color: C.muted, fontSize: 14, margin: "4px 0 16px" }}>
        {t(n === 1 ? "plan.summary_one" : "plan.summary_other", { n })}
      </p>
      <MilestoneCards plan={plan} />

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8 }}>
        {savedAt ? (
          <>
            <span style={{ color: "#1a7f4b", fontSize: 14 }}>{t("plan.saved")}</span>
            <button onClick={props.onHome} style={secondaryButton()}>{t("plan.backToAims")}</button>
          </>
        ) : (
          <>
            <button onClick={props.onSave} style={primaryButton(false)}>{t("plan.save")}</button>
            <button onClick={props.onReset} style={secondaryButton()}>{t("plan.startOver")}</button>
          </>
        )}
      </div>
    </section>
  );
}

function SavedGoalView(props: { goal: Goal; onBack: () => void; onDelete: () => void }) {
  const { t } = useI18n();
  const { goal } = props;
  const plan = planOf(goal);
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
function chipButton(): CSSProperties {
  return { padding: "6px 12px", borderRadius: 999, border: `1px solid ${C.border}`, background: "#fff", color: C.muted, fontSize: 12, cursor: "pointer" };
}
function linkButton(): CSSProperties {
  return { border: "none", background: "none", color: C.accent, fontSize: 12, cursor: "pointer", padding: 0 };
}
