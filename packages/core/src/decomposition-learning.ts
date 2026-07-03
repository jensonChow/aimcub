import type { ContextCategory, DecompositionContract, Evidence, Evaluator, Goal, Milestone, MilestoneCompletion } from "@core/types";
import { evaluate } from "./evaluate";
import type { ContextLineageReport } from "./context-lineage";
import type { PlanQualityDimension, PlanQualityIssue, PlanQualityIssueCode, PlanQualityReport } from "./plan-quality";

export type DecompositionLearningSource = "completed_contract" | "quality_issue" | "context_outcome";
export type DecompositionLearningRecommendation =
  | "reuse_pattern"
  | "tighten_contract"
  | "ask_context_earlier"
  | "improve_acceptance"
  | "reconsider_granularity";

export interface DecompositionLearningRow {
  source: DecompositionLearningSource;
  recommendation: DecompositionLearningRecommendation;
  aimId: string;
  aimTitle: string;
  nodeKey?: string;
  nodeTitle?: string;
  category?: ContextCategory;
  dimension?: PlanQualityDimension;
  issueCodes?: PlanQualityIssueCode[];
  decidedBy?: MilestoneCompletion["decided_by"];
  evidenceKinds?: Evidence["kind"][];
  evaluatorKinds?: Evaluator[];
  triggeringEvidenceCount?: number;
  minimumTrustScore?: number;
  acceptedContextCount?: number;
  rejectedContextCount?: number;
  deprioritizedContextCount?: number;
  completed?: boolean;
  reason: string;
  example: string;
}

export interface DecompositionLearningReport {
  version: 1;
  totalAims: number;
  totalMilestones: number;
  completedMilestones: number;
  qualityIssueCount: number;
  contextOutcomeCount: number;
  evidenceAttributionCount: number;
  rows: DecompositionLearningRow[];
  guidance: string[];
}

export type DecompositionStrategyFocus =
  | "verifiability"
  | "granularity"
  | "context_fit"
  | "evidence_pattern"
  | "contract_specificity";

export type DecompositionStrategyPriority = "high" | "medium" | "low";

export interface DecompositionStrategyAction {
  focus: DecompositionStrategyFocus;
  priority: DecompositionStrategyPriority;
  recommendation: string;
  reason: string;
  sourceRows: number;
}

export interface DecompositionStrategyReport {
  version: 1;
  title: string;
  actionCount: number;
  actions: DecompositionStrategyAction[];
  guidance: string[];
}

export interface ReviewDecompositionStrategyInput {
  title: string;
  description?: string;
  learning?: DecompositionLearningReport | null;
}

export interface DecompositionLearningAim {
  goal: Pick<Goal, "id" | "title" | "metadata">;
  milestones?: readonly Pick<Milestone, "id" | "title" | "status" | "metadata" | "acceptance_rule">[];
  lineage?: Pick<ContextLineageReport, "rows"> | null;
  evidence?: readonly Pick<Evidence, "id" | "kind" | "payload" | "trust_score">[];
  completions?: readonly Pick<MilestoneCompletion, "milestone_id" | "decided_by" | "triggering_evidence_ids">[];
}

const QUALITY_ISSUES = new Set<PlanQualityIssueCode>([
  "missing_decomposition_contract",
  "missing_contract_evidence",
  "missing_contract_eval_signal",
  "missing_context_application",
  "missing_eval_acceptance_signal",
  "missing_research_evidence",
  "insufficient_research_coverage",
  "manual_only_verification",
  "orphan_verification_milestone",
  "duplicate_acceptance_rule",
  "indistinct_acceptance_rule",
  "oversized_milestone",
  "compound_milestone",
  "unsupported_auto_evaluator",
  "weak_commit_pattern",
  "empty_commit_pattern",
  "missing_dependency_shape",
]);

const QUALITY_DIMENSIONS = new Set<PlanQualityDimension>([
  "verifiability",
  "granularity",
  "distinctness",
  "context_fit",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function qualityDimensionForIssue(code: PlanQualityIssueCode): PlanQualityDimension {
  switch (code) {
    case "missing_decomposition_contract":
    case "missing_context_application":
    case "missing_research_evidence":
    case "insufficient_research_coverage":
      return "context_fit";
    case "missing_contract_evidence":
    case "missing_contract_eval_signal":
    case "missing_eval_acceptance_signal":
    case "manual_only_verification":
    case "orphan_verification_milestone":
    case "unsupported_auto_evaluator":
    case "weak_commit_pattern":
    case "empty_commit_pattern":
      return "verifiability";
    case "oversized_milestone":
    case "compound_milestone":
    case "missing_dependency_shape":
      return "granularity";
    case "duplicate_acceptance_rule":
    case "indistinct_acceptance_rule":
      return "distinctness";
  }
}

function recommendationForIssue(code: PlanQualityIssueCode): DecompositionLearningRecommendation {
  switch (code) {
    case "missing_context_application":
    case "missing_research_evidence":
    case "insufficient_research_coverage":
      return "ask_context_earlier";
    case "missing_eval_acceptance_signal":
    case "manual_only_verification":
    case "orphan_verification_milestone":
    case "unsupported_auto_evaluator":
    case "weak_commit_pattern":
    case "empty_commit_pattern":
      return "improve_acceptance";
    case "oversized_milestone":
    case "compound_milestone":
    case "duplicate_acceptance_rule":
    case "indistinct_acceptance_rule":
    case "missing_dependency_shape":
      return "reconsider_granularity";
    case "missing_decomposition_contract":
    case "missing_contract_evidence":
    case "missing_contract_eval_signal":
      return "tighten_contract";
  }
}

function planQualityFromMetadata(metadata: Record<string, unknown> | undefined): PlanQualityReport | null {
  const quality = asRecord(metadata?.plan_quality);
  if (!quality || !Array.isArray(quality.issues)) return null;
  const issues = quality.issues.flatMap((item): PlanQualityIssue[] => {
    const issue = asRecord(item);
    if (!issue || typeof issue.code !== "string" || !QUALITY_ISSUES.has(issue.code as PlanQualityIssueCode)) return [];
    const severity = issue.severity === "error" || issue.severity === "warning" || issue.severity === "info"
      ? issue.severity
      : "warning";
    const message = cleanText(issue.message) || issue.code;
    return [{
      code: issue.code as PlanQualityIssueCode,
      severity,
      message,
      ...(typeof issue.nodeKey === "string" ? { nodeKey: issue.nodeKey } : {}),
      ...(typeof issue.contextCategory === "string" ? { contextCategory: issue.contextCategory as ContextCategory } : {}),
    }];
  });
  const dimensions = Array.isArray(quality.dimensions)
    ? quality.dimensions.flatMap((item) => {
        const dimension = asRecord(item);
        if (!dimension || typeof dimension.dimension !== "string" || !QUALITY_DIMENSIONS.has(dimension.dimension as PlanQualityDimension)) return [];
        return [dimension.dimension as PlanQualityDimension];
      })
    : [];
  return {
    score: typeof quality.score === "number" ? quality.score : 0,
    grade: quality.grade === "pass" || quality.grade === "warn" || quality.grade === "fail" ? quality.grade : "warn",
    issues,
    dimensions: dimensions.map((dimension) => ({
      dimension,
      score: 0,
      grade: "warn",
      issueCount: 0,
      issueCodes: [],
    })),
  };
}

function contractFromMilestone(
  milestone: Pick<Milestone, "metadata">,
): Pick<DecompositionContract, "definition_of_done" | "required_evidence" | "eval_signal" | "context_gaps"> | null {
  const contract = asRecord(milestone.metadata?.decomposition_contract);
  if (!contract) return null;
  const definitionOfDone = cleanText(contract.definition_of_done);
  const evalSignal = cleanText(contract.eval_signal);
  const requiredEvidence = Array.isArray(contract.required_evidence)
    ? contract.required_evidence.map(cleanText).filter(Boolean)
    : [];
  const contextGaps = Array.isArray(contract.context_gaps)
    ? contract.context_gaps.flatMap((item) => {
        const gap = asRecord(item);
        const question = cleanText(gap?.question);
        const category = gap?.category;
        if (!question || typeof category !== "string") return [];
        return [{
          category: category as ContextCategory,
          question,
          reason: cleanText(gap?.reason),
        }];
      })
    : [];
  if (!definitionOfDone && requiredEvidence.length === 0 && !evalSignal) return null;
  return {
    definition_of_done: definitionOfDone,
    required_evidence: requiredEvidence,
    eval_signal: evalSignal,
    context_gaps: contextGaps,
  };
}

function nodeKeyFromMilestone(milestone: Pick<Milestone, "title" | "metadata">): string | undefined {
  return cleanText(milestone.metadata?.plan_key) || undefined;
}

function acceptanceClauseCount(milestone: Pick<Milestone, "acceptance_rule">): number {
  return Array.isArray(milestone.acceptance_rule?.clauses) ? milestone.acceptance_rule.clauses.length : 0;
}

function uniqueEvidenceKinds(evidence: readonly Pick<Evidence, "kind">[]): Evidence["kind"][] {
  return [...new Set(evidence.map((item) => item.kind))];
}

function evaluatorKindsForCompletion(
  milestone: Pick<Milestone, "acceptance_rule">,
  completion: Pick<MilestoneCompletion, "decided_by"> | undefined,
  evidence: readonly Pick<Evidence, "id" | "kind" | "payload" | "trust_score">[],
): Evaluator[] {
  if (!completion || evidence.length === 0) return [];
  if (completion.decided_by === "user_confirm" && evidence.some((item) => item.kind === "manual_check")) {
    return ["manual_confirm"];
  }
  const result = evaluate(milestone.acceptance_rule, evidence as Evidence[]);
  return milestone.acceptance_rule.clauses
    .filter((_clause, index) => result.clauseSatisfied[index])
    .map((clause) => clause.evaluator);
}

function attributionForMilestone(
  milestone: Pick<Milestone, "id" | "acceptance_rule">,
  input: DecompositionLearningAim,
): Pick<DecompositionLearningRow, "decidedBy" | "evidenceKinds" | "evaluatorKinds" | "triggeringEvidenceCount" | "minimumTrustScore"> {
  const completion = input.completions?.find((item) => item.milestone_id === milestone.id);
  if (!completion) return {};
  const triggeringIds = new Set(completion.triggering_evidence_ids);
  const triggeringEvidence = (input.evidence ?? []).filter((item) => triggeringIds.has(item.id));
  const evidenceKinds = uniqueEvidenceKinds(triggeringEvidence);
  const evaluatorKinds = evaluatorKindsForCompletion(milestone, completion, triggeringEvidence);
  const minimumTrustScore = triggeringEvidence.length > 0
    ? Math.min(...triggeringEvidence.map((item) => item.trust_score))
    : undefined;
  return {
    decidedBy: completion.decided_by,
    evidenceKinds,
    evaluatorKinds,
    triggeringEvidenceCount: triggeringEvidence.length,
    ...(minimumTrustScore !== undefined ? { minimumTrustScore } : {}),
  };
}

function completedContractRows(input: DecompositionLearningAim): DecompositionLearningRow[] {
  return (input.milestones ?? []).flatMap((milestone): DecompositionLearningRow[] => {
    if (milestone.status !== "completed") return [];
    const contract = contractFromMilestone(milestone);
    if (!contract || contract.required_evidence.length === 0 || !contract.eval_signal || acceptanceClauseCount(milestone) === 0) {
      return [];
    }
    const nodeKey = nodeKeyFromMilestone(milestone);
    const attribution = attributionForMilestone(milestone, input);
    return [{
      source: "completed_contract",
      recommendation: "reuse_pattern",
      aimId: input.goal.id,
      aimTitle: input.goal.title,
      ...(nodeKey ? { nodeKey } : {}),
      nodeTitle: milestone.title,
      completed: true,
      ...attribution,
      reason: attribution.triggeringEvidenceCount ? "completed_with_evidence_attribution" : "completed_with_inspectable_contract",
      example: `${milestone.title}: done when ${contract.definition_of_done || contract.eval_signal}`,
    }];
  });
}

function qualityRows(input: DecompositionLearningAim): DecompositionLearningRow[] {
  const quality = planQualityFromMetadata(input.goal.metadata);
  if (!quality) return [];
  const titleByKey = new Map((input.milestones ?? []).flatMap((milestone) => {
    const key = nodeKeyFromMilestone(milestone);
    return key ? [[key, milestone.title] as const] : [];
  }));
  return quality.issues
    .filter((issue) => issue.severity !== "info")
    .map((issue) => ({
      source: "quality_issue",
      recommendation: recommendationForIssue(issue.code),
      aimId: input.goal.id,
      aimTitle: input.goal.title,
      ...(issue.nodeKey ? { nodeKey: issue.nodeKey } : {}),
      ...(issue.nodeKey && titleByKey.has(issue.nodeKey) ? { nodeTitle: titleByKey.get(issue.nodeKey) } : {}),
      ...(issue.contextCategory ? { category: issue.contextCategory } : {}),
      dimension: qualityDimensionForIssue(issue.code),
      issueCodes: [issue.code],
      reason: issue.code,
      example: issue.message,
    } satisfies DecompositionLearningRow));
}

function contextOutcomeRows(input: DecompositionLearningAim): DecompositionLearningRow[] {
  return (input.lineage?.rows ?? []).flatMap((row): DecompositionLearningRow[] => {
    const accepted = row.acceptedContextCount ?? 0;
    const rejected = row.rejectedContextCount ?? 0;
    const deprioritized = row.deprioritizedContextCount ?? 0;
    if (accepted + rejected + deprioritized === 0) return [];
    const negative = rejected + deprioritized;
    const recommendation: DecompositionLearningRecommendation =
      negative > 0 && negative >= Math.max(1, accepted)
        ? "tighten_contract"
        : row.impactedPlan || accepted > 0
          ? "ask_context_earlier"
          : "tighten_contract";
    return [{
      source: "context_outcome",
      recommendation,
      aimId: input.goal.id,
      aimTitle: input.goal.title,
      ...(row.originNode?.key ? { nodeKey: row.originNode.key } : {}),
      ...(row.originNode?.title ? { nodeTitle: row.originNode.title } : {}),
      category: row.category,
      acceptedContextCount: accepted,
      rejectedContextCount: rejected,
      deprioritizedContextCount: deprioritized,
      reason: recommendation === "ask_context_earlier" ? "accepted_context_changed_or_supported_plan" : "context_candidate_rejected",
      example: row.question,
    }];
  });
}

function rowKey(row: DecompositionLearningRow): string {
  return [
    row.source,
    row.recommendation,
    row.aimId,
    row.nodeKey ?? "",
    row.category ?? "",
    row.reason,
    row.example.toLowerCase(),
  ].join("\u0000");
}

function recommendationRank(recommendation: DecompositionLearningRecommendation): number {
  switch (recommendation) {
    case "tighten_contract":
      return 0;
    case "improve_acceptance":
      return 1;
    case "ask_context_earlier":
      return 2;
    case "reconsider_granularity":
      return 3;
    case "reuse_pattern":
      return 4;
  }
}

function learningGuidance(row: DecompositionLearningRow): string {
  const target = row.nodeTitle ? ` for "${row.nodeTitle}"` : "";
  if (row.recommendation === "reuse_pattern") {
    const evidence = row.evidenceKinds?.length ? ` via ${row.evidenceKinds.join(", ")}` : "";
    const evaluators = row.evaluatorKinds?.length ? ` matched ${row.evaluatorKinds.join(", ")}` : "";
    return `Reuse completed contract patterns${target}; they reached evidence-derived completion${evidence}${evaluators} with clear required evidence and eval signals.`;
  }
  if (row.recommendation === "ask_context_earlier") {
    return `Ask ${row.category?.replace("_", "-") ?? "context"} questions earlier${target}; accepted context supported the plan after decomposition.`;
  }
  if (row.recommendation === "improve_acceptance") {
    return `Improve acceptance rules${target}; prior decomposition had ${row.issueCodes?.join(", ") ?? "verifiability"} issues.`;
  }
  if (row.recommendation === "reconsider_granularity") {
    return `Reconsider milestone granularity${target}; prior decomposition showed ${row.issueCodes?.join(", ") ?? "granularity"} issues.`;
  }
  return `Tighten milestone contracts${target}; prior context candidates or quality checks showed the contract was not specific enough.`;
}

function priorityForRows(rowCount: number, highAt = 2): DecompositionStrategyPriority {
  if (rowCount >= highAt) return "high";
  if (rowCount > 0) return "medium";
  return "low";
}

function priorityRank(priority: DecompositionStrategyPriority): number {
  switch (priority) {
    case "high":
      return 0;
    case "medium":
      return 1;
    case "low":
      return 2;
  }
}

function focusRank(focus: DecompositionStrategyFocus): number {
  switch (focus) {
    case "contract_specificity":
      return 0;
    case "verifiability":
      return 1;
    case "context_fit":
      return 2;
    case "evidence_pattern":
      return 3;
    case "granularity":
      return 4;
  }
}

function evidencePair(row: DecompositionLearningRow): string | null {
  const evidence = row.evidenceKinds?.length ? row.evidenceKinds.join(", ") : "";
  const evaluators = row.evaluatorKinds?.length ? row.evaluatorKinds.join(", ") : "";
  if (evidence && evaluators) return `${evidence} via ${evaluators}`;
  if (evidence) return `${evidence} via unknown evaluator`;
  if (evaluators) return `unknown evidence via ${evaluators}`;
  return null;
}

function topEvidencePairs(rows: readonly DecompositionLearningRow[]): string[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const pair = evidencePair(row);
    if (!pair) continue;
    counts.set(pair, (counts.get(pair) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 2)
    .map(([pair]) => pair);
}

function strategyGuidance(action: DecompositionStrategyAction): string {
  switch (action.focus) {
    case "verifiability":
      return "Treat eval signals as acceptance inputs; every milestone should name the evidence that can satisfy it.";
    case "granularity":
      return "Prefer one independently verifiable outcome per milestone, then connect milestones linearly when dependencies are obvious.";
    case "context_fit":
      return "Collect only context that can change milestone boundaries, owner routing, evidence choice, or eval signals.";
    case "evidence_pattern":
      return "Reuse evidence/evaluator pairings that already produced trusted completions before inventing new acceptance shapes.";
    case "contract_specificity":
      return "Write decomposition contracts with concrete done states, required evidence, context gaps, and personalized eval signals.";
  }
}

export function reviewDecompositionStrategy(input: ReviewDecompositionStrategyInput): DecompositionStrategyReport {
  const title = cleanText(input.title) || "Untitled aim";
  const description = cleanText(input.description);
  const rows = input.learning?.rows ?? [];
  const actions: DecompositionStrategyAction[] = [];
  const addAction = (action: DecompositionStrategyAction) => {
    actions.push(action);
  };

  const verifiabilityRows = rows.filter((row) =>
    row.recommendation === "improve_acceptance" ||
    row.dimension === "verifiability" ||
    row.issueCodes?.some((code) =>
      code === "weak_commit_pattern" ||
      code === "empty_commit_pattern" ||
      code === "missing_eval_acceptance_signal" ||
      code === "manual_only_verification",
    ),
  );
  if (verifiabilityRows.length > 0) {
    addAction({
      focus: "verifiability",
      priority: priorityForRows(verifiabilityRows.length),
      recommendation: "Make every acceptance_rule evidence-backed, specific, and tied to the milestone vocabulary.",
      reason: "Historical decompositions had acceptance or eval weaknesses.",
      sourceRows: verifiabilityRows.length,
    });
  }

  const granularityRows = rows.filter((row) =>
    row.recommendation === "reconsider_granularity" ||
    row.dimension === "granularity" ||
    row.issueCodes?.some((code) => code === "oversized_milestone" || code === "compound_milestone"),
  );
  if (granularityRows.length > 0) {
    addAction({
      focus: "granularity",
      priority: priorityForRows(granularityRows.length),
      recommendation: "Split milestones around independently inspectable outcomes, not implementation phases plus release chores.",
      reason: "Historical decompositions mixed outcomes or produced oversized milestones.",
      sourceRows: granularityRows.length,
    });
  }

  const contextRows = rows.filter((row) => row.recommendation === "ask_context_earlier" || row.dimension === "context_fit");
  const missingDescription = description.length < 24;
  if (contextRows.length > 0 || missingDescription) {
    addAction({
      focus: "context_fit",
      priority: missingDescription && contextRows.length > 0 ? "high" : priorityForRows(contextRows.length),
      recommendation: "Surface context_gaps before locking the plan when target, constraints, procedure, or eval standards are underspecified.",
      reason: missingDescription
        ? contextRows.length > 0
          ? "The current aim has a short description and historical context changed or supported plans."
          : "The current aim has a short description."
        : "Historical accepted context changed or supported decompositions after the first pass.",
      sourceRows: contextRows.length,
    });
  }

  const evidenceRows = rows.filter((row) => row.recommendation === "reuse_pattern" && (row.evidenceKinds?.length || row.evaluatorKinds?.length));
  if (evidenceRows.length > 0) {
    const pairs = topEvidencePairs(evidenceRows);
    addAction({
      focus: "evidence_pattern",
      priority: priorityForRows(evidenceRows.length),
      recommendation: pairs.length > 0
        ? `Reuse proven evidence/evaluator pairings such as ${pairs.join("; ")} when they fit this aim.`
        : "Reuse proven evidence/evaluator pairings from completed milestones when they fit this aim.",
      reason: "Historical milestones reached completion through trusted evidence attribution.",
      sourceRows: evidenceRows.length,
    });
  }

  const contractRows = rows.filter((row) =>
    row.recommendation === "tighten_contract" ||
    row.issueCodes?.some((code) =>
      code === "missing_decomposition_contract" ||
      code === "missing_contract_evidence" ||
      code === "missing_contract_eval_signal",
    ),
  );
  if (contractRows.length > 0) {
    addAction({
      focus: "contract_specificity",
      priority: priorityForRows(contractRows.length),
      recommendation: "Tighten decomposition_contract fields so required evidence, context gaps, and eval_signal are explicit.",
      reason: "Historical contracts or context candidates were not specific enough.",
      sourceRows: contractRows.length,
    });
  }

  const sortedActions = actions.sort((a, b) =>
    priorityRank(a.priority) - priorityRank(b.priority) ||
    b.sourceRows - a.sourceRows ||
    focusRank(a.focus) - focusRank(b.focus),
  );

  return {
    version: 1,
    title,
    actionCount: sortedActions.length,
    actions: sortedActions,
    guidance: sortedActions.map(strategyGuidance),
  };
}

export function summarizeDecompositionLearning(
  aims: readonly (DecompositionLearningAim | null | undefined)[],
): DecompositionLearningReport {
  const rows: DecompositionLearningRow[] = [];
  const seen = new Set<string>();
  let totalMilestones = 0;
  let completedMilestones = 0;
  let qualityIssueCount = 0;
  let contextOutcomeCount = 0;
  let evidenceAttributionCount = 0;

  for (const aim of aims) {
    if (!aim) continue;
    totalMilestones += aim.milestones?.length ?? 0;
    completedMilestones += (aim.milestones ?? []).filter((milestone) => milestone.status === "completed").length;
    const nextRows = [
      ...qualityRows(aim),
      ...contextOutcomeRows(aim),
      ...completedContractRows(aim),
    ];
    qualityIssueCount += nextRows.filter((row) => row.source === "quality_issue").length;
    contextOutcomeCount += nextRows.filter((row) => row.source === "context_outcome").length;
    evidenceAttributionCount += nextRows.filter((row) => row.triggeringEvidenceCount && row.triggeringEvidenceCount > 0).length;
    for (const row of nextRows) {
      const key = rowKey(row);
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
  }

  const sortedRows = rows.sort((a, b) =>
    recommendationRank(a.recommendation) - recommendationRank(b.recommendation) ||
    (b.rejectedContextCount ?? 0) + (b.deprioritizedContextCount ?? 0) - ((a.rejectedContextCount ?? 0) + (a.deprioritizedContextCount ?? 0)) ||
    (b.acceptedContextCount ?? 0) - (a.acceptedContextCount ?? 0) ||
    a.aimTitle.localeCompare(b.aimTitle),
  );

  return {
    version: 1,
    totalAims: aims.filter(Boolean).length,
    totalMilestones,
    completedMilestones,
    qualityIssueCount,
    contextOutcomeCount,
    evidenceAttributionCount,
    rows: sortedRows,
    guidance: sortedRows.slice(0, 6).map(learningGuidance),
  };
}
