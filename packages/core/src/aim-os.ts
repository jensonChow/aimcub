import type {
  AcceptanceClause,
  AcceptanceRule,
  Actor,
  ActorKind,
  AimCompletionRecapRead,
  AimProgressReadModel,
  AimProgressSummary,
  AimProgressSummaryStatus,
  Assignment,
  AssignmentSource,
  AssignmentStatus,
  ContextIntakeSession,
  ContextIntakeSessionStatus,
  Evidence,
  EvidenceAttribution,
  EvaluationReview,
  EvidenceReviewItem,
  EvaluatorRuntimeResult,
  Goal,
  Memory,
  Milestone,
  MilestoneCompletion,
  DecompositionOutput,
  DecompositionOwner,
  PlanNode,
  PlanRoutingOverride as PlanRoutingOverrideValue,
  PlanRoutingOwner,
  Run,
  SubAimRelation,
  SubAimRelationStatus,
  ToolTrace,
} from "@aimcub/types";
import { PlanRoutingOverride } from "@aimcub/types";
import { AUTO_VERIFY_MIN_TRUST, evaluate } from "./evaluate";
import type { ContextSedimentationCandidateInput } from "./context-sedimentation";

export interface RoutedAssignment {
  goalId: string;
  milestoneId: string;
  actorKind: ActorKind;
  actorId: string | null;
  status: AssignmentStatus;
  source: AssignmentSource;
  reason: string;
  capabilityTags: string[];
}

export interface RoutingModelOption {
  id: string;
  label?: string;
}

export interface RoutingRuntimeAgentOption {
  id: string;
  label: string;
  available: boolean;
  authenticated: boolean;
  models: readonly RoutingModelOption[];
  unavailableReason?: string | null;
}

export interface PlanNodeRoutingRecommendation {
  likelyOwner: DecompositionOwner;
  recommendedOwner: PlanRoutingOwner;
  rationale: string;
  capabilityTags: string[];
}

export type PlanRoutingValidationIssueCode =
  | "human_route_unavailable"
  | "missing_agent_runtime"
  | "missing_agent_selection"
  | "unknown_agent"
  | "agent_unavailable"
  | "agent_unauthenticated"
  | "missing_agent_model"
  | "unknown_agent_model"
  | "human_route_has_agent_selection";

export interface PlanRoutingValidationIssue {
  nodeKey: string;
  title: string;
  code: PlanRoutingValidationIssueCode;
  message: string;
}

export interface PlanRoutingValidation {
  ok: boolean;
  issues: PlanRoutingValidationIssue[];
}

export interface ContextIntakeDecisionInput {
  aimTitle: string;
  aimDescription?: string | null;
  goalId?: string | null;
  readiness?: string;
  missingQuestions?: readonly string[];
  blockedReasons?: readonly string[];
  toolTraces?: readonly Pick<ToolTrace, "id" | "status" | "error">[];
}

export interface HumanTaskHandoff {
  title: string;
  instructions: string;
  requiredEvidence: string[];
  approvalRequired: boolean;
  secretOrAccessRequired: boolean;
  tasteCallRequired: boolean;
  finalConfirmationRequired: boolean;
}

export interface EvaluationRuntimeReport {
  passed: boolean;
  matchedEvidenceIds: string[];
  trustScore: number;
  evalReview: EvaluationReview;
  evaluatorResults: EvaluatorRuntimeResult[];
  evidenceReview: EvidenceReviewItem[];
}

export interface BuildAimProgressInput {
  goal: Goal;
  milestones: readonly Milestone[];
  actors?: readonly Actor[];
  assignments?: readonly Assignment[];
  runs?: readonly Run[];
  subAimRelations?: readonly SubAimRelation[];
  goals?: readonly Goal[];
  milestonesByGoal?: Readonly<Record<string, readonly Milestone[]>>;
  evidence?: readonly Evidence[];
  completions?: readonly MilestoneCompletion[];
  contextCandidates?: readonly Memory[];
  acceptedContext?: readonly Memory[];
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function contractOf(milestone: Pick<Milestone, "metadata">): Record<string, unknown> | null {
  return asRecord(milestone.metadata?.decomposition_contract);
}

function isDecompositionOwner(value: unknown): value is DecompositionOwner {
  return value === "human" || value === "agent" || value === "either" || value === "mixed";
}

function contractLikelyOwnerValue(contract: Record<string, unknown> | null | undefined): DecompositionOwner {
  const owner = contract?.likely_owner;
  return owner === "human" || owner === "agent" || owner === "either" || owner === "mixed" ? owner : "either";
}

function hasManualOnlyRule(rule: AcceptanceRule): boolean {
  return rule.clauses.every((clause) => clause.evaluator === "manual_confirm");
}

function requiredEvidenceText(contract: Record<string, unknown> | null | undefined): string {
  return Array.isArray(contract?.required_evidence) ? contract.required_evidence.map(cleanText).join(" ") : "";
}

function requiresHumanJudgmentText(parts: readonly string[]): boolean {
  const text = parts.join(" ").toLowerCase();
  return /\b(approve|approval|secret|credential|access|taste|choose|decide|sign off|physical|call|meeting)\b/.test(text)
    || /审批|批准|密钥|凭证|权限|品味|选择|决定|线下|电话|会议|人工确认/.test(text);
}

function requiresHumanJudgment(milestone: Milestone): boolean {
  const contract = contractOf(milestone);
  return requiresHumanJudgmentText([
    milestone.title,
    milestone.description,
    cleanText(contract?.definition_of_done),
    cleanText(contract?.eval_signal),
    requiredEvidenceText(contract),
  ]);
}

function capabilityTagsForText(parts: readonly string[]): string[] {
  const text = parts.join(" ").toLowerCase();
  const tags = new Set<string>();
  if (/\b(code|commit|test|ci|typescript|react|api|database|migration|repo|build)\b/.test(text)) tags.add("software");
  if (/\b(search|research|compare|market|docs|documentation|web)\b/.test(text)) tags.add("research");
  if (/\b(write|summarize|doc|brief|copy|content)\b/.test(text)) tags.add("writing");
  if (/\b(approve|secret|credential|access|taste|physical|meeting)\b/.test(text)) tags.add("human_judgment");
  return [...tags];
}

function capabilityTagsForMilestone(milestone: Milestone): string[] {
  const contract = contractOf(milestone);
  return capabilityTagsForText([
    milestone.title,
    milestone.description,
    cleanText(contract?.definition_of_done),
    requiredEvidenceText(contract),
  ]);
}

function findActor(actors: readonly Actor[], kind: ActorKind, capabilityTags: readonly string[]): Actor | null {
  const active = actors.filter((actor) => actor.kind === kind && actor.status === "active");
  if (active.length === 0) return null;
  const withCapability = active.find((actor) =>
    capabilityTags.length === 0 || capabilityTags.some((tag) => actor.capabilities.includes(tag)),
  );
  return withCapability ?? active[0] ?? null;
}

function routingRationale(input: {
  likelyOwner: DecompositionOwner;
  humanRequired: boolean;
  manualOnly: boolean;
  humanJudgment: boolean;
}): string {
  if (input.likelyOwner === "human") {
    return "The decomposition marks this as human-owned because it depends on judgment, access, approval, or manual proof.";
  }
  if (input.likelyOwner === "mixed") {
    return "The decomposition marks this as mixed work, so Aimcub keeps the route human-gated unless you delegate the digital part to an agent.";
  }
  if (input.manualOnly) {
    return "The eval rule requires manual confirmation, so Aimcub recommends a human route.";
  }
  if (input.humanJudgment) {
    return "The contract mentions approval, access, taste, a decision, or physical-world work, so Aimcub recommends a human route.";
  }
  if (input.likelyOwner === "agent") {
    return "The decomposition marks this as agent-owned and the work can be proved with digital evidence.";
  }
  return "No non-delegable blocker was found, so Aimcub recommends the agent path for this digital or evidence-backed work.";
}

export function routingRecommendationForPlanNode(node: PlanNode): PlanNodeRoutingRecommendation {
  const contract = node.decomposition_contract;
  const contractRecord = contract ? contract as Record<string, unknown> : null;
  const likelyOwner = contract?.likely_owner && isDecompositionOwner(contract.likely_owner)
    ? contract.likely_owner
    : "either";
  const manualOnly = hasManualOnlyRule(node.acceptance_rule);
  const humanJudgment = requiresHumanJudgmentText([
    node.title,
    node.description,
    cleanText(contract?.definition_of_done),
    cleanText(contract?.eval_signal),
    requiredEvidenceText(contractRecord),
  ]);
  const humanRequired = likelyOwner === "human" || likelyOwner === "mixed" || manualOnly || humanJudgment;
  return {
    likelyOwner,
    recommendedOwner: humanRequired ? "human" : "agent",
    rationale: routingRationale({ likelyOwner, humanRequired, manualOnly, humanJudgment }),
    capabilityTags: capabilityTagsForText([
      node.title,
      node.description,
      cleanText(contract?.definition_of_done),
      requiredEvidenceText(contractRecord),
    ]),
  };
}

function routingRecommendationForMilestone(milestone: Milestone): PlanNodeRoutingRecommendation {
  const contract = contractOf(milestone);
  const likelyOwner = contractLikelyOwnerValue(contract);
  const manualOnly = hasManualOnlyRule(milestone.acceptance_rule);
  const humanJudgment = requiresHumanJudgment(milestone);
  const humanRequired = likelyOwner === "human" || likelyOwner === "mixed" || manualOnly || humanJudgment;
  return {
    likelyOwner,
    recommendedOwner: humanRequired ? "human" : "agent",
    rationale: routingRationale({ likelyOwner, humanRequired, manualOnly, humanJudgment }),
    capabilityTags: capabilityTagsForMilestone(milestone),
  };
}

export function routingOverrideForMilestone(milestone: Pick<Milestone, "metadata">): PlanRoutingOverrideValue | null {
  const parsed = PlanRoutingOverride.nullable().safeParse(milestone.metadata?.routing_override ?? null);
  return parsed.success ? parsed.data : null;
}

function routingOverrideLabel(override: PlanRoutingOverrideValue): string {
  if (override.owner === "human") return "User override: route this sub-aim to a human.";
  const agent = override.agent_label || override.agent_id || "the selected local agent";
  const model = override.model_label || override.model;
  return `User override: route this sub-aim to ${model ? `${agent} / ${model}` : agent}.`;
}

export function recommendAssignmentForMilestone(input: {
  milestone: Milestone;
  actors?: readonly Actor[];
}): RoutedAssignment {
  const actors = input.actors ?? [];
  const recommendation = routingRecommendationForMilestone(input.milestone);
  const override = routingOverrideForMilestone(input.milestone);
  const actorKind: ActorKind = override?.owner ?? recommendation.recommendedOwner;
  const capabilityTags = [
    ...recommendation.capabilityTags,
    ...(override?.owner === "agent" && override.agent_id ? [`agent:${override.agent_id}`] : []),
    ...(override?.owner === "agent" && override.model ? [`model:${override.model}`] : []),
  ];
  const actor = findActor(actors, actorKind, capabilityTags);
  const reason = override ? routingOverrideLabel(override) : recommendation.rationale;
  return {
    goalId: input.milestone.goal_id,
    milestoneId: input.milestone.id,
    actorKind,
    actorId: actor?.id ?? null,
    status: "assigned",
    source: override ? "user_override" : "routing",
    reason,
    capabilityTags,
  };
}

export function routeMilestones(input: {
  milestones: readonly Milestone[];
  actors?: readonly Actor[];
}): RoutedAssignment[] {
  return input.milestones.map((milestone) => recommendAssignmentForMilestone({
    milestone,
    actors: input.actors,
  }));
}

function readyAgents(agents: readonly RoutingRuntimeAgentOption[]): RoutingRuntimeAgentOption[] {
  return agents.filter((agent) => agent.available && agent.authenticated);
}

function issue(node: PlanNode, code: PlanRoutingValidationIssueCode, message: string): PlanRoutingValidationIssue {
  return { nodeKey: node.key, title: node.title, code, message };
}

export function validatePlanRouting(input: {
  plan: DecompositionOutput;
  agents?: readonly RoutingRuntimeAgentOption[];
  allowHuman?: boolean;
}): PlanRoutingValidation {
  const agents = input.agents ?? [];
  const availableAgents = readyAgents(agents);
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  const issues: PlanRoutingValidationIssue[] = [];

  for (const node of input.plan.nodes) {
    const recommendation = routingRecommendationForPlanNode(node);
    const override = node.routing_override ?? null;
    const owner = override?.owner ?? recommendation.recommendedOwner;

    if (owner === "human") {
      if (input.allowHuman === false) {
        issues.push(issue(node, "human_route_unavailable", "Human routing is not available in this runtime."));
      }
      if (override && (override.agent_id || override.model)) {
        issues.push(issue(node, "human_route_has_agent_selection", "Human-owned work cannot keep an agent or model selection."));
      }
      continue;
    }

    if (availableAgents.length === 0) {
      issues.push(issue(
        node,
        "missing_agent_runtime",
        // Runtime-agnostic on purpose: the adapter registry is open, so naming built-ins here
        // would go stale the moment someone adds one.
        "No authenticated local CLI agent is available. Choose Human for this sub-aim or set up a local agent CLI.",
      ));
      continue;
    }

    if (!override) continue;
    if (!override.agent_id) {
      issues.push(issue(node, "missing_agent_selection", "Choose a local agent for this agent-owned sub-aim."));
      continue;
    }

    const selectedAgent = agentById.get(override.agent_id);
    if (!selectedAgent) {
      issues.push(issue(node, "unknown_agent", `Selected agent "${override.agent_id}" is not part of the current runtime configuration.`));
      continue;
    }
    if (!selectedAgent.available) {
      issues.push(issue(node, "agent_unavailable", `${selectedAgent.label} is not installed or is not executable.`));
      continue;
    }
    if (!selectedAgent.authenticated) {
      issues.push(issue(node, "agent_unauthenticated", `${selectedAgent.label} is installed but not authenticated.`));
      continue;
    }

    if (selectedAgent.models.length > 0 && !override.model) {
      issues.push(issue(node, "missing_agent_model", `Choose a model for ${selectedAgent.label}.`));
      continue;
    }
    if (override.model && selectedAgent.models.length > 0 && !selectedAgent.models.some((model) => model.id === override.model)) {
      issues.push(issue(node, "unknown_agent_model", `${selectedAgent.label} does not expose model "${override.model}".`));
    }
  }

  return { ok: issues.length === 0, issues };
}

export function decideContextIntakeSession(input: ContextIntakeDecisionInput): Pick<
  ContextIntakeSession,
  "aim_title" | "aim_description" | "goal_id" | "status" | "readiness" | "can_continue" | "should_pause" | "missing_questions" | "blocked_reasons" | "tool_trace_ids"
> {
  const missingQuestions = [...(input.missingQuestions ?? [])].map(cleanText).filter(Boolean);
  const blockedReasons = [
    ...(input.blockedReasons ?? []),
    ...(input.toolTraces ?? []).flatMap((trace) =>
      trace.status === "blocked" ? [trace.error ?? `Tool ${trace.id} is blocked.`] : [],
    ),
  ].map(cleanText).filter(Boolean);
  const running = (input.toolTraces ?? []).some((trace) => trace.status === "pending" || trace.status === "running");
  let status: ContextIntakeSessionStatus = "ready";
  if (blockedReasons.length > 0) status = "blocked";
  else if (missingQuestions.length > 0) status = "needs_user";
  else if (running) status = "collecting";
  const shouldPause = status === "needs_user" || status === "blocked";
  return {
    aim_title: input.aimTitle,
    aim_description: input.aimDescription ?? "",
    goal_id: input.goalId ?? null,
    status,
    readiness: input.readiness ?? status,
    can_continue: status === "ready",
    should_pause: shouldPause,
    missing_questions: missingQuestions,
    blocked_reasons: blockedReasons,
    tool_trace_ids: (input.toolTraces ?? []).map((trace) => trace.id),
  };
}

export function buildHumanTaskHandoff(milestone: Milestone): HumanTaskHandoff {
  const contract = contractOf(milestone);
  const requiredEvidence = Array.isArray(contract?.required_evidence)
    ? contract.required_evidence.map(cleanText).filter(Boolean)
    : ["A short proof note explaining why this sub-aim is complete."];
  const text = [
    milestone.title,
    milestone.description,
    cleanText(contract?.definition_of_done),
    cleanText(contract?.eval_signal),
    requiredEvidence.join(" "),
  ].join(" ").toLowerCase();
  return {
    title: milestone.title,
    instructions: cleanText(contract?.definition_of_done) || milestone.description || "Complete this sub-aim and attach proof.",
    requiredEvidence,
    approvalRequired: /\b(approve|approval|sign off)\b/.test(text) || /审批|批准/.test(text),
    secretOrAccessRequired: /\b(secret|credential|access|permission)\b/.test(text) || /密钥|凭证|权限/.test(text),
    tasteCallRequired: /\b(taste|choose|decide|preference)\b/.test(text) || /品味|选择|决定|偏好/.test(text),
    finalConfirmationRequired: true,
  };
}

function unsupportedEvaluator(clause: AcceptanceClause): boolean {
  return clause.evaluator === "file_uploaded" || clause.evaluator === "url" || clause.evaluator === "llm_judge";
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function acceptanceModeText(rule: AcceptanceRule): string {
  if (rule.logic === "any") return "At least one acceptance rule";
  if (rule.logic === "weighted") return "The weighted acceptance threshold";
  return "All acceptance rules";
}

function buildEvidenceReviewItems(
  rule: AcceptanceRule,
  evidenceRows: readonly Evidence[],
  evaluatorResults: readonly EvaluatorRuntimeResult[],
): EvidenceReviewItem[] {
  const matchesByEvidence = new Map<string, EvidenceReviewItem["rule_matches"]>();
  evaluatorResults.forEach((result, index) => {
    result.matched_evidence_ids.forEach((evidenceId) => {
      const matches = matchesByEvidence.get(evidenceId) ?? [];
      matches.push({ clause_index: index, evaluator: result.evaluator });
      matchesByEvidence.set(evidenceId, matches);
    });
  });
  const hasAutoVerifiableRule = rule.clauses.some((clause) => clause.auto_verifiable);
  const trustFloor = Math.round(AUTO_VERIFY_MIN_TRUST * 100);
  return evidenceRows.map((evidence): EvidenceReviewItem => {
    const ruleMatches = matchesByEvidence.get(evidence.id) ?? [];
    if (ruleMatches.length > 0) {
      const labels = ruleMatches.map((match) => `rule ${match.clause_index + 1} (${match.evaluator})`).join(", ");
      return {
        evidence,
        rule_matches: ruleMatches,
        status: "matched",
        review_note: `Matches ${labels}.`,
      };
    }
    if (hasAutoVerifiableRule && evidence.trust_score < AUTO_VERIFY_MIN_TRUST) {
      return {
        evidence,
        rule_matches: [],
        status: "low_trust",
        review_note: `Trust is below the ${trustFloor}% floor for auto-verifiable rules; add trusted evidence or confirm manually.`,
      };
    }
    return {
      evidence,
      rule_matches: [],
      status: "unmatched",
      review_note: "Recorded evidence does not satisfy any current acceptance rule.",
    };
  });
}

function evaluationReason(input: {
  rule: AcceptanceRule;
  evidenceCount: number;
  passed: boolean;
  matchedCount: number;
  evaluatorResults: readonly EvaluatorRuntimeResult[];
  evidenceReview: readonly EvidenceReviewItem[];
}): string {
  if (input.passed) {
    return `${acceptanceModeText(input.rule)} passed with ${plural(input.matchedCount, "matched evidence item")}.`;
  }
  const unsupported = input.evaluatorResults.filter((result) => result.status === "unsupported");
  if (unsupported.length > 0) {
    return `Cannot auto-evaluate ${unsupported.map((result) => result.evaluator).join(", ")} in the v1 runtime.`;
  }
  if (input.evidenceCount === 0) {
    return "No evidence has been recorded for this sub-aim yet.";
  }
  const needsHuman = input.evaluatorResults.some((result) => result.status === "needs_human");
  if (needsHuman) {
    return "Manual confirmation evidence is still required for this acceptance rule.";
  }
  const lowTrustCount = input.evidenceReview.filter((item) => item.status === "low_trust").length;
  if (lowTrustCount > 0) {
    return lowTrustCount === 1
      ? "1 evidence item is below the auto-verification trust floor."
      : `${lowTrustCount} evidence items are below the auto-verification trust floor.`;
  }
  const failedCount = input.evaluatorResults.filter((result) => result.status === "failed").length;
  if (failedCount > 0) {
    return failedCount === 1
      ? "1 acceptance rule still has no matching evidence."
      : `${failedCount} acceptance rules still have no matching evidence.`;
  }
  return "The eval is pending until matching evidence is recorded.";
}

function evaluationNextAction(input: {
  rule: AcceptanceRule;
  evidenceCount: number;
  passed: boolean;
  evaluatorResults: readonly EvaluatorRuntimeResult[];
  evidenceReview: readonly EvidenceReviewItem[];
}): string {
  if (input.passed) {
    return input.rule.completion_mode === "auto"
      ? "Review the matched evidence for the audit trail."
      : "Review matched evidence, then confirm only if it proves real completion.";
  }
  if (input.evaluatorResults.some((result) => result.status === "unsupported")) {
    return "Collect manual proof or revise the acceptance rule to a supported evaluator.";
  }
  if (input.evidenceCount === 0) {
    return "Run the assigned agent, add trusted evidence, or confirm human proof.";
  }
  if (input.evaluatorResults.some((result) => result.status === "needs_human")) {
    return "Use Confirm proof after the work is complete and evidence is inspectable.";
  }
  if (input.evidenceReview.some((item) => item.status === "low_trust")) {
    return "Add trusted webhook or CI evidence, or confirm manually if the proof is sufficient.";
  }
  return "Add evidence that matches the rule, or break down the sub-aim if the rule is wrong.";
}

export function evaluateWithRuntimeReport(rule: AcceptanceRule, evidence: readonly Evidence[]): EvaluationRuntimeReport {
  const evidenceRows = [...evidence];
  const base = evaluate(rule, evidenceRows);
  const evaluatorResults = rule.clauses.map((clause, index): EvaluatorRuntimeResult => {
    if (unsupportedEvaluator(clause)) {
      return {
        evaluator: clause.evaluator,
        status: "unsupported",
        matched_evidence_ids: [],
        trust_score: 0,
        explanation: `${clause.evaluator} is declared but not implemented in the v1 runtime.`,
        failure_reason: "unsupported_evaluator",
        requires_human_confirmation: clause.evaluator === "llm_judge",
      };
    }
    const clauseRule: AcceptanceRule = {
      logic: "all",
      threshold: 1,
      completion_mode: rule.completion_mode,
      clauses: [clause],
    };
    const result = evaluate(clauseRule, evidenceRows);
    const satisfied = base.clauseSatisfied[index] ?? result.passed;
    return {
      evaluator: clause.evaluator,
      status: satisfied ? "passed" : clause.evaluator === "manual_confirm" ? "needs_human" : "failed",
      matched_evidence_ids: result.matchedEvidenceIds,
      trust_score: result.trustScore,
      explanation: satisfied
        ? `${clause.evaluator} accepted ${result.matchedEvidenceIds.length} evidence item(s).`
        : `${clause.evaluator} has not received sufficient matching evidence.`,
      failure_reason: satisfied ? null : "not_satisfied",
      requires_human_confirmation: clause.evaluator === "manual_confirm" || rule.completion_mode === "manual",
    };
  });
  const evidenceReview = buildEvidenceReviewItems(rule, evidenceRows, evaluatorResults);
  const reason = evaluationReason({
    rule,
    evidenceCount: evidenceRows.length,
    passed: base.passed,
    matchedCount: base.matchedEvidenceIds.length,
    evaluatorResults,
    evidenceReview,
  });
  const nextAction = evaluationNextAction({
    rule,
    evidenceCount: evidenceRows.length,
    passed: base.passed,
    evaluatorResults,
    evidenceReview,
  });
  return {
    passed: base.passed,
    matchedEvidenceIds: base.matchedEvidenceIds,
    trustScore: base.trustScore,
    evalReview: {
      passed: base.passed,
      matched_evidence_ids: base.matchedEvidenceIds,
      trust_score: base.trustScore,
      reason,
      next_action: nextAction,
    },
    evaluatorResults,
    evidenceReview,
  };
}

function relationStatus(
  relation: SubAimRelation,
  milestonesByGoal: Readonly<Record<string, readonly Milestone[]>> | undefined,
): SubAimRelationStatus {
  const childMilestones = milestonesByGoal?.[relation.child_goal_id];
  if (!childMilestones || childMilestones.length === 0) return relation.status;
  if (childMilestones.every((milestone) => milestone.status === "completed" || milestone.status === "skipped")) {
    return "completed";
  }
  if (childMilestones.some((milestone) => milestone.status === "blocked")) return "blocked";
  return relation.status;
}

function latestByCreatedAt<T extends { created_at?: string }>(rows: readonly T[]): T | null {
  return rows.slice().sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))[0] ?? null;
}

function uniqueRowsById<T extends { id: string }>(rows: readonly T[]): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    unique.push(row);
  }
  return unique;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function nextActionForMilestone(input: {
  milestone: Milestone;
  assignment: Assignment | null;
  latestRun: Run | null;
  childRelations: readonly SubAimRelation[];
  completed: boolean;
  blocked: boolean;
}): string {
  if (input.completed) return "Completed.";
  if (input.childRelations.some((relation) => relation.status === "completed")) {
    return "Review the completed child aim and confirm whether the parent sub-aim is satisfied.";
  }
  if (input.childRelations.length > 0) return "Continue the child aim breakdown.";
  if (input.blocked) return "Resolve the blocked assignment or run.";
  if (!input.assignment) return "Assign this sub-aim to a human or agent.";
  if (!input.latestRun && input.assignment.actor_kind === "agent") return "Run the assigned agent.";
  if (!input.latestRun && input.assignment.actor_kind === "human") return "Collect human proof and confirm completion.";
  const latestRun = input.latestRun;
  if (!latestRun) return "Start the assigned work.";
  if (latestRun.status === "failed") return "Inspect the failed run and retry or reassign.";
  if (latestRun.status === "completed") return "Review run evidence against the eval rule.";
  return "Continue the active run.";
}

export function buildAimCompletionRecap(input: {
  goal: Goal;
  milestones: readonly AimProgressReadModel["milestones"][number][];
  evidence?: readonly Evidence[];
  completions?: readonly MilestoneCompletion[];
  learnedContext?: readonly Memory[];
}): AimCompletionRecapRead | null {
  if (input.milestones.length === 0 || input.milestones.some((row) => !row.completed)) {
    return null;
  }

  const completionByMilestone = new Map((input.completions ?? []).map((completion) => [completion.milestone_id, completion]));
  const passedEvalResults = input.milestones.flatMap((row) =>
    row.evaluator_results
      .filter((result) => result.status === "passed")
      .map((result) => ({
        milestone_id: row.milestone.id,
        evaluator: result.evaluator,
        status: result.status,
        explanation: result.explanation,
        trust_score: result.trust_score,
        matched_evidence_ids: result.matched_evidence_ids,
      })),
  );
  const evidenceIds = uniqueStrings([
    ...passedEvalResults.flatMap((result) => result.matched_evidence_ids),
    ...(input.completions ?? []).flatMap((completion) => completion.triggering_evidence_ids),
  ]);
  const passingEvidence = (input.evidence ?? [])
    .filter((row) => evidenceIds.includes(row.id))
    .map((row) => ({
      id: row.id,
      milestone_id: row.milestone_id,
      kind: row.kind,
      summary: row.summary,
      occurred_at: row.occurred_at,
      trust_score: row.trust_score,
    }));
  const learnedContext = uniqueRowsById(input.learnedContext ?? [])
    .filter((memory) => memory.status === "pending" || memory.status === "active")
    .map((memory) => ({
      id: memory.id,
      content: memory.content,
      category: memory.category,
      source: memory.source,
      status: memory.status,
      scope: memory.goal_id ? "aim" as const : "global" as const,
      confidence: memory.confidence,
    }));

  const completedSubAims = input.milestones.map((row) => {
    const completion = completionByMilestone.get(row.milestone.id) ?? null;
    const passed = row.evaluator_results.find((result) => result.status === "passed") ?? null;
    const contract = contractOf(row.milestone);
    const outcome = cleanText(contract?.definition_of_done)
      || cleanText(row.milestone.description)
      || "Sub-aim completed.";
    return {
      milestone_id: row.milestone.id,
      title: row.milestone.title,
      outcome,
      completed_at: row.milestone.completed_at ?? completion?.created_at ?? null,
      decided_by: completion?.decided_by ?? null,
      evidence_ids: uniqueStrings([
        ...(completion?.triggering_evidence_ids ?? []),
        ...(passed?.matched_evidence_ids ?? []),
      ]),
      eval_status: passed?.status ?? "passed" as const,
    };
  });

  return {
    complete: true,
    final_outcome: `Completed ${completedSubAims.length}/${input.milestones.length} sub-aims for "${input.goal.title}".`,
    completed_sub_aims: completedSubAims,
    passing_evidence: passingEvidence,
    eval_results: passedEvalResults,
    learned_context: learnedContext,
    evidence_empty_reason: passingEvidence.length === 0
      ? "No matched evidence rows were recorded for this completion. The recap can still show completed sub-aims, but future eval reuse will need evidence on later aims."
      : "",
    context_empty_reason: learnedContext.length === 0
      ? "No new memory candidates or accepted aim context were recorded from this completion."
      : "",
  };
}

export function buildAimProgressReadModel(input: BuildAimProgressInput): AimProgressReadModel {
  const evidence = input.evidence ?? [];
  const completions = input.completions ?? [];
  const assignments = input.assignments ?? [];
  const runs = input.runs ?? [];
  const relationRows = input.subAimRelations ?? [];
  const milestones = input.milestones.map((milestone) => {
    const milestoneEvidence = evidence.filter((row) =>
      row.goal_id === milestone.goal_id && (row.milestone_id === null || row.milestone_id === milestone.id),
    );
    const assignment = latestByCreatedAt(assignments.filter((row) => row.milestone_id === milestone.id));
    const latestRun = latestByCreatedAt(runs.filter((row) => row.milestone_id === milestone.id));
    const childRelations = relationRows
      .filter((relation) => relation.parent_milestone_id === milestone.id)
      .map((relation) => ({ ...relation, status: relationStatus(relation, input.milestonesByGoal) }));
    const evaluation = evaluateWithRuntimeReport(milestone.acceptance_rule, milestoneEvidence);
    const completed = milestone.status === "completed" || completions.some((completion) => completion.milestone_id === milestone.id);
    const blocked = milestone.status === "blocked" || assignment?.status === "blocked" || latestRun?.status === "blocked";
    return {
      milestone,
      assignment,
      latest_run: latestRun,
      child_relations: childRelations,
      eval_review: evaluation.evalReview,
      evaluator_results: evaluation.evaluatorResults,
      evidence: evaluation.evidenceReview,
      evidence_count: milestoneEvidence.length,
      completed,
      blocked,
      next_action: nextActionForMilestone({
        milestone,
        assignment,
        latestRun,
        childRelations,
        completed,
        blocked,
      }),
    };
  });
  const incomplete = milestones.find((row) => !row.completed && !row.blocked) ?? milestones.find((row) => !row.completed);
  const completionRecap = buildAimCompletionRecap({
    goal: input.goal,
    milestones,
    evidence,
    completions,
    learnedContext: [
      ...(input.contextCandidates ?? []),
      ...(input.acceptedContext ?? []),
    ],
  });
  return {
    goal: input.goal,
    milestones,
    actors: [...(input.actors ?? [])],
    assignments: [...assignments],
    runs: [...runs],
    sub_aim_relations: relationRows.map((relation) => ({ ...relation, status: relationStatus(relation, input.milestonesByGoal) })),
    context_candidates: [...(input.contextCandidates ?? [])],
    completion_recap: completionRecap,
    completed_milestones: milestones.filter((row) => row.completed).length,
    total_milestones: milestones.length,
    blocked_count: milestones.filter((row) => row.blocked).length,
    next_action: incomplete?.next_action ?? "Aim is complete.",
  };
}

/**
 * A cheap per-aim progress rollup for list surfaces (sidebar rows, Home cards).
 * Coarse on purpose — it reads milestone/assignment/run *status* only, so a batch
 * endpoint can summarize every aim in one store pass instead of firing N
 * `getAimProgress` calls (each of which runs the full `evaluate()` pipeline).
 */
export function summarizeAimProgress(input: {
  goal: Goal;
  milestones: readonly Milestone[];
  assignments?: readonly Assignment[];
  runs?: readonly Run[];
}): AimProgressSummary {
  const assignments = input.assignments ?? [];
  const runs = input.runs ?? [];
  const total = input.milestones.length;
  const completed = input.milestones.filter((milestone) => milestone.status === "completed").length;
  const running = runs.filter((run) => run.status === "running").length;
  const blocked = input.milestones.filter((milestone) =>
    milestone.status === "blocked"
    || assignments.some((assignment) => assignment.milestone_id === milestone.id && assignment.status === "blocked"),
  ).length;

  let status: AimProgressSummaryStatus;
  if (input.goal.status === "achieved" || (total > 0 && completed >= total)) status = "complete";
  else if (total === 0) status = "planning";
  else if (running > 0) status = "running";
  else if (blocked > 0) status = "blocked";
  else status = "needs_you";

  return { goal_id: input.goal.id, status, total, completed, blocked, running };
}

export type AimResearchStatus = "none" | "gathering" | "ready";

export interface AimResearchSignal {
  status: AimResearchStatus;
  /** Count of gathered context/research memories in play for this aim. */
  memoryCount: number;
  /** Count of pending research/context candidates still being distilled. */
  pendingCount: number;
}

/**
 * Derives a real research/context-gathering signal for an aim from the memory
 * substrate, replacing the earlier synthetic "a plan exists → research is done"
 * proxy. Research has no distinct milestone/stage concept — it is the context an
 * aim accrued before and during planning — so the honest signal is the gathered
 * memory count plus any pending candidates still being distilled. Pure: callers
 * pass the aim-relevant active memories (aim-scoped + global) and pending candidates.
 */
export function summarizeAimResearch(input: {
  planExists: boolean;
  memories?: readonly Memory[];
  contextCandidates?: readonly Memory[];
}): AimResearchSignal {
  const memoryCount = (input.memories ?? []).filter((memory) => memory.status === "active").length;
  const pendingCount = (input.contextCandidates ?? []).length;

  let status: AimResearchStatus;
  if (input.planExists) status = "ready";
  else if (memoryCount > 0 || pendingCount > 0) status = "gathering";
  else status = "none";

  return { status, memoryCount, pendingCount };
}

export function attributeEvidence(input: {
  evidence: Evidence;
  assignment?: Assignment | null;
  run?: Run | null;
  reason?: string;
}): Omit<EvidenceAttribution, "id" | "created_at"> {
  return {
    owner_id: input.evidence.owner_id,
    evidence_id: input.evidence.id,
    goal_id: input.evidence.goal_id,
    milestone_id: input.evidence.milestone_id,
    run_id: input.run?.id ?? null,
    assignment_id: input.assignment?.id ?? input.run?.assignment_id ?? null,
    actor_kind: input.run?.actor_kind ?? input.assignment?.actor_kind ?? null,
    actor_id: input.run?.actor_id ?? input.assignment?.actor_id ?? null,
    trust_score: input.evidence.trust_score,
    reason: input.reason ?? "Evidence attributed through Aim OS orchestration state.",
  };
}

export function deriveContextCandidatesFromWork(input: {
  goal: Goal;
  milestones: readonly Milestone[];
  evidence?: readonly Evidence[];
  runs?: readonly Run[];
  completions?: readonly MilestoneCompletion[];
}): ContextSedimentationCandidateInput[] {
  const milestoneById = new Map(input.milestones.map((milestone) => [milestone.id, milestone]));
  const candidates: ContextSedimentationCandidateInput[] = [];
  for (const completion of input.completions ?? []) {
    const milestone = milestoneById.get(completion.milestone_id);
    if (!milestone) continue;
    candidates.push({
      content: `Eval signal: "${milestone.title}" counted as complete via ${completion.decided_by}.`,
      category: "eval_signal",
      scope: "global",
      source: "distilled_context",
      confidence: completion.decided_by === "user_confirm" ? 0.82 : 0.72,
      originId: completion.milestone_id,
    });
  }
  for (const run of input.runs ?? []) {
    if (run.status !== "completed" || !cleanText(run.summary)) continue;
    const milestone = milestoneById.get(run.milestone_id);
    candidates.push({
      content: `Procedure: For "${milestone?.title ?? input.goal.title}", ${cleanText(run.summary)}`,
      category: "procedure",
      scope: "aim",
      source: "distilled_context",
      confidence: 0.68,
      originId: run.id,
    });
  }
  for (const ev of input.evidence ?? []) {
    if (ev.kind !== "manual_check" || !cleanText(ev.summary)) continue;
    const milestone = ev.milestone_id ? milestoneById.get(ev.milestone_id) : null;
    candidates.push({
      content: `Eval signal: Manual proof accepted${milestone ? ` for "${milestone.title}"` : ""}: ${cleanText(ev.summary)}`,
      category: "eval_signal",
      scope: "global",
      source: "distilled_context",
      confidence: 0.78,
      originId: ev.id,
    });
  }
  return candidates;
}
