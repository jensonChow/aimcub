/**
 * Validate a DecompositionOutput and materialize it into linear Milestone rows.
 * A desktop-local copy of the web app's `materialize` (apps/web/lib/mock-repo.ts) — it
 * uses `node:crypto` randomUUID, which keeps it out of the purity-guarded @core kernel.
 * Reuses `@core/domain` validatePlan as the gate, identical to the web path.
 */
import { randomUUID } from "node:crypto";

import { validatePlan } from "@core/domain";
import type { DecompositionOutput, Milestone, MilestoneStatus } from "@core/types";

export function materialize(
  decomposition: DecompositionOutput,
  goalId: string,
  ownerId: string,
  statuses: MilestoneStatus[] = [],
): Milestone[] {
  const result = validatePlan(decomposition);
  if (!result.ok) {
    throw new Error(`invalid decomposition: ${result.errors.join("; ")}`);
  }

  const idByKey = new Map<string, string>();
  for (const node of decomposition.nodes) idByKey.set(node.key, randomUUID());
  const dependsOn = new Map<string, string>(); // to -> from id
  for (const edge of decomposition.edges) {
    const fromId = idByKey.get(edge.from);
    if (fromId) dependsOn.set(edge.to, fromId);
  }

  return decomposition.nodes.map((node, i) => {
    const status = statuses[i] ?? "pending";
    return {
      id: idByKey.get(node.key)!,
      goal_id: goalId,
      owner_id: ownerId,
      title: node.title,
      description: node.description,
      status,
      order_index: i,
      depends_on_id: dependsOn.get(node.key) ?? null,
      acceptance_rule: node.acceptance_rule,
      xp_reward: node.xp_reward,
      completed_at: null,
      metadata: { est_effort: node.est_effort, plan_key: node.key },
    } satisfies Milestone;
  });
}
