/**
 * MockGoalRepo — in-memory implementation of DataPort. Zero network, zero Supabase,
 * zero secrets required. Seeded with a couple of sample goals + milestones so the app
 * runs out of the box.
 *
 * Goal creation runs the local deterministic decomposer (lib/decompose) and materializes
 * the DecompositionOutput into Milestone[] using @core/domain's validatePlan as the gate
 * — exactly the path the live LLM-backed implementation will follow.
 *
 * TODO(v1a-live): swap this for a supabase-js implementation of @core/api-client.AimcubRepo.
 */
import type { CreateGoalInput } from "@core/api-client";
import { stageForXp, validatePlan } from "@core/domain";
import type {
  Collectible,
  DecompositionOutput,
  Goal,
  Milestone,
  MilestoneStatus,
  Notification,
  Pet,
  Rarity,
} from "@core/types";
import type { DataPort } from "./data-port";
import { localDecompose } from "./decompose";
import { uuid } from "./ids";

/** Fixed demo owner. TODO(v1a-live): replace with the authenticated user's id. */
export const DEMO_OWNER_ID = "00000000-0000-4000-8000-000000000001";

function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

/** Materialize a validated DecompositionOutput into linear Milestone rows. Shared by mock and live ports. */
export function materialize(
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

/** One rarity tier up — mirrors the production seeded shiny upgrade for the demo. */
const RARITY_UPGRADE: Record<Rarity, Rarity> = {
  common: "uncommon",
  uncommon: "rare",
  rare: "epic",
  epic: "legendary",
  legendary: "legendary",
};

export class MockGoalRepo implements DataPort {
  private goals = new Map<string, Goal>();
  private milestonesByGoal = new Map<string, Milestone[]>();
  /** Stable derived-entity ids so re-reads return the same rows (pets/badges/notifications are derived, not stored). */
  private petIdByGoal = new Map<string, string>();
  private badgeIdByMilestone = new Map<string, string>();
  private notificationIdByMilestone = new Map<string, string>();

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

  /**
   * Derived mock pet — mirrors the grow_pet recompute: xp = sum of completed milestones'
   * xp_reward, stage = stageForXp(xp). Null until the first completion (the live pets row
   * is materialized by the jobs worker, so a fresh goal has no row yet).
   */
  async getPet(goalId: string): Promise<Pet | null> {
    const completed = (this.milestonesByGoal.get(goalId) ?? []).filter((m) => m.status === "completed");
    if (completed.length === 0) return null;
    const xp = completed.reduce((sum, m) => sum + m.xp_reward, 0);
    const id = this.stableId(this.petIdByGoal, goalId);
    return {
      id,
      owner_id: this.goals.get(goalId)?.owner_id ?? DEMO_OWNER_ID,
      goal_id: goalId,
      species: "default",
      branch: "unset",
      stage: stageForXp(xp),
      xp,
      mood: 0.7,
      sprite_set: "default",
      updated_at: new Date().toISOString(),
    } satisfies Pet;
  }

  /**
   * Derived mock badges — one milestone_badge per completed milestone, with the same
   * metadata snapshot the live mint job writes. The first milestone of each goal is the
   * deterministic "shiny" (stands in for production's seeded ~10% upgrade roll).
   */
  async listCollectibles(ownerId: string): Promise<Collectible[]> {
    const out: Collectible[] = [];
    for (const goal of this.goals.values()) {
      if (goal.owner_id !== ownerId) continue;
      for (const m of this.milestonesByGoal.get(goal.id) ?? []) {
        if (m.status !== "completed") continue;
        const shiny = m.order_index === 0;
        out.push({
          id: this.stableId(this.badgeIdByMilestone, m.id),
          owner_id: ownerId,
          goal_id: goal.id,
          milestone_id: m.id,
          kind: "milestone_badge",
          rarity: shiny ? RARITY_UPGRADE[m.rarity] : m.rarity,
          metadata: {
            goal_title: goal.title,
            milestone_title: m.title,
            completed_at: m.completed_at,
            awarded_xp: m.xp_reward,
            ...(shiny ? { shiny: true } : {}),
          },
          image_url: null,
          minted_at: m.completed_at ?? new Date().toISOString(),
        } satisfies Collectible);
      }
    }
    return out.sort((a, b) => (b.minted_at ?? "").localeCompare(a.minted_at ?? ""));
  }

  /** Derived mock notifications — one pet-voice celebration per completed milestone, newest first. */
  async listNotifications(ownerId: string, limit = 20): Promise<Notification[]> {
    const out: Notification[] = [];
    for (const goal of this.goals.values()) {
      if (goal.owner_id !== ownerId) continue;
      for (const m of this.milestonesByGoal.get(goal.id) ?? []) {
        if (m.status !== "completed") continue;
        out.push({
          id: this.stableId(this.notificationIdByMilestone, m.id),
          owner_id: ownerId,
          trigger: "milestone_done",
          channels: ["in_app", "agent_inbox"],
          dedup_key: `notif:milestone_done:${m.id}`,
          ref_goal_id: goal.id,
          ref_milestone_id: m.id,
          persona_msg: `'${m.title}' just lit up — +${m.xp_reward} XP for us. I felt that one in my shell.`,
          status: "sent",
          created_at: m.completed_at ?? new Date().toISOString(),
        } satisfies Notification);
      }
    }
    return out
      .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))
      .slice(0, limit);
  }

  /** Memoized uuid per source row, so derived entities keep their identity across reads. */
  private stableId(cache: Map<string, string>, key: string): string {
    let id = cache.get(key);
    if (!id) {
      id = uuid();
      cache.set(key, id);
    }
    return id;
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
