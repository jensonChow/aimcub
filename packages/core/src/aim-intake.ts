import type { ContextCategory, Memory, MemoryKind } from "@core/types";
import {
  inferContextCategory,
  reviewContextProfile,
  type ContextProfileCategoryRow,
  type ContextProfileReport,
} from "./context";
import type {
  PlanContextGapSource,
  PlanContextGapRoiSignal,
  PlanContextGapPriority,
  PlanQualityDimension,
  PlanQualityContext,
  PlanQualityIssueCode,
  PlanReviewReport,
} from "./plan-quality";
import type { ContextLineageLearningReport, ContextLineageLearningRow } from "./context-lineage";

export type AimIntakeReadiness = "ready" | "needs_targeted_context" | "needs_plan_refinement";
export type AimIntakeQuestionSource = "aim_text" | "context_profile" | "planning_context" | "draft_review";
export type ContextCaptureOriginSource = AimIntakeQuestionSource | "clarify" | "review_gap" | "decomposition_strategy";
export type ContextCaptureScope = "aim" | "global";
export type ContextCapturePurpose =
  | "shape_plan"
  | "define_eval"
  | "route_work"
  | "reuse_preference"
  | "document_procedure";

export interface ContextCaptureOrigin {
  source: ContextCaptureOriginSource;
  reason: string;
  prompt?: string;
  gapSource?: PlanContextGapSource;
  nodeKey?: string;
  nodeTitle?: string;
  roiScore?: number;
  roiSignals?: PlanContextGapRoiSignal[];
  issueCodes?: PlanQualityIssueCode[];
}

export interface ContextCaptureContract {
  category: ContextCategory;
  scope: ContextCaptureScope;
  purpose: ContextCapturePurpose;
  improvesDimension: PlanQualityDimension;
  reason: string;
  origin?: ContextCaptureOrigin;
}

export interface AimIntakeQuestion {
  id: string;
  category: ContextCategory;
  priority: PlanContextGapPriority;
  source: AimIntakeQuestionSource;
  reason: string;
  prompt: string;
  capture?: ContextCaptureContract;
  gapSource?: PlanContextGapSource;
  nodeKey?: string;
  nodeTitle?: string;
  roiScore?: number;
  roiSignals?: PlanContextGapRoiSignal[];
  issueCodes?: PlanQualityIssueCode[];
}

export interface AimIntakeSelectedContextRow {
  category: ContextCategory;
  count: number;
  highConfidenceCount: number;
}

export interface AimIntakeContextCoverage {
  profile: ContextProfileReport;
  selectedTotal: number;
  selectedByCategory: AimIntakeSelectedContextRow[];
  missingCoreCategories: ContextCategory[];
}

export interface AimIntakeReport {
  title: string;
  readiness: AimIntakeReadiness;
  score: number;
  coverage: AimIntakeContextCoverage;
  questions: AimIntakeQuestion[];
  nextActions: string[];
}

export interface ReviewAimIntakeInput {
  title: string;
  description?: string | null;
  memories?: readonly Pick<Memory, "content" | "category" | "confidence" | "goal_id" | "status">[];
  selectedContext?: readonly PlanQualityContext[];
  draftReview?: PlanReviewReport | null;
  lineageLearning?: ContextLineageLearningReport | null;
  maxQuestions?: number;
}

const CORE_CONTEXT_CATEGORIES: readonly ContextCategory[] = ["eval_signal", "constraint", "procedure"];
const QUESTION_SOURCE_RANK: Record<AimIntakeQuestionSource, number> = {
  draft_review: 0,
  aim_text: 1,
  planning_context: 2,
  context_profile: 3,
};
const PRIORITY_RANK: Record<PlanContextGapPriority, number> = {
  high: 0,
  medium: 1,
  low: 2,
};
const PRIORITY_PENALTY: Record<PlanContextGapPriority, number> = {
  high: 24,
  medium: 12,
  low: 5,
};

function cleanText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function contextCategory(row: { content: string; category?: string | null; kind?: MemoryKind | string }): ContextCategory {
  if (
    row.category === "preference" ||
    row.category === "constraint" ||
    row.category === "capability" ||
    row.category === "eval_signal" ||
    row.category === "project_fact" ||
    row.category === "procedure"
  ) {
    return row.category;
  }
  return inferContextCategory(row.content, row.kind === "procedural" ? "procedure" : "project_fact");
}

function categoryPrompt(category: ContextCategory): string {
  switch (category) {
    case "eval_signal":
      return "Ask what would make this aim count as genuinely complete, and what evidence would prove it without relying on manual judgment alone.";
    case "constraint":
      return "Ask for non-negotiable scope boundaries such as tools, platform limits, privacy, budget, deadlines, or quality bars.";
    case "procedure":
      return "Ask whether there is an existing workflow, checklist, command, artifact, or review path this aim should follow.";
    case "capability":
      return "Ask who or which agent is best suited for each kind of work, only if routing would change the plan.";
    case "preference":
      return "Ask for stable preferences that should shape scope, interaction style, or default tradeoffs.";
    case "project_fact":
      return "Ask for the desired outcome, target surface, and known environment facts before decomposing.";
  }
}

function contextCaptureScope(category: ContextCategory): ContextCaptureScope {
  switch (category) {
    case "project_fact":
    case "procedure":
      return "aim";
    case "preference":
    case "constraint":
    case "capability":
    case "eval_signal":
      return "global";
  }
}

function contextCapturePurpose(category: ContextCategory): ContextCapturePurpose {
  switch (category) {
    case "eval_signal":
      return "define_eval";
    case "capability":
      return "route_work";
    case "preference":
      return "reuse_preference";
    case "procedure":
      return "document_procedure";
    case "constraint":
    case "project_fact":
      return "shape_plan";
  }
}

function contextCaptureDimension(category: ContextCategory): PlanQualityDimension {
  switch (category) {
    case "eval_signal":
    case "procedure":
      return "verifiability";
    case "constraint":
      return "granularity";
    case "preference":
    case "capability":
    case "project_fact":
      return "context_fit";
  }
}

export function contextCaptureForCategory(
  category: ContextCategory,
  reason = "question_answer",
  improvesDimension?: PlanQualityDimension,
  origin?: ContextCaptureOrigin,
): ContextCaptureContract {
  return {
    category,
    scope: contextCaptureScope(category),
    purpose: contextCapturePurpose(category),
    improvesDimension: improvesDimension ?? contextCaptureDimension(category),
    reason,
    ...(origin ? { origin } : {}),
  };
}

function profilePriority(row: ContextProfileCategoryRow): PlanContextGapPriority {
  if (row.category === "eval_signal" && row.strength === "missing") return "high";
  if (row.strength === "missing") return "medium";
  if (row.pendingCount > 0) return "medium";
  return "low";
}

function selectedContextRows(selectedContext: readonly PlanQualityContext[]): AimIntakeSelectedContextRow[] {
  const byCategory = new Map<ContextCategory, { count: number; highConfidenceCount: number }>();
  for (const row of selectedContext) {
    if (cleanText(row.content).length === 0) continue;
    if (typeof row.confidence === "number" && row.confidence < 0.6) continue;
    const category = contextCategory(row);
    const current = byCategory.get(category) ?? { count: 0, highConfidenceCount: 0 };
    current.count += 1;
    if (typeof row.confidence !== "number" || row.confidence >= 0.75) current.highConfidenceCount += 1;
    byCategory.set(category, current);
  }
  return [...byCategory.entries()]
    .map(([category, stats]) => ({ category, ...stats }))
    .sort((a, b) => a.category.localeCompare(b.category));
}

function actionPriorityValue(priority: "high" | "medium" | "low"): number {
  return priority === "high" ? 0 : priority === "medium" ? 1 : 2;
}

function sortQuestions(a: AimIntakeQuestion, b: AimIntakeQuestion): number {
  return (b.roiScore ?? 0) - (a.roiScore ?? 0) ||
    PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
    QUESTION_SOURCE_RANK[a.source] - QUESTION_SOURCE_RANK[b.source] ||
    a.category.localeCompare(b.category) ||
    a.prompt.localeCompare(b.prompt);
}

function uniqueRoiSignals(signals: readonly PlanContextGapRoiSignal[]): PlanContextGapRoiSignal[] {
  return [...new Set(signals)];
}

function lineageRecommendationBonus(row: ContextLineageLearningRow): number {
  switch (row.recommendation) {
    case "reuse_pattern":
      return 20 + Math.min(12, row.impactedCount * 3);
    case "resolve_pending":
      return 14 + Math.min(8, row.pendingContextCount * 2);
    case "ask_selectively":
      return 5;
    case "fix_capture":
      return -8;
  }
}

function bestLineageLearningRow(
  question: Omit<AimIntakeQuestion, "id">,
  learning: ContextLineageLearningReport | null | undefined,
): ContextLineageLearningRow | null {
  if (!learning || learning.totalQuestions === 0) return null;
  const rows = learning.rows.filter((row) => {
    if (row.askedCount === 0 || row.category !== question.category) return false;
    if (question.gapSource && row.gapSource && question.gapSource !== row.gapSource) return false;
    return true;
  });
  if (rows.length === 0) return null;
  return [...rows].sort((a, b) =>
    lineageRecommendationBonus(b) - lineageRecommendationBonus(a) ||
    b.impactedCount - a.impactedCount ||
    b.memoryCapturedCount - a.memoryCapturedCount ||
    b.pendingContextCount - a.pendingContextCount,
  )[0]!;
}

function applyLineageLearning(
  question: Omit<AimIntakeQuestion, "id">,
  learning: ContextLineageLearningReport | null | undefined,
): Omit<AimIntakeQuestion, "id"> {
  const row = bestLineageLearningRow(question, learning);
  if (!row) return question;
  const bonus = lineageRecommendationBonus(row);
  const baseScore = question.roiScore ?? PRIORITY_PENALTY[question.priority];
  const nextPriority = question.priority === "medium" && (row.recommendation === "reuse_pattern" || row.recommendation === "resolve_pending")
    ? "high"
    : question.priority;
  return {
    ...question,
    priority: nextPriority,
    roiScore: Math.max(0, Math.round(baseScore + bonus)),
    roiSignals: uniqueRoiSignals([
      ...(question.roiSignals ?? []),
      "lineage_learning",
      ...(row.category === "eval_signal" ? ["eval_signal" as const] : []),
      ...(row.category === "procedure" ? ["procedure" as const] : []),
      ...(row.category === "constraint" ? ["constraint" as const] : []),
    ]),
  };
}

function scoreQuestions(questions: readonly AimIntakeQuestion[], draftReview: PlanReviewReport | null | undefined): number {
  const questionPenalty = questions.reduce((sum, question) => sum + PRIORITY_PENALTY[question.priority], 0);
  const reviewPenalty = draftReview?.quality.grade === "fail" ? 20 : draftReview?.quality.grade === "warn" ? 8 : 0;
  return Math.max(0, 100 - questionPenalty - reviewPenalty);
}

function readiness(input: {
  questions: readonly AimIntakeQuestion[];
  draftReview?: PlanReviewReport | null;
}): AimIntakeReadiness {
  if (
    input.draftReview?.quality.grade === "fail" ||
    input.draftReview?.actions.some((action) => action.priority === "high") ||
    input.questions.some((question) => question.source === "draft_review" && question.priority === "high")
  ) {
    return "needs_plan_refinement";
  }
  if (input.questions.some((question) => question.priority === "high" || question.priority === "medium")) {
    return "needs_targeted_context";
  }
  return "ready";
}

function addQuestion(
  questions: AimIntakeQuestion[],
  seen: Set<string>,
  question: Omit<AimIntakeQuestion, "id">,
): void {
  const key = `${question.category}\u0000${question.source}\u0000${question.prompt}`;
  if (seen.has(key)) return;
  seen.add(key);
  questions.push({
    ...question,
    id: "",
    capture: question.capture ?? contextCaptureForCategory(question.category, question.reason, undefined, {
      source: question.source,
      reason: question.reason,
      prompt: question.prompt,
      ...(question.gapSource ? { gapSource: question.gapSource } : {}),
      ...(question.nodeKey ? { nodeKey: question.nodeKey } : {}),
      ...(question.nodeTitle ? { nodeTitle: question.nodeTitle } : {}),
      ...(typeof question.roiScore === "number" ? { roiScore: question.roiScore } : {}),
      ...(question.roiSignals ? { roiSignals: question.roiSignals } : {}),
      ...(question.issueCodes ? { issueCodes: question.issueCodes } : {}),
    }),
  });
}

function aimTextQuestions(input: ReviewAimIntakeInput): Omit<AimIntakeQuestion, "id">[] {
  const title = cleanText(input.title);
  const description = cleanText(input.description);
  const titleTokens = title.split(/\s+/).filter(Boolean);
  if (description.length >= 40 || titleTokens.length >= 8) return [];
  return [{
    category: "project_fact",
    priority: description.length === 0 && titleTokens.length <= 4 ? "high" : "medium",
    source: "aim_text",
    reason: "thin_aim_statement",
    prompt: categoryPrompt("project_fact"),
  }];
}

function profileQuestions(input: {
  profile: ContextProfileReport;
  selectedCategories: Set<ContextCategory>;
}): Omit<AimIntakeQuestion, "id">[] {
  const questions: Omit<AimIntakeQuestion, "id">[] = [];
  for (const row of input.profile.rows) {
    if (!CORE_CONTEXT_CATEGORIES.includes(row.category)) continue;
    if (input.selectedCategories.has(row.category)) continue;
    if (row.strength === "ready" || row.strength === "strong") continue;
    questions.push({
      category: row.category,
      priority: profilePriority(row),
      source: row.pendingCount > 0 ? "planning_context" : "context_profile",
      reason: row.pendingCount > 0 ? "pending_context_not_selected" : `profile_${row.strength}`,
      prompt: row.pendingCount > 0
        ? `Review pending ${row.category} context before decomposing, or answer directly: ${categoryPrompt(row.category)}`
        : categoryPrompt(row.category),
    });
  }
  return questions;
}

function draftReviewQuestions(review: PlanReviewReport | null | undefined): Omit<AimIntakeQuestion, "id">[] {
  if (!review) return [];
  return review.context.gaps.map((gap) => ({
    category: gap.category,
    priority: gap.priority,
    source: "draft_review",
    reason: gap.reason,
    prompt: gap.prompt,
    gapSource: gap.source,
    nodeKey: gap.nodeKey,
    nodeTitle: gap.nodeTitle,
    roiScore: gap.roiScore,
    roiSignals: gap.roiSignals,
    issueCodes: gap.issueCodes,
  }));
}

function nextActions(input: {
  report: Omit<AimIntakeReport, "nextActions">;
  draftReview?: PlanReviewReport | null;
}): string[] {
  const actions: string[] = [];
  const highQuestions = input.report.questions.filter((question) => question.priority === "high").length;
  const mediumQuestions = input.report.questions.filter((question) => question.priority === "medium").length;
  const pendingRows = input.report.coverage.profile.totalPending;

  if (input.report.readiness === "needs_plan_refinement") {
    actions.push("Refine the draft before accepting the decomposition.");
  }
  for (const action of [...(input.draftReview?.actions ?? [])].sort((a, b) => actionPriorityValue(a.priority) - actionPriorityValue(b.priority)).slice(0, 3)) {
    actions.push(action.reason);
  }
  if (highQuestions > 0) {
    actions.push(`Answer ${highQuestions} high-priority intake question${highQuestions === 1 ? "" : "s"} before accepting a plan.`);
  } else if (mediumQuestions > 0) {
    actions.push(`Answer ${mediumQuestions} targeted intake question${mediumQuestions === 1 ? "" : "s"} if the answer would change scope or evidence.`);
  }
  if (pendingRows > 0) {
    actions.push("Review pending context candidates so future aims need fewer questions.");
  }
  if (input.report.coverage.selectedTotal === 0) {
    actions.push("Let answers and completion evidence from this aim seed the user's context profile.");
  }
  if (actions.length === 0) {
    actions.push("Proceed with decomposition and keep collecting eval signals from evidence.");
  }
  return [...new Set(actions)];
}

export function reviewAimIntake(input: ReviewAimIntakeInput): AimIntakeReport {
  const profile = reviewContextProfile({ memories: input.memories ?? [] });
  const selectedByCategory = selectedContextRows(input.selectedContext ?? []);
  const selectedCategories = new Set(selectedByCategory.map((row) => row.category));
  const missingCoreCategories = CORE_CONTEXT_CATEGORIES.filter((category) => !selectedCategories.has(category));
  const seen = new Set<string>();
  const questions: AimIntakeQuestion[] = [];

  for (const question of [
    ...aimTextQuestions(input),
    ...profileQuestions({ profile, selectedCategories }),
    ...draftReviewQuestions(input.draftReview),
  ]) {
    addQuestion(questions, seen, applyLineageLearning(question, input.lineageLearning));
  }

  const sortedQuestions = questions
    .sort(sortQuestions)
    .slice(0, Math.max(1, Math.min(8, Math.floor(input.maxQuestions ?? 5))))
    .map((question, index) => ({ ...question, id: `intake_${index + 1}` }));
  const partial = {
    title: cleanText(input.title),
    readiness: readiness({ questions: sortedQuestions, draftReview: input.draftReview }),
    score: scoreQuestions(sortedQuestions, input.draftReview),
    coverage: {
      profile,
      selectedTotal: selectedByCategory.reduce((sum, row) => sum + row.count, 0),
      selectedByCategory,
      missingCoreCategories,
    },
    questions: sortedQuestions,
  };
  return {
    ...partial,
    nextActions: nextActions({ report: partial, draftReview: input.draftReview }),
  };
}
