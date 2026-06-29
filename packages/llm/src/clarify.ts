/**
 * Clarifying-questions pipeline — the "feedback step" of planning.
 *
 * The planner never asks cold. Flow: draft a first-pass decomposition, then call
 * `clarify` to surface ONLY the few high-impact questions whose answers most change
 * the plan (value-of-information) — as options that are hypotheses-with-trade-offs,
 * plus the low-impact unknowns we DEFAULTED rather than asked (default-and-disclose).
 * The user's answers then feed a refine pass (`buildRefinedDescription` → `decompose`).
 *
 * Like `decompose`, this is TOTAL: a transport/model failure or malformed output is
 * returned as `{ ok: false, errors }`, never thrown. Routed through the `classify`
 * task (Haiku) — cheap and high-frequency. There is no offline fallback: with no
 * provider configured the caller surfaces the error honestly (no templates).
 */
import { type DecompositionOutput, type GoalDomain } from "@core/types";

import type { LlmGateway, LlmResponse, LlmUsage } from "./index";
import { clarifyJsonSchema } from "./clarify-schema";

const DEFAULT_MAX_QUESTIONS = 3;
const HARD_MAX_QUESTIONS = 5;

export type ClarifyQuestionKind = "scope" | "involvement" | "assumption" | "constraint";

/** One hypothesis option the user can pick, with the trade-off it implies. */
export interface ClarifyOption {
  label: string;
  tradeoff: string;
}

/** A single high-impact question, surfaced as hypothesis-options + always free-text. */
export interface ClarifyQuestion {
  id: string;
  question: string;
  /** Why answering this changes the plan most (value-of-information). */
  why_high_impact: string;
  kind: ClarifyQuestionKind;
  /** Always true in v1 — a free-text "something else" is always available. */
  allow_other: boolean;
  options: ClarifyOption[];
}

/** A low-impact unknown we defaulted rather than asked about (default-and-disclose). */
export interface ClarifyAssumption {
  statement: string;
  default_value: string;
}

/** The structured question set + the assumptions we are disclosing (not asking). */
export interface ClarifyOutput {
  questions: ClarifyQuestion[];
  assumptions: ClarifyAssumption[];
}

/** A user's answer to one question: a chosen option label and/or free text. */
export interface ClarifyAnswer {
  question_id: string;
  selected_label: string | null;
  other_text: string | null;
}

/** Input to {@link clarify}: the raw aim plus the first-pass draft to ground questions in. */
export interface ClarifyInput {
  title: string;
  description?: string;
  domain?: GoalDomain;
  /** The first-pass plan. We never ask cold — questions are grounded in this draft. */
  draft: DecompositionOutput;
  /** Answers already collected, to ask a second, sharper round (usually empty). */
  priorAnswers?: ClarifyAnswer[];
  /** Cap on questions (value-of-information budget). Default 3, hard max 5. */
  maxQuestions?: number;
}

export interface ClarifyValidation {
  ok: boolean;
  errors: string[];
}

/** Result of {@link clarify}. `validation.ok === false` ⇒ `output` is null. */
export interface ClarifyResult {
  output: ClarifyOutput | null;
  validation: ClarifyValidation;
  usage: LlmUsage | null;
}

const QUESTION_KINDS: readonly ClarifyQuestionKind[] = [
  "scope",
  "involvement",
  "assumption",
  "constraint",
];

/** System prompt: frozen instructions, kept stable for prompt-cache friendliness. */
const CLARIFY_SYSTEM_PROMPT = [
  "You are Aimcub's planning engine, running the CLARIFYING step.",
  "You are shown a user's goal and a FIRST-PASS draft plan. Do NOT redo the plan.",
  "Your job: surface only the few questions whose answers would most change the plan,",
  "so the next pass is sharper. Be ruthlessly selective.",
  "",
  "Rules:",
  "- Ask AT MOST a handful of questions (prefer 2-3, never more than 5). Fewer is better.",
  "- Ask ONLY what materially branches the plan (value-of-information). If an unknown is",
  "  low-impact or safely defaultable, do NOT ask it — record it under `assumptions`",
  "  (default-and-disclose) so the user can correct it instead.",
  "- NEVER ask anything you could reasonably infer from the goal or the draft.",
  "- Each question carries >= 2 `options`. Every option is a concrete hypothesis (a",
  "  candidate answer), never a blank, and states its `tradeoff` (the consequence).",
  "- `allow_other` is always true — the user can always type a free-text answer.",
  "- Prefer questions about: scope/ambition, the user's desired involvement (do-it-myself",
  "  vs delegate), hard constraints, and load-bearing assumptions in the draft.",
  "- Give every question a unique, stable `id` (e.g. `scope`, `q2`).",
  "- The schema marks every field required: set any field that does not apply to null.",
].join("\n");

/** Render the draft compactly so questions can be grounded in it. */
function renderDraft(draft: DecompositionOutput): string {
  const nodes = Array.isArray(draft?.nodes) ? draft.nodes : [];
  if (nodes.length === 0) return "(empty draft)";
  return nodes.map((n) => `- ${n.key}: ${n.title}${n.description ? ` — ${n.description}` : ""}`).join("\n");
}

/** Build the per-goal user prompt. */
function buildClarifyPrompt(input: ClarifyInput): string {
  const domain = input.domain ?? "software";
  const description = input.description?.trim() ? input.description.trim() : "(no description provided)";
  const lines = [
    `Goal title: ${input.title}`,
    `Goal domain: ${domain}`,
    `Goal description: ${description}`,
    "",
    "First-pass draft milestones:",
    renderDraft(input.draft),
  ];
  if (input.priorAnswers && input.priorAnswers.length > 0) {
    lines.push("", "The user already answered:");
    for (const a of input.priorAnswers) {
      const ans = a.other_text?.trim() || a.selected_label?.trim() || "";
      lines.push(`- ${a.question_id}: ${ans}`);
    }
    lines.push("", "Ask only what is STILL unresolved and high-impact.");
  } else {
    lines.push("", "Surface the few high-impact clarifying questions following the rules and schema.");
  }
  return lines.join("\n");
}

/**
 * Surface the clarifying questions for a drafted plan.
 *
 * @param gateway any `LlmGateway` (the Anthropic gateway in production, a mock in tests).
 * @param input the aim + its first-pass draft.
 */
export async function clarify(gateway: LlmGateway, input: ClarifyInput): Promise<ClarifyResult> {
  const maxQuestions = clampMax(input.maxQuestions);
  let raw: LlmResponse<unknown>;
  try {
    raw = await gateway.completeStructured<unknown>({
      task: "classify",
      system: CLARIFY_SYSTEM_PROMPT,
      prompt: buildClarifyPrompt(input),
      schema: clarifyJsonSchema,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      output: null,
      validation: { ok: false, errors: [`llm request failed: ${message}`] },
      usage: null,
    };
  }

  const normalized = normalizeClarify(raw.output, maxQuestions);
  if (!normalized) {
    return {
      output: null,
      validation: { ok: false, errors: ["clarify output is not shaped as { questions[], assumptions[] }"] },
      usage: raw.usage,
    };
  }
  const validation = validateClarify(normalized);
  return { output: validation.ok ? normalized : null, validation, usage: raw.usage };
}

function clampMax(n: number | undefined): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return DEFAULT_MAX_QUESTIONS;
  return Math.max(1, Math.min(HARD_MAX_QUESTIONS, Math.floor(n)));
}

function isQuestionKind(v: unknown): v is ClarifyQuestionKind {
  return typeof v === "string" && (QUESTION_KINDS as readonly string[]).includes(v);
}

/** Recursively drop null values (the schema expresses optionality as `T | null`). */
function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNulls);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== null) out[k] = stripNulls(v);
    }
    return out;
  }
  return value;
}

/** Shape raw model output into ClarifyOutput; null if it isn't even question-set-shaped. */
function normalizeClarify(raw: unknown, maxQuestions: number): ClarifyOutput | null {
  const cleaned = stripNulls(raw);
  if (!cleaned || typeof cleaned !== "object" || Array.isArray(cleaned)) return null;
  const o = cleaned as Record<string, unknown>;
  if (!Array.isArray(o.questions)) return null;

  const questions: ClarifyQuestion[] = (o.questions as unknown[]).slice(0, maxQuestions).map((q, i) => {
    const r = q && typeof q === "object" && !Array.isArray(q) ? (q as Record<string, unknown>) : {};
    const options: ClarifyOption[] = (Array.isArray(r.options) ? (r.options as unknown[]) : [])
      .map((opt) => {
        const oo = opt && typeof opt === "object" && !Array.isArray(opt) ? (opt as Record<string, unknown>) : {};
        return {
          label: typeof oo.label === "string" ? oo.label : "",
          tradeoff: typeof oo.tradeoff === "string" ? oo.tradeoff : "",
        };
      })
      .filter((opt) => opt.label.trim().length > 0);
    return {
      id: typeof r.id === "string" && r.id.trim() ? r.id : `q${i + 1}`,
      question: typeof r.question === "string" ? r.question : "",
      why_high_impact: typeof r.why_high_impact === "string" ? r.why_high_impact : "",
      kind: isQuestionKind(r.kind) ? r.kind : "assumption",
      allow_other: typeof r.allow_other === "boolean" ? r.allow_other : true,
      options,
    };
  });

  const assumptions: ClarifyAssumption[] = (Array.isArray(o.assumptions) ? (o.assumptions as unknown[]) : [])
    .map((a) => {
      const aa = a && typeof a === "object" && !Array.isArray(a) ? (a as Record<string, unknown>) : {};
      return {
        statement: typeof aa.statement === "string" ? aa.statement : "",
        default_value: typeof aa.default_value === "string" ? aa.default_value : "",
      };
    })
    .filter((a) => a.statement.trim().length > 0);

  return { questions, assumptions };
}

/** Cheap structural validation: each question is a real fork (>= 2 options), unique ids, non-empty. */
export function validateClarify(output: ClarifyOutput): ClarifyValidation {
  const errors: string[] = [];
  const ids = new Set<string>();
  output.questions.forEach((q, i) => {
    const ref = q.id || `#${i + 1}`;
    if (!q.question.trim()) errors.push(`question ${ref}: empty question text`);
    if (q.options.length < 2) errors.push(`question ${ref}: needs at least 2 options`);
    if (ids.has(q.id)) errors.push(`duplicate question id: ${q.id}`);
    ids.add(q.id);
  });
  return { ok: errors.length === 0, errors };
}

/**
 * Fold the user's answers into an enriched description for the refine `decompose` pass.
 * Keeps `decompose`'s interface untouched: answers ride along in the description.
 */
export function buildRefinedDescription(
  originalDescription: string | undefined,
  questions: ClarifyQuestion[],
  answers: ClarifyAnswer[],
): string {
  const base = originalDescription?.trim() ?? "";
  const byId = new Map(questions.map((q) => [q.id, q]));
  const lines: string[] = [];
  for (const a of answers) {
    const ans = a.other_text?.trim() || a.selected_label?.trim() || "";
    if (!ans) continue;
    const label = byId.get(a.question_id)?.question ?? a.question_id;
    lines.push(`- ${label} → ${ans}`);
  }
  if (lines.length === 0) return base;
  return [base, "", "Clarifications from the user:", ...lines].filter(Boolean).join("\n");
}
