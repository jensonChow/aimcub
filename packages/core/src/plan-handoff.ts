import type {
  AcceptanceClause,
  AcceptanceRule,
  DecompositionContextGap,
  DecompositionOutput,
  DecompositionOwner,
  PlanNode,
} from "@core/types";

export type PlanHandoffReadiness = "ready" | "needs_context" | "needs_human" | "needs_review";

export type PlanHandoffBlockerCode =
  | "missing_contract"
  | "context_gaps"
  | "manual_completion"
  | "missing_agent_evidence"
  | "unsupported_auto_evaluator"
  | "human_handoff";

export interface PlanHandoffTask {
  nodeKey: string;
  title: string;
  description: string;
  likelyOwner: DecompositionOwner;
  readiness: PlanHandoffReadiness;
  blockerCodes: PlanHandoffBlockerCode[];
  prerequisiteKeys: string[];
  expectedEvidence: string[];
  evalSignal: string | null;
  contextGaps: DecompositionContextGap[];
  acceptanceSummary: string;
  handoffBrief: string;
}

export interface PlanHandoffReport {
  total: number;
  agentReady: PlanHandoffTask[];
  agentBlocked: PlanHandoffTask[];
  humanRequired: PlanHandoffTask[];
  mixed: PlanHandoffTask[];
  either: PlanHandoffTask[];
  needsContext: PlanHandoffTask[];
  nextActions: string[];
}

export interface BuildPlanHandoffReportInput {
  plan: DecompositionOutput;
}

const SUPPORTED_AUTO_EVALUATORS = new Set<AcceptanceClause["evaluator"]>([
  "commit_pattern",
  "ci_status",
]);

function prerequisitesFor(plan: DecompositionOutput): Map<string, string[]> {
  const prerequisites = new Map<string, string[]>();
  for (const node of plan.nodes) prerequisites.set(node.key, []);
  for (const edge of plan.edges) {
    const existing = prerequisites.get(edge.to);
    if (existing) existing.push(edge.from);
  }
  return prerequisites;
}

function clauseSummary(clause: AcceptanceClause): string {
  switch (clause.evaluator) {
    case "commit_pattern": {
      const parts = [
        clause.match.path_glob ? `paths ${clause.match.path_glob}` : undefined,
        clause.match.message_pattern ? `message ${clause.match.message_pattern}` : undefined,
        clause.match.min_files ? `${clause.match.min_files}+ files` : undefined,
        clause.match.branch ? `branch ${clause.match.branch}` : undefined,
      ].filter(Boolean);
      return parts.length > 0 ? `commit (${parts.join(", ")})` : "commit evidence";
    }
    case "ci_status":
      return clause.match.workflow
        ? `CI ${clause.match.workflow} ${clause.match.conclusion}`
        : `CI ${clause.match.conclusion}`;
    case "manual_confirm":
      return "manual confirmation";
    case "file_uploaded":
      return `file artifact (${clause.match.min_count}+ files)`;
    case "url":
      return clause.match.pattern ? `URL matching ${clause.match.pattern}` : "URL evidence";
    case "llm_judge":
      return "LLM judge evidence";
  }
}

function acceptanceSummary(rule: AcceptanceRule): string {
  const clauses = rule.clauses.map(clauseSummary).join("; ");
  return `${rule.logic} · ${rule.completion_mode} · ${clauses}`;
}

function hasAgentEvidence(rule: AcceptanceRule): boolean {
  return rule.clauses.some((clause) => clause.auto_verifiable && SUPPORTED_AUTO_EVALUATORS.has(clause.evaluator));
}

function hasUnsupportedAutoEvaluator(rule: AcceptanceRule): boolean {
  return rule.clauses.some((clause) =>
    clause.auto_verifiable && !SUPPORTED_AUTO_EVALUATORS.has(clause.evaluator),
  );
}

function blockerCodes(node: PlanNode): PlanHandoffBlockerCode[] {
  const contract = node.decomposition_contract;
  const codes = new Set<PlanHandoffBlockerCode>();

  if (!contract) codes.add("missing_contract");
  if (contract?.context_gaps.length) codes.add("context_gaps");
  if (node.acceptance_rule.completion_mode === "manual") codes.add("manual_completion");
  if (!hasAgentEvidence(node.acceptance_rule)) codes.add("missing_agent_evidence");
  if (hasUnsupportedAutoEvaluator(node.acceptance_rule)) codes.add("unsupported_auto_evaluator");
  if (contract?.likely_owner === "human" || contract?.likely_owner === "mixed") codes.add("human_handoff");

  return [...codes];
}

function readiness(likelyOwner: DecompositionOwner, codes: readonly PlanHandoffBlockerCode[]): PlanHandoffReadiness {
  if (codes.includes("context_gaps")) return "needs_context";
  if (likelyOwner === "human" || likelyOwner === "mixed" || codes.includes("human_handoff") || codes.includes("manual_completion")) {
    return "needs_human";
  }
  if (codes.includes("missing_contract") || codes.includes("missing_agent_evidence") || codes.includes("unsupported_auto_evaluator")) {
    return "needs_review";
  }
  return "ready";
}

function handoffBrief(node: PlanNode, prerequisiteKeys: readonly string[], summary: string): string {
  const contract = node.decomposition_contract;
  const parts = [
    `Task: ${node.title}`,
    node.description ? `Description: ${node.description}` : undefined,
    prerequisiteKeys.length > 0 ? `Prerequisites: ${prerequisiteKeys.join(", ")}` : undefined,
    contract?.definition_of_done ? `Done: ${contract.definition_of_done}` : undefined,
    contract?.required_evidence.length ? `Evidence: ${contract.required_evidence.join("; ")}` : undefined,
    contract?.eval_signal ? `Eval: ${contract.eval_signal}` : undefined,
    `Acceptance: ${summary}`,
  ].filter(Boolean);
  return parts.join("\n");
}

function taskForNode(node: PlanNode, prerequisites: Map<string, string[]>): PlanHandoffTask {
  const likelyOwner = node.decomposition_contract?.likely_owner ?? "either";
  const codes = blockerCodes(node);
  const prerequisiteKeys = prerequisites.get(node.key) ?? [];
  const summary = acceptanceSummary(node.acceptance_rule);
  return {
    nodeKey: node.key,
    title: node.title,
    description: node.description,
    likelyOwner,
    readiness: readiness(likelyOwner, codes),
    blockerCodes: codes,
    prerequisiteKeys,
    expectedEvidence: node.decomposition_contract?.required_evidence ?? [],
    evalSignal: node.decomposition_contract?.eval_signal ?? null,
    contextGaps: node.decomposition_contract?.context_gaps ?? [],
    acceptanceSummary: summary,
    handoffBrief: handoffBrief(node, prerequisiteKeys, summary),
  };
}

function nextActions(report: Omit<PlanHandoffReport, "nextActions">): string[] {
  const actions: string[] = [];
  if (report.agentReady.length > 0) {
    actions.push(`Queue ${report.agentReady.length} agent-ready task${report.agentReady.length === 1 ? "" : "s"} for local agent handoff.`);
  }
  if (report.needsContext.length > 0) {
    actions.push(`Collect context for ${report.needsContext.length} blocked task${report.needsContext.length === 1 ? "" : "s"} before handoff.`);
  }
  if (report.humanRequired.length + report.mixed.length > 0) {
    actions.push(`Ask the user to handle or approve ${report.humanRequired.length + report.mixed.length} human-gated task${report.humanRequired.length + report.mixed.length === 1 ? "" : "s"}.`);
  }
  if (report.agentBlocked.length > 0) {
    actions.push(`Review ${report.agentBlocked.length} agent-intended task${report.agentBlocked.length === 1 ? "" : "s"} with weak handoff/eval evidence.`);
  }
  return actions.length > 0 ? actions : ["Plan has no routable tasks yet; refine the decomposition first."];
}

export function buildPlanHandoffReport(input: BuildPlanHandoffReportInput): PlanHandoffReport {
  const prerequisites = prerequisitesFor(input.plan);
  const tasks = input.plan.nodes.map((node) => taskForNode(node, prerequisites));
  const agentReady = tasks.filter((task) =>
    (task.likelyOwner === "agent" || task.likelyOwner === "either") && task.readiness === "ready",
  );
  const agentBlocked = tasks.filter((task) =>
    (task.likelyOwner === "agent" || task.likelyOwner === "either") && task.readiness !== "ready",
  );
  const humanRequired = tasks.filter((task) => task.likelyOwner === "human");
  const mixed = tasks.filter((task) => task.likelyOwner === "mixed");
  const either = tasks.filter((task) => task.likelyOwner === "either");
  const needsContext = tasks.filter((task) => task.readiness === "needs_context");
  const partial = {
    total: tasks.length,
    agentReady,
    agentBlocked,
    humanRequired,
    mixed,
    either,
    needsContext,
  };
  return {
    ...partial,
    nextActions: nextActions(partial),
  };
}
