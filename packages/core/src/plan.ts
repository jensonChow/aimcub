/**
 * Decomposition validation + re-plan merge.
 * - validatePlan: semantic validation of the LLM output (what the grammar cannot enforce: acyclic / unique ids / count limit).
 * - planMerge: the core invariant of re-plan — completed nodes are frozen forever, never overwritten or lost.
 */
import {
  DecompositionOutput,
  type AcceptanceRule,
  type DecompositionContract,
  type MilestoneStatus,
  type PlanEdge,
  type PlanNode,
} from "@aimcub/types";

export interface PlanValidation {
  ok: boolean;
  errors: string[];
}

export interface PlanNodePatch {
  title?: string;
  description?: string;
  acceptance_rule?: AcceptanceRule;
  decomposition_contract?: DecompositionContract | null;
  routing_override?: PlanNode["routing_override"];
}

export interface SplitPlanNodeInput {
  first?: PlanNodePatch;
  second?: Partial<Pick<PlanNode, "key" | "title" | "description" | "est_effort" | "xp_reward" | "acceptance_rule" | "decomposition_contract">>;
}

/** edge {from, to} semantics: `from` must be completed before `to` can begin (directed edge from→to). Detects directed cycles. */
function hasCycle(keys: string[], edges: PlanEdge[]): boolean {
  const adj = new Map<string, string[]>();
  for (const k of keys) adj.set(k, []);
  for (const e of edges) adj.get(e.from)?.push(e.to);

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const k of keys) color.set(k, WHITE);

  const dfs = (u: string): boolean => {
    color.set(u, GRAY);
    for (const v of adj.get(u) ?? []) {
      const cv = color.get(v) ?? WHITE;
      if (cv === GRAY) return true;
      if (cv === WHITE && dfs(v)) return true;
    }
    color.set(u, BLACK);
    return false;
  };

  for (const k of keys) {
    if ((color.get(k) ?? WHITE) === WHITE && dfs(k)) return true;
  }
  return false;
}

export function validatePlan(output: DecompositionOutput): PlanValidation {
  const errors: string[] = [];
  const keys = output.nodes.map((n) => n.key);
  const keySet = new Set(keys);

  if (keySet.size !== keys.length) errors.push("duplicate node keys");
  if (output.nodes.length < 1 || output.nodes.length > 15) {
    errors.push("node count out of range (1..15)");
  }

  for (const e of output.edges) {
    if (!keySet.has(e.from)) errors.push(`edge.from references unknown node: ${e.from}`);
    if (!keySet.has(e.to)) errors.push(`edge.to references unknown node: ${e.to}`);
    if (e.from === e.to) errors.push(`self-dependency: ${e.from}`);
  }

  if (errors.length === 0 && hasCycle(keys, output.edges)) {
    errors.push("dependency cycle detected");
  }

  return { ok: errors.length === 0, errors };
}

export function validateExecutablePlan(input: unknown): PlanValidation {
  const parsed = DecompositionOutput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
    };
  }
  return validatePlan(parsed.data);
}

function cloneAcceptanceRule(rule: AcceptanceRule): AcceptanceRule {
  return {
    ...rule,
    clauses: rule.clauses.map((clause) => ({
      ...clause,
      match: { ...clause.match },
    })) as AcceptanceRule["clauses"],
  };
}

function cloneContract(contract: DecompositionContract | null | undefined): DecompositionContract | null {
  if (!contract) return null;
  return {
    ...contract,
    required_evidence: [...contract.required_evidence],
    context_gaps: contract.context_gaps.map((gap) => ({ ...gap })),
  };
}

function compactUnique(values: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const normalized = trimmed.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(trimmed);
  }
  return result;
}

function mergeText(left: string | undefined, right: string | undefined): string {
  return compactUnique([left ?? "", right ?? ""]).join("\n\n");
}

function mergeCompletionMode(left: AcceptanceRule["completion_mode"], right: AcceptanceRule["completion_mode"]): AcceptanceRule["completion_mode"] {
  if (left === right) return left;
  if (left === "auto_then_confirm" || right === "auto_then_confirm") return "auto_then_confirm";
  return left === "auto" || right === "auto" ? "auto_then_confirm" : "manual";
}

function mergeAcceptanceRules(left: AcceptanceRule, right: AcceptanceRule): AcceptanceRule {
  return {
    logic: "all",
    threshold: 1,
    completion_mode: mergeCompletionMode(left.completion_mode, right.completion_mode),
    clauses: [
      ...cloneAcceptanceRule(left).clauses,
      ...cloneAcceptanceRule(right).clauses,
    ],
  };
}

function mergeContracts(left: DecompositionContract | null, right: DecompositionContract | null): DecompositionContract | null {
  if (!left && !right) return null;
  if (!left) return cloneContract(right);
  if (!right) return cloneContract(left);

  const gaps = [...left.context_gaps, ...right.context_gaps];
  const seenGaps = new Set<string>();
  return {
    why: mergeText(left.why, right.why) || "Merged sub-aim contract.",
    definition_of_done: mergeText(left.definition_of_done, right.definition_of_done) || "The merged sub-aim is complete.",
    required_evidence: compactUnique([...left.required_evidence, ...right.required_evidence]),
    likely_owner: left.likely_owner === right.likely_owner ? left.likely_owner : "mixed",
    context_gaps: gaps.filter((gap) => {
      const id = `${gap.category}\n${gap.question.trim().toLowerCase()}`;
      if (seenGaps.has(id)) return false;
      seenGaps.add(id);
      return true;
    }).map((gap) => ({ ...gap })),
    eval_signal: mergeText(left.eval_signal, right.eval_signal) || "Evidence satisfies the merged acceptance rule.",
  };
}

function applyNodePatch(node: PlanNode, patch: PlanNodePatch): PlanNode {
  return {
    ...node,
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.acceptance_rule !== undefined ? { acceptance_rule: cloneAcceptanceRule(patch.acceptance_rule) } : {}),
    ...(patch.decomposition_contract !== undefined ? { decomposition_contract: cloneContract(patch.decomposition_contract) } : {}),
    ...(patch.routing_override !== undefined ? { routing_override: patch.routing_override } : {}),
  };
}

function linearEdgesFor(nodes: readonly PlanNode[]): PlanEdge[] {
  const edges: PlanEdge[] = [];
  for (let i = 1; i < nodes.length; i += 1) {
    edges.push({ from: nodes[i - 1]!.key, to: nodes[i]!.key });
  }
  return edges;
}

function withLinearOrder(plan: DecompositionOutput, nodes: PlanNode[]): DecompositionOutput {
  return { ...plan, nodes, edges: linearEdgesFor(nodes) };
}

function uniquePlanKey(existing: ReadonlySet<string>, preferred: string): string {
  const root = preferred
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "sub-aim";
  let candidate = root;
  let suffix = 2;
  while (existing.has(candidate)) {
    candidate = `${root}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

export function updatePlanNode(plan: DecompositionOutput, key: string, patch: PlanNodePatch): DecompositionOutput {
  return {
    ...plan,
    nodes: plan.nodes.map((node) => (node.key === key ? applyNodePatch(node, patch) : node)),
  };
}

export function mergePlanNodes(plan: DecompositionOutput, targetKey: string, sourceKey: string): DecompositionOutput {
  if (targetKey === sourceKey) return plan;
  const target = plan.nodes.find((node) => node.key === targetKey);
  const source = plan.nodes.find((node) => node.key === sourceKey);
  if (!target || !source) return plan;

  const mergedTitle = target.title.trim().toLowerCase() === source.title.trim().toLowerCase()
    ? target.title
    : `${target.title} + ${source.title}`;
  const merged: PlanNode = {
    ...target,
    title: mergedTitle,
    description: mergeText(target.description, source.description),
    xp_reward: Math.max(1, target.xp_reward + source.xp_reward),
    acceptance_rule: mergeAcceptanceRules(target.acceptance_rule, source.acceptance_rule),
    decomposition_contract: mergeContracts(target.decomposition_contract, source.decomposition_contract),
  };
  const nodes = plan.nodes.flatMap((node) => {
    if (node.key === targetKey) return [merged];
    if (node.key === sourceKey) return [];
    return [node];
  });
  return withLinearOrder(plan, nodes);
}

export function splitPlanNode(plan: DecompositionOutput, key: string, input: SplitPlanNodeInput = {}): DecompositionOutput {
  const index = plan.nodes.findIndex((node) => node.key === key);
  const node = plan.nodes[index];
  if (!node || plan.nodes.length >= 15) return plan;

  const existing = new Set(plan.nodes.map((item) => item.key));
  const secondKey = uniquePlanKey(existing, input.second?.key ?? `${node.key}-split`);
  const first = applyNodePatch(node, input.first ?? {});
  const second: PlanNode = {
    ...node,
    key: secondKey,
    title: input.second?.title ?? `Follow up: ${node.title}`,
    description: input.second?.description ?? "",
    est_effort: input.second?.est_effort ?? node.est_effort,
    xp_reward: input.second?.xp_reward ?? node.xp_reward,
    acceptance_rule: input.second?.acceptance_rule ? cloneAcceptanceRule(input.second.acceptance_rule) : cloneAcceptanceRule(node.acceptance_rule),
    decomposition_contract: input.second && "decomposition_contract" in input.second
      ? cloneContract(input.second.decomposition_contract ?? null)
      : cloneContract(node.decomposition_contract),
  };

  const nodes = [...plan.nodes.slice(0, index), first, second, ...plan.nodes.slice(index + 1)];
  return withLinearOrder(plan, nodes);
}

export function movePlanNode(plan: DecompositionOutput, key: string, toIndex: number): DecompositionOutput {
  const fromIndex = plan.nodes.findIndex((node) => node.key === key);
  const node = plan.nodes[fromIndex];
  if (!node) return plan;
  const nextNodes = plan.nodes.slice();
  nextNodes.splice(fromIndex, 1);
  const clamped = Math.max(0, Math.min(toIndex, nextNodes.length));
  nextNodes.splice(clamped, 0, node);
  return withLinearOrder(plan, nextNodes);
}

// ── re-plan merge ──────────────────────────────────────────────────────────

export type MergeAction = "freeze" | "update" | "add" | "skip";

export interface ExistingMilestone {
  id: string;
  title: string;
  status: MilestoneStatus;
  /**
   * The plan-node key this milestone was materialized from, when known. Preferred over title for
   * matching so an in-place edit that RENAMES a milestone (same node key, new title) updates the
   * milestone in place instead of skip+add. An LLM re-plan generates fresh keys that don't match,
   * so it falls back to title matching exactly as before.
   */
  key?: string | null;
}

export interface MergedItem {
  action: MergeAction;
  existingId: string | null;
  nodeKey: string | null;
  title: string;
}

const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Merge a new decomposition result into the existing milestones. Hard invariants:
 *  - Completed nodes → always freeze (kept even if the LLM drops them; finished effort is never lost).
 *  - Unfinished nodes matched by key (preferred) or title → update (reuse the stable id), so an
 *    in-place rename keeps the same milestone instead of skip+add.
 *  - New nodes → add. Unfinished nodes that disappeared → skip (soft delete, not a physical delete).
 */
export function planMerge(existing: ExistingMilestone[], next: DecompositionOutput): MergedItem[] {
  const byKey = new Map<string, ExistingMilestone>();
  const byTitle = new Map<string, ExistingMilestone>();
  for (const m of existing) {
    if (m.key) byKey.set(m.key, m);
    byTitle.set(norm(m.title), m);
  }

  const usedExisting = new Set<string>();
  const result: MergedItem[] = [];

  for (const node of next.nodes) {
    // Match by stable node key first (survives a rename), then by title. Never re-match an existing
    // milestone already claimed by an earlier node.
    const keyed = node.key ? byKey.get(node.key) : undefined;
    const titled = byTitle.get(norm(node.title));
    const match = keyed && !usedExisting.has(keyed.id)
      ? keyed
      : titled && !usedExisting.has(titled.id)
        ? titled
        : undefined;
    if (match) {
      usedExisting.add(match.id);
      if (match.status === "completed") {
        result.push({ action: "freeze", existingId: match.id, nodeKey: node.key, title: match.title });
      } else {
        result.push({ action: "update", existingId: match.id, nodeKey: node.key, title: node.title });
      }
    } else {
      result.push({ action: "add", existingId: null, nodeKey: node.key, title: node.title });
    }
  }

  for (const m of existing) {
    if (usedExisting.has(m.id)) continue;
    if (m.status === "completed") {
      result.push({ action: "freeze", existingId: m.id, nodeKey: null, title: m.title });
    } else {
      result.push({ action: "skip", existingId: m.id, nodeKey: null, title: m.title });
    }
  }

  return result;
}
