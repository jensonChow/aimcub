import type {
  AcceptanceClause,
  ContextCategory,
  DecompositionOutput,
  MemoryKind,
  PlanNode,
} from "@aimcub/types";
import { inferContextCategory } from "./context";

export type PlanQualitySeverity = "info" | "warning" | "error";
export type PlanQualityGrade = "pass" | "warn" | "fail";

export type PlanQualityIssueCode =
  | "missing_decomposition_contract"
  | "missing_contract_evidence"
  | "missing_contract_eval_signal"
  | "missing_context_application"
  | "missing_eval_acceptance_signal"
  | "missing_research_evidence"
  | "insufficient_research_coverage"
  | "manual_only_verification"
  | "orphan_verification_milestone"
  | "duplicate_acceptance_rule"
  | "indistinct_acceptance_rule"
  | "oversized_milestone"
  | "compound_milestone"
  | "unsupported_auto_evaluator"
  | "weak_commit_pattern"
  | "empty_commit_pattern"
  | "missing_dependency_shape";

export interface PlanQualityIssue {
  code: PlanQualityIssueCode;
  severity: PlanQualitySeverity;
  message: string;
  nodeKey?: string;
  contextCategory?: ContextCategory;
}

export type PlanQualityDimension = "verifiability" | "granularity" | "distinctness" | "context_fit";

export interface PlanQualityDimensionReport {
  dimension: PlanQualityDimension;
  score: number;
  grade: PlanQualityGrade;
  issueCount: number;
  issueCodes: PlanQualityIssueCode[];
}

export interface PlanQualityReport {
  score: number;
  grade: PlanQualityGrade;
  issues: PlanQualityIssue[];
  dimensions?: PlanQualityDimensionReport[];
}

export interface PlanQualityContext {
  content: string;
  category?: ContextCategory | string;
  kind?: MemoryKind | string;
  confidence?: number;
}

export interface PlanQualityResearchEvidence {
  required?: boolean;
  sourceCount?: number;
  fetchedSourceCount?: number;
  searchResultCount?: number;
  sources?: readonly unknown[];
  uncertainties?: readonly string[];
}

export interface CritiquePlanInput {
  plan: DecompositionOutput;
  context?: readonly PlanQualityContext[];
  research?: PlanQualityResearchEvidence | null;
}

export interface PlanContextUse {
  content: string;
  category: ContextCategory;
  confidence?: number;
  applied: boolean;
  matchedKeywords: string[];
}

export type PlanContextGapPriority = "high" | "medium" | "low";
export type PlanContextGapSource = "missing_context" | "decomposition_contract";
export type PlanContextGapRoiSignal =
  | "high_priority"
  | "medium_priority"
  | "low_priority"
  | "decomposition_contract"
  | "missing_context"
  | "node_specific"
  | "quality_issue_linked"
  | "lineage_learning"
  | "eval_signal"
  | "procedure"
  | "constraint"
  | "capability";

export interface PlanContextGap {
  category: ContextCategory;
  priority: PlanContextGapPriority;
  reason: string;
  prompt: string;
  source?: PlanContextGapSource;
  nodeKey?: string;
  nodeTitle?: string;
  roiScore?: number;
  roiSignals?: PlanContextGapRoiSignal[];
  issueCodes?: PlanQualityIssueCode[];
}

export type PlanReviewActionCode =
  | "fix_quality_errors"
  | "refine_with_unapplied_context"
  | "review_quality_warnings"
  | "capture_initial_context"
  | "accept_plan";

export type PlanReviewActionPriority = "high" | "medium" | "low";

export interface PlanReviewAction {
  code: PlanReviewActionCode;
  priority: PlanReviewActionPriority;
  title: string;
  reason: string;
  refinePrompt?: string;
  contextCategories?: ContextCategory[];
  issueCodes?: PlanQualityIssueCode[];
}

export interface PlanReviewReport {
  quality: PlanQualityReport;
  context: {
    total: number;
    applied: PlanContextUse[];
    unapplied: PlanContextUse[];
    ignoredLowConfidence: PlanContextUse[];
    gaps: PlanContextGap[];
  };
  actions: PlanReviewAction[];
  guidance: string[];
}

export interface ReviewPlanInput extends CritiquePlanInput {
  quality?: PlanQualityReport | null;
}

const STOPWORDS = new Set([
  "about",
  "after",
  "again",
  "aimcub",
  "before",
  "context",
  "done",
  "from",
  "must",
  "only",
  "plan",
  "prefer",
  "prefers",
  "project",
  "signal",
  "that",
  "this",
  "user",
  "verified",
  "wants",
  "with",
  "work",
]);

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_./-]+/g, " ").replace(/\s+/g, " ").trim();
}

function planText(plan: DecompositionOutput): string {
  const parts = [
    plan.goal_summary,
    plan.rationale,
    ...plan.nodes.flatMap((node) => [
      node.key,
      node.title,
      node.description,
      JSON.stringify(node.acceptance_rule),
      JSON.stringify(node.decomposition_contract),
    ]),
  ];
  return normalizeText(parts.filter(Boolean).join(" "));
}

function acceptanceRulesText(plan: DecompositionOutput): string {
  return normalizeText(plan.nodes.map((node) => JSON.stringify(node.acceptance_rule)).join(" "));
}

function contextCategory(row: PlanQualityContext): ContextCategory {
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

function contextKeywords(content: string): string[] {
  const withoutPrefix = content.replace(/^[a-z_ ]+:\s*/i, "");
  const tokens = normalizeText(withoutPrefix)
    .split(" ")
    .filter((token) => token.length >= 4 && !STOPWORDS.has(token));
  return [...new Set(tokens)].slice(0, 6);
}

function clauseSummary(clause: AcceptanceClause): string {
  return clause.evaluator;
}

function hasCommitFilter(clause: Extract<AcceptanceClause, { evaluator: "commit_pattern" }>): boolean {
  const m = clause.match;
  return Boolean(m.path_glob || m.min_files || m.message_pattern || m.branch);
}

function weakMessagePattern(pattern: string | undefined): boolean {
  if (!pattern) return true;
  const normalized = normalizeText(pattern);
  if (normalized.length < 4) return true;
  return ["update", "fix", "change", "work", "done", "wip"].includes(normalized);
}

function critiqueNodeVerification(node: PlanNode): PlanQualityIssue[] {
  const issues: PlanQualityIssue[] = [];
  const clauses = node.acceptance_rule.clauses;
  const autoSupported = clauses.some((clause) => clause.evaluator === "commit_pattern" || clause.evaluator === "ci_status");
  const manualOnly = clauses.every((clause) => clause.evaluator === "manual_confirm");

  if (manualOnly) {
    issues.push({
      code: "manual_only_verification",
      severity: "warning",
      nodeKey: node.key,
      message: `Milestone "${node.title}" can only be completed manually; prefer evidence-backed rules when possible.`,
    });
  }

  for (const clause of clauses) {
    if (clause.evaluator === "commit_pattern") {
      if (!hasCommitFilter(clause)) {
        issues.push({
          code: "empty_commit_pattern",
          severity: "error",
          nodeKey: node.key,
          message: `Milestone "${node.title}" has a commit_pattern with no filters, so any trusted commit could satisfy it.`,
        });
      } else if (!clause.match.path_glob && !clause.match.min_files && weakMessagePattern(clause.match.message_pattern)) {
        issues.push({
          code: "weak_commit_pattern",
          severity: "warning",
          nodeKey: node.key,
          message: `Milestone "${node.title}" uses a broad commit message pattern; add path_glob or min_files to make completion harder to spoof.`,
        });
      }
    } else if (clause.evaluator !== "ci_status" && clause.evaluator !== "manual_confirm") {
      issues.push({
        code: "unsupported_auto_evaluator",
        severity: clause.auto_verifiable ? "error" : "warning",
        nodeKey: node.key,
        message: `Milestone "${node.title}" uses ${clauseSummary(clause)}, which evaluate() does not implement in v1.`,
      });
    }
  }

  if (!autoSupported && !manualOnly) {
    issues.push({
      code: "unsupported_auto_evaluator",
      severity: "warning",
      nodeKey: node.key,
      message: `Milestone "${node.title}" has no v1 auto-verifiable clause.`,
    });
  }

  return issues;
}

function critiqueNodeContract(node: PlanNode): PlanQualityIssue[] {
  const contract = node.decomposition_contract;
  if (!contract) {
    return [
      {
        code: "missing_decomposition_contract",
        severity: "warning",
        nodeKey: node.key,
        message: `Milestone "${node.title}" is missing a decomposition_contract, so its why/done/evidence/routing/context rationale is not inspectable.`,
      },
    ];
  }

  const issues: PlanQualityIssue[] = [];
  const requiredEvidence = Array.isArray(contract.required_evidence) ? contract.required_evidence : [];
  if (requiredEvidence.length === 0 || requiredEvidence.every((item) => typeof item !== "string" || item.trim().length === 0)) {
    issues.push({
      code: "missing_contract_evidence",
      severity: "warning",
      nodeKey: node.key,
      message: `Milestone "${node.title}" has a decomposition_contract but no required_evidence explaining what should prove completion.`,
    });
  }
  if (typeof contract.eval_signal !== "string" || !contract.eval_signal.trim()) {
    issues.push({
      code: "missing_contract_eval_signal",
      severity: "warning",
      nodeKey: node.key,
      message: `Milestone "${node.title}" has a decomposition_contract but no eval_signal describing the personalized done standard.`,
    });
  }
  return issues;
}

function critiqueContextApplication(plan: DecompositionOutput, context: readonly PlanQualityContext[]): PlanQualityIssue[] {
  const issues: PlanQualityIssue[] = [];
  const categoriesToCheck = new Set<ContextCategory>(["constraint", "procedure", "eval_signal"]);

  for (const row of contextUsage(plan, context)) {
    if (typeof row.confidence === "number" && row.confidence < 0.6) continue;
    if (!categoriesToCheck.has(row.category)) continue;
    if (row.matchedKeywords.length === 0) {
      issues.push({
        code: "missing_context_application",
        severity: "warning",
        contextCategory: row.category,
        message: `No obvious use of ${row.category} context: "${row.content}".`,
      });
    }
  }

  return issues;
}

function critiqueEvalAcceptanceApplication(plan: DecompositionOutput, context: readonly PlanQualityContext[]): PlanQualityIssue[] {
  const text = acceptanceRulesText(plan);
  const issues: PlanQualityIssue[] = [];

  for (const row of context) {
    if (typeof row.confidence === "number" && row.confidence < 0.6) continue;
    if (contextCategory(row) !== "eval_signal") continue;
    const keywords = contextKeywords(row.content);
    if (keywords.length === 0) continue;
    const matchedKeywords = keywords.filter((keyword) => text.includes(keyword));
    if (matchedKeywords.length === 0) {
      issues.push({
        code: "missing_eval_acceptance_signal",
        severity: "warning",
        contextCategory: "eval_signal",
        message: `Eval signal is not reflected in acceptance rules: "${row.content}".`,
      });
    }
  }

  return issues;
}

const RESEARCH_REQUIRED_PATTERN =
  /\b(latest|current|recent|today|research|search|web|online|compare|comparison|market|competitor|pricing|price|docs|documentation|regulation|legal|law|policy|travel|visa|flight|hotel|country|city|vendor|official)\b|最新|当前|现在|近期|调研|搜索|联网|网页|在线|对比|比较|市场|竞品|价格|文档|官方|法规|法律|政策|旅行|旅游|签证|机票|航班|酒店|国家|城市/;

function parseResearchCount(content: string, label: string): number | null {
  const match = new RegExp(`${label}:\\s*(\\d+)`, "i").exec(content);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function researchFromContext(context: readonly PlanQualityContext[]): PlanQualityResearchEvidence | null {
  for (const row of context) {
    const content = row.content;
    if (!/Research brief for aim:/i.test(content)) continue;
    const sourceCount = parseResearchCount(content, "Sources");
    const fetchedMatch = /(\d+)\s+fetched pages/i.exec(content);
    const searchMatch = /(\d+)\s+search results/i.exec(content);
    return {
      sourceCount: sourceCount ?? undefined,
      fetchedSourceCount: fetchedMatch ? Number(fetchedMatch[1]) : undefined,
      searchResultCount: searchMatch ? Number(searchMatch[1]) : undefined,
      uncertainties: /Uncertainties:/i.test(content) ? ["Research brief reported uncertainties."] : [],
    };
  }
  return null;
}

function planNeedsResearch(plan: DecompositionOutput): boolean {
  return RESEARCH_REQUIRED_PATTERN.test(planText(plan));
}

function normalizedResearchEvidence(
  explicit: PlanQualityResearchEvidence | null | undefined,
  context: readonly PlanQualityContext[],
): PlanQualityResearchEvidence | null {
  const research = explicit ?? researchFromContext(context);
  if (!research) return null;
  return {
    required: research.required,
    sourceCount: research.sourceCount ?? research.sources?.length ?? 0,
    fetchedSourceCount: research.fetchedSourceCount ?? 0,
    searchResultCount: research.searchResultCount ?? 0,
    sources: research.sources,
    uncertainties: research.uncertainties ?? [],
  };
}

function critiqueResearchCoverage(
  plan: DecompositionOutput,
  context: readonly PlanQualityContext[],
  research: PlanQualityResearchEvidence | null | undefined,
): PlanQualityIssue[] {
  const evidence = normalizedResearchEvidence(research, context);
  if (!evidence?.required && !planNeedsResearch(plan)) return [];

  if (!evidence || (evidence.sourceCount ?? 0) === 0) {
    return [{
      code: "missing_research_evidence",
      severity: "warning",
      contextCategory: "project_fact",
      message: "Plan appears to depend on current or external facts, but no first-party web research evidence was provided.",
    }];
  }

  const sourceCount = evidence.sourceCount ?? 0;
  const fetchedSourceCount = evidence.fetchedSourceCount ?? 0;
  const uncertainties = evidence.uncertainties ?? [];
  if (sourceCount < 3 || fetchedSourceCount < 1 || uncertainties.length > 0) {
    const reasons: string[] = [];
    if (sourceCount < 3) reasons.push(`only ${sourceCount} source${sourceCount === 1 ? "" : "s"}`);
    if (fetchedSourceCount < 1) reasons.push("no fetched source pages");
    if (uncertainties.length > 0) reasons.push(`${uncertainties.length} research uncertainty${uncertainties.length === 1 ? "" : "ies"}`);
    return [{
      code: "insufficient_research_coverage",
      severity: "warning",
      contextCategory: "project_fact",
      message: `Plan uses web-sensitive facts, but research coverage is thin: ${reasons.join(", ")}.`,
    }];
  }

  return [];
}

function critiqueDependencyShape(plan: DecompositionOutput): PlanQualityIssue[] {
  if (plan.nodes.length >= 4 && plan.edges.length === 0) {
    return [
      {
        code: "missing_dependency_shape",
        severity: "info",
        message: "Plan has several milestones but no dependencies; confirm the work can really proceed in any order.",
      },
    ];
  }
  return [];
}

function isVerificationOnlyNode(node: PlanNode): boolean {
  const clauses = node.acceptance_rule.clauses;
  return clauses.length > 0 && clauses.every((clause) => clause.evaluator === "ci_status");
}

function critiqueVerificationDependencies(plan: DecompositionOutput): PlanQualityIssue[] {
  if (plan.nodes.length <= 1) return [];
  const hasIncoming = new Set(plan.edges.map((edge) => edge.to));
  return plan.nodes
    .filter((node) => isVerificationOnlyNode(node) && !hasIncoming.has(node.key))
    .map((node) => ({
      code: "orphan_verification_milestone",
      severity: "warning",
      nodeKey: node.key,
      message: `Verification milestone "${node.title}" has no prerequisite; link it after the implementation work it verifies.`,
    }));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

function acceptanceRuleSignature(node: PlanNode): string {
  return JSON.stringify(canonicalize(node.acceptance_rule));
}

function critiqueDuplicateAcceptanceRules(plan: DecompositionOutput): PlanQualityIssue[] {
  const firstBySignature = new Map<string, PlanNode>();
  const issues: PlanQualityIssue[] = [];

  for (const node of plan.nodes) {
    const signature = acceptanceRuleSignature(node);
    const first = firstBySignature.get(signature);
    if (!first) {
      firstBySignature.set(signature, node);
      continue;
    }
    issues.push({
      code: "duplicate_acceptance_rule",
      severity: "warning",
      nodeKey: node.key,
      message: `Milestone "${node.title}" has the same acceptance rule as "${first.title}", so the same evidence may complete both.`,
    });
  }

  return issues;
}

type DistinctiveEvidenceEvaluator = "commit_pattern" | "ci_status";

interface CompletingEvidenceClause {
  signature: string;
  evaluator: DistinctiveEvidenceEvaluator;
  node: PlanNode;
  ruleSignature: string;
}

function autoEvidenceClauseSignature(clause: AcceptanceClause): string | null {
  if (clause.evaluator !== "commit_pattern" && clause.evaluator !== "ci_status") return null;
  return `${clause.evaluator}:${JSON.stringify(canonicalize(clause.match))}`;
}

function clauseCanCompleteRule(node: PlanNode, clauseIndex: number): boolean {
  const rule = node.acceptance_rule;
  if (rule.logic === "any") return true;
  if (rule.logic === "all") return rule.clauses.length === 1;
  const clause = rule.clauses[clauseIndex];
  return (clause?.weight ?? 1) >= rule.threshold;
}

function completingEvidenceClauses(node: PlanNode): CompletingEvidenceClause[] {
  const ruleSignature = acceptanceRuleSignature(node);
  return node.acceptance_rule.clauses.flatMap((clause, index) => {
    if (clause.evaluator !== "commit_pattern" && clause.evaluator !== "ci_status") return [];
    const signature = autoEvidenceClauseSignature(clause);
    if (!signature || !clauseCanCompleteRule(node, index)) return [];
    return [{
      signature,
      evaluator: clause.evaluator,
      node,
      ruleSignature,
    }];
  });
}

function critiqueIndistinctAcceptanceRules(plan: DecompositionOutput): PlanQualityIssue[] {
  const firstByClauseSignature = new Map<string, CompletingEvidenceClause>();
  const reportedPairs = new Set<string>();
  const issues: PlanQualityIssue[] = [];

  for (const node of plan.nodes) {
    for (const clause of completingEvidenceClauses(node)) {
      const first = firstByClauseSignature.get(clause.signature);
      if (!first) {
        firstByClauseSignature.set(clause.signature, clause);
        continue;
      }
      if (first.ruleSignature === clause.ruleSignature) continue;

      const pairKey = `${first.node.key}:${node.key}`;
      if (reportedPairs.has(pairKey)) continue;
      reportedPairs.add(pairKey);
      issues.push({
        code: "indistinct_acceptance_rule",
        severity: "warning",
        nodeKey: node.key,
        message: `Milestone "${node.title}" reuses the same ${clause.evaluator} evidence filter as "${first.node.title}", so one evidence event may complete both milestones.`,
      });
    }
  }

  return issues;
}

function critiqueMilestoneSize(plan: DecompositionOutput): PlanQualityIssue[] {
  return plan.nodes
    .filter((node) => node.est_effort === "xl")
    .map((node) => ({
      code: "oversized_milestone",
      severity: "warning",
      nodeKey: node.key,
      message: `Milestone "${node.title}" is estimated xl; split it into smaller verifiable milestones unless it is truly atomic.`,
    }));
}

const COMPOUND_ACTION_VERBS = [
  "add",
  "build",
  "connect",
  "create",
  "deploy",
  "design",
  "document",
  "expose",
  "implement",
  "integrate",
  "migrate",
  "persist",
  "refactor",
  "release",
  "render",
  "ship",
  "test",
  "verify",
  "wire",
];

function actionVerbMatches(text: string): string[] {
  return COMPOUND_ACTION_VERBS.filter((verb) => new RegExp(`\\b${verb}\\b`).test(text));
}

function hasCompoundConnector(text: string): boolean {
  return /\b(?:also|and|plus|then)\b|[;&]/.test(text);
}

function looksCompoundMilestone(node: PlanNode): boolean {
  return [node.title, node.description].some((part) => {
    const text = normalizeText(part);
    return actionVerbMatches(text).length >= 2 && hasCompoundConnector(text);
  });
}

function critiqueCompoundMilestones(plan: DecompositionOutput): PlanQualityIssue[] {
  return plan.nodes
    .filter(looksCompoundMilestone)
    .map((node) => ({
      code: "compound_milestone",
      severity: "warning",
      nodeKey: node.key,
      message: `Milestone "${node.title}" appears to bundle multiple deliverables; split independent work into separate verifiable milestones.`,
    }));
}

function scoreIssues(issues: readonly PlanQualityIssue[]): number {
  const penalty = issues.reduce((sum, issue) => {
    if (issue.severity === "error") return sum + 30;
    if (issue.severity === "warning") return sum + 10;
    return sum + 3;
  }, 0);
  return Math.max(0, 100 - penalty);
}

function gradeIssues(issues: readonly PlanQualityIssue[], score: number): PlanQualityGrade {
  return issues.some((issue) => issue.severity === "error") || score < 60 ? "fail" : issues.length > 0 ? "warn" : "pass";
}

const ISSUE_DIMENSION: Record<PlanQualityIssueCode, PlanQualityDimension> = {
  duplicate_acceptance_rule: "distinctness",
  empty_commit_pattern: "verifiability",
  compound_milestone: "granularity",
  indistinct_acceptance_rule: "distinctness",
  manual_only_verification: "verifiability",
  missing_contract_evidence: "verifiability",
  missing_contract_eval_signal: "verifiability",
  missing_context_application: "context_fit",
  missing_decomposition_contract: "context_fit",
  missing_dependency_shape: "distinctness",
  missing_eval_acceptance_signal: "context_fit",
  missing_research_evidence: "context_fit",
  insufficient_research_coverage: "context_fit",
  orphan_verification_milestone: "verifiability",
  oversized_milestone: "granularity",
  unsupported_auto_evaluator: "verifiability",
  weak_commit_pattern: "verifiability",
};

const PLAN_QUALITY_DIMENSIONS: PlanQualityDimension[] = [
  "verifiability",
  "granularity",
  "distinctness",
  "context_fit",
];

function dimensionScorecard(issues: readonly PlanQualityIssue[]): PlanQualityDimensionReport[] {
  return PLAN_QUALITY_DIMENSIONS.map((dimension) => {
    const dimensionIssues = issues.filter((issue) => ISSUE_DIMENSION[issue.code] === dimension);
    const score = scoreIssues(dimensionIssues);
    return {
      dimension,
      score,
      grade: gradeIssues(dimensionIssues, score),
      issueCount: dimensionIssues.length,
      issueCodes: [...new Set(dimensionIssues.map((issue) => issue.code))],
    };
  });
}

export function critiquePlan(input: CritiquePlanInput): PlanQualityReport {
  const issues = [
    ...input.plan.nodes.flatMap(critiqueNodeContract),
    ...input.plan.nodes.flatMap(critiqueNodeVerification),
    ...critiqueContextApplication(input.plan, input.context ?? []),
    ...critiqueEvalAcceptanceApplication(input.plan, input.context ?? []),
    ...critiqueResearchCoverage(input.plan, input.context ?? [], input.research),
    ...critiqueDependencyShape(input.plan),
    ...critiqueVerificationDependencies(input.plan),
    ...critiqueDuplicateAcceptanceRules(input.plan),
    ...critiqueIndistinctAcceptanceRules(input.plan),
    ...critiqueMilestoneSize(input.plan),
    ...critiqueCompoundMilestones(input.plan),
  ];
  const score = scoreIssues(issues);
  const grade = gradeIssues(issues, score);
  return { score, grade, issues, dimensions: dimensionScorecard(issues) };
}

function contextUsage(plan: DecompositionOutput, context: readonly PlanQualityContext[]): PlanContextUse[] {
  const text = planText(plan);
  return context
    .filter((row) => row.content.trim().length > 0)
    .map((row) => {
      const keywords = contextKeywords(row.content);
      const matchedKeywords = keywords.filter((keyword) => text.includes(keyword));
      return {
        content: row.content.trim(),
        category: contextCategory(row),
        confidence: row.confidence,
        applied: matchedKeywords.length > 0,
        matchedKeywords,
      };
    });
}

const VERIFIABILITY_CONTEXT_ISSUES: PlanQualityIssueCode[] = [
  "missing_contract_evidence",
  "missing_contract_eval_signal",
  "empty_commit_pattern",
  "manual_only_verification",
  "orphan_verification_milestone",
  "unsupported_auto_evaluator",
  "weak_commit_pattern",
];

const GRANULARITY_CONTEXT_ISSUES: PlanQualityIssueCode[] = [
  "compound_milestone",
  "oversized_milestone",
];

const DISTINCTNESS_CONTEXT_ISSUES: PlanQualityIssueCode[] = [
  "duplicate_acceptance_rule",
  "indistinct_acceptance_rule",
  "missing_dependency_shape",
];

const RESEARCH_CONTEXT_ISSUES: PlanQualityIssueCode[] = [
  "missing_research_evidence",
  "insufficient_research_coverage",
];

function hasAnyIssue(issueCodes: Set<PlanQualityIssueCode>, codes: readonly PlanQualityIssueCode[]): boolean {
  return codes.some((code) => issueCodes.has(code));
}

function contextGapPriority(issueCodes: Set<PlanQualityIssueCode>, category: ContextCategory): PlanContextGapPriority {
  if (category === "project_fact" && hasAnyIssue(issueCodes, RESEARCH_CONTEXT_ISSUES)) return "high";
  if (category === "eval_signal") {
    return hasAnyIssue(issueCodes, VERIFIABILITY_CONTEXT_ISSUES) ||
      hasAnyIssue(issueCodes, GRANULARITY_CONTEXT_ISSUES) ||
      hasAnyIssue(issueCodes, DISTINCTNESS_CONTEXT_ISSUES) ||
      issueCodes.has("missing_eval_acceptance_signal")
      ? "high"
      : "medium";
  }
  if (category === "procedure") {
    return hasAnyIssue(issueCodes, VERIFIABILITY_CONTEXT_ISSUES) ||
      hasAnyIssue(issueCodes, DISTINCTNESS_CONTEXT_ISSUES)
      ? "medium"
      : "low";
  }
  if (category === "constraint") return "medium";
  return "low";
}

function evalSignalGapPrompt(issueCodes: Set<PlanQualityIssueCode>): string {
  const prompts: string[] = [];
  if (hasAnyIssue(issueCodes, GRANULARITY_CONTEXT_ISSUES)) {
    prompts.push("Which outcomes should count as separate milestones, where does each outcome stop, and what evidence would prove each outcome complete?");
  }
  if (hasAnyIssue(issueCodes, DISTINCTNESS_CONTEXT_ISSUES)) {
    prompts.push("What evidence should uniquely prove each milestone so one event cannot complete unrelated work?");
  }
  if (hasAnyIssue(issueCodes, VERIFIABILITY_CONTEXT_ISSUES) || issueCodes.has("missing_eval_acceptance_signal")) {
    prompts.push("What would make this aim count as genuinely complete, and what evidence would prove it without relying on manual judgment alone?");
  }
  return prompts.length > 0
    ? prompts.join(" ")
    : "What would make this aim count as genuinely complete, and what evidence would prove it?";
}

function constraintGapPrompt(issueCodes: Set<PlanQualityIssueCode>): string {
  if (hasAnyIssue(issueCodes, GRANULARITY_CONTEXT_ISSUES)) {
    return "Which non-negotiable scope boundaries decide which deliverables must be split, deferred, or kept together?";
  }
  return "Which non-negotiable constraints apply, such as tools, platform boundaries, privacy, budget, deadlines, or quality bars?";
}

function procedureGapPrompt(issueCodes: Set<PlanQualityIssueCode>): string {
  const prompts: string[] = [];
  if (hasAnyIssue(issueCodes, VERIFIABILITY_CONTEXT_ISSUES)) {
    prompts.push("Which existing commands, CI workflows, files, review artifacts, or evidence sources prove progress?");
  }
  if (hasAnyIssue(issueCodes, DISTINCTNESS_CONTEXT_ISSUES)) {
    prompts.push("Should shared verification be its own dependent milestone instead of completing multiple milestones at once?");
  }
  return prompts.length > 0
    ? prompts.join(" ")
    : "Which existing workflow, checklist, or verification command should this aim follow?";
}

function researchGapPrompt(issueCodes: Set<PlanQualityIssueCode>): string {
  if (issueCodes.has("missing_research_evidence")) {
    return "Run first-party web research before finalizing this plan: search multiple current sources, fetch the most relevant pages, and use cited facts to refine constraints, risks, and milestone order.";
  }
  return "Broaden first-party web research before finalizing this plan: use at least 3 relevant sources and fetch at least 1 source page so the plan is not based on snippets alone.";
}

function contractGapPriority(category: ContextCategory): PlanContextGapPriority {
  switch (category) {
    case "eval_signal":
      return "high";
    case "constraint":
    case "procedure":
    case "capability":
      return "medium";
    case "preference":
    case "project_fact":
      return "low";
  }
}

function contractContextGaps(plan: DecompositionOutput): PlanContextGap[] {
  const gaps: PlanContextGap[] = [];
  for (const node of plan.nodes) {
    const contract = node.decomposition_contract;
    if (!contract) continue;
    for (const gap of contract.context_gaps) {
      const question = gap.question.trim();
      if (!question) continue;
      gaps.push({
        category: gap.category,
        priority: contractGapPriority(gap.category),
        reason: gap.reason || "decomposition_contract_gap",
        prompt: `For milestone "${node.title}": ${question}`,
        source: "decomposition_contract",
        nodeKey: node.key,
        nodeTitle: node.title,
      });
    }
  }
  return gaps;
}

function gapPriorityScore(priority: PlanContextGapPriority): { score: number; signal: PlanContextGapRoiSignal } {
  switch (priority) {
    case "high":
      return { score: 50, signal: "high_priority" };
    case "medium":
      return { score: 32, signal: "medium_priority" };
    case "low":
      return { score: 14, signal: "low_priority" };
  }
}

function gapCategoryScore(category: ContextCategory): { score: number; signal?: PlanContextGapRoiSignal } {
  switch (category) {
    case "eval_signal":
      return { score: 18, signal: "eval_signal" };
    case "procedure":
      return { score: 14, signal: "procedure" };
    case "constraint":
      return { score: 12, signal: "constraint" };
    case "capability":
      return { score: 8, signal: "capability" };
    case "preference":
    case "project_fact":
      return { score: 4 };
  }
}

function scoreContextGap(gap: PlanContextGap): Pick<PlanContextGap, "roiScore" | "roiSignals"> {
  const priority = gapPriorityScore(gap.priority);
  const category = gapCategoryScore(gap.category);
  const signals: PlanContextGapRoiSignal[] = [priority.signal];
  if (category.signal) signals.push(category.signal);

  let score = priority.score + category.score;
  if (gap.source === "decomposition_contract") {
    score += 18;
    signals.push("decomposition_contract");
  } else if (gap.source === "missing_context") {
    score += 8;
    signals.push("missing_context");
  }
  if (gap.nodeKey) {
    score += 8;
    signals.push("node_specific");
  }
  if ((gap.issueCodes ?? []).length > 0) {
    score += 8;
    signals.push("quality_issue_linked");
  }
  return {
    roiScore: Math.max(0, Math.min(100, score)),
    roiSignals: [...new Set(signals)],
  };
}

function gapPriorityRank(priority: PlanContextGapPriority): number {
  return priority === "high" ? 0 : priority === "medium" ? 1 : 2;
}

function rankContextGaps(gaps: readonly PlanContextGap[]): PlanContextGap[] {
  return gaps
    .map((gap) => ({ ...gap, ...scoreContextGap(gap) }))
    .sort((a, b) =>
      (b.roiScore ?? 0) - (a.roiScore ?? 0) ||
      gapPriorityRank(a.priority) - gapPriorityRank(b.priority) ||
      (a.source ?? "").localeCompare(b.source ?? "") ||
      a.category.localeCompare(b.category) ||
      (a.nodeKey ?? "").localeCompare(b.nodeKey ?? "") ||
      a.prompt.localeCompare(b.prompt),
    );
}

function addContextGap(gaps: PlanContextGap[], seen: Set<string>, gap: PlanContextGap): void {
  const key = `${gap.category}\u0000${gap.prompt.toLowerCase().replace(/\s+/g, " ").trim()}`;
  if (seen.has(key)) return;
  seen.add(key);
  gaps.push(gap);
}

function contextGaps(
  plan: DecompositionOutput,
  quality: PlanQualityReport,
  consideredContext: readonly PlanContextUse[],
): PlanContextGap[] {
  const present = new Set(consideredContext.map((row) => row.category));
  const issueCodes = new Set(quality.issues.map((issue) => issue.code));
  const gaps: PlanContextGap[] = [];
  const seen = new Set<string>();

  for (const gap of contractContextGaps(plan)) {
    addContextGap(gaps, seen, gap);
  }

  if (!present.has("eval_signal")) {
    addContextGap(gaps, seen, {
      category: "eval_signal",
      priority: contextGapPriority(issueCodes, "eval_signal"),
      reason: "missing_personalized_eval",
      prompt: evalSignalGapPrompt(issueCodes),
      source: "missing_context",
      issueCodes: [...issueCodes],
    });
  }
  if (!present.has("constraint")) {
    addContextGap(gaps, seen, {
      category: "constraint",
      priority: contextGapPriority(issueCodes, "constraint"),
      reason: "missing_constraints",
      prompt: constraintGapPrompt(issueCodes),
      source: "missing_context",
      issueCodes: [...issueCodes],
    });
  }
  if (!present.has("procedure")) {
    addContextGap(gaps, seen, {
      category: "procedure",
      priority: contextGapPriority(issueCodes, "procedure"),
      reason: "missing_proven_workflow",
      prompt: procedureGapPrompt(issueCodes),
      source: "missing_context",
      issueCodes: [...issueCodes],
    });
  }
  if (hasAnyIssue(issueCodes, RESEARCH_CONTEXT_ISSUES)) {
    addContextGap(gaps, seen, {
      category: "project_fact",
      priority: contextGapPriority(issueCodes, "project_fact"),
      reason: "insufficient_research_evidence",
      prompt: researchGapPrompt(issueCodes),
      source: "missing_context",
      issueCodes: [...issueCodes].filter((code) => RESEARCH_CONTEXT_ISSUES.includes(code)),
    });
  }
  if (plan.nodes.length >= 2 && !present.has("capability")) {
    addContextGap(gaps, seen, {
      category: "capability",
      priority: contextGapPriority(issueCodes, "capability"),
      reason: "missing_routing_context",
      prompt: "Who or which agent is best suited for each kind of work, if routing is ambiguous?",
      source: "missing_context",
      issueCodes: [...issueCodes],
    });
  }

  return rankContextGaps(gaps);
}

function reviewGuidance(
  quality: PlanQualityReport,
  unapplied: readonly PlanContextUse[],
  totalContext: number,
  gaps: readonly PlanContextGap[],
): string[] {
  const guidance: string[] = [];
  if (quality.grade === "fail") {
    guidance.push("Fix error-level plan quality issues before accepting this decomposition.");
  } else if (quality.grade === "warn") {
    guidance.push("Review warning-level plan quality issues before accepting this decomposition.");
  }

  const highImpact = unapplied.filter((row) =>
    row.category === "constraint" || row.category === "procedure" || row.category === "eval_signal",
  );
  if (highImpact.length > 0) {
    guidance.push("Confirm whether unapplied high-impact context is irrelevant, or refine the plan with it.");
  }
  if (totalContext === 0) {
    guidance.push("No active context was available; answers and evidence from this aim should seed future planning.");
  }
  if (gaps.some((gap) => gap.category === "eval_signal")) {
    guidance.push("Missing personalized eval context; capture what the user considers genuinely complete.");
  }
  if (quality.issues.some((issue) => RESEARCH_CONTEXT_ISSUES.includes(issue.code))) {
    guidance.push("Web-sensitive decomposition needs stronger first-party research evidence before the plan should be trusted.");
  }
  return guidance;
}

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

function qualityIssueRefineInstruction(issue: PlanQualityIssue, index: number): string {
  if (issue.code === "missing_decomposition_contract") {
    return [
      `${index}. ${issue.message}`,
      "   Add a decomposition_contract with why, definition_of_done, required_evidence, likely_owner, context_gaps, and eval_signal so the milestone can be reviewed and routed.",
    ].join("\n");
  }
  if (issue.code === "missing_contract_evidence") {
    return [
      `${index}. ${issue.message}`,
      "   Fill required_evidence with concrete artifacts or events that align with the milestone's acceptance_rule.",
    ].join("\n");
  }
  if (issue.code === "missing_contract_eval_signal") {
    return [
      `${index}. ${issue.message}`,
      "   Fill eval_signal with the user's personalized completion standard, then reflect it in evidence-backed acceptance_rule details where possible.",
    ].join("\n");
  }
  if (issue.code === "missing_eval_acceptance_signal") {
    return [
      `${index}. ${issue.message}`,
      "   Convert the eval_signal into evidence-backed acceptance_rule details, such as a commit_pattern message/path/min_files filter or a ci_status requirement that proves the user's done standard.",
    ].join("\n");
  }
  if (issue.code === "oversized_milestone") {
    return [
      `${index}. ${issue.message}`,
      "   Split the milestone into smaller evidence-verifiable milestones, each with its own acceptance_rule and clear dependency shape.",
    ].join("\n");
  }
  if (issue.code === "compound_milestone") {
    return [
      `${index}. ${issue.message}`,
      "   Separate bundled deliverables into distinct milestones so each one has a single outcome, its own acceptance_rule, and evidence that cannot accidentally complete unrelated work.",
    ].join("\n");
  }
  if (issue.code === "indistinct_acceptance_rule") {
    return [
      `${index}. ${issue.message}`,
      "   Make each milestone's acceptance_rule distinguishable with different path_glob, message_pattern, workflow, branch, or min_files filters; move shared verification into a dependent verification milestone when it is truly shared.",
    ].join("\n");
  }
  if (issue.code === "missing_research_evidence") {
    return [
      `${index}. ${issue.message}`,
      "   Collect first-party web research before finalizing the plan, or add an agent-owned research milestone that gathers current sources before downstream planning decisions.",
    ].join("\n");
  }
  if (issue.code === "insufficient_research_coverage") {
    return [
      `${index}. ${issue.message}`,
      "   Broaden search/fetch coverage, then revise milestones with source-backed constraints, risks, and unresolved uncertainties instead of relying on snippets or assumptions.",
    ].join("\n");
  }
  return `${index}. ${issue.message}`;
}

function qualityIssueRefinePrompt(kind: "error-level" | "warning-level", issues: readonly PlanQualityIssue[]): string {
  const headline = kind === "error-level"
    ? "Revise the decomposition to fix these error-level quality issues before the user accepts the plan:"
    : "Consider revising the decomposition to address these warning-level quality issues:";
  return [
    headline,
    ...issues.slice(0, 5).map((issue, i) => qualityIssueRefineInstruction(issue, i + 1)),
  ].join("\n");
}

function reviewActions(
  quality: PlanQualityReport,
  unapplied: readonly PlanContextUse[],
  totalContext: number,
  gaps: readonly PlanContextGap[],
): PlanReviewAction[] {
  const actions: PlanReviewAction[] = [];
  const errors = quality.issues.filter((issue) => issue.severity === "error");
  const warnings = quality.issues.filter((issue) => issue.severity === "warning");
  const highImpactContext = unapplied.filter((row) =>
    row.category === "constraint" || row.category === "procedure" || row.category === "eval_signal",
  );

  if (errors.length > 0) {
    actions.push({
      code: "fix_quality_errors",
      priority: "high",
      title: "Fix quality errors before accepting",
      reason: `${errors.length} error-level issue${errors.length === 1 ? "" : "s"} would make this decomposition unsafe to accept.`,
      issueCodes: unique(errors.map((issue) => issue.code)),
      refinePrompt: qualityIssueRefinePrompt("error-level", errors),
    });
  }

  if (highImpactContext.length > 0) {
    actions.push({
      code: "refine_with_unapplied_context",
      priority: "high",
      title: "Refine with unapplied context",
      reason: `${highImpactContext.length} high-impact context row${highImpactContext.length === 1 ? "" : "s"} did not appear in the plan.`,
      contextCategories: unique(highImpactContext.map((row) => row.category)),
      refinePrompt: [
        "Revise the decomposition to explicitly account for these high-impact context rows, unless a row is truly irrelevant:",
        ...highImpactContext.slice(0, 5).map((row, i) => `${i + 1}. [${row.category}] ${row.content}`),
      ].join("\n"),
    });
  }

  if (errors.length === 0 && warnings.length > 0) {
    actions.push({
      code: "review_quality_warnings",
      priority: "medium",
      title: "Review quality warnings",
      reason: `${warnings.length} warning-level issue${warnings.length === 1 ? "" : "s"} may reduce plan reliability.`,
      issueCodes: unique(warnings.map((issue) => issue.code)),
      refinePrompt: qualityIssueRefinePrompt("warning-level", warnings),
    });
  }

  if (totalContext === 0) {
    actions.push({
      code: "capture_initial_context",
      priority: "low",
      title: "Capture initial context as work happens",
      reason: "No active context was available for this decomposition.",
      contextCategories: unique(gaps.map((gap) => gap.category)),
      refinePrompt: [
        "Collect the minimum context that would change this decomposition; avoid profile-style questions:",
        ...gaps.slice(0, 5).map((gap, i) => `${i + 1}. [${gap.category}] ${gap.prompt}`),
      ].join("\n"),
    });
  }

  if (actions.length === 0) {
    actions.push({
      code: "accept_plan",
      priority: "low",
      title: "Accept plan",
      reason: "No blocking quality or context-usage issues were detected.",
    });
  }

  return actions;
}

export function reviewPlan(input: ReviewPlanInput): PlanReviewReport {
  const quality = input.quality ?? critiquePlan(input);
  const usage = contextUsage(input.plan, input.context ?? []);
  const ignoredLowConfidence = usage.filter((row) => typeof row.confidence === "number" && row.confidence < 0.6);
  const considered = usage.filter((row) => !(typeof row.confidence === "number" && row.confidence < 0.6));
  const applied = considered.filter((row) => row.applied);
  const unapplied = considered.filter((row) => !row.applied);
  const gaps = contextGaps(input.plan, quality, considered);
  return {
    quality,
    context: {
      total: usage.length,
      applied,
      unapplied,
      ignoredLowConfidence,
      gaps,
    },
    actions: reviewActions(quality, unapplied, usage.length, gaps),
    guidance: reviewGuidance(quality, unapplied, usage.length, gaps),
  };
}
