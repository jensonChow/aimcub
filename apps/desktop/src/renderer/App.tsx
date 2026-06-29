import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import type { DecompositionOutput } from "@core/types";
import type { ClarifyOutput, ClarifyAnswer } from "@core/llm";

import { summarizeRule } from "./summarize";

type Step = "aim" | "drafting" | "questions" | "refining" | "plan";

type AnswerMap = Record<string, { label: string | null; other: string }>;

const C = {
  text: "#1a1a19",
  muted: "#6b6a65",
  border: "#e3e1d9",
  accent: "#3266ad",
  accentBg: "#eef3fb",
  surface: "#ffffff",
  page: "#faf9f6",
};

export function App() {
  const [step, setStep] = useState<Step>("aim");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [draft, setDraft] = useState<DecompositionOutput | null>(null);
  const [clarifyOut, setClarifyOut] = useState<ClarifyOutput | null>(null);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [finalPlan, setFinalPlan] = useState<DecompositionOutput | null>(null);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState(true);

  useEffect(() => {
    window.aimcub.getKeyStatus().then((s) => setHasKey(s.hasKey)).catch(() => {});
  }, []);

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

  async function startDraft() {
    if (!title.trim()) return;
    setError(null);
    setStep("drafting");
    try {
      const d = await window.aimcub.draft({ title: title.trim(), description: description.trim() || undefined });
      if (!d.output) throw new Error(d.errors.join("; ") || "could not draft a plan");
      setDraft(d.output);
      const c = await window.aimcub.clarify({
        title: title.trim(),
        description: description.trim() || undefined,
        draft: d.output,
      });
      setClarifyOut(c.output ?? { questions: [], assumptions: [] });
      setOffline(d.usedFallback || c.usedFallback);
      setStep("questions");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep("aim");
    }
  }

  async function refine(useDraftAsIs: boolean) {
    if (!draft) return;
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
      setFinalPlan(r.output ?? draft);
      setStep("plan");
    } catch {
      setFinalPlan(draft);
      setStep("plan");
    }
  }

  async function save() {
    if (!finalPlan) return;
    const res = await window.aimcub.saveGoal({
      title: title.trim(),
      description: description.trim() || undefined,
      plan: finalPlan,
      questions: clarifyOut?.questions ?? [],
      answers: builtAnswers,
    });
    setSavedAt(res.goal.created_at ?? new Date().toISOString());
  }

  function reset() {
    setStep("aim");
    setTitle("");
    setDescription("");
    setDraft(null);
    setClarifyOut(null);
    setAnswers({});
    setFinalPlan(null);
    setError(null);
    setSavedAt(null);
  }

  return (
    <div style={{ fontFamily: "system-ui, -apple-system, sans-serif", color: C.text, background: C.page, minHeight: "100vh" }}>
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "28px 24px 64px" }}>
        <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 20 }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>Aimcub</h1>
          <span style={{ fontSize: 12, color: C.muted }}>aim → decompose · local-first</span>
        </header>

        {!hasKey && <KeyBanner onSaved={() => setHasKey(true)} />}
        {error && <Notice tone="error">{error}</Notice>}

        {step === "aim" && (
          <AimForm
            title={title}
            description={description}
            onTitle={setTitle}
            onDescription={setDescription}
            onSubmit={startDraft}
          />
        )}

        {(step === "drafting" || step === "refining") && (
          <Notice tone="info">{step === "drafting" ? "Sketching a first-pass plan…" : "Refining with your answers…"}</Notice>
        )}

        {step === "questions" && clarifyOut && (
          <QuestionsStep
            clarify={clarifyOut}
            answers={answers}
            offline={offline}
            onAnswer={(id, patch) => setAnswers((m) => ({ ...m, [id]: { label: null, other: "", ...m[id], ...patch } }))}
            onRefine={() => refine(false)}
            onUseDraft={() => refine(true)}
          />
        )}

        {step === "plan" && finalPlan && (
          <PlanView plan={finalPlan} savedAt={savedAt} onSave={save} onReset={reset} />
        )}
      </div>
    </div>
  );
}

function AimForm(props: {
  title: string;
  description: string;
  onTitle: (v: string) => void;
  onDescription: (v: string) => void;
  onSubmit: () => void;
}) {
  return (
    <section style={card()}>
      <label style={labelStyle()}>What do you want to accomplish?</label>
      <input
        autoFocus
        value={props.title}
        onChange={(e) => props.onTitle(e.target.value)}
        placeholder="e.g. Build a CLI todo app with tests + CI"
        style={inputStyle()}
        onKeyDown={(e) => { if (e.key === "Enter" && props.title.trim()) props.onSubmit(); }}
      />
      <label style={{ ...labelStyle(), marginTop: 14 }}>A little more context (optional)</label>
      <textarea
        value={props.description}
        onChange={(e) => props.onDescription(e.target.value)}
        placeholder="Constraints, scope, anything that shapes the plan."
        rows={3}
        style={{ ...inputStyle(), resize: "vertical" }}
      />
      <button onClick={props.onSubmit} disabled={!props.title.trim()} style={primaryButton(!props.title.trim())}>
        Draft a plan →
      </button>
    </section>
  );
}

function QuestionsStep(props: {
  clarify: ClarifyOutput;
  answers: AnswerMap;
  offline: boolean;
  onAnswer: (id: string, patch: Partial<{ label: string | null; other: string }>) => void;
  onRefine: () => void;
  onUseDraft: () => void;
}) {
  const { clarify, answers } = props;
  return (
    <section>
      <p style={{ color: C.muted, fontSize: 14, margin: "4px 0 16px" }}>
        A rough plan is ready. Answer a couple of questions to sharpen it{props.offline ? " (offline templates — no API key)" : ""}.
      </p>

      {clarify.questions.length === 0 && (
        <Notice tone="info">No clarifying questions — the plan is ready.</Notice>
      )}

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
            placeholder="Something else…"
            style={{ ...inputStyle(), marginTop: 8, fontSize: 13 }}
          />
        </div>
      ))}

      {clarify.assumptions.length > 0 && (
        <div style={{ ...card(), background: "#f6f5f1" }}>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>Assuming (change anything that's wrong above):</div>
          {clarify.assumptions.map((a, i) => (
            <div key={i} style={{ fontSize: 13, marginBottom: 4 }}>
              • {a.statement} {a.default_value && <span style={{ color: C.muted }}>({a.default_value})</span>}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
        <button onClick={props.onRefine} style={primaryButton(false)}>Refine plan →</button>
        <button onClick={props.onUseDraft} style={secondaryButton()}>Use the draft as-is</button>
      </div>
    </section>
  );
}

function PlanView(props: { plan: DecompositionOutput; savedAt: string | null; onSave: () => void; onReset: () => void }) {
  const { plan, savedAt } = props;
  return (
    <section>
      <p style={{ color: C.muted, fontSize: 14, margin: "4px 0 16px" }}>
        {plan.nodes.length} milestones · each lights up when its acceptance rule is met.
      </p>
      {plan.nodes.map((n, i) => (
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

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8 }}>
        {savedAt ? (
          <>
            <span style={{ color: "#1a7f4b", fontSize: 14 }}>✓ Saved locally</span>
            <button onClick={props.onReset} style={secondaryButton()}>New aim</button>
          </>
        ) : (
          <>
            <button onClick={props.onSave} style={primaryButton(false)}>Save plan</button>
            <button onClick={props.onReset} style={secondaryButton()}>Start over</button>
          </>
        )}
      </div>
    </section>
  );
}

function KeyBanner(props: { onSaved: () => void }) {
  const [key, setKey] = useState("");
  return (
    <div style={{ ...card(), background: "#fff8e8", border: "1px solid #f0e0b0" }}>
      <div style={{ fontSize: 13, marginBottom: 8 }}>
        No Anthropic API key — the planner is using offline templates. Paste a key to get real decomposition.
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="sk-ant-…"
          type="password"
          style={{ ...inputStyle(), flex: 1 }}
        />
        <button
          onClick={async () => {
            const s = await window.aimcub.setKey(key);
            if (s.hasKey) props.onSaved();
          }}
          style={primaryButton(!key.trim())}
          disabled={!key.trim()}
        >
          Save key
        </button>
      </div>
    </div>
  );
}

function Notice(props: { tone: "info" | "error"; children: ReactNode }) {
  const bg = props.tone === "error" ? "#fcebeb" : C.accentBg;
  const fg = props.tone === "error" ? "#a32d2d" : C.accent;
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
  return { textAlign: "left", padding: "10px 12px", borderRadius: 8, border: `1px solid ${selected ? C.accent : C.border}`, background: selected ? C.accentBg : "#fff", color: C.text, cursor: "pointer" };
}
