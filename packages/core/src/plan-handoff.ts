import type {
  AcceptanceClause,
  AcceptanceRule,
  ContextCategory,
  DecompositionContextGap,
  DecompositionOutput,
  DecompositionOwner,
  PlanNode,
} from "@core/types";
import type { ContextSedimentationAimContext, ContextSedimentationMemoryCandidate } from "./context-sedimentation";
import { inferContextCategory } from "./context";
import type { PlanQualityContext } from "./plan-quality";

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

export interface LocalAgentHandoffContextItem {
  category: ContextCategory;
  content: string;
  source: ContextSedimentationAimContext["source"] | ContextSedimentationMemoryCandidate["source"] | "selected_context";
  stepId?: string;
  reason: string;
}

export interface LocalAgentHandoffJob {
  id: string;
  nodeKey: string;
  title: string;
  status: "ready";
  prerequisiteKeys: string[];
  inputContext: LocalAgentHandoffContextItem[];
  expectedEvidence: string[];
  evalSignal: string;
  acceptanceSummary: string;
  handoffBrief: string;
}

export interface LocalAgentBlockedJob {
  id: string;
  nodeKey: string;
  title: string;
  status: Exclude<PlanHandoffReadiness, "ready">;
  blockerCodes: PlanHandoffBlockerCode[];
  inputContext: LocalAgentHandoffContextItem[];
  contextGaps: DecompositionContextGap[];
  nextAction: string;
}

export interface LocalHumanHandoffTask {
  id: string;
  nodeKey: string;
  title: string;
  likelyOwner: Extract<DecompositionOwner, "human" | "mixed">;
  blockerCodes: PlanHandoffBlockerCode[];
  inputContext: LocalAgentHandoffContextItem[];
  contextGaps: DecompositionContextGap[];
  requiredDecision: string;
}

export interface LocalHandoffManifest {
  version: 1;
  agentQueue: LocalAgentHandoffJob[];
  blockedAgentQueue: LocalAgentBlockedJob[];
  humanQueue: LocalHumanHandoffTask[];
  evalSignals: string[];
  nextActions: string[];
}

export interface BuildLocalHandoffManifestInput {
  plan: DecompositionOutput;
  handoff?: PlanHandoffReport;
  aimContext?: readonly ContextSedimentationAimContext[];
  durableMemoryCandidates?: readonly ContextSedimentationMemoryCandidate[];
  selectedContext?: readonly PlanQualityContext[];
  maxContextItemsPerJob?: number;
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

function selectedContextCategory(context: PlanQualityContext): ContextCategory {
  switch (context.category) {
    case "preference":
    case "constraint":
    case "capability":
    case "eval_signal":
    case "project_fact":
    case "procedure":
      return context.category;
    default:
      return inferContextCategory(context.content, context.kind === "procedural" ? "procedure" : "project_fact");
  }
}

function handoffContextCandidates(input: BuildLocalHandoffManifestInput): LocalAgentHandoffContextItem[] {
  const rows: LocalAgentHandoffContextItem[] = [
    ...(input.aimContext ?? []).map((context) => ({
      category: context.category,
      content: context.content,
      source: context.source,
      ...(context.stepId ? { stepId: context.stepId } : {}),
      reason: context.reason,
    })),
    ...(input.durableMemoryCandidates ?? []).map((context) => ({
      category: context.category,
      content: context.content,
      source: context.source,
      ...(context.stepId ? { stepId: context.stepId } : {}),
      reason: context.reason,
    })),
    ...(input.selectedContext ?? [])
      .filter((context) => context.content.trim().length > 0)
      .map((context) => ({
        category: selectedContextCategory(context),
        content: context.content.trim(),
        source: "selected_context" as const,
        reason: "Selected planning context used during decomposition.",
      })),
  ];
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.category}\u0000${row.content.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function contextForTask(
  contexts: readonly LocalAgentHandoffContextItem[],
  maxItems: number,
): LocalAgentHandoffContextItem[] {
  return contexts
    .slice(0, maxItems)
    .map((context) => ({
      category: context.category,
      content: context.content,
      source: context.source,
      ...(context.stepId ? { stepId: context.stepId } : {}),
      reason: context.reason,
    }));
}

function agentJob(
  task: PlanHandoffTask,
  contexts: readonly LocalAgentHandoffContextItem[],
  maxContextItems: number,
): LocalAgentHandoffJob {
  return {
    id: `agent:${task.nodeKey}`,
    nodeKey: task.nodeKey,
    title: task.title,
    status: "ready",
    prerequisiteKeys: task.prerequisiteKeys,
    inputContext: contextForTask(contexts, maxContextItems),
    expectedEvidence: task.expectedEvidence,
    evalSignal: task.evalSignal ?? "Complete the task according to the aim-specific acceptance rule.",
    acceptanceSummary: task.acceptanceSummary,
    handoffBrief: task.handoffBrief,
  };
}

function blockedJob(
  task: PlanHandoffTask,
  contexts: readonly LocalAgentHandoffContextItem[],
  maxContextItems: number,
): LocalAgentBlockedJob {
  const needsContext = task.contextGaps[0];
  return {
    id: `blocked:${task.nodeKey}`,
    nodeKey: task.nodeKey,
    title: task.title,
    status: task.readiness === "ready" ? "needs_review" : task.readiness,
    blockerCodes: task.blockerCodes,
    inputContext: contextForTask(contexts, maxContextItems),
    contextGaps: task.contextGaps,
    nextAction: needsContext
      ? `Collect context: ${needsContext.question}`
      : "Review handoff contract, owner, and auto-verifiable evidence before queueing.",
  };
}

function humanTask(
  task: PlanHandoffTask,
  contexts: readonly LocalAgentHandoffContextItem[],
  maxContextItems: number,
): LocalHumanHandoffTask {
  return {
    id: `human:${task.nodeKey}`,
    nodeKey: task.nodeKey,
    title: task.title,
    likelyOwner: task.likelyOwner === "mixed" ? "mixed" : "human",
    blockerCodes: task.blockerCodes,
    inputContext: contextForTask(contexts, maxContextItems),
    contextGaps: task.contextGaps,
    requiredDecision: task.likelyOwner === "mixed"
      ? "Decide the human handoff point before agent execution continues."
      : "User or another human must complete or approve this task.",
  };
}

function contextEvalSignals(input: BuildLocalHandoffManifestInput): string[] {
  const signals: string[] = [];
  for (const context of input.aimContext ?? []) {
    if (context.category === "eval_signal" && context.content.trim()) signals.push(context.content.trim());
  }
  for (const context of input.durableMemoryCandidates ?? []) {
    if (context.category === "eval_signal" && context.content.trim()) signals.push(context.content.trim());
  }
  for (const context of input.selectedContext ?? []) {
    if (selectedContextCategory(context) === "eval_signal" && context.content.trim()) {
      signals.push(context.content.trim());
    }
  }
  return signals;
}

function manifestNextActions(input: {
  manifest: Omit<LocalHandoffManifest, "nextActions">;
  report: PlanHandoffReport;
}): string[] {
  const actions: string[] = [];
  if (input.manifest.agentQueue.length > 0) {
    actions.push(`Prepare ${input.manifest.agentQueue.length} local agent job${input.manifest.agentQueue.length === 1 ? "" : "s"} for queueing.`);
  }
  if (input.manifest.blockedAgentQueue.length > 0) {
    actions.push(`Resolve ${input.manifest.blockedAgentQueue.length} blocked agent job${input.manifest.blockedAgentQueue.length === 1 ? "" : "s"} before one-click handoff.`);
  }
  if (input.manifest.humanQueue.length > 0) {
    actions.push(`Route ${input.manifest.humanQueue.length} human-gated task${input.manifest.humanQueue.length === 1 ? "" : "s"} outside the agent queue.`);
  }
  return actions.length > 0 ? actions : input.report.nextActions;
}

export function buildLocalHandoffManifest(input: BuildLocalHandoffManifestInput): LocalHandoffManifest {
  const report = input.handoff ?? buildPlanHandoffReport({ plan: input.plan });
  const maxContextItems = input.maxContextItemsPerJob ?? 6;
  const contexts = handoffContextCandidates(input);
  const partial: Omit<LocalHandoffManifest, "nextActions"> = {
    version: 1,
    agentQueue: report.agentReady.map((task) => agentJob(task, contexts, maxContextItems)),
    blockedAgentQueue: report.agentBlocked.map((task) => blockedJob(task, contexts, maxContextItems)),
    humanQueue: [
      ...report.humanRequired.map((task) => humanTask(task, contexts, maxContextItems)),
      ...report.mixed.map((task) => humanTask(task, contexts, maxContextItems)),
    ],
    evalSignals: [
      ...new Set([
        ...report.agentReady.flatMap((task) => task.evalSignal ? [task.evalSignal] : []),
        ...contextEvalSignals(input),
      ]),
    ],
  };
  return {
    ...partial,
    nextActions: manifestNextActions({ manifest: partial, report }),
  };
}
