/**
 * MockGoalRepo — in-memory implementation of DataPort. Zero network, zero Supabase,
 * zero secrets required. Seeded with a couple of sample goals + milestones so the app
 * runs out of the box.
 *
 * Goal creation runs the local deterministic decomposer (lib/decompose) and materializes
 * the DecompositionOutput into Milestone[] using @core/domain's validatePlan as the gate
 * — exactly the path the live LLM-backed implementation will follow.
 *
 * TODO(v1a-live): swap this for a supabase-js implementation of @core/api-client.GoalPetRepo.
 */
import type { CreateGoalInput } from "@core/api-client";
import { validatePlan } from "@core/domain";
import type { DecompositionOutput, Goal, Milestone, MilestoneStatus } from "@core/types";
import type { DataPort } from "./data-port";
import { localDecompose } from "./decompose";
import { uuid } from "./ids";

/** Fixed demo owner. TODO(v1a-live): replace with the authenticated user's id. */
export const DEMO_OWNER_ID = "00000000-0000-4000-8000-000000000001";

function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

/** Materialize a validated DecompositionOutput into linear Milestone rows. */
function materialize(
  decomposition: DecompositionOutput,
  goalId: string,
  ownerId: string,
  statuses: MilestoneStatus[] = [],
): Milestone[] {
  const result = validatePlan(decomposition);
  if (!result.ok) {
    // Should never happen for the deterministic local plan; surfaces LLM regressions in live mode.
    throw new Error(`invalid decomposition: ${result.errors.join("; ")}`);
  }

  // Map plan keys -> generated milestone ids so depends_on_id can be linked.
  const idByKey = new Map<string, string>();
  for (const node of decomposition.nodes) idByKey.set(node.key, uuid());
  const dependsOn = new Map<string, string>(); // to -> from
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
      rarity: node.rarity,
      completed_at: status === "completed" ? isoDaysFromNow(-1) : null,
      metadata: { est_effort: node.est_effort, plan_key: node.key },
    } satisfies Milestone;
  });
}

export class MockGoalRepo implements DataPort {
  private goals = new Map<string, Goal>();
  private milestonesByGoal = new Map<string, Milestone[]>();

  constructor(ownerId: string = DEMO_OWNER_ID) {
    this.seed(ownerId);
  }

  private seed(ownerId: string): void {
    // Sample goal 1 — partially in progress, to show a mid-flight progress bar.
    const g1 = this.buildGoal(ownerId, {
      title: "Ship a personal portfolio site",
      description: "A fast static site with a blog and a projects page.",
      targetDate: isoDaysFromNow(30),
    });
    const m1 = materialize(localDecompose({ title: g1.title, description: g1.description }), g1.id, ownerId, [
      "completed",
      "in_progress",
      "pending",
      "pending",
      "pending",
    ]);
    g1.status = "active";
    this.goals.set(g1.id, g1);
    this.milestonesByGoal.set(g1.id, m1);

    // Sample goal 2 — fresh draft, all pending.
    const g2 = this.buildGoal(ownerId, {
      title: "Learn Rust by building a CLI tool",
      description: "A small command-line utility, tested and released.",
      targetDate: isoDaysFromNow(60),
    });
    const m2 = materialize(localDecompose({ title: g2.title, description: g2.description }), g2.id, ownerId);
    this.goals.set(g2.id, g2);
    this.milestonesByGoal.set(g2.id, m2);
  }

  private buildGoal(ownerId: string, input: Omit<CreateGoalInput, "ownerId">): Goal {
    return {
      id: uuid(),
      owner_id: ownerId,
      title: input.title,
      description: input.description ?? "",
      domain: input.domain ?? "software",
      status: "draft",
      target_date: input.targetDate ?? null,
      plan_json: null,
      metadata: {},
      created_at: new Date().toISOString(),
    } satisfies Goal;
  }

  async listGoals(ownerId: string): Promise<Goal[]> {
    return [...this.goals.values()]
      .filter((g) => g.owner_id === ownerId)
      .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  }

  async getGoal(id: string): Promise<Goal | null> {
    return this.goals.get(id) ?? null;
  }

  async listMilestones(goalId: string): Promise<Milestone[]> {
    const list = this.milestonesByGoal.get(goalId) ?? [];
    return [...list].sort((a, b) => a.order_index - b.order_index);
  }

  async createGoal(input: CreateGoalInput): Promise<{ goal: Goal; milestones: Milestone[] }> {
    const goal = this.buildGoal(input.ownerId, input);
    goal.status = "active";
    // Deterministic local decomposition. TODO(v1a-live): call @core/llm decomposition.
    const decomposition = localDecompose({ title: goal.title, description: goal.description, domain: goal.domain });
    goal.plan_json = decomposition;
    const milestones = materialize(decomposition, goal.id, input.ownerId);
    this.goals.set(goal.id, goal);
    this.milestonesByGoal.set(goal.id, milestones);
    return { goal, milestones };
  }
}
