import type { ContextCategory, DecompositionContract, DecompositionOutput, Goal, Memory } from "@core/types";
import type {
  AimIntakeReport,
  AimLearningReport,
  ContextCaptureContract,
  ContextCaptureFulfillmentReport,
  ContextHealthRow,
  ContextLineageLearningReport,
  ContextProfileReport,
  DecompositionLearningReport,
  DecompositionStrategyReport,
  PlanQualityDimensionReport,
} from "@core/domain";
import type { ClarifyAnswerImpactReport, ClarifyOutput, PlanningContextSelectionReport } from "@core/llm";
import { getLlmProviderDefinition } from "@core/llm/providers";
import type { PlanResult, ProviderStatus } from "../shared/ipc";

import type { StringKey } from "./i18n";
import { C } from "./styles";

type T = (key: StringKey, vars?: Record<string, string | number>) => string;

export function contextLearningRecommendationLabel(
  recommendation: ClarifyLearningRecommendation,
  t: T,
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

type ClarifyLearningRecommendation = "ask_more" | "ask_less" | "ask_selectively";

export function lineageLearningRecommendationLabel(
  recommendation: ContextLineageLearningReport["rows"][number]["recommendation"],
  t: T,
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

export function decompositionLearningRecommendationLabel(
  recommendation: DecompositionLearningReport["rows"][number]["recommendation"],
  t: T,
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

export function decompositionStrategyFocusLabel(
  focus: DecompositionStrategyReport["actions"][number]["focus"],
  t: T,
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

export function decompositionStrategyPriorityLabel(
  priority: DecompositionStrategyReport["actions"][number]["priority"],
  t: T,
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

export function contextProfileStrengthLabel(
  strength: ContextProfileReport["rows"][number]["strength"],
  t: T,
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

export function contextCategoryLabel(category: ContextCategory, t: T): string {
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

export function decompositionOwnerLabel(owner: DecompositionContract["likely_owner"], t: T): string {
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

export function clarifyWhyLabel(
  why: NonNullable<ClarifyOutput["questions"][number]["why_asked"]>[number],
  t: T,
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

export function capturePurposeLabel(purpose: ContextCaptureContract["purpose"], t: T): string {
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

export function captureContractLabel(capture: ContextCaptureContract, t: T): string {
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

export function qualityTone(grade: PlanQualityDimensionReport["grade"]): string {
  if (grade === "fail") return C.danger;
  if (grade === "warn") return "#8a6517";
  return "#1a7f4b";
}

export function dimensionLabel(dimension: PlanQualityDimensionReport["dimension"], t: T): string {
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

export function intakeReadinessLabel(readiness: AimIntakeReport["readiness"], t: T): string {
  switch (readiness) {
    case "ready":
      return t("intake.ready");
    case "needs_targeted_context":
      return t("intake.needsContext");
    case "needs_plan_refinement":
      return t("intake.needsRefinement");
  }
}

export function intakeQuestionSourceLabel(source: AimIntakeReport["questions"][number]["source"], t: T): string {
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

export function aimLearningSourceLabel(source: AimLearningReport["rows"][number]["source"], t: T): string {
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

export function aimLearningStatusMark(status: AimLearningReport["rows"][number]["status"]): string {
  switch (status) {
    case "learned":
      return "+";
    case "pending":
      return "?";
    case "gap":
      return "!";
  }
}

export function aimLearningStatusColor(status: AimLearningReport["rows"][number]["status"]): string {
  switch (status) {
    case "learned":
      return "#1a7f4b";
    case "pending":
      return C.accent;
    case "gap":
      return "#8a6517";
  }
}

export function aimLearningRowOrder(a: AimLearningReport["rows"][number], b: AimLearningReport["rows"][number]): number {
  const statusRank = { pending: 0, gap: 1, learned: 2 } satisfies Record<AimLearningReport["rows"][number]["status"], number>;
  const priorityRank = { high: 0, medium: 1, low: 2 } as const;
  const byStatus = statusRank[a.status] - statusRank[b.status];
  if (byStatus !== 0) return byStatus;
  return priorityRank[a.priority ?? "medium"] - priorityRank[b.priority ?? "medium"];
}

export function shortUiText(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > 140 ? `${text.slice(0, 137)}...` : text;
}

export function impactSignalLabel(signal: ClarifyAnswerImpactReport["rows"][number]["signals"][number], t: T): string {
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

export function fulfillmentStatusLabel(status: ContextCaptureFulfillmentReport["rows"][number]["status"], t: T): string {
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

export function fulfillmentStatusMark(status: ContextCaptureFulfillmentReport["rows"][number]["status"]): string {
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

export function fulfillmentStatusColor(status: ContextCaptureFulfillmentReport["rows"][number]["status"]): string {
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

export function actionLabel(code: NonNullable<PlanResult["review"]>["actions"][number]["code"], t: T): string {
  return t(`review.action.${code}` as StringKey);
}

export function contextHealthActionLabel(action: ContextHealthRow["action"], t: T): string {
  return t(`context.health.action.${action}` as StringKey);
}

export function contextHealthReasonLabel(reason: string, t: T): string {
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

export function providerLabel(s: ProviderStatus, t: (key: "provider.anthropicShort" | "provider.openaiShort") => string): string {
  const def = getLlmProviderDefinition(s.provider);
  if (s.provider === "anthropic") {
    const model = s.model ? ` · ${s.model}` : "";
    return `${t("provider.anthropicShort")}${model} ⚙`;
  }
  const model = s.model ? ` · ${s.model}` : "";
  return `${def?.shortLabel ?? t("provider.openaiShort")}${model} ⚙`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString();
}

export function planOf(g: Goal): DecompositionOutput | null {
  const p = g.plan_json as DecompositionOutput | null | undefined;
  return p && Array.isArray(p.nodes) ? p : null;
}

export function reviewOf(g: Goal): PlanResult["review"] | null {
  const review = g.metadata?.plan_review as PlanResult["review"] | undefined;
  return review && review.quality && review.context ? review : null;
}

export function aimIntakeOf(g: Goal): AimIntakeReport | null {
  const report = g.metadata?.aim_intake as Partial<AimIntakeReport> | undefined;
  if (!report || typeof report.score !== "number" || !Array.isArray(report.questions)) return null;
  return report as AimIntakeReport;
}

export function clarifyImpactOf(g: Goal): ClarifyAnswerImpactReport | null {
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

export function contextCaptureFulfillmentOf(g: Goal): ContextCaptureFulfillmentReport | null {
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

export function planningContextOf(g: Goal): PlanningContextSelectionReport | null {
  const report = g.metadata?.planning_context as Partial<PlanningContextSelectionReport> | undefined;
  if (!report || !Array.isArray(report.selected) || !Array.isArray(report.ignored)) return null;
  return {
    total: typeof report.total === "number" ? report.total : report.selected.length + report.ignored.length,
    limit: typeof report.limit === "number" ? report.limit : report.selected.length,
    selected: report.selected as PlanningContextSelectionReport["selected"],
    ignored: report.ignored as PlanningContextSelectionReport["ignored"],
  };
}

export function pendingContextForGoal(goal: Goal, candidates: readonly Memory[]): Memory[] {
  return candidates.filter((candidate) => candidate.goal_id === goal.id && candidate.status === "pending");
}
