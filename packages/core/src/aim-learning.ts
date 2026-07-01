import type { ContextCategory, Goal, Memory } from "@core/types";
import type { AimIntakeReadiness } from "./aim-intake";
import { inferContextCategory } from "./context";
import type { PlanContextGapPriority } from "./plan-quality";

export type AimLearningSource = "clarify_answer" | "reviewed_context" | "pending_context" | "intake_gap" | "review_gap";
export type AimLearningStatus = "learned" | "pending" | "gap";

export interface AimLearningRow {
  source: AimLearningSource;
  status: AimLearningStatus;
  category: ContextCategory;
  content: string;
  reason: string;
  priority?: PlanContextGapPriority;
}

export interface AimLearningIntakeSummary {
  readiness: AimIntakeReadiness;
  score: number;
  missingCoreCategories: ContextCategory[];
  questionCount: number;
}

export interface AimLearningClarifySummary {
  answeredCount: number;
  impactedCount: number;
  changedNodeCount: number;
}

export interface AimLearningReport {
  goalId: string;
  title: string;
  intake: AimLearningIntakeSummary | null;
  clarify: AimLearningClarifySummary | null;
  learnedCount: number;
  pendingContextCount: number;
  gapCount: number;
  rows: AimLearningRow[];
  nextActions: string[];
}

export interface ReviewAimLearningInput {
  goal: Pick<Goal, "id" | "title" | "metadata">;
  pendingContext?: readonly Pick<Memory, "content" | "category" | "status" | "source" | "goal_id">[];
  contextOutcomes?: readonly Pick<Memory, "content" | "category" | "status" | "source" | "goal_id" | "superseded_by">[];
}

const READINESS = new Set<AimIntakeReadiness>(["ready", "needs_targeted_context", "needs_plan_refinement"]);
const CATEGORIES = new Set<ContextCategory>([
  "preference",
  "constraint",
  "capability",
  "eval_signal",
  "project_fact",
  "procedure",
]);
const PRIORITIES = new Set<PlanContextGapPriority>(["high", "medium", "low"]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function asCategory(value: unknown, fallbackText = ""): ContextCategory {
  return typeof value === "string" && CATEGORIES.has(value as ContextCategory)
    ? value as ContextCategory
    : inferContextCategory(fallbackText);
}

function asPriority(value: unknown): PlanContextGapPriority {
  return typeof value === "string" && PRIORITIES.has(value as PlanContextGapPriority)
    ? value as PlanContextGapPriority
    : "medium";
}

function intakeSummary(metadata: Record<string, unknown> | undefined): AimLearningIntakeSummary | null {
  const intake = asRecord(metadata?.aim_intake);
  if (!intake || !READINESS.has(intake.readiness as AimIntakeReadiness)) return null;
  const coverage = asRecord(intake.coverage);
  const missingCoreCategories = Array.isArray(coverage?.missingCoreCategories)
    ? coverage.missingCoreCategories.filter((category): category is ContextCategory =>
        typeof category === "string" && CATEGORIES.has(category as ContextCategory),
      )
    : [];
  return {
    readiness: intake.readiness as AimIntakeReadiness,
    score: asNumber(intake.score),
    missingCoreCategories,
    questionCount: Array.isArray(intake.questions) ? intake.questions.length : 0,
  };
}

function clarifySummary(metadata: Record<string, unknown> | undefined): AimLearningClarifySummary | null {
  const impact = asRecord(metadata?.clarify_answer_impact);
  if (!impact || impact.version !== 1) return null;
  return {
    answeredCount: asNumber(impact.answered_count),
    impactedCount: asNumber(impact.impacted_count),
    changedNodeCount: asNumber(impact.changed_node_count),
  };
}

function clarifyRows(metadata: Record<string, unknown> | undefined): AimLearningRow[] {
  const impact = asRecord(metadata?.clarify_answer_impact);
  if (!impact || impact.version !== 1 || !Array.isArray(impact.rows)) return [];
  return impact.rows.flatMap((item) => {
    const row = asRecord(item);
    if (!row) return [];
    const content = cleanText(row.memory_content) || cleanText(row.answer);
    if (!content) return [];
    const affected = Array.isArray(row.affected_node_keys) ? row.affected_node_keys.length : 0;
    const signals = Array.isArray(row.signals) ? row.signals.filter((signal) => typeof signal === "string") : [];
    return [{
      source: "clarify_answer",
      status: "learned",
      category: asCategory(row.memory_category, content),
      content,
      reason: affected > 0 || signals.includes("quality_dimension_improved")
        ? "answer_changed_plan"
        : "answer_captured_context",
    } satisfies AimLearningRow];
  });
}

function pendingRows(pendingContext: ReviewAimLearningInput["pendingContext"]): AimLearningRow[] {
  return (pendingContext ?? [])
    .filter((memory) => memory.status === "pending" && cleanText(memory.content).length > 0)
    .map((memory) => ({
      source: "pending_context",
      status: "pending",
      category: memory.category,
      content: cleanText(memory.content),
      reason: memory.source === "agent_inferred" ? "needs_user_review" : "pending_confirmation",
    }));
}

function reviewedContextRows(input: ReviewAimLearningInput): AimLearningRow[] {
  return (input.contextOutcomes ?? [])
    .filter((memory) => memory.goal_id === input.goal.id && cleanText(memory.content).length > 0)
    .flatMap((memory): AimLearningRow[] => {
      if (memory.status === "active") {
        return [{
          source: "reviewed_context",
          status: "learned",
          category: memory.category,
          content: cleanText(memory.content),
          reason: "context_accepted",
        }];
      }
      if (memory.status === "deleted" && memory.superseded_by) {
        return [{
          source: "reviewed_context",
          status: "learned",
          category: memory.category,
          content: cleanText(memory.content),
          reason: "context_accepted_as_duplicate",
        }];
      }
      if (memory.status === "deleted") {
        return [{
          source: "reviewed_context",
          status: "gap",
          category: memory.category,
          content: cleanText(memory.content),
          reason: "context_rejected",
        }];
      }
      if (memory.status === "deprioritized") {
        return [{
          source: "reviewed_context",
          status: "gap",
          category: memory.category,
          content: cleanText(memory.content),
          reason: "context_deprioritized",
        }];
      }
      return [];
    });
}

function intakeGapRows(metadata: Record<string, unknown> | undefined): AimLearningRow[] {
  const intake = asRecord(metadata?.aim_intake);
  if (!intake || !Array.isArray(intake.questions)) return [];
  return intake.questions.flatMap((item) => {
    const question = asRecord(item);
    if (!question) return [];
    const prompt = cleanText(question.prompt);
    if (!prompt) return [];
    const priority = asPriority(question.priority);
    if (priority === "low") return [];
    return [{
      source: "intake_gap",
      status: "gap",
      category: asCategory(question.category, prompt),
      content: prompt,
      reason: cleanText(question.reason) || "intake_question",
      priority,
    } satisfies AimLearningRow];
  });
}

function reviewGapRows(metadata: Record<string, unknown> | undefined): AimLearningRow[] {
  const review = asRecord(metadata?.plan_review);
  const context = asRecord(review?.context);
  const gaps = context?.gaps;
  if (!Array.isArray(gaps)) return [];
  return gaps.flatMap((item) => {
    const gap = asRecord(item);
    if (!gap) return [];
    const prompt = cleanText(gap.prompt);
    if (!prompt) return [];
    const priority = asPriority(gap.priority);
    if (priority === "low") return [];
    return [{
      source: "review_gap",
      status: "gap",
      category: asCategory(gap.category, prompt),
      content: prompt,
      reason: cleanText(gap.reason) || "plan_review_gap",
      priority,
    } satisfies AimLearningRow];
  });
}

function addUnique(rows: AimLearningRow[], seen: Set<string>, row: AimLearningRow): void {
  const key = `${row.status}\u0000${row.category}\u0000${row.content.toLowerCase()}`;
  if (seen.has(key)) return;
  seen.add(key);
  rows.push(row);
}

function nextActions(input: {
  intake: AimLearningIntakeSummary | null;
  clarify: AimLearningClarifySummary | null;
  pendingContextCount: number;
  gapCount: number;
  learnedCount: number;
}): string[] {
  const actions: string[] = [];
  if (input.pendingContextCount > 0) {
    actions.push(`Review ${input.pendingContextCount} pending context candidate${input.pendingContextCount === 1 ? "" : "s"} from this aim.`);
  }
  if (input.intake?.missingCoreCategories.length) {
    actions.push(`Capture missing core context: ${input.intake.missingCoreCategories.join(", ")}.`);
  }
  if (input.clarify && input.clarify.impactedCount > 0) {
    actions.push("Keep using clarify answers that changed the plan as future eval/context signals.");
  }
  if (input.gapCount > 0 && input.pendingContextCount === 0) {
    actions.push("Turn unresolved intake/review gaps into concrete context through the next clarify or evidence event.");
  }
  if (input.learnedCount === 0 && input.pendingContextCount === 0 && input.gapCount === 0) {
    actions.push("No reusable context signal was recorded yet; completion evidence should seed learning for this aim.");
  }
  return actions;
}

export function reviewAimLearning(input: ReviewAimLearningInput): AimLearningReport {
  const metadata = input.goal.metadata;
  const seen = new Set<string>();
  const rows: AimLearningRow[] = [];
  for (const row of [
    ...clarifyRows(metadata),
    ...reviewedContextRows(input),
    ...pendingRows(input.pendingContext),
    ...intakeGapRows(metadata),
    ...reviewGapRows(metadata),
  ]) {
    addUnique(rows, seen, row);
  }
  const intake = intakeSummary(metadata);
  const clarify = clarifySummary(metadata);
  const learnedCount = rows.filter((row) => row.status === "learned").length;
  const pendingContextCount = rows.filter((row) => row.status === "pending").length;
  const gapCount = rows.filter((row) => row.status === "gap").length;
  return {
    goalId: input.goal.id,
    title: input.goal.title,
    intake,
    clarify,
    learnedCount,
    pendingContextCount,
    gapCount,
    rows,
    nextActions: nextActions({ intake, clarify, learnedCount, pendingContextCount, gapCount }),
  };
}
