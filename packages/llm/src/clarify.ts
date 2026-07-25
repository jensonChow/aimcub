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
import { type ContextCategory, type DecompositionOutput, type GoalDomain, type MemoryKind, type PlanNode } from "@aimcub/types";
import {
  CHOICE_SELECTION_REASONS,
  decideChoiceSelection,
  contextCaptureForCategory,
  reviewPlan,
  type AimIntakeQuestion,
  type AimIntakeReport,
  type ContextCaptureContract,
  type ContextCaptureLearningReport,
  type ContextCaptureOrigin,
  type ContextLineageLearningRecommendation,
  type ContextLineageLearningReport,
  type ContextLineageLearningRow,
  type ChoiceSelectionReason,
  type DecompositionStrategyFocus,
  type DecompositionStrategyReport,
  type PlanContextGap,
  type PlanContextGapRoiSignal,
  type PlanContextGapSource,
  type PlanQualityDimension,
  type PlanQualityDimensionReport,
  type PlanQualityIssueCode,
  type PlanQualityReport,
  type PlanReviewReport,
} from "@aimcub/core";

import type { LlmGateway, LlmResponse, LlmUsage } from "./index";
import { clarifyJsonSchema } from "./clarify-schema";
import type { AimOutputLanguage } from "./language";
import { PLANNING_CONTEXT_RULES, planningMemoryCategory, renderPlanningContext } from "./planning-context";
import type { PlanningMemory } from "./planning-context";

const DEFAULT_MAX_QUESTIONS = 6;
const DEFAULT_EMPTY_CONTEXT_QUESTIONS = 2;
const HARD_MAX_QUESTIONS = 7;

export type ClarifyQuestionKind = "scope" | "involvement" | "assumption" | "constraint" | "capability";
export type ClarifyQuestionSourceDimension = PlanQualityDimension;
export type ClarifyQuestionWhyCode = "review_gap" | "quality_dimension" | "historical_learning" | "aim_intake" | "context_lineage" | "decomposition_strategy";
export type ClarifySelectionMode = "single" | "multiple";

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
  /** The scorecard dimension this question most improves, when known. */
  source_dimension?: ClarifyQuestionSourceDimension;
  /** Deterministic explanation of why this question is worth asking now. */
  why_asked?: ClarifyQuestionWhy[];
  /** What reusable context this answer is expected to capture. */
  capture?: ContextCaptureContract;
  /** Always true in v1 — a free-text "something else" is always available. */
  allow_other: boolean;
  /** Whether options are mutually exclusive or several can apply. */
  selection_mode?: ClarifySelectionMode;
  /** Auditable semantic reason for the selection mode. */
  selection_mode_reason?: ChoiceSelectionReason;
  options: ClarifyOption[];
}

export interface ClarifyQuestionWhy {
  code: ClarifyQuestionWhyCode;
  detail: string;
  originSource?: ContextCaptureOrigin["source"];
  source_dimension?: ClarifyQuestionSourceDimension;
  category?: ContextCategory;
  priority?: "high" | "medium" | "low";
  gapSource?: PlanContextGapSource;
  nodeKey?: string;
  nodeTitle?: string;
  roiScore?: number;
  roiSignals?: PlanContextGapRoiSignal[];
  issueCodes?: PlanQualityIssueCode[];
  recommendation?: ClarifyLearningRecommendation | ContextLineageLearningRecommendation;
  strategyFocus?: DecompositionStrategyFocus;
  sourceRows?: number;
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
  selected_labels?: string[] | null;
  other_text: string | null;
}

/** Input to {@link clarify}: the raw aim plus the first-pass draft to ground questions in. */
export interface ClarifyInput {
  title: string;
  description?: string;
  domain?: GoalDomain | null;
  /** The first-pass plan. We never ask cold — questions are grounded in this draft. */
  draft: DecompositionOutput;
  /** Answers already collected, to ask a second, sharper round (usually empty). */
  priorAnswers?: ClarifyAnswer[];
  /** Relevant user/org context from prior aims. Used to avoid low-value repeated questions. */
  memories?: readonly PlanningMemory[];
  /** Historical usefulness of past clarify answers. Used to choose higher-ROI questions. */
  learning?: ClarifyLearningReport | null;
  /** Historical fulfillment of capture contracts. Used to ask questions that really become context. */
  captureLearning?: ContextCaptureLearningReport | null;
  /** Historical question → memory → plan-impact lineage. Used to ask questions with proven downstream value. */
  lineageLearning?: ContextLineageLearningReport | null;
  /** Current decomposition strategy. Used to keep question budget focused on context that can change the next plan. */
  decompositionStrategy?: DecompositionStrategyReport | null;
  /** User-facing output language inferred from the aim text. Schema enum values stay unchanged. */
  outputLanguage?: AimOutputLanguage;
  /** Aim-specific intake readiness. Used to choose questions that close missing context. */
  intake?: AimIntakeReport | null;
  /** Optional plan review from the draft. If omitted, clarify computes one from @aimcub/core. */
  review?: Pick<PlanReviewReport, "quality" | "context"> | null;
  /** Cap on questions (value-of-information budget). Default 6, hard max 7. */
  maxQuestions?: number;
}

export interface ClarifyValidation {
  ok: boolean;
  errors: string[];
}

/** A user-stated memory derived from a clarify answer. */
export interface ClarifyAnswerMemory {
  content: string;
  kind: MemoryKind;
  category: ContextCategory;
  source: "user_stated";
}

export type ClarifyAnswerImpactSignal =
  | "quality_dimension_improved"
  | "milestone_added"
  | "milestone_text_changed"
  | "acceptance_rule_changed"
  | "node_matched_answer_terms"
  | "node_matched_question_terms";

export interface ClarifyAnswerQualityDelta {
  dimension: PlanQualityDimension;
  beforeScore: number | null;
  afterScore: number | null;
  delta: number | null;
  beforeGrade: PlanQualityReport["grade"] | null;
  afterGrade: PlanQualityReport["grade"] | null;
}

export interface ClarifyAnswerImpactRow {
  question_id: string;
  question: string;
  answer: string;
  kind: ClarifyQuestionKind | null;
  source_dimension?: ClarifyQuestionSourceDimension;
  memory_category: ContextCategory;
  memory_content: string;
  affected_node_keys: string[];
  signals: ClarifyAnswerImpactSignal[];
}

export interface ClarifyAnswerImpactReport {
  version: 1;
  answered_count: number;
  impacted_count: number;
  changed_node_count: number;
  quality_delta: ClarifyAnswerQualityDelta[];
  rows: ClarifyAnswerImpactRow[];
}

export type ClarifyLearningRecommendation = "ask_more" | "ask_selectively" | "ask_less";

export interface ClarifyLearningRow {
  source_dimension: ClarifyQuestionSourceDimension;
  answered_count: number;
  impacted_count: number;
  impact_rate: number;
  affected_node_count: number;
  total_quality_delta: number;
  average_quality_delta: number;
  recommendation: ClarifyLearningRecommendation;
}

export interface ClarifyLearningReport {
  version: 1;
  total_answered: number;
  total_impacted: number;
  rows: ClarifyLearningRow[];
  guidance: string[];
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
  "capability",
];
const QUESTION_SOURCE_DIMENSIONS: readonly ClarifyQuestionSourceDimension[] = [
  "verifiability",
  "granularity",
  "distinctness",
  "context_fit",
];
const QUESTION_CONTEXT_CATEGORIES: Record<ClarifyQuestionKind, readonly ContextCategory[]> = {
  scope: ["preference", "constraint", "eval_signal", "project_fact"],
  involvement: ["preference", "capability"],
  assumption: ["project_fact", "procedure", "constraint", "preference", "capability"],
  constraint: ["constraint", "project_fact", "preference"],
  capability: ["capability", "procedure", "project_fact"],
};

const DIMENSION_CONTEXT_GAP_CATEGORIES: Record<ClarifyQuestionSourceDimension, readonly ContextCategory[]> = {
  verifiability: ["eval_signal", "procedure"],
  granularity: ["constraint", "eval_signal"],
  distinctness: ["eval_signal", "procedure"],
  context_fit: ["preference", "constraint", "capability", "project_fact"],
};

const CONTEXT_ANSWER_STOPWORDS = new Set([
  "about",
  "aimcub",
  "answer",
  "answered",
  "assumed",
  "candidate",
  "choose",
  "constraint",
  "context",
  "default",
  "does",
  "from",
  "have",
  "high",
  "impact",
  "kind",
  "known",
  "language",
  "option",
  "plan",
  "prefer",
  "preference",
  "prefers",
  "question",
  "scope",
  "should",
  "that",
  "this",
  "tradeoff",
  "user",
  "want",
  "wants",
  "what",
  "which",
  "with",
]);

/** System prompt: frozen instructions, kept stable for prompt-cache friendliness. */
const CLARIFY_SYSTEM_PROMPT = [
  "You are Aimcub's planning engine, running the CLARIFYING step.",
  "You are shown a user's goal and a FIRST-PASS draft plan. Do NOT redo the plan.",
  "Your job: surface only the few questions whose answers would most change the plan,",
  "so the next pass is sharper. Be ruthlessly selective.",
  "",
  "Rules:",
  "- Return 0-7 questions. Let the unresolved high-impact context determine the count;",
  "  never target a fixed form length or add filler questions to reach a minimum.",
  "- Cover BOTH durable context and aim-local context. Durable/global context includes the",
  "  user's stable constraints, preferences, capabilities, and eval standards. Aim-local",
  "  context includes this aim's target surface, source material, workflow, files, commands,",
  "  artifacts, or external facts that should not become long-term memory.",
  "- Ask ONLY what materially branches the plan (value-of-information). If an unknown is",
  "  low-impact or safely defaultable, do NOT ask it — record it under `assumptions`",
  "  (default-and-disclose) so the user can correct it instead.",
  "- NEVER ask anything you could reasonably infer from the goal or the draft.",
  "- NEVER ask anything already answered by known user context. Put that under",
  "  assumptions/context instead and ask only what remains high-impact.",
  PLANNING_CONTEXT_RULES,
  "- Each question carries >= 2 `options`. Every option is a concrete hypothesis (a",
  "  candidate answer), never a blank, and states its `tradeoff` (the consequence).",
  "- Set `selection_mode` to `single` only when the options are mutually exclusive.",
  "  Set it to `multiple` when several options can be true together, such as constraints,",
  "  tools, platforms, evidence sources, source materials, or capabilities.",
  "- Decide from answer relationships, not option count, question kind, or words such as",
  "  'which' / '\u54ea\u6761'. Test every option pair: if a reasonable user could truthfully choose",
  "  both in the same scope, the question is `multiple`.",
  "- A compatible set of routes remains multiple even when the user may later prioritize one.",
  "  Ask a separate single-choice question only when one primary/first route is required.",
  "- Phrase every single-choice question so its one-current-state, exactly-one, primary,",
  "  default, or best-fit scope is explicit enough for the runtime to verify.",
  "- If uncertain, use `multiple` with `selection_mode_reason=unclear_defaults_multiple`.",
  "- Set `selection_mode_reason` to one of: `mutually_exclusive`,",
  "  `primary_choice_requested`, `compatible_options`, `unclear_defaults_multiple`.",
  "  Only the first two reasons permit `single`; the latter two require `multiple`.",
  "- Examples: one output format (Summary vs Detailed) is single; report sections, local",
  "  files + web research, completion evidence, constraints, capabilities, and compatible",
  "  life/career routes are multiple. Split questions that mix separate decision axes.",
  "- Keep question text short and user-facing. Avoid internal scorecard, contract, ROI,",
  "  lineage, or schema jargon in `question`, option `label`, and option `tradeoff`.",
  "- Option labels should be short natural phrases; put nuance in one concise tradeoff.",
  "- `allow_other` is always true — the user can always type a free-text answer.",
  "- Prefer questions about: exact target/outcome, source material to inspect, existing",
  "  workflow/tools, eval evidence, durable constraints, and agent routing/capability.",
  "- When plan review signals are provided, turn high-priority context gaps into questions",
  "  before asking lower-impact scope or preference questions.",
  "- When aim intake readiness is provided, use it as the front door for question budget:",
  "  prioritize high/medium intake questions that are not already answered by known context.",
  "- If aim intake says the aim is ready, ask only when draft review or historical learning",
  "  shows a materially useful question remains.",
  "- Use historical clarify learning as a tie-breaker: prefer dimensions whose past answers",
  "  improved plans, and ask low-ROI dimensions only when current review signals demand them.",
  "- Use historical capture learning as a second tie-breaker: prefer capture contracts whose",
  "  answers became memory and impacted plans; avoid or rephrase contracts that users answer",
  "  but fail to capture as memory, or that rarely impact plans.",
  "- Use historical context lineage learning as the strongest context tie-breaker: prefer",
  "  question categories whose past answers became durable memory and changed milestone",
  "  contracts; resolve pending context before asking new questions that repeat it.",
  "- Use current decomposition strategy to prioritize, not to starve intake. When it",
  "  prioritizes context fit, include questions whose answers can change milestone",
  "  boundaries, owner routing, required evidence, or eval signals.",
  "- When a question comes from review signals, set `source_dimension` to the scorecard",
  "  dimension it most improves: `verifiability`, `granularity`, `distinctness`, or",
  "  `context_fit`. Set it to null for general discovery questions.",
  "- Use `capability` when the answer identifies what the user, team, or linked agents are",
  "  good at or can access; those answers become routing context later.",
  "- Give every question a unique, stable `id` (e.g. `scope`, `q2`).",
  "- Follow the requested output language for every user-facing string. Do not translate",
  "  schema enum values, source_dimension values, ids, commands, paths, or code names.",
  "- The schema marks every field required: set any field that does not apply to null.",
].join("\n");

/** Render the draft compactly so questions can be grounded in it. */
function renderDraft(draft: DecompositionOutput): string {
  const nodes = Array.isArray(draft?.nodes) ? draft.nodes : [];
  if (nodes.length === 0) return "(empty draft)";
  return nodes
    .map((n) => {
      const lines = [`- ${n.key}: ${n.title}${n.description ? ` — ${n.description}` : ""}`];
      const contract = n.decomposition_contract;
      if (contract) {
        lines.push(
          `  contract: owner=${contract.likely_owner}; done=${contract.definition_of_done}; evidence=${contract.required_evidence.join(" | ")}; eval=${contract.eval_signal}`,
        );
        for (const gap of contract.context_gaps.slice(0, 3)) {
          lines.push(`  gap [${gap.category}]: ${gap.question} (${gap.reason})`);
        }
      }
      return lines.join("\n");
    })
    .join("\n");
}

function reviewForClarify(input: ClarifyInput): Pick<PlanReviewReport, "quality" | "context"> {
  return input.review ?? reviewPlan({ plan: input.draft, context: input.memories });
}

function fallbackGapRoiScore(gap: PlanContextGap): number {
  const priority = gap.priority === "high" ? 50 : gap.priority === "medium" ? 32 : 14;
  const category = gap.category === "eval_signal" ? 18 : gap.category === "procedure" ? 14 : gap.category === "constraint" ? 12 : 6;
  return priority + category + (gap.source === "decomposition_contract" ? 18 : 8) + (gap.nodeKey ? 8 : 0);
}

type CaptureLearningRowLike = Pick<
  NonNullable<ContextCaptureLearningReport["originRows"]>[number] | ContextCaptureLearningReport["rows"][number],
  "recommendation" | "impactedCount"
>;

function captureRecommendationAdjustment(row: CaptureLearningRowLike, strong: boolean): number {
  const base = row.recommendation === "ask_more"
    ? strong ? 22 : 14
    : row.recommendation === "ask_selectively"
      ? strong ? 5 : 2
      : row.recommendation === "fix_capture"
        ? strong ? -12 : -8
        : strong ? -20 : -14;
  return base > 0 ? base + Math.min(strong ? 12 : 8, row.impactedCount * (strong ? 3 : 2)) : base;
}

function originLearningMatchesGap(
  row: NonNullable<ContextCaptureLearningReport["originRows"]>[number],
  gap: PlanContextGap,
): boolean {
  if (row.category !== gap.category || row.askedCount === 0) return false;
  const nodeMatches = Boolean(gap.nodeKey && row.nodeKey === gap.nodeKey);
  const sourceMatches = Boolean(gap.source && row.gapSource === gap.source);
  const issueMatches = Boolean(
    gap.issueCodes &&
    gap.issueCodes.some((code) => row.issueCodes.includes(code)),
  );
  return nodeMatches || sourceMatches || issueMatches;
}

function captureLearningAdjustment(
  gap: PlanContextGap,
  learning: ContextCaptureLearningReport | null | undefined,
): number {
  if (!learning || learning.totalAsked === 0) return 0;
  const originRows = (learning.originRows ?? []).filter((row) => originLearningMatchesGap(row, gap));
  if (originRows.length > 0) {
    const bestOrigin = [...originRows].sort((a, b) =>
      b.impactedCount - a.impactedCount ||
      b.memoryCapturedCount - a.memoryCapturedCount ||
      b.answeredCount - a.answeredCount ||
      (b.avgRoiScore ?? 0) - (a.avgRoiScore ?? 0),
    )[0]!;
    const nodeBonus = gap.nodeKey && bestOrigin.nodeKey === gap.nodeKey ? 4 : 0;
    return captureRecommendationAdjustment(bestOrigin, true) + nodeBonus;
  }
  const rows = learning.rows.filter((row) => row.category === gap.category && row.askedCount > 0);
  if (rows.length === 0) return 0;
  const best = [...rows].sort((a, b) =>
    b.impactedCount - a.impactedCount ||
    b.memoryCapturedCount - a.memoryCapturedCount ||
    b.answeredCount - a.answeredCount,
  )[0]!;
  return captureRecommendationAdjustment(best, false);
}

function lineageRecommendationAdjustment(row: ContextLineageLearningRow, strong: boolean): number {
  const base = row.recommendation === "reuse_pattern"
    ? strong ? 24 : 16
    : row.recommendation === "resolve_pending"
      ? strong ? 18 : 12
      : row.recommendation === "ask_selectively"
        ? strong ? 5 : 2
        : strong ? -12 : -8;
  if (base <= 0) return base;
  return base + Math.min(strong ? 12 : 8, row.impactedCount * (strong ? 3 : 2)) + Math.min(6, row.pendingContextCount * 2);
}

function lineageLearningMatchesGap(row: ContextLineageLearningRow, gap: PlanContextGap): boolean {
  if (row.category !== gap.category || row.askedCount === 0) return false;
  if (gap.source && row.gapSource && row.gapSource !== gap.source) return false;
  return true;
}

function lineageLearningAdjustment(
  gap: PlanContextGap,
  learning: ContextLineageLearningReport | null | undefined,
): number {
  if (!learning || learning.totalQuestions === 0) return 0;
  const rows = learning.rows.filter((row) => lineageLearningMatchesGap(row, gap));
  if (rows.length === 0) return 0;
  const best = [...rows].sort((a, b) =>
    lineageRecommendationAdjustment(b, Boolean(gap.source && b.gapSource === gap.source)) -
      lineageRecommendationAdjustment(a, Boolean(gap.source && a.gapSource === gap.source)) ||
    b.impactedCount - a.impactedCount ||
    b.memoryCapturedCount - a.memoryCapturedCount ||
    b.pendingContextCount - a.pendingContextCount,
  )[0]!;
  return lineageRecommendationAdjustment(best, Boolean(gap.source && best.gapSource === gap.source));
}

function rankReviewGapsForClarify(
  gaps: readonly PlanContextGap[],
  captureLearning: ContextCaptureLearningReport | null | undefined,
  lineageLearning: ContextLineageLearningReport | null | undefined,
): PlanContextGap[] {
  return [...gaps].sort((a, b) => {
    const scoreA = (a.roiScore ?? fallbackGapRoiScore(a)) + captureLearningAdjustment(a, captureLearning) + lineageLearningAdjustment(a, lineageLearning);
    const scoreB = (b.roiScore ?? fallbackGapRoiScore(b)) + captureLearningAdjustment(b, captureLearning) + lineageLearningAdjustment(b, lineageLearning);
    return scoreB - scoreA ||
      (b.roiScore ?? 0) - (a.roiScore ?? 0) ||
      a.category.localeCompare(b.category) ||
      (a.nodeKey ?? "").localeCompare(b.nodeKey ?? "") ||
      a.prompt.localeCompare(b.prompt);
  });
}

function renderReviewSignals(
  review: Pick<PlanReviewReport, "quality" | "context">,
  captureLearning: ContextCaptureLearningReport | null | undefined,
  lineageLearning: ContextLineageLearningReport | null | undefined,
): string {
  const dimensions = (review.quality.dimensions ?? []).filter((dimension) =>
    dimension.grade !== "pass" || dimension.issueCount > 0,
  );
  const gaps = rankReviewGapsForClarify(review.context.gaps ?? [], captureLearning, lineageLearning);
  const lines: string[] = [];

  if (dimensions.length > 0) {
    lines.push("Scorecard dimensions needing attention:");
    for (const dimension of dimensions.slice(0, 4)) {
      const codes = dimension.issueCodes.length > 0 ? ` · ${dimension.issueCodes.join(", ")}` : "";
      lines.push(`- ${dimension.dimension}: ${dimension.grade} (${dimension.score}/100)${codes}`);
    }
  }

  if (gaps.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("Context gaps to turn into high-impact questions:");
    for (const gap of gaps.slice(0, 5)) {
      const source = gap.source ? ` · ${gap.source}` : "";
      const node = gap.nodeKey ? ` · ${gap.nodeKey}${gap.nodeTitle ? ` (${gap.nodeTitle})` : ""}` : "";
      const roi = typeof gap.roiScore === "number" ? ` · roi ${gap.roiScore}` : "";
      lines.push(`- [${gap.priority}] ${gap.category}${source}${node}${roi}: ${gap.prompt}`);
    }
  }

  return lines.length > 0 ? lines.join("\n") : "(no review gaps)";
}

function renderClarifyLearning(learning: ClarifyLearningReport | null | undefined): string {
  if (!learning || learning.total_answered === 0) return "(none yet)";
  const lines = [
    `Past clarify answers: ${learning.total_answered} answered · ${learning.total_impacted} impacted`,
  ];
  for (const row of learning.rows.filter((item) => item.answered_count > 0).slice(0, 4)) {
    lines.push(
      `- ${row.source_dimension}: ${row.recommendation}, ${row.impacted_count}/${row.answered_count} impacted, avg delta ${row.average_quality_delta}`,
    );
  }
  for (const line of learning.guidance.slice(0, 3)) lines.push(`- ${line}`);
  return lines.join("\n");
}

function renderCaptureLearning(learning: ContextCaptureLearningReport | null | undefined): string {
  if (!learning || learning.totalAsked === 0) return "(none yet)";
  const lines = [
    `Past capture contracts: ${learning.totalAsked} asked · ${learning.totalAnswered} answered · ${learning.totalCaptured} captured · ${learning.totalImpacted} impacted`,
  ];
  for (const row of learning.rows.filter((item) => item.askedCount > 0).slice(0, 5)) {
    lines.push(
      `- ${row.scope}/${row.category} · ${row.purpose} · improves ${row.improvesDimension}: ${row.recommendation}, answered ${row.answeredCount}/${row.askedCount}, captured ${row.memoryCapturedCount}, impacted ${row.impactedCount}`,
    );
  }
  const originRows = (learning.originRows ?? []).filter((item) => item.askedCount > 0).slice(0, 4);
  if (originRows.length > 0) {
    lines.push("Origin-specific capture signals:");
    for (const row of originRows) {
      const origin = row.nodeKey
        ? `${row.nodeKey}${row.nodeTitle ? ` (${row.nodeTitle})` : ""}`
        : row.gapSource ?? row.source;
      const roi = typeof row.avgRoiScore === "number" ? `, avg roi ${row.avgRoiScore}` : "";
      lines.push(
        `- ${origin} · ${row.scope}/${row.category} · ${row.purpose}: ${row.recommendation}, answered ${row.answeredCount}/${row.askedCount}, captured ${row.memoryCapturedCount}, impacted ${row.impactedCount}${roi}`,
      );
    }
  }
  for (const line of learning.guidance.slice(0, 4)) lines.push(`- ${line}`);
  return lines.join("\n");
}

function renderLineageLearning(learning: ContextLineageLearningReport | null | undefined): string {
  if (!learning || learning.totalQuestions === 0) return "(none yet)";
  const lines = [
    `Past context lineage: ${learning.totalQuestions} questions · ${learning.totalAnswered} answered · ${learning.totalCaptured} captured · ${learning.totalImpacted} impacted · ${learning.totalPending} pending`,
  ];
  for (const row of learning.rows.filter((item) => item.askedCount > 0).slice(0, 5)) {
    const source = row.gapSource ?? row.source;
    const example = row.exampleNodeTitle ? ` · example node: ${row.exampleNodeTitle}` : "";
    const accepted = row.acceptedContextCount ? `, accepted ${row.acceptedContextCount}` : "";
    const rejected = row.rejectedContextCount || row.deprioritizedContextCount
      ? `, rejected/deprioritized ${(row.rejectedContextCount ?? 0) + (row.deprioritizedContextCount ?? 0)}`
      : "";
    lines.push(
      `- ${source}/${row.category} · ${row.capturePurpose} · improves ${row.improvesDimension}: ${row.recommendation}, answered ${row.answeredCount}/${row.askedCount}, captured ${row.memoryCapturedCount}, impacted ${row.impactedCount}, pending ${row.pendingContextCount}${accepted}${rejected}${example}`,
    );
  }
  for (const line of learning.guidance.slice(0, 4)) lines.push(`- ${line}`);
  return lines.join("\n");
}

function strategyAwareMaxQuestions(maxQuestions: number | undefined, strategy: DecompositionStrategyReport | null | undefined): number {
  void strategy;
  return clampMax(maxQuestions);
}

function renderDecompositionStrategyForClarify(
  strategy: DecompositionStrategyReport | null | undefined,
  maxQuestions: number,
): string {
  const lines = [`Effective question budget: ${maxQuestions}`];
  if (!strategy || strategy.actions.length === 0) {
    lines.push("(no decomposition strategy actions yet)");
    return lines.join("\n");
  }
  lines.push(`Strategy for "${strategy.title}": ${strategy.actionCount} actions`);
  for (const action of strategy.actions.slice(0, 5)) {
    lines.push(
      `- [${action.priority}] ${action.focus} · ${action.sourceRows} source rows: ${action.recommendation} Reason: ${action.reason}`,
    );
  }
  if (strategy.actions.some((action) => action.focus === "context_fit")) {
    lines.push("- Context-fit budget rule: ask at most the effective question budget, and ask only when the answer can change milestone boundaries, owner routing, required evidence, or eval signals.");
  }
  for (const line of strategy.guidance.slice(0, 4)) lines.push(`- ${line}`);
  return lines.join("\n");
}

function renderAimIntake(intake: AimIntakeReport | null | undefined): string {
  if (!intake) return "(not provided)";
  const lines = [
    `Readiness: ${intake.readiness} (${intake.score}/100)`,
    `Context profile coverage: ${intake.coverage.profile.coverageScore}/100`,
    `Selected context rows: ${intake.coverage.selectedTotal}`,
  ];
  if (intake.coverage.missingCoreCategories.length > 0) {
    lines.push(`Missing core context: ${intake.coverage.missingCoreCategories.join(", ")}`);
  }
  if (intake.questions.length > 0) {
    lines.push("Targeted intake questions to prefer when still unresolved:");
    for (const question of intake.questions.slice(0, 5)) {
      lines.push(`- [${question.priority}] ${question.category} · ${question.source} · ${question.reason}: ${question.prompt}`);
    }
  }
  if (intake.acquisition?.length > 0) {
    lines.push("Recommended context acquisition channels:");
    for (const row of intake.acquisition.slice(0, 5)) {
      const tools = row.suggestedTools.length > 0 ? ` · tools: ${row.suggestedTools.join(", ")}` : "";
      const categories = row.categories.length > 0 ? ` · categories: ${row.categories.join(", ")}` : "";
      lines.push(`- [${row.priority}] ${row.channel} · ${row.scope}${categories}${tools}: ${row.action}`);
    }
  }
  if (intake.loop) {
    lines.push("Context intake loop:");
    lines.push(`- shouldContinue: ${intake.loop.shouldContinue}; nextStep: ${intake.loop.nextStepId ?? "none"}`);
    lines.push(`- stopCondition: ${intake.loop.stopCondition}`);
    for (const step of intake.loop.steps.slice(0, 4)) {
      const tools = step.toolCalls.length > 0
        ? ` · tools: ${step.toolCalls.map((tool) => `${tool.name}/${tool.boundary}`).join(", ")}`
        : "";
      const outputs = step.outputs.length > 0 ? ` · outputs: ${step.outputs.join(", ")}` : "";
      lines.push(`- ${step.id}: [${step.priority}] ${step.channel} · ${step.status} · repeat ${step.repeatMode}${outputs}${tools}`);
    }
  }
  if (intake.nextActions.length > 0) {
    lines.push("Intake next actions:");
    for (const action of intake.nextActions.slice(0, 3)) lines.push(`- ${action}`);
  }
  return lines.join("\n");
}

function dimensionIssueWhy(
  dimension: ClarifyQuestionSourceDimension,
  review: Pick<PlanReviewReport, "quality" | "context">,
): ClarifyQuestionWhy | null {
  const row = (review.quality.dimensions ?? []).find((item) => item.dimension === dimension);
  if (!row || (row.grade === "pass" && row.issueCount === 0)) return null;
  const issues = row.issueCodes.length > 0 ? `; issues: ${row.issueCodes.join(", ")}` : "";
  return {
    code: "quality_dimension",
    source_dimension: dimension,
    detail: `${dimension.replace("_", "-")} is ${row.grade} (${row.score}/100)${issues}`,
  };
}

function contextGapWhy(
  categories: readonly ContextCategory[],
  sourceDimension: ClarifyQuestionSourceDimension | undefined,
  review: Pick<PlanReviewReport, "quality" | "context">,
  captureLearning: ContextCaptureLearningReport | null | undefined,
  lineageLearning: ContextLineageLearningReport | null | undefined,
): ClarifyQuestionWhy | null {
  const categorySet = new Set(categories);
  const matching = rankReviewGapsForClarify(review.context.gaps ?? [], captureLearning, lineageLearning).filter((item) =>
    item.priority !== "low" && categorySet.has(item.category),
  );
  const gap = matching.find((item) => item.source === "decomposition_contract") ??
    categories.flatMap((category) => matching.filter((item) => item.category === category))[0];
  if (!gap) return null;
  return {
    code: "review_gap",
    source_dimension: sourceDimension,
    category: gap.category,
    priority: gap.priority,
    detail: gap.prompt,
    ...(gap.source ? { gapSource: gap.source } : {}),
    ...(gap.nodeKey ? { nodeKey: gap.nodeKey } : {}),
    ...(gap.nodeTitle ? { nodeTitle: gap.nodeTitle } : {}),
    ...(typeof gap.roiScore === "number" ? { roiScore: gap.roiScore } : {}),
    ...(gap.roiSignals ? { roiSignals: gap.roiSignals } : {}),
    ...(gap.issueCodes ? { issueCodes: gap.issueCodes } : {}),
  };
}

function questionContextGapWhy(
  question: Pick<ClarifyQuestion, "kind" | "source_dimension">,
  review: Pick<PlanReviewReport, "quality" | "context">,
  captureLearning: ContextCaptureLearningReport | null | undefined,
  lineageLearning: ContextLineageLearningReport | null | undefined,
): ClarifyQuestionWhy | null {
  const categories = question.source_dimension
    ? DIMENSION_CONTEXT_GAP_CATEGORIES[question.source_dimension]
    : QUESTION_CONTEXT_CATEGORIES[question.kind];
  return contextGapWhy(categories, question.source_dimension, review, captureLearning, lineageLearning);
}

function learningWhy(
  dimension: ClarifyQuestionSourceDimension,
  learning: ClarifyLearningReport | null | undefined,
): ClarifyQuestionWhy | null {
  const row = learning?.rows.find((item) => item.source_dimension === dimension && item.answered_count > 0);
  if (!row) return null;
  return {
    code: "historical_learning",
    source_dimension: dimension,
    recommendation: row.recommendation,
    detail: `${row.impacted_count}/${row.answered_count} past answers impacted plans; average quality delta ${row.average_quality_delta}`,
  };
}

function uniqueRoiSignals(signals: readonly PlanContextGapRoiSignal[]): PlanContextGapRoiSignal[] {
  return [...new Set(signals)];
}

function categoryRoiSignals(category: ContextCategory): PlanContextGapRoiSignal[] {
  switch (category) {
    case "eval_signal":
      return ["lineage_learning", "eval_signal"];
    case "procedure":
      return ["lineage_learning", "procedure"];
    case "constraint":
      return ["lineage_learning", "constraint"];
    case "capability":
      return ["lineage_learning", "capability"];
    case "preference":
    case "project_fact":
      return ["lineage_learning"];
  }
}

function bestLineageRowForQuestion(
  question: Pick<ClarifyQuestion, "kind" | "source_dimension">,
  learning: ContextLineageLearningReport | null | undefined,
): ContextLineageLearningRow | null {
  if (!learning || learning.totalQuestions === 0) return null;
  const categories = question.source_dimension
    ? DIMENSION_CONTEXT_GAP_CATEGORIES[question.source_dimension]
    : QUESTION_CONTEXT_CATEGORIES[question.kind];
  const categorySet = new Set(categories);
  const rows = learning.rows.filter((row) => row.askedCount > 0 && categorySet.has(row.category));
  if (rows.length === 0) return null;
  return [...rows].sort((a, b) => {
    const strongA = question.source_dimension ? a.improvesDimension === question.source_dimension : false;
    const strongB = question.source_dimension ? b.improvesDimension === question.source_dimension : false;
    return lineageRecommendationAdjustment(b, strongB) - lineageRecommendationAdjustment(a, strongA) ||
      Number(strongB) - Number(strongA) ||
      b.impactedCount - a.impactedCount ||
      b.memoryCapturedCount - a.memoryCapturedCount ||
      b.pendingContextCount - a.pendingContextCount ||
      b.answeredCount - a.answeredCount;
  })[0]!;
}

function lineageWhy(
  question: Pick<ClarifyQuestion, "kind" | "source_dimension">,
  learning: ContextLineageLearningReport | null | undefined,
): ClarifyQuestionWhy | null {
  const row = bestLineageRowForQuestion(question, learning);
  if (!row) return null;
  const impacted = row.memoryCapturedCount > 0
    ? `${row.impactedCount}/${row.memoryCapturedCount} captured answers impacted plans`
    : `${row.impactedCount} impacted plans`;
  const pending = row.pendingContextCount > 0 ? `; ${row.pendingContextCount} pending candidate${row.pendingContextCount === 1 ? "" : "s"}` : "";
  const example = row.exampleNodeTitle ? `; example node: ${row.exampleNodeTitle}` : "";
  return {
    code: "context_lineage",
    source_dimension: question.source_dimension ?? row.improvesDimension,
    category: row.category,
    recommendation: row.recommendation,
    detail: `${row.recommendation}: ${impacted}; answered ${row.answeredCount}/${row.askedCount}${pending}${example}`,
    originSource: "clarify",
    ...(row.gapSource ? { gapSource: row.gapSource } : {}),
    roiSignals: uniqueRoiSignals([...categoryRoiSignals(row.category), ...row.signals.filter((signal): signal is PlanContextGapRoiSignal =>
      signal === "high_priority" ||
      signal === "medium_priority" ||
      signal === "low_priority" ||
      signal === "decomposition_contract" ||
      signal === "missing_context" ||
      signal === "node_specific" ||
      signal === "quality_issue_linked" ||
      signal === "lineage_learning" ||
      signal === "eval_signal" ||
      signal === "procedure" ||
      signal === "constraint" ||
      signal === "capability",
    )]),
  };
}

function strategyActionMatchesQuestion(
  action: DecompositionStrategyReport["actions"][number],
  question: Pick<ClarifyQuestion, "kind" | "source_dimension">,
): boolean {
  switch (action.focus) {
    case "verifiability":
      return question.source_dimension === "verifiability";
    case "granularity":
      return question.source_dimension === "granularity";
    case "context_fit":
      return question.source_dimension === "context_fit" ||
        question.kind === "scope" ||
        question.kind === "constraint" ||
        question.kind === "capability" ||
        question.kind === "assumption";
    case "evidence_pattern":
      return question.source_dimension === "verifiability";
    case "contract_specificity":
      return question.source_dimension === "verifiability" ||
        question.source_dimension === "context_fit" ||
        question.kind === "assumption";
  }
}

function strategyWhy(
  question: Pick<ClarifyQuestion, "kind" | "source_dimension">,
  strategy: DecompositionStrategyReport | null | undefined,
): ClarifyQuestionWhy | null {
  const action = strategy?.actions.find((item) => strategyActionMatchesQuestion(item, question));
  if (!action) return null;
  return {
    code: "decomposition_strategy",
    source_dimension: question.source_dimension,
    priority: action.priority,
    strategyFocus: action.focus,
    sourceRows: action.sourceRows,
    detail: `${action.focus}: ${action.recommendation} ${action.reason}`,
  };
}

function intakeQuestionMatchesDimension(
  question: AimIntakeQuestion,
  dimension: ClarifyQuestionSourceDimension,
): boolean {
  return DIMENSION_CONTEXT_GAP_CATEGORIES[dimension].includes(question.category);
}

function intakeQuestionMatchesKind(question: AimIntakeQuestion, kind: ClarifyQuestionKind): boolean {
  return QUESTION_CONTEXT_CATEGORIES[kind].includes(question.category);
}

function intakeWhy(
  question: Pick<ClarifyQuestion, "kind" | "source_dimension">,
  intake: AimIntakeReport | null | undefined,
): ClarifyQuestionWhy | null {
  const row = intake?.questions.find((item) =>
    item.priority !== "low" &&
    (question.source_dimension
      ? intakeQuestionMatchesDimension(item, question.source_dimension)
      : intakeQuestionMatchesKind(item, question.kind)),
  );
  if (!row) return null;
  return {
    code: "aim_intake",
    source_dimension: question.source_dimension,
    category: row.category,
    priority: row.priority,
    detail: `${row.source}: ${row.reason} · ${row.prompt}`,
    originSource: row.source,
    gapSource: row.gapSource,
    nodeKey: row.nodeKey,
    nodeTitle: row.nodeTitle,
    roiScore: row.roiScore,
    roiSignals: row.roiSignals,
    issueCodes: row.issueCodes,
  };
}

function captureOriginFromWhy(why: readonly ClarifyQuestionWhy[]): ContextCaptureOrigin | undefined {
  const row = why.find((item) =>
    item.code === "review_gap" || item.code === "aim_intake",
  ) ?? why.find((item) => item.code === "context_lineage") ??
    why.find((item) => item.code === "decomposition_strategy");
  if (!row) return undefined;
  const roiSignals = uniqueRoiSignals(why.flatMap((item) => item.roiSignals ?? []));
  return {
    source: row.code === "review_gap"
      ? "review_gap"
      : row.code === "decomposition_strategy"
        ? "decomposition_strategy"
        : row.originSource ?? "clarify",
    reason: row.detail,
    prompt: row.detail,
    ...(row.gapSource ? { gapSource: row.gapSource } : {}),
    ...(row.nodeKey ? { nodeKey: row.nodeKey } : {}),
    ...(row.nodeTitle ? { nodeTitle: row.nodeTitle } : {}),
    ...(typeof row.roiScore === "number" ? { roiScore: row.roiScore } : {}),
    ...(roiSignals.length > 0 ? { roiSignals } : {}),
    ...(row.issueCodes ? { issueCodes: row.issueCodes } : {}),
  };
}

function annotateQuestionWhy(
  question: ClarifyQuestion,
  review: Pick<PlanReviewReport, "quality" | "context">,
  learning: ClarifyLearningReport | null | undefined,
  captureLearning: ContextCaptureLearningReport | null | undefined,
  lineageLearning: ContextLineageLearningReport | null | undefined,
  decompositionStrategy: DecompositionStrategyReport | null | undefined,
  intake: AimIntakeReport | null | undefined,
): ClarifyQuestion {
  const why = [
    intakeWhy(question, intake),
    strategyWhy(question, decompositionStrategy),
    questionContextGapWhy(question, review, captureLearning, lineageLearning),
    question.source_dimension ? dimensionIssueWhy(question.source_dimension, review) : null,
    question.source_dimension ? learningWhy(question.source_dimension, learning) : null,
    lineageWhy(question, lineageLearning),
  ].filter((item): item is ClarifyQuestionWhy => item !== null);
  if (why.length === 0) return question;
  const category = why.find((item) => item.category)?.category;
  const origin = captureOriginFromWhy(why);
  const isBaselineContextQuestion = question.capture?.reason === "baseline_context_intake";
  const shouldRetargetCapture = !isBaselineContextQuestion && Boolean(category && question.capture?.category !== category);
  const capture = shouldRetargetCapture && category
    ? contextCaptureForCategory(category, question.source_dimension ? `review_${question.source_dimension}` : "review_gap", question.source_dimension, origin)
    : question.capture && origin
      ? { ...question.capture, origin }
      : question.capture;
  return {
    ...question,
    why_asked: why,
    ...(capture ? { capture } : {}),
  };
}

function annotateClarifyWhy(
  output: ClarifyOutput,
  review: Pick<PlanReviewReport, "quality" | "context">,
  learning: ClarifyLearningReport | null | undefined,
  captureLearning: ContextCaptureLearningReport | null | undefined,
  lineageLearning: ContextLineageLearningReport | null | undefined,
  decompositionStrategy: DecompositionStrategyReport | null | undefined,
  intake: AimIntakeReport | null | undefined,
): ClarifyOutput {
  return {
    ...output,
    questions: output.questions.map((question) => annotateQuestionWhy(question, review, learning, captureLearning, lineageLearning, decompositionStrategy, intake)),
  };
}

function renderOutputLanguageInstruction(language: AimOutputLanguage | undefined): string {
  if (language === "simplified_chinese") {
    return [
      "Output language: Simplified Chinese.",
      "Write every user-facing question, reason, option label, option tradeoff, and assumption in Simplified Chinese.",
      "Keep schema enum values, ids, source_dimension values, commands, paths, and code names unchanged.",
    ].join("\n");
  }
  return [
    "Output language: English unless the user's aim is clearly written in another language.",
    "Keep schema enum values, ids, source_dimension values, commands, paths, and code names unchanged.",
  ].join("\n");
}

/** Build the per-goal user prompt. */
function buildClarifyPrompt(input: ClarifyInput, maxQuestions: number): string {
  const description = input.description?.trim() ? input.description.trim() : "(no description provided)";
  const review = reviewForClarify(input);
  const lines = [
    `Goal title: ${input.title}`,
    // Never state a guessed domain: a wrong label skews the questions worse than no label.
    `Goal domain: ${input.domain ?? "(not set — infer from the goal itself)"}`,
    `Goal description: ${description}`,
    "",
    renderOutputLanguageInstruction(input.outputLanguage),
    "",
    "Known user context from previous aims:",
    renderPlanningContext(input.memories),
    "",
    "Aim intake readiness:",
    renderAimIntake(input.intake),
    "",
    "First-pass draft milestones:",
    renderDraft(input.draft),
    "",
    "Historical clarify learning:",
    renderClarifyLearning(input.learning),
    "",
    "Historical capture learning:",
    renderCaptureLearning(input.captureLearning),
    "",
    "Historical context lineage learning:",
    renderLineageLearning(input.lineageLearning),
    "",
    "Current decomposition strategy:",
    renderDecompositionStrategyForClarify(input.decompositionStrategy, maxQuestions),
    "",
    "Plan review signals:",
    renderReviewSignals(review, input.captureLearning, input.lineageLearning),
  ];
  if (input.priorAnswers && input.priorAnswers.length > 0) {
    lines.push("", "The user already answered:");
    for (const a of input.priorAnswers) {
      const ans = clarifyAnswerText(a);
      lines.push(`- ${a.question_id}: ${ans}`);
    }
    lines.push("", "Ask only what is STILL unresolved and high-impact.");
  } else {
    lines.push("", "Surface a sufficient context intake set following the rules and schema.");
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
  const maxQuestions = strategyAwareMaxQuestions(input.maxQuestions, input.decompositionStrategy);
  const review = reviewForClarify(input);
  let raw: LlmResponse<unknown>;
  try {
    raw = await gateway.completeStructured<unknown>({
      task: "classify",
      system: CLARIFY_SYSTEM_PROMPT,
      prompt: buildClarifyPrompt({ ...input, review }, maxQuestions),
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

  const normalized = normalizeClarify(raw.output);
  if (!normalized) {
    return {
      output: null,
      validation: { ok: false, errors: ["clarify output is not shaped as { questions[], assumptions[] }"] },
      usage: raw.usage,
    };
  }
  const contextAware = filterQuestionsAnsweredByContext(normalized, input.memories, maxQuestions);
  const coverageAware = ensureContextIntakeCoverage(contextAware, input.memories, maxQuestions, input.outputLanguage);
  const annotated = annotateClarifyWhy(coverageAware, review, input.learning, input.captureLearning, input.lineageLearning, input.decompositionStrategy, input.intake);
  const validation = validateClarify(annotated);
  return { output: validation.ok ? annotated : null, validation, usage: raw.usage };
}

function clampMax(n: number | undefined): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return DEFAULT_MAX_QUESTIONS;
  return Math.max(1, Math.min(HARD_MAX_QUESTIONS, Math.floor(n)));
}

function isQuestionKind(v: unknown): v is ClarifyQuestionKind {
  return typeof v === "string" && (QUESTION_KINDS as readonly string[]).includes(v);
}

function isQuestionSourceDimension(v: unknown): v is ClarifyQuestionSourceDimension {
  return typeof v === "string" && (QUESTION_SOURCE_DIMENSIONS as readonly string[]).includes(v);
}

function answerContextCategory(
  question: Pick<ClarifyQuestion, "kind" | "source_dimension"> | undefined,
): ContextCategory {
  if (!question) return "preference";
  if (question.kind === "capability") return "capability";
  if (question.kind === "constraint") return "constraint";
  if (question.source_dimension === "verifiability" || question.source_dimension === "distinctness") {
    return "eval_signal";
  }
  if (question.source_dimension === "granularity") return "constraint";

  switch (question.kind) {
    case "assumption":
      return "project_fact";
    case "scope":
    case "involvement":
    default:
      return "preference";
  }
}

function captureForClarifyQuestion(
  question: Pick<ClarifyQuestion, "kind" | "source_dimension">,
): ContextCaptureContract {
  return contextCaptureForCategory(
    answerContextCategory(question),
    question.source_dimension ? `clarify_${question.source_dimension}` : `clarify_${question.kind}`,
    question.source_dimension,
  );
}

function memoryKindForContextCategory(category: ContextCategory): MemoryKind {
  return category === "procedure" ? "procedural" : "semantic";
}

function contextCategoryLabel(category: ContextCategory): string {
  switch (category) {
    case "eval_signal":
      return "Eval signal";
    case "project_fact":
      return "Project fact";
    case "preference":
      return "Preference";
    case "constraint":
      return "Constraint";
    case "capability":
      return "Capability";
    case "procedure":
      return "Procedure";
  }
}

function cleanMemoryText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function sentence(value: string): string {
  const cleaned = cleanMemoryText(value);
  return /[.!?]$/.test(cleaned) ? cleaned : `${cleaned}.`;
}

function clarifyAnswerText(answer: ClarifyAnswer): string {
  if (!Array.isArray(answer.selected_labels) || answer.selected_labels.length === 0) {
    return cleanMemoryText(answer.other_text ?? "") || cleanMemoryText(answer.selected_label ?? "");
  }
  const selected = answer.selected_labels.map((label) => cleanMemoryText(label)).filter(Boolean).join("; ");
  return [selected, cleanMemoryText(answer.other_text ?? "")]
    .filter(Boolean)
    .join(selected ? "; " : "");
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
function normalizeClarify(raw: unknown): ClarifyOutput | null {
  const cleaned = stripNulls(raw);
  if (!cleaned || typeof cleaned !== "object" || Array.isArray(cleaned)) return null;
  const o = cleaned as Record<string, unknown>;
  if (!Array.isArray(o.questions)) return null;

  const questions: ClarifyQuestion[] = (o.questions as unknown[]).map((q, i) => {
    const r = q && typeof q === "object" && !Array.isArray(q) ? (q as Record<string, unknown>) : {};
    const seenOptionLabels = new Set<string>();
    const options: ClarifyOption[] = (Array.isArray(r.options) ? (r.options as unknown[]) : [])
      .map((opt) => {
        const oo = opt && typeof opt === "object" && !Array.isArray(opt) ? (opt as Record<string, unknown>) : {};
        return {
          label: typeof oo.label === "string" ? oo.label : "",
          tradeoff: typeof oo.tradeoff === "string" ? oo.tradeoff : "",
        };
      })
      .filter((opt) => {
        const key = opt.label.trim().toLowerCase();
        if (!key || seenOptionLabels.has(key)) return false;
        seenOptionLabels.add(key);
        return true;
      });
    const question = typeof r.question === "string" ? r.question : "";
    const selection = decideChoiceSelection({
      question,
      options: options.map((option) => ({ label: option.label, detail: option.tradeoff })),
      requestedMode: r.selection_mode,
      requestedReason: r.selection_mode_reason,
    });
    return {
      id: typeof r.id === "string" && r.id.trim() ? r.id : `q${i + 1}`,
      question,
      why_high_impact: typeof r.why_high_impact === "string" ? r.why_high_impact : "",
      kind: isQuestionKind(r.kind) ? r.kind : "assumption",
      ...(isQuestionSourceDimension(r.source_dimension) ? { source_dimension: r.source_dimension } : {}),
      allow_other: true,
      selection_mode: selection.mode,
      selection_mode_reason: selection.reason,
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

  return {
    questions: questions.map((question) => ({
      ...question,
      capture: captureForClarifyQuestion(question),
    })),
    assumptions,
  };
}

function contextAnswerTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !CONTEXT_ANSWER_STOPWORDS.has(token));
}

function questionSearchText(question: ClarifyQuestion): string {
  return [
    question.id,
    question.question,
    question.why_high_impact,
    question.kind,
    ...question.options.flatMap((opt) => [opt.label, opt.tradeoff]),
  ].join(" ");
}

function contextAnswersQuestion(
  question: ClarifyQuestion,
  memories: readonly PlanningMemory[] | undefined,
): { memory: PlanningMemory; category: ContextCategory } | null {
  const qTokens = new Set(contextAnswerTokens(questionSearchText(question)));
  if (qTokens.size === 0) return null;
  const allowed = new Set<ContextCategory>(QUESTION_CONTEXT_CATEGORIES[question.kind]);

  for (const memory of memories ?? []) {
    const content = memory.content.trim();
    if (!content) continue;
    if (typeof memory.confidence === "number" && memory.confidence < 0.6) continue;
    const category = planningMemoryCategory(memory);
    if (!allowed.has(category)) continue;
    const overlap = contextAnswerTokens(content).filter((token) => qTokens.has(token));
    if (overlap.length > 0) return { memory, category };
  }

  return null;
}

interface BaselineContextQuestionTarget {
  id: string;
  category: ContextCategory;
  kind: ClarifyQuestionKind;
  source_dimension: ClarifyQuestionSourceDimension;
  question: string;
  why_high_impact: string;
  selection_mode: ClarifySelectionMode;
  selection_mode_reason: ChoiceSelectionReason;
  options: ClarifyOption[];
}

const BASELINE_CONTEXT_QUESTION_TARGETS: readonly BaselineContextQuestionTarget[] = [
  {
    id: "aim_target_context",
    category: "project_fact",
    kind: "assumption",
    source_dimension: "context_fit",
    question: "Which context sources should the agent inspect before finalizing this aim's plan?",
    why_high_impact: "This prevents the plan from guessing the current project state or target artifact.",
    selection_mode: "multiple",
    selection_mode_reason: "compatible_options",
    options: [
      { label: "Local project or files", tradeoff: "Grounds the plan in the current implementation or materials." },
      { label: "External or current research", tradeoff: "Adds current facts, documentation, or market context." },
      { label: "User-provided documents", tradeoff: "Uses the user's brief, examples, or source material." },
      { label: "Connected memory or tools", tradeoff: "Reuses prior preferences, workflows, and accessible systems." },
    ],
  },
  {
    id: "durable_eval_signal",
    category: "eval_signal",
    kind: "constraint",
    source_dimension: "verifiability",
    question: "Which kinds of evidence should Aimcub use to verify that this aim is complete?",
    why_high_impact: "This becomes a reusable evaluation signal and sharpens acceptance rules.",
    selection_mode: "multiple",
    selection_mode_reason: "compatible_options",
    options: [
      { label: "Automated artifact or test proves it", tradeoff: "Best for agent execution and repeatable eval." },
      { label: "Human review or subjective approval proves it", tradeoff: "Captures taste or judgment, but needs your review." },
    ],
  },
  {
    id: "aim_procedure_context",
    category: "procedure",
    kind: "constraint",
    source_dimension: "verifiability",
    question: "For this aim, are there existing commands, files, docs, workflows, or external references the agent should follow or research?",
    why_high_impact: "This gives the agent concrete local or web context to use before decomposing work.",
    selection_mode: "multiple",
    selection_mode_reason: "compatible_options",
    options: [
      { label: "Use existing local artifacts", tradeoff: "Grounds the plan in current files and workflows." },
      { label: "Research external/current information", tradeoff: "Useful for modern APIs, competitors, or market facts." },
    ],
  },
];

function highConfidenceGlobalMemoryForCategory(
  category: ContextCategory,
  memories: readonly PlanningMemory[] | undefined,
): boolean {
  return (memories ?? []).some((memory) => {
    if ((memory.goalId ?? memory.goal_id ?? null) !== null) return false;
    if (typeof memory.confidence === "number" && memory.confidence < 0.75) return false;
    return planningMemoryCategory(memory) === category && memory.content.trim().length > 0;
  });
}

function questionCategory(question: ClarifyQuestion): ContextCategory {
  return question.capture?.category ?? answerContextCategory(question);
}

function localizeBaselineContextQuestionTarget(
  target: BaselineContextQuestionTarget,
  language: AimOutputLanguage | undefined,
): BaselineContextQuestionTarget {
  if (language !== "simplified_chinese") return target;
  switch (target.id) {
    case "aim_target_context":
      return {
        ...target,
        question: "\u5728\u5b8c\u6210\u8ba1\u5212\u524d\uff0c\u4ee3\u7406\u5e94\u8be5\u67e5\u770b\u54ea\u4e9b\u4e0a\u4e0b\u6587\u6765\u6e90\uff1f",
        why_high_impact: "\u8fd9\u80fd\u907f\u514d\u8ba1\u5212\u51ed\u7a7a\u731c\u5f53\u524d\u72b6\u6001\u3002",
        options: [
          { label: "\u672c\u5730\u9879\u76ee\u6216\u6587\u4ef6", tradeoff: "\u8ba9\u8ba1\u5212\u57fa\u4e8e\u5f53\u524d\u5b9e\u73b0\u6216\u5df2\u6709\u6750\u6599\u3002" },
          { label: "\u5916\u90e8\u6216\u6700\u65b0\u7814\u7a76", tradeoff: "\u8865\u5145\u6700\u65b0\u4e8b\u5b9e\u3001\u6587\u6863\u6216\u5e02\u573a\u4fe1\u606f\u3002" },
          { label: "\u7528\u6237\u63d0\u4f9b\u7684\u6587\u6863", tradeoff: "\u4f7f\u7528\u7b80\u62a5\u3001\u8303\u4f8b\u6216\u6e90\u6750\u6599\u3002" },
          { label: "\u5df2\u8fde\u63a5\u7684\u8bb0\u5fc6\u6216\u5de5\u5177", tradeoff: "\u590d\u7528\u5df2\u6709\u504f\u597d\u3001\u6d41\u7a0b\u548c\u53ef\u8bbf\u95ee\u7cfb\u7edf\u3002" },
        ],
      };
    case "durable_eval_signal":
      return {
        ...target,
        question: "\u5bf9\u4f60\u6765\u8bf4\uff0c\u4ec0\u4e48\u8bc1\u636e\u80fd\u8bc1\u660e\u8fd9\u4e2a\u76ee\u6807\u771f\u7684\u5b8c\u6210\u4e86\uff1f",
        why_high_impact: "\u8fd9\u4f1a\u53d8\u6210\u53ef\u590d\u7528\u7684\u9a8c\u6536\u6807\u51c6\u3002",
        options: [
          { label: "\u81ea\u52a8\u5316\u7ed3\u679c\u8bc1\u660e", tradeoff: "\u9002\u5408\u4ee3\u7406\u6267\u884c\u548c\u91cd\u590d\u8bc4\u4f30\u3002" },
          { label: "\u4eba\u5de5\u786e\u8ba4\u5373\u53ef", tradeoff: "\u9002\u5408\u5ba1\u7f8e\u548c\u5224\u65ad\uff0c\u4f46\u9700\u8981\u4f60\u5ba1\u67e5\u3002" },
        ],
      };
    case "aim_procedure_context":
      return {
        ...target,
        question: "\u6709\u6ca1\u6709\u5df2\u6709\u547d\u4ee4\u3001\u6587\u4ef6\u3001\u6587\u6863\u3001\u6d41\u7a0b\u6216\u5916\u90e8\u8d44\u6599\u8981\u9075\u5faa\uff1f",
        why_high_impact: "\u8fd9\u80fd\u8ba9\u4ee3\u7406\u57fa\u4e8e\u771f\u5b9e\u6750\u6599\u62c6\u5206\u4efb\u52a1\u3002",
        options: [
          { label: "\u4f7f\u7528\u672c\u5730\u8d44\u6599", tradeoff: "\u8ba1\u5212\u4f1a\u8d34\u5408\u73b0\u6709\u6587\u4ef6\u548c\u6d41\u7a0b\u3002" },
          { label: "\u9700\u8981\u5916\u90e8\u7814\u7a76", tradeoff: "\u9002\u5408\u6700\u65b0 API\u3001\u7ade\u54c1\u6216\u5e02\u573a\u4fe1\u606f\u3002" },
        ],
      };
    default:
      return target;
  }
}

function createBaselineContextQuestion(
  target: BaselineContextQuestionTarget,
  language?: AimOutputLanguage,
): ClarifyQuestion {
  const localizedTarget = localizeBaselineContextQuestionTarget(target, language);
  return {
    id: localizedTarget.id,
    question: localizedTarget.question,
    why_high_impact: localizedTarget.why_high_impact,
    kind: localizedTarget.kind,
    source_dimension: localizedTarget.source_dimension,
    allow_other: true,
    selection_mode: localizedTarget.selection_mode,
    selection_mode_reason: localizedTarget.selection_mode_reason,
    options: [...localizedTarget.options],
    capture: contextCaptureForCategory(localizedTarget.category, "baseline_context_intake", localizedTarget.source_dimension, {
      source: "clarify",
      reason: localizedTarget.why_high_impact,
      prompt: localizedTarget.question,
      roiSignals: localizedTarget.category === "eval_signal"
        ? ["high_priority", "eval_signal"]
        : localizedTarget.category === "procedure"
          ? ["high_priority", "procedure"]
          : localizedTarget.category === "capability"
            ? ["medium_priority", "capability"]
            : ["medium_priority", "missing_context"],
    }),
  };
}

function ensureContextIntakeCoverage(
  output: ClarifyOutput,
  memories: readonly PlanningMemory[] | undefined,
  maxQuestions: number,
  outputLanguage?: AimOutputLanguage,
): ClarifyOutput {
  if (maxQuestions <= 0 || output.questions.length > 0) return output;
  const minQuestions = Math.min(maxQuestions, DEFAULT_EMPTY_CONTEXT_QUESTIONS);

  const questions = [...output.questions];
  const existingIds = new Set(questions.map((question) => question.id));
  const coveredCategories = new Set(questions.map(questionCategory));

  for (const target of BASELINE_CONTEXT_QUESTION_TARGETS) {
    if (questions.length >= minQuestions || questions.length >= maxQuestions) break;
    if (existingIds.has(target.id)) continue;
    if (coveredCategories.has(target.category)) continue;
    if (
      (target.category === "constraint" || target.category === "preference" || target.category === "capability" || target.category === "eval_signal") &&
      highConfidenceGlobalMemoryForCategory(target.category, memories)
    ) {
      continue;
    }
    const question = createBaselineContextQuestion(target, outputLanguage);
    questions.push(question);
    existingIds.add(question.id);
    coveredCategories.add(target.category);
  }

  return { ...output, questions };
}

function filterQuestionsAnsweredByContext(
  output: ClarifyOutput,
  memories: readonly PlanningMemory[] | undefined,
  maxQuestions: number,
): ClarifyOutput {
  const questions: ClarifyQuestion[] = [];
  const assumptions = [...output.assumptions];

  for (const question of output.questions) {
    const match = contextAnswersQuestion(question, memories);
    if (match) {
      assumptions.push({
        statement: `Answered from known ${match.category} context: ${question.question}`,
        default_value: match.memory.content.trim(),
      });
      continue;
    }
    if (questions.length < maxQuestions) questions.push(question);
  }

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
    const uniqueOptionLabels = new Set(q.options.map((option) => option.label.trim().toLowerCase()).filter(Boolean));
    if (uniqueOptionLabels.size !== q.options.length) errors.push(`question ${ref}: option labels must be unique`);
    if (q.selection_mode !== "single" && q.selection_mode !== "multiple") {
      errors.push(`question ${ref}: needs an explicit selection mode`);
    }
    if (!q.selection_mode_reason || !(CHOICE_SELECTION_REASONS as readonly string[]).includes(q.selection_mode_reason)) {
      errors.push(`question ${ref}: needs a valid selection mode reason`);
    }
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
    const ans = clarifyAnswerText(a);
    if (!ans) continue;
    const label = byId.get(a.question_id)?.question ?? a.question_id;
    lines.push(`- ${label} → ${ans}`);
  }
  if (lines.length === 0) return base;
  return [base, "", "Clarifications from the user:", ...lines].filter(Boolean).join("\n");
}

/**
 * Fold clarify answers into user-stated planning memories.
 *
 * These are active memories, not pending candidates: the user explicitly answered them.
 * Inferred assumptions and review gaps still flow through the pending context inbox.
 */
export function clarifyAnswersToMemories(
  questions: readonly ClarifyQuestion[],
  answers: readonly ClarifyAnswer[],
): ClarifyAnswerMemory[] {
  const byId = new Map(questions.map((q) => [q.id, q]));
  return answers
    .map((answer) => ({ answer, text: clarifyAnswerText(answer) }))
    .filter((row) => row.text.length > 0)
    .map(({ answer, text }) => {
      const question = byId.get(answer.question_id);
      const category = question?.capture?.category ?? answerContextCategory(question);
      const label = contextCategoryLabel(category);
      const questionText = cleanMemoryText(question?.question ?? answer.question_id);
      const sourceDimension = question?.source_dimension
        ? ` Source dimension: ${question.source_dimension.replace("_", "-")}.`
        : "";
      return {
        content: `${label}: ${sentence(text)} Clarify question: ${sentence(questionText)}${sourceDimension}`,
        kind: memoryKindForContextCategory(category),
        category,
        source: "user_stated" as const,
      };
    });
}

const IMPACT_STOPWORDS = new Set([
  "about",
  "acceptance",
  "answer",
  "answers",
  "build",
  "clarify",
  "complete",
  "done",
  "from",
  "have",
  "impact",
  "into",
  "milestone",
  "option",
  "plan",
  "question",
  "should",
  "that",
  "this",
  "what",
  "when",
  "which",
  "with",
]);

interface NodeChange {
  key: string;
  signals: ClarifyAnswerImpactSignal[];
  text: string;
}

function impactTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_./-]+/g, " ")
    .split(/\s+/)
    .map((token) => token.trim().replace(/^[./-]+|[./-]+$/g, ""))
    .filter((token) => token.length >= 3 && !IMPACT_STOPWORDS.has(token));
}

function hasTokenOverlap(haystack: string, needle: string): boolean {
  const haystackTokens = new Set(impactTokens(haystack));
  if (haystackTokens.size === 0) return false;
  return impactTokens(needle).some((token) => haystackTokens.has(token));
}

function nodeText(node: PlanNode): string {
  return [
    node.key,
    node.title,
    node.description,
    node.est_effort,
    String(node.xp_reward),
    JSON.stringify(node.acceptance_rule),
    JSON.stringify(node.decomposition_contract),
  ].join(" ");
}

function nodeTextSignature(node: PlanNode): string {
  return [node.title, node.description, node.est_effort, String(node.xp_reward), JSON.stringify(node.decomposition_contract)].join("\n");
}

function changedNodes(
  beforePlan: DecompositionOutput | null | undefined,
  afterPlan: DecompositionOutput,
): NodeChange[] {
  const beforeByKey = new Map((beforePlan?.nodes ?? []).map((node) => [node.key, node]));
  return afterPlan.nodes
    .map((node) => {
      const before = beforeByKey.get(node.key);
      const signals: ClarifyAnswerImpactSignal[] = [];
      if (!before) {
        signals.push("milestone_added");
      } else {
        if (nodeTextSignature(before) !== nodeTextSignature(node)) signals.push("milestone_text_changed");
        if (JSON.stringify(before.acceptance_rule) !== JSON.stringify(node.acceptance_rule)) {
          signals.push("acceptance_rule_changed");
        }
      }
      return { key: node.key, signals, text: nodeText(node) };
    })
    .filter((row) => row.signals.length > 0);
}

function qualityDimension(
  quality: PlanQualityReport | null | undefined,
  dimension: PlanQualityDimension,
): PlanQualityDimensionReport | null {
  return (quality?.dimensions ?? []).find((row) => row.dimension === dimension) ?? null;
}

function qualityDelta(
  beforeQuality: PlanQualityReport | null | undefined,
  afterQuality: PlanQualityReport | null | undefined,
): ClarifyAnswerQualityDelta[] {
  return QUESTION_SOURCE_DIMENSIONS.map((dimension) => {
    const before = qualityDimension(beforeQuality, dimension);
    const after = qualityDimension(afterQuality, dimension);
    const beforeScore = typeof before?.score === "number" ? before.score : null;
    const afterScore = typeof after?.score === "number" ? after.score : null;
    return {
      dimension,
      beforeScore,
      afterScore,
      delta: beforeScore !== null && afterScore !== null ? afterScore - beforeScore : null,
      beforeGrade: before?.grade ?? null,
      afterGrade: after?.grade ?? null,
    };
  });
}

function preferredChangeSignals(
  question: ClarifyQuestion | undefined,
): readonly ClarifyAnswerImpactSignal[] {
  switch (question?.source_dimension) {
    case "verifiability":
    case "distinctness":
      return ["acceptance_rule_changed", "node_matched_answer_terms", "node_matched_question_terms"];
    case "granularity":
      return ["milestone_added", "milestone_text_changed", "node_matched_answer_terms"];
    case "context_fit":
      return ["node_matched_answer_terms", "node_matched_question_terms", "milestone_text_changed"];
    default:
      return ["node_matched_answer_terms", "node_matched_question_terms", "milestone_text_changed"];
  }
}

function rankNodeChange(
  row: NodeChange,
  preferred: readonly ClarifyAnswerImpactSignal[],
): number {
  let score = 0;
  for (const signal of row.signals) {
    const index = preferred.indexOf(signal);
    score += index >= 0 ? 20 - index : 1;
  }
  return score;
}

function rowQualityImproved(
  dimension: ClarifyQuestionSourceDimension | undefined,
  deltas: readonly ClarifyAnswerQualityDelta[],
): boolean {
  if (!dimension) return false;
  const delta = deltas.find((row) => row.dimension === dimension)?.delta;
  return typeof delta === "number" && delta > 0;
}

export function traceClarifyAnswerImpact(input: {
  questions: readonly ClarifyQuestion[];
  answers: readonly ClarifyAnswer[];
  beforePlan?: DecompositionOutput | null;
  afterPlan: DecompositionOutput;
  beforeQuality?: PlanQualityReport | null;
  afterQuality?: PlanQualityReport | null;
}): ClarifyAnswerImpactReport {
  const byId = new Map(input.questions.map((question) => [question.id, question]));
  const deltas = qualityDelta(input.beforeQuality, input.afterQuality);
  const baseChanges = changedNodes(input.beforePlan, input.afterPlan);
  const allAfterNodes = input.afterPlan.nodes.map((node) => ({ key: node.key, signals: [] as ClarifyAnswerImpactSignal[], text: nodeText(node) }));
  const rows: ClarifyAnswerImpactRow[] = input.answers
    .map((answer) => {
      const text = clarifyAnswerText(answer);
      if (!text) return null;
      const question = byId.get(answer.question_id);
      const memory = clarifyAnswersToMemories(question ? [question] : [], [answer])[0];
      if (!memory) return null;
      const preferred = preferredChangeSignals(question);
      const changes = (baseChanges.length > 0 ? baseChanges : allAfterNodes)
        .map((change) => {
          const signals = [...change.signals];
          if (hasTokenOverlap(change.text, text)) signals.push("node_matched_answer_terms");
          if (question && hasTokenOverlap(change.text, question.question)) signals.push("node_matched_question_terms");
          return { ...change, signals: [...new Set(signals)] };
        })
        .filter((change) => change.signals.length > 0)
        .sort((a, b) => rankNodeChange(b, preferred) - rankNodeChange(a, preferred))
        .slice(0, 5);
      const signals = [...new Set(changes.flatMap((change) => change.signals))];
      if (rowQualityImproved(question?.source_dimension, deltas)) signals.unshift("quality_dimension_improved");
      return {
        question_id: answer.question_id,
        question: question?.question ?? answer.question_id,
        answer: text,
        kind: question?.kind ?? null,
        ...(question?.source_dimension ? { source_dimension: question.source_dimension } : {}),
        memory_category: memory.category,
        memory_content: memory.content,
        affected_node_keys: changes.map((change) => change.key),
        signals: [...new Set(signals)],
      };
    })
    .filter((row): row is ClarifyAnswerImpactRow => row !== null);

  return {
    version: 1,
    answered_count: rows.length,
    impacted_count: rows.filter((row) => row.affected_node_keys.length > 0 || row.signals.includes("quality_dimension_improved")).length,
    changed_node_count: baseChanges.length,
    quality_delta: deltas,
    rows,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeQualityDeltaRows(value: unknown): ClarifyAnswerQualityDelta[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const row = asRecord(item);
      if (!row || !isQuestionSourceDimension(row.dimension)) return null;
      return {
        dimension: row.dimension,
        beforeScore: typeof row.beforeScore === "number" ? row.beforeScore : null,
        afterScore: typeof row.afterScore === "number" ? row.afterScore : null,
        delta: typeof row.delta === "number" ? row.delta : null,
        beforeGrade: typeof row.beforeGrade === "string" ? row.beforeGrade as PlanQualityReport["grade"] : null,
        afterGrade: typeof row.afterGrade === "string" ? row.afterGrade as PlanQualityReport["grade"] : null,
      };
    })
    .filter((row): row is ClarifyAnswerQualityDelta => row !== null);
}

function normalizeImpactRows(value: unknown): ClarifyAnswerImpactRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const row = asRecord(item);
      if (!row) return null;
      const questionId = typeof row.question_id === "string" ? row.question_id : "";
      const question = typeof row.question === "string" ? row.question : questionId;
      const answer = typeof row.answer === "string" ? row.answer.trim() : "";
      if (!questionId || !answer) return null;
      const memoryCategory = typeof row.memory_category === "string" ? row.memory_category : "project_fact";
      return {
        question_id: questionId,
        question,
        answer,
        kind: isQuestionKind(row.kind) ? row.kind : null,
        ...(isQuestionSourceDimension(row.source_dimension) ? { source_dimension: row.source_dimension } : {}),
        memory_category: memoryCategory as ContextCategory,
        memory_content: typeof row.memory_content === "string" ? row.memory_content : "",
        affected_node_keys: Array.isArray(row.affected_node_keys)
          ? row.affected_node_keys.filter((key): key is string => typeof key === "string")
          : [],
        signals: Array.isArray(row.signals)
          ? row.signals.filter((signal): signal is ClarifyAnswerImpactSignal => typeof signal === "string")
          : [],
      };
    })
    .filter((row): row is ClarifyAnswerImpactRow => row !== null);
}

export function clarifyImpactReportFromMetadata(
  metadata: Record<string, unknown> | undefined,
): ClarifyAnswerImpactReport | null {
  const report = asRecord(metadata?.clarify_answer_impact);
  if (!report || report.version !== 1) return null;
  const rows = normalizeImpactRows(report.rows);
  return {
    version: 1,
    answered_count: asNumber(report.answered_count, rows.length),
    impacted_count: asNumber(report.impacted_count, rows.filter((row) =>
      row.affected_node_keys.length > 0 || row.signals.includes("quality_dimension_improved"),
    ).length),
    changed_node_count: asNumber(report.changed_node_count),
    quality_delta: normalizeQualityDeltaRows(report.quality_delta),
    rows,
  };
}

function reportDimensionDelta(
  report: ClarifyAnswerImpactReport,
  dimension: ClarifyQuestionSourceDimension,
): number {
  const delta = report.quality_delta.find((row) => row.dimension === dimension)?.delta;
  return typeof delta === "number" ? delta : 0;
}

function learningRecommendation(input: {
  answered: number;
  impactRate: number;
  averageDelta: number;
}): ClarifyLearningRecommendation {
  if (input.answered >= 1 && (input.impactRate >= 0.6 || input.averageDelta > 0)) return "ask_more";
  if (input.answered >= 2 && input.impactRate < 0.25 && input.averageDelta <= 0) return "ask_less";
  return "ask_selectively";
}

function learningGuidance(row: ClarifyLearningRow): string {
  const dimension = row.source_dimension.replace("_", "-");
  if (row.recommendation === "ask_more") {
    return `Prefer ${dimension} questions when current review signals allow it; ${row.impacted_count}/${row.answered_count} past answers impacted plans.`;
  }
  if (row.recommendation === "ask_less") {
    return `Avoid ${dimension} questions unless current review gaps demand them; past answers rarely changed plans.`;
  }
  return `Ask ${dimension} questions selectively when the current draft exposes a matching gap.`;
}

export function summarizeClarifyLearning(
  reports: readonly (ClarifyAnswerImpactReport | null | undefined)[],
): ClarifyLearningReport {
  const stats = new Map<ClarifyQuestionSourceDimension, {
    answered: number;
    impacted: number;
    affectedNodes: number;
    totalDelta: number;
  }>();
  for (const dimension of QUESTION_SOURCE_DIMENSIONS) {
    stats.set(dimension, { answered: 0, impacted: 0, affectedNodes: 0, totalDelta: 0 });
  }

  for (const report of reports) {
    if (!report) continue;
    for (const row of report.rows) {
      if (!row.source_dimension) continue;
      const stat = stats.get(row.source_dimension);
      if (!stat) continue;
      stat.answered += 1;
      if (row.affected_node_keys.length > 0 || row.signals.includes("quality_dimension_improved")) {
        stat.impacted += 1;
      }
      stat.affectedNodes += row.affected_node_keys.length;
      stat.totalDelta += reportDimensionDelta(report, row.source_dimension);
    }
  }

  const rows: ClarifyLearningRow[] = QUESTION_SOURCE_DIMENSIONS.map((dimension) => {
    const stat = stats.get(dimension)!;
    const impactRate = stat.answered > 0 ? Number((stat.impacted / stat.answered).toFixed(2)) : 0;
    const averageDelta = stat.answered > 0 ? Number((stat.totalDelta / stat.answered).toFixed(2)) : 0;
    return {
      source_dimension: dimension,
      answered_count: stat.answered,
      impacted_count: stat.impacted,
      impact_rate: impactRate,
      affected_node_count: stat.affectedNodes,
      total_quality_delta: Number(stat.totalDelta.toFixed(2)),
      average_quality_delta: averageDelta,
      recommendation: learningRecommendation({ answered: stat.answered, impactRate, averageDelta }),
    };
  });
  const activeRows = rows.filter((row) => row.answered_count > 0);
  return {
    version: 1,
    total_answered: activeRows.reduce((sum, row) => sum + row.answered_count, 0),
    total_impacted: activeRows.reduce((sum, row) => sum + row.impacted_count, 0),
    rows,
    guidance: activeRows
      .sort((a, b) => b.impacted_count - a.impacted_count || b.average_quality_delta - a.average_quality_delta)
      .slice(0, 4)
      .map(learningGuidance),
  };
}
