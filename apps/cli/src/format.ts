/**
 * Pure output formatters for the CLI — kept separate from I/O so they are unit-testable.
 * The CLI shell (index.ts) does argv/env/network; these functions only render strings.
 */
import type { AcceptanceRule, DecompositionContract, DecompositionOutput, Evidence, Goal, Memory, Milestone, MilestoneCompletion } from "@core/types";
import { isPromptLikeContextCandidate, recommendContextScope } from "@core/domain";
import type { AimIntakeReport, AimLearningReport, ContextCaptureContract, ContextCaptureFulfillmentReport, ContextCaptureLearningReport, ContextHealthRow, ContextLineageLearningReport, ContextLineageReport, ContextProfileReport, DecompositionLearningReport, DecompositionStrategyReport, MergeAction, MergedItem, PlanQualityReport, PlanReviewReport } from "@core/domain";
import { clarifyImpactReportFromMetadata } from "@core/llm";
import type {
  ClarifyAnswerImpactReport,
  ClarifyLearningReport,
  ClarifyOutput,
  PlanningContextSelectionReport,
  PlanningContextSelectionRow,
} from "@core/llm";

/** A terse one-line summary of an acceptance rule (which evaluators must fire). */
export function ruleSummary(rule: AcceptanceRule): string {
  const clauses = Array.isArray(rule?.clauses) ? rule.clauses : [];
  if (clauses.length === 0) return "manual";
  const join = rule.logic === "any" ? " OR " : " AND ";
  return clauses.map((c) => c.evaluator).join(join);
}

/** Render a decomposition plan as readable, terminal-friendly text. */
function formatPlanQuality(quality: PlanQualityReport): string[] {
  const lines = [`quality: ${quality.grade} (${quality.score}/100)`];
  if (quality.dimensions && quality.dimensions.length > 0) {
    lines.push(
      `scorecard: ${quality.dimensions
        .map((row) => `${row.dimension.replace("_", "-")} ${row.grade} ${row.score}/100`)
        .join(" · ")}`,
    );
  }
  for (const issue of quality.issues.slice(0, 5)) {
    const target = issue.nodeKey ? ` ${issue.nodeKey}` : issue.contextCategory ? ` ${issue.contextCategory}` : "";
    lines.push(`   ! [${issue.severity}]${target} ${issue.message}`);
  }
  if (quality.issues.length > 5) lines.push(`   ! ${quality.issues.length - 5} more issue${quality.issues.length === 6 ? "" : "s"}`);
  return lines;
}

function formatPlanReview(review: PlanReviewReport): string[] {
  const { context } = review;
  const gaps = context.gaps ?? [];
  const lines = [
    `context: ${context.applied.length} applied · ${context.unapplied.length} unapplied · ${context.ignoredLowConfidence.length} low-confidence · ${gaps.length} gaps`,
  ];
  for (const row of context.applied.slice(0, 3)) {
    const keywords = row.matchedKeywords.length > 0 ? ` (${row.matchedKeywords.join(", ")})` : "";
    lines.push(`   + [${row.category}] ${row.content}${keywords}`);
  }
  for (const row of context.unapplied.slice(0, 3)) {
    lines.push(`   ? [${row.category}] ${row.content}`);
  }
  for (const gap of gaps.slice(0, 3)) {
    lines.push(`   gap: [${gap.priority}] ${gap.category} — ${gap.prompt}`);
  }
  for (const action of review.actions.slice(0, 3)) {
    lines.push(`   action: [${action.priority}] ${action.code} — ${action.reason}`);
  }
  for (const item of review.guidance.slice(0, 3)) lines.push(`   → ${item}`);
  return lines;
}

function shortContent(content: string, max = 100): string {
  const compact = content.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max - 1)}...` : compact;
}

function isDecompositionOwner(value: unknown): value is DecompositionContract["likely_owner"] {
  return value === "human" || value === "agent" || value === "either" || value === "mixed";
}

function isContextCategory(value: unknown): value is DecompositionContract["context_gaps"][number]["category"] {
  return (
    value === "preference" ||
    value === "constraint" ||
    value === "capability" ||
    value === "eval_signal" ||
    value === "project_fact" ||
    value === "procedure"
  );
}

function decompositionContractFromMetadata(metadata: Record<string, unknown> | undefined): DecompositionContract | null {
  const value = metadata?.decomposition_contract;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const contract = value as Partial<DecompositionContract>;
  if (
    typeof contract.why !== "string" ||
    typeof contract.definition_of_done !== "string" ||
    !Array.isArray(contract.required_evidence) ||
    typeof contract.eval_signal !== "string"
  ) {
    return null;
  }
  return {
    why: contract.why,
    definition_of_done: contract.definition_of_done,
    required_evidence: contract.required_evidence.filter((item): item is string => typeof item === "string"),
    likely_owner: isDecompositionOwner(contract.likely_owner) ? contract.likely_owner : "either",
    context_gaps: Array.isArray(contract.context_gaps)
      ? contract.context_gaps.filter(
          (gap): gap is DecompositionContract["context_gaps"][number] =>
            Boolean(gap) &&
            typeof gap === "object" &&
            !Array.isArray(gap) &&
            isContextCategory((gap as { category?: unknown }).category) &&
            typeof (gap as { question?: unknown }).question === "string",
        )
      : [],
    eval_signal: contract.eval_signal,
  };
}

function formatDecompositionContract(contract: DecompositionContract | null | undefined): string[] {
  if (!contract) return [];
  const lines = [
    `   contract: owner ${contract.likely_owner} · done ${shortContent(contract.definition_of_done, 90)}`,
    `   evidence: ${contract.required_evidence.map((item) => shortContent(item, 60)).join(" · ")}`,
    `   eval: ${shortContent(contract.eval_signal, 100)}`,
  ];
  for (const gap of contract.context_gaps.slice(0, 2)) {
    lines.push(`   gap: [${gap.category.replace("_", "-")}] ${shortContent(gap.question, 100)}`);
  }
  return lines;
}

function formatPlanningContextRow(mark: "+" | "-", row: PlanningContextSelectionRow): string[] {
  const confidence = typeof row.confidence === "number" ? ` · ${Math.round(row.confidence * 100)}%` : "";
  const matches = row.matchedTokens.length > 0 ? ` · matches: ${row.matchedTokens.slice(0, 5).join(", ")}` : "";
  return [
    `   ${mark} [${row.category}] ${row.scope} · score ${row.score}${confidence} · ${row.reason}${matches}`,
    `     ${shortContent(row.content)}`,
  ];
}

export function formatPlanningContextSelection(report: PlanningContextSelectionReport): string {
  const lines = [
    `planning context: ${report.selected.length} selected · ${report.ignored.length} ignored · limit ${report.limit}`,
  ];
  for (const row of report.selected.slice(0, 4)) lines.push(...formatPlanningContextRow("+", row));
  const ignored = report.ignored.filter((row) => row.reason !== "empty_content").slice(0, 3);
  for (const row of ignored) lines.push(...formatPlanningContextRow("-", row));
  const hidden = report.selected.length + ignored.length < report.total ? report.total - report.selected.length - ignored.length : 0;
  if (hidden > 0) lines.push(`   ... ${hidden} more context row${hidden === 1 ? "" : "s"}`);
  return lines.join("\n");
}

function planningContextSelectionFromMetadata(metadata: Record<string, unknown> | undefined): PlanningContextSelectionReport | null {
  const value = metadata?.planning_context;
  if (!value || typeof value !== "object") return null;
  const report = value as Partial<PlanningContextSelectionReport>;
  if (!Array.isArray(report.selected) || !Array.isArray(report.ignored)) return null;
  return {
    total: typeof report.total === "number" ? report.total : report.selected.length + report.ignored.length,
    limit: typeof report.limit === "number" ? report.limit : report.selected.length,
    selected: report.selected as PlanningContextSelectionRow[],
    ignored: report.ignored as PlanningContextSelectionRow[],
  };
}

function contextCaptureFulfillmentFromMetadata(metadata: Record<string, unknown> | undefined): ContextCaptureFulfillmentReport | null {
  const value = metadata?.context_capture_fulfillment as Partial<ContextCaptureFulfillmentReport> | undefined;
  if (!value || value.version !== 1 || !Array.isArray(value.rows)) return null;
  return {
    version: 1,
    total: typeof value.total === "number" ? value.total : value.rows.length,
    answeredCount: typeof value.answeredCount === "number" ? value.answeredCount : 0,
    memoryCapturedCount: typeof value.memoryCapturedCount === "number" ? value.memoryCapturedCount : 0,
    impactedCount: typeof value.impactedCount === "number" ? value.impactedCount : 0,
    rows: value.rows as ContextCaptureFulfillmentReport["rows"],
  };
}

export function formatClarifyImpact(report: ClarifyAnswerImpactReport): string {
  const lines = [
    `clarify impact: ${report.answered_count} answer${report.answered_count === 1 ? "" : "s"} · ${report.impacted_count} impacted · ${report.changed_node_count} changed milestone${report.changed_node_count === 1 ? "" : "s"}`,
  ];
  for (const row of report.rows.slice(0, 3)) {
    const source = row.source_dimension ? ` · ${row.source_dimension.replace("_", "-")}` : "";
    const nodes = row.affected_node_keys.length > 0 ? ` (${row.affected_node_keys.join(", ")})` : "";
    lines.push(`   + [${row.memory_category.replace("_", "-")}${source}] ${row.answer}${nodes}`);
  }
  if (report.rows.length > 3) lines.push(`   ... ${report.rows.length - 3} more answer${report.rows.length === 4 ? "" : "s"}`);
  return lines.join("\n");
}

export function formatContextCaptureFulfillment(report: ContextCaptureFulfillmentReport): string {
  const lines = [
    `capture fulfillment: ${report.answeredCount}/${report.total} answered · ${report.memoryCapturedCount} captured · ${report.impactedCount} impacted`,
  ];
  for (const row of report.rows.slice(0, 5)) {
    const impact = row.affectedNodeKeys.length > 0 ? ` (${row.affectedNodeKeys.join(", ")})` : "";
    lines.push(
      `   ${row.status.replace(/_/g, "-")} [${row.capture.scope}/${row.capture.category.replace("_", "-")}] ${row.capture.purpose.replace("_", "-")} · improves ${row.capture.improvesDimension.replace("_", "-")}${impact}`,
    );
    lines.push(`     ${shortContent(row.answer ?? row.question, 120)}`);
  }
  if (report.rows.length > 5) lines.push(`   ... ${report.rows.length - 5} more capture contract${report.rows.length === 6 ? "" : "s"}`);
  return lines.join("\n");
}

function formatCaptureContract(capture: ContextCaptureContract | undefined): string | null {
  if (!capture) return null;
  const parts = [
    `capture: ${capture.scope}`,
    capture.category.replace("_", "-"),
    `· ${capture.purpose.replace("_", "-")}`,
    `· improves ${capture.improvesDimension.replace("_", "-")}`,
  ];
  if (capture.origin?.nodeKey) parts.push(`· from ${capture.origin.nodeKey}`);
  if (typeof capture.origin?.roiScore === "number") parts.push(`· roi ${capture.origin.roiScore}`);
  return parts.join(" ");
}

export function formatClarifyLearning(report: ClarifyLearningReport): string {
  const lines = [
    `clarify learning: ${report.total_answered} answer${report.total_answered === 1 ? "" : "s"} · ${report.total_impacted} impacted`,
  ];
  const rows = report.rows.filter((row) => row.answered_count > 0);
  if (rows.length === 0) {
    lines.push("   (no clarify impact history yet)");
    return lines.join("\n");
  }
  for (const row of rows) {
    const dimension = row.source_dimension.replace("_", "-");
    lines.push(
      `   ${dimension}: ${row.recommendation} · ${row.impacted_count}/${row.answered_count} impacted · rate ${row.impact_rate} · avg delta ${row.average_quality_delta}`,
    );
  }
  if (report.guidance.length > 0) {
    lines.push("guidance:");
    for (const item of report.guidance) lines.push(`   - ${item}`);
  }
  return lines.join("\n");
}

export function formatContextCaptureLearning(report: ContextCaptureLearningReport): string {
  const lines = [
    `capture learning: ${report.totalAsked} asked · ${report.totalAnswered} answered · ${report.totalCaptured} captured · ${report.totalImpacted} impacted`,
  ];
  const rows = report.rows.filter((row) => row.askedCount > 0);
  if (rows.length === 0) {
    lines.push("   (no capture contract history yet)");
    return lines.join("\n");
  }
  for (const row of rows.slice(0, 6)) {
    lines.push(
      `   ${row.scope}/${row.category.replace("_", "-")} · ${row.purpose.replace("_", "-")} · improves ${row.improvesDimension.replace("_", "-")}: ${row.recommendation.replace("_", "-")} · ${row.impactedCount}/${row.memoryCapturedCount} impacted · answer rate ${row.answerRate}`,
    );
  }
  const originRows = (report.originRows ?? []).filter((row) => row.askedCount > 0).slice(0, 6);
  if (originRows.length > 0) {
    lines.push("origins:");
    for (const row of originRows) {
      const origin = row.nodeKey
        ? `${row.nodeKey}${row.nodeTitle ? ` (${shortContent(row.nodeTitle, 42)})` : ""}`
        : row.gapSource?.replace("_", "-") ?? row.source.replace("_", "-");
      const roi = typeof row.avgRoiScore === "number" ? ` · avg roi ${row.avgRoiScore}` : "";
      lines.push(
        `   ${origin}: ${row.category.replace("_", "-")} · ${row.recommendation.replace("_", "-")} · ${row.impactedCount}/${row.memoryCapturedCount} impacted${roi}`,
      );
    }
  }
  if (report.guidance.length > 0) {
    lines.push("guidance:");
    for (const item of report.guidance.slice(0, 6)) lines.push(`   - ${item}`);
  }
  return lines.join("\n");
}

export function formatContextLineageLearning(report: ContextLineageLearningReport): string {
  const lines = [
    `lineage learning: ${report.totalQuestions} questions · ${report.totalCaptured} captured · ${report.totalImpacted} impacted · ${report.totalPending} pending`,
  ];
  const rows = report.rows.filter((row) => row.askedCount > 0);
  if (rows.length === 0) {
    lines.push("   (no context lineage learning yet)");
    return lines.join("\n");
  }
  for (const row of rows.slice(0, 6)) {
    const source = row.gapSource?.replace("_", "-") ?? row.source.replace("_", "-");
    const node = row.exampleNodeTitle ? ` · example ${shortContent(row.exampleNodeTitle, 42)}` : "";
    const accepted = row.acceptedContextCount ? ` · accepted ${row.acceptedContextCount}` : "";
    const rejected = row.rejectedContextCount || row.deprioritizedContextCount
      ? ` · rejected/deprioritized ${(row.rejectedContextCount ?? 0) + (row.deprioritizedContextCount ?? 0)}`
      : "";
    lines.push(
      `   ${source}/${row.category.replace("_", "-")} · ${row.capturePurpose.replace("_", "-")} · improves ${row.improvesDimension.replace("_", "-")}: ${row.recommendation.replace("_", "-")} · ${row.impactedCount}/${row.memoryCapturedCount} impacted · pending ${row.pendingContextCount}${accepted}${rejected}${node}`,
    );
    lines.push(`     q: ${shortContent(row.exampleQuestion, 120)}`);
    if (row.exampleAnswer) lines.push(`     a: ${shortContent(row.exampleAnswer, 120)}`);
  }
  if (report.guidance.length > 0) {
    lines.push("guidance:");
    for (const item of report.guidance.slice(0, 6)) lines.push(`   - ${item}`);
  }
  return lines.join("\n");
}

export function formatDecompositionLearning(report: DecompositionLearningReport): string {
  const lines = [
    `decomposition learning: ${report.totalAims} aims · ${report.completedMilestones}/${report.totalMilestones} milestones completed · ${report.qualityIssueCount} quality issues · ${report.contextOutcomeCount} context outcomes · ${report.evidenceAttributionCount} evidence attributions`,
  ];
  if (report.rows.length === 0) {
    lines.push("   (no decomposition learning yet)");
    return lines.join("\n");
  }
  for (const row of report.rows.slice(0, 6)) {
    const node = row.nodeTitle ? ` · ${shortContent(row.nodeTitle, 42)}` : "";
    const category = row.category ? ` · ${row.category.replace("_", "-")}` : "";
    const dimension = row.dimension ? ` · ${row.dimension.replace("_", "-")}` : "";
    const issues = row.issueCodes?.length ? ` · ${row.issueCodes.map((code) => code.replace(/_/g, "-")).join(", ")}` : "";
    const context = row.acceptedContextCount || row.rejectedContextCount || row.deprioritizedContextCount
      ? ` · accepted ${row.acceptedContextCount ?? 0} · rejected/deprioritized ${(row.rejectedContextCount ?? 0) + (row.deprioritizedContextCount ?? 0)}`
      : "";
    const evidence = row.evidenceKinds?.length
      ? ` · evidence ${row.evidenceKinds.join(", ")} via ${row.evaluatorKinds?.join(", ") || "unknown"}`
      : "";
    const trust = typeof row.minimumTrustScore === "number" ? ` · trust ${row.minimumTrustScore}` : "";
    lines.push(
      `   ${row.recommendation.replace("_", "-")} · ${row.source.replace("_", "-")}${node}${category}${dimension}${issues}${context}${evidence}${trust}`,
    );
    lines.push(`     ${shortContent(row.example, 120)}`);
  }
  if (report.guidance.length > 0) {
    lines.push("guidance:");
    for (const item of report.guidance.slice(0, 6)) lines.push(`   - ${item}`);
  }
  return lines.join("\n");
}

export function formatDecompositionStrategy(report: DecompositionStrategyReport): string {
  const lines = [
    `decomposition strategy: ${report.title} · ${report.actionCount} action${report.actionCount === 1 ? "" : "s"}`,
  ];
  if (report.actions.length === 0) {
    lines.push("   (no strategy actions yet)");
    return lines.join("\n");
  }
  for (const action of report.actions.slice(0, 6)) {
    lines.push(
      `   [${action.priority}] ${action.focus.replace("_", "-")} · ${action.sourceRows} source row${action.sourceRows === 1 ? "" : "s"}`,
    );
    lines.push(`     ${shortContent(action.recommendation, 140)}`);
    lines.push(`     reason: ${shortContent(action.reason, 120)}`);
  }
  if (report.guidance.length > 0) {
    lines.push("guidance:");
    for (const item of report.guidance.slice(0, 6)) lines.push(`   - ${item}`);
  }
  return lines.join("\n");
}

export function formatContextLineage(report: ContextLineageReport): string {
  const lines = [
    `context lineage: ${report.total} question${report.total === 1 ? "" : "s"} · ${report.memoryCapturedCount} captured · ${report.impactedCount} impacted · ${report.pendingContextCount} pending`,
  ];
  if (report.rows.length === 0) {
    lines.push("   (no context capture lineage yet)");
    return lines.join("\n");
  }
  for (const row of report.rows.slice(0, 5)) {
    const origin = row.originNode
      ? ` · from ${row.originNode.key} (${shortContent(row.originNode.title, 40)})`
      : row.source !== "unknown"
        ? ` · from ${row.source.replace("_", "-")}`
        : "";
    const affected = row.affectedNodes.length > 0
      ? ` · affects ${row.affectedNodes.map((node) => node.key).join(", ")}`
      : "";
    lines.push(
      `   ${row.captureStatus.replace(/_/g, "-")} [${row.category.replace("_", "-")}] ${row.capturePurpose.replace("_", "-")} · improves ${row.improvesDimension.replace("_", "-")}${origin}${affected}`,
    );
    lines.push(`     q: ${shortContent(row.question, 120)}`);
    if (row.answer) lines.push(`     a: ${shortContent(row.answer, 120)}`);
    if (row.memoryContent) lines.push(`     memory: ${shortContent(row.memoryContent, 120)}`);
    if (row.originNode?.contract) {
      lines.push(`     contract: done ${shortContent(row.originNode.contract.definition_of_done, 90)}`);
      lines.push(`     eval: ${shortContent(row.originNode.contract.eval_signal, 90)}`);
    }
    if (row.pendingContext.length > 0) {
      lines.push(`     pending: ${shortContent(row.pendingContext[0]!.content, 120)}`);
    }
    const rejected = (row.rejectedContextCount ?? 0) + (row.deprioritizedContextCount ?? 0);
    if (row.acceptedContextCount) lines.push(`     accepted context: ${row.acceptedContextCount}`);
    if (rejected > 0) lines.push(`     rejected/deprioritized context: ${rejected}`);
    lines.push(`     action: ${row.nextAction}`);
  }
  if (report.rows.length > 5) lines.push(`   ... ${report.rows.length - 5} more lineage row${report.rows.length === 6 ? "" : "s"}`);
  for (const action of report.nextActions.slice(0, 3)) lines.push(`   next: ${action}`);
  return lines.join("\n");
}

export function formatPlanPretty(
  plan: DecompositionOutput,
  quality?: PlanQualityReport,
  review?: PlanReviewReport,
  contextSelection?: PlanningContextSelectionReport,
  intake?: AimIntakeReport,
): string {
  const lines: string[] = [];
  lines.push(plan.goal_summary || "(plan)");
  lines.push(`${plan.nodes.length} milestone${plan.nodes.length === 1 ? "" : "s"}`);
  if (quality) lines.push(...formatPlanQuality(quality));
  if (review) lines.push(...formatPlanReview(review));
  if (intake) lines.push(...formatAimIntake(intake).split("\n"));
  if (contextSelection) lines.push(...formatPlanningContextSelection(contextSelection).split("\n"));
  lines.push("");
  plan.nodes.forEach((n, i) => {
    lines.push(`${i + 1}. ${n.title}  (+${n.xp_reward} xp · ${n.est_effort})`);
    if (n.description) lines.push(`   ${n.description}`);
    lines.push(`   ✓ ${ruleSummary(n.acceptance_rule)}`);
    lines.push(...formatDecompositionContract(n.decomposition_contract));
  });
  return lines.join("\n");
}

/** Render the clarifying-questions step as readable text. */
export function formatClarifyPretty(title: string, out: ClarifyOutput): string {
  const lines: string[] = [];
  lines.push(`Clarifying questions for: ${title}`);
  lines.push("");
  if (out.questions.length === 0) {
    lines.push("(no high-impact questions — the plan is ready)");
  }
  out.questions.forEach((q) => {
    const source = q.source_dimension ? ` · ${q.source_dimension.replace("_", "-")}` : "";
    lines.push(`[${q.kind}${source}] ${q.question}`);
    if (q.why_high_impact) lines.push(`   why: ${q.why_high_impact}`);
    if (q.why_asked && q.why_asked.length > 0) {
      lines.push(`   asked: ${q.why_asked.map((why) => whyAskedSummary(why)).join(" · ")}`);
    }
    const capture = formatCaptureContract(q.capture);
    if (capture) lines.push(`   ${capture}`);
    q.options.forEach((o) => lines.push(`   - ${o.label}${o.tradeoff ? ` — ${o.tradeoff}` : ""}`));
    lines.push("");
  });
  if (out.assumptions.length > 0) {
    lines.push("Assuming (override anything wrong):");
    out.assumptions.forEach((a) => lines.push(`   • ${a.statement}${a.default_value ? ` (${a.default_value})` : ""}`));
  }
  return lines.join("\n").trimEnd();
}

function whyAskedSummary(why: NonNullable<ClarifyOutput["questions"][number]["why_asked"]>[number]): string {
  switch (why.code) {
    case "review_gap":
      return `review gap${why.category ? `/${why.category.replace("_", "-")}` : ""}`;
    case "quality_dimension":
      return `quality/${why.source_dimension?.replace("_", "-") ?? "dimension"}`;
    case "historical_learning":
      return `learning/${why.recommendation ?? "signal"}`;
    case "aim_intake":
      return `intake${why.category ? `/${why.category.replace("_", "-")}` : ""}`;
    case "context_lineage":
      return `lineage${why.category ? `/${why.category.replace("_", "-")}` : ""}${why.recommendation ? `/${why.recommendation.replace("_", "-")}` : ""}`;
    case "decomposition_strategy":
      return `strategy${why.strategyFocus ? `/${why.strategyFocus.replace("_", "-")}` : ""}`;
  }
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

/** A saved aim paired with its materialized milestone-row count (the source of truth for the count). */
export interface GoalListItem {
  goal: Goal;
  milestoneCount: number;
}

/** Render the saved-aims list, one per line (id · title · #milestones · date). */
export function formatGoalList(items: GoalListItem[]): string {
  if (items.length === 0) return "No aims yet. Create one with: aimcub new \"<title>\"";
  return items
    .map(({ goal, milestoneCount: n }) => {
      const date = goal.created_at ? goal.created_at.slice(0, 10) : "";
      return `${shortId(goal.id)}  ${goal.title}  (${n} milestone${n === 1 ? "" : "s"}${date ? ` · ${date}` : ""})`;
    })
    .join("\n");
}

/** One-line summary of a re-plan merge: how many milestones were added/updated/kept/skipped. */
export function formatMergeSummary(merged: MergedItem[]): string {
  const n = (a: MergeAction): number => merged.filter((m) => m.action === a).length;
  return `re-plan: ${n("add")} added · ${n("update")} updated · ${n("freeze")} kept (done) · ${n("skip")} skipped`;
}

/** Render a saved aim + its materialized milestones. */
export function formatGoalDetail(
  goal: Goal,
  milestones: Milestone[],
  learning?: AimLearningReport | null,
  lineage?: ContextLineageReport | null,
): string {
  const lines: string[] = [];
  lines.push(goal.title);
  if (goal.description) lines.push(goal.description);
  lines.push(`id: ${goal.id}`);
  lines.push(`${milestones.length} milestone${milestones.length === 1 ? "" : "s"}`);
  const contextSelection = planningContextSelectionFromMetadata(goal.metadata);
  if (contextSelection) lines.push(...formatPlanningContextSelection(contextSelection).split("\n"));
  const clarifyImpact = clarifyImpactReportFromMetadata(goal.metadata);
  if (clarifyImpact) lines.push(...formatClarifyImpact(clarifyImpact).split("\n"));
  const captureFulfillment = contextCaptureFulfillmentFromMetadata(goal.metadata);
  if (captureFulfillment) lines.push(...formatContextCaptureFulfillment(captureFulfillment).split("\n"));
  if (lineage && (lineage.rows.length > 0 || lineage.nextActions.length > 0)) {
    lines.push(...formatContextLineage(lineage).split("\n"));
  }
  if (learning && (learning.rows.length > 0 || learning.nextActions.length > 0)) {
    lines.push(...formatAimLearning(learning).split("\n"));
  }
  lines.push("");
  milestones.forEach((m, i) => {
    lines.push(`${i + 1}. ${m.title}  [${m.status}]  (+${m.xp_reward} xp)`);
    if (m.description) lines.push(`   ${m.description}`);
    lines.push(`   ✓ ${ruleSummary(m.acceptance_rule)}`);
    lines.push(...formatDecompositionContract(decompositionContractFromMetadata(m.metadata)));
  });
  return lines.join("\n").trimEnd();
}

export function formatAimLearning(report: AimLearningReport): string {
  const lines = [
    `aim learning: ${report.learnedCount} learned · ${report.pendingContextCount} pending · ${report.gapCount} gaps`,
  ];
  if (report.intake) {
    const missing = report.intake.missingCoreCategories.length > 0
      ? ` · missing ${report.intake.missingCoreCategories.map((category) => category.replace("_", "-")).join(", ")}`
      : "";
    lines.push(`   intake: ${report.intake.readiness.replace(/_/g, "-")} (${report.intake.score}/100)${missing}`);
  }
  if (report.clarify) {
    lines.push(
      `   clarify: ${report.clarify.answeredCount} answered · ${report.clarify.impactedCount} impacted · ${report.clarify.changedNodeCount} changed`,
    );
  }
  for (const row of report.rows.slice(0, 6)) {
    const mark = row.status === "learned" ? "+" : row.status === "pending" ? "?" : "gap";
    const priority = row.priority ? ` · ${row.priority}` : "";
    lines.push(`   ${mark} [${row.category.replace("_", "-")}] ${row.source.replace("_", "-")}${priority} · ${row.reason}`);
    lines.push(`     ${shortContent(row.content, 120)}`);
  }
  if (report.rows.length > 6) lines.push(`   ... ${report.rows.length - 6} more learning row${report.rows.length === 7 ? "" : "s"}`);
  for (const action of report.nextActions.slice(0, 3)) lines.push(`   action: ${action}`);
  return lines.join("\n");
}

function statusMark(status: Milestone["status"]): string {
  switch (status) {
    case "completed":
      return "done";
    case "in_progress":
      return "work";
    case "blocked":
      return "block";
    case "skipped":
      return "skip";
    case "pending":
      return "todo";
  }
}

function progressBar(done: number, total: number, width = 18): string {
  if (total <= 0) return "-".repeat(width);
  const filled = Math.round((done / total) * width);
  return `${"#".repeat(filled)}${"-".repeat(Math.max(0, width - filled))}`;
}

/** Render the aim board: progress first, then every milestone with acceptance and completion state. */
export function formatBoard(goal: Goal, milestones: Milestone[], evidence: Evidence[] = []): string {
  const completed = milestones.filter((m) => m.status === "completed").length;
  const totalXp = milestones.reduce((sum, m) => sum + m.xp_reward, 0);
  const doneXp = milestones.filter((m) => m.status === "completed").reduce((sum, m) => sum + m.xp_reward, 0);
  const lines: string[] = [];
  lines.push(goal.title);
  lines.push(`id: ${goal.id}`);
  lines.push(`progress: [${progressBar(completed, milestones.length)}] ${completed}/${milestones.length} milestones · ${doneXp}/${totalXp} xp`);
  if (evidence.length > 0) lines.push(`evidence: ${evidence.length} event${evidence.length === 1 ? "" : "s"}`);
  lines.push("");
  milestones.forEach((m, i) => {
    const count = evidence.filter((ev) => ev.milestone_id === m.id || ev.milestone_id === null).length;
    lines.push(`${i + 1}. ${statusMark(m.status).padEnd(5)} ${m.title}  (+${m.xp_reward} xp)`);
    lines.push(`   id: ${shortId(m.id)} · ${ruleSummary(m.acceptance_rule)}${count ? ` · ${count} evidence` : ""}`);
    if (m.description) lines.push(`   ${m.description}`);
    lines.push(...formatDecompositionContract(decompositionContractFromMetadata(m.metadata)));
  });
  return lines.join("\n").trimEnd();
}

/** Render evidence rows newest-last, matching the append-only stream. */
export function formatEvidenceList(evidence: Evidence[]): string {
  if (evidence.length === 0) return "No evidence yet.";
  return evidence
    .map((ev) => {
      const at = ev.occurred_at ? ev.occurred_at.slice(0, 19) : "";
      const target = ev.milestone_id ? ` · milestone ${shortId(ev.milestone_id)}` : " · goal";
      const source = ev.source_event_id ? ` · ${ev.source_event_id}` : "";
      return `${shortId(ev.id)}  ${ev.kind}${target}${source}${at ? ` · ${at}` : ""}${ev.summary ? `\n   ${ev.summary}` : ""}`;
    })
    .join("\n");
}

export function formatConfirmResult(
  milestone: Milestone,
  completion: MilestoneCompletion | null,
  alreadyCompleted: boolean,
  contextCandidateCount = 0,
): string {
  if (alreadyCompleted) return `Already completed: ${milestone.title}`;
  const suffix = contextCandidateCount > 0 ? `\ncontext candidates: ${contextCandidateCount} pending` : "";
  if (!completion) {
    return `Recorded manual confirmation evidence, but this milestone did not complete. Its rule may be auto-only.${suffix}`;
  }
  return `Confirmed: ${milestone.title} (+${completion.awarded_xp} xp)${suffix}`;
}

export function formatEvidenceResult(
  evidence: Evidence,
  completions: MilestoneCompletion[],
  deduped: boolean,
  contextCandidateCount = 0,
): string {
  const lines = [`${deduped ? "Deduped" : "Recorded"} evidence ${shortId(evidence.id)} (${evidence.kind})`];
  for (const c of completions) lines.push(`completed milestone ${shortId(c.milestone_id)} (+${c.awarded_xp} xp)`);
  if (contextCandidateCount > 0) lines.push(`context candidates: ${contextCandidateCount} pending`);
  return lines.join("\n");
}

export function formatImportSummary(summary: {
  goals: number;
  milestones: number;
  memories: number;
  evidence: number;
  completions: number;
  actors?: number;
  subAimRelations?: number;
  assignments?: number;
  runs?: number;
}): string {
  return [
    `imported: ${summary.goals} goals`,
    `${summary.milestones} milestones`,
    `${summary.memories} memories`,
    `${summary.evidence} evidence`,
    `${summary.completions} completions`,
    `${summary.actors ?? 0} actors`,
    `${summary.subAimRelations ?? 0} sub-aim relations`,
    `${summary.assignments ?? 0} assignments`,
    `${summary.runs ?? 0} runs`,
  ].join(" · ");
}

export function formatMemoryList(memories: Memory[]): string {
  if (memories.length === 0) return "No memories yet.";
  return memories
    .map((m) => {
      const scope = m.goal_id ? `aim ${shortId(m.goal_id)}` : "global";
      const confidence = Number.isFinite(m.confidence) ? ` · ${Math.round(m.confidence * 100)}%` : "";
      return `${shortId(m.id)}  ${m.category} · ${m.kind} · ${m.source} · ${scope}${confidence}\n   ${m.content}`;
    })
    .join("\n");
}

export function formatMemoryCandidateList(memories: Memory[]): string {
  if (memories.length === 0) return "No pending context candidates.";
  return memories
    .map((m) => {
      const scope = m.goal_id ? `aim ${shortId(m.goal_id)}` : "global";
      const recommended = recommendContextScope(m).scope;
      const confidence = Number.isFinite(m.confidence) ? ` · ${Math.round(m.confidence * 100)}%` : "";
      const editRequired = isPromptLikeContextCandidate(m.content);
      const status = editRequired ? " · edit required" : "";
      const lines = [
        `${shortId(m.id)}  ${m.category} · ${m.kind} · ${m.source} · ${scope} · recommended ${recommended}${confidence}${status}`,
        `   ${m.content}`,
      ];
      if (editRequired) lines.push(`   ! Edit this into an actual answer before accepting, e.g. aimcub context accept ${shortId(m.id)} --text "Eval signal: ..."`);
      return lines.join("\n");
    })
    .join("\n");
}

export function formatContext(memories: Memory[]): string {
  const active = memories.filter((m) => m.status === "active");
  if (active.length === 0) return "No context yet. Answer clarify questions or add memories as you work.";
  const byCategory = new Map<string, Memory[]>();
  for (const memory of active) {
    byCategory.set(memory.category, [...(byCategory.get(memory.category) ?? []), memory]);
  }
  const lines = ["Aimcub context", ""];
  for (const [category, rows] of [...byCategory.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`${category}:`);
    rows.slice(0, 8).forEach((m) => lines.push(`  - ${m.content}`));
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

export function formatContextProfile(report: ContextProfileReport): string {
  const lines = [
    `context profile: ${report.coverageScore}/100 coverage · ${report.totalActive} active · ${report.totalPending} pending`,
  ];
  for (const row of report.rows) {
    const confidence = row.averageConfidence === null ? "n/a" : `${Math.round(row.averageConfidence * 100)}%`;
    lines.push(
      `   ${row.category}: ${row.strength} · active ${row.activeCount} · pending ${row.pendingCount} · high-conf ${row.highConfidenceCount} · avg ${confidence}`,
    );
    if (row.strength === "missing" || row.strength === "thin") {
      lines.push(`      next: ${row.recommendation}`);
    }
  }
  return lines.join("\n");
}

export function formatAimIntake(report: AimIntakeReport): string {
  const selected = report.coverage.selectedByCategory.length > 0
    ? report.coverage.selectedByCategory
        .map((row) => `${row.category.replace("_", "-")} ${row.count}`)
        .join(" · ")
    : "none";
  const lines = [
    `aim intake: ${report.readiness.replace(/_/g, "-")} (${report.score}/100) · context profile ${report.coverage.profile.coverageScore}/100 · selected ${report.coverage.selectedTotal}`,
    `   selected: ${selected}`,
  ];
  if (report.coverage.missingCoreCategories.length > 0) {
    lines.push(`   missing core context: ${report.coverage.missingCoreCategories.map((category) => category.replace("_", "-")).join(", ")}`);
  }
  for (const question of report.questions.slice(0, 5)) {
    const roi = typeof question.roiScore === "number" ? ` · roi ${question.roiScore}` : "";
    lines.push(
      `   ? [${question.priority}] ${question.category.replace("_", "-")} · ${question.source.replace("_", "-")}${roi} · ${question.reason}`,
    );
    lines.push(`     ${question.prompt}`);
    const capture = formatCaptureContract(question.capture);
    if (capture) lines.push(`     ${capture}`);
  }
  for (const row of (report.acquisition ?? []).slice(0, 4)) {
    const categories = row.categories.length > 0
      ? ` · ${row.categories.map((category) => category.replace("_", "-")).join(", ")}`
      : "";
    const tools = row.suggestedTools.length > 0 ? ` · tools ${row.suggestedTools.join(", ")}` : "";
    lines.push(`   acquire: [${row.priority}] ${row.channel.replace("_", "-")} · ${row.scope}${categories}${tools}`);
    lines.push(`     ${row.action}`);
  }
  if (report.loop) {
    lines.push(`   loop: ${report.loop.shouldContinue ? "continue" : "ready"} · next ${report.loop.nextStepId ?? "none"}`);
    const nextStep = report.loop.steps.find((step) => step.id === report.loop.nextStepId) ?? report.loop.steps[0];
    if (nextStep) {
      const tools = nextStep.toolCalls.length > 0
        ? ` · tools ${nextStep.toolCalls.map((tool) => `${tool.name}:${tool.boundary}`).join(", ")}`
        : "";
      lines.push(`     ${nextStep.channel.replace("_", "-")} · ${nextStep.status} · ${nextStep.repeatMode}${tools}`);
    }
  }
  for (const action of report.nextActions.slice(0, 4)) {
    lines.push(`   action: ${action}`);
  }
  return lines.join("\n");
}

export function formatContextHealth(rows: ContextHealthRow[]): string {
  if (rows.length === 0) return "No active context yet.";
  const actionable = rows.filter((row) => row.action !== "keep");
  if (actionable.length === 0) {
    const traced = rows.filter((row) => row.selectedCount + row.ignoredCount > 0).length;
    return `Context health: clean (${traced}/${rows.length} rows have planning trace).`;
  }

  const lines = [`Context health: ${actionable.length} row${actionable.length === 1 ? "" : "s"} need attention`];
  for (const row of actionable.slice(0, 12)) {
    const scope = row.goalId ? `aim ${shortId(row.goalId)}` : "global";
    const counts = `${row.selectedCount} selected / ${row.ignoredCount} ignored`;
    const reasons = row.lastReasons.length > 0 ? ` · last: ${row.lastReasons.join(", ")}` : "";
    lines.push(`${shortId(row.memoryId)}  ${row.action} · ${row.category} · ${scope} · ${counts} · ${row.reason}${reasons}`);
    lines.push(`   ${shortContent(row.content, 120)}`);
  }
  if (actionable.length > 12) lines.push(`... ${actionable.length - 12} more row${actionable.length === 13 ? "" : "s"}`);
  return lines.join("\n");
}
