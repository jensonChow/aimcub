import { describe, expect, it } from "vitest";
import { validatePlan } from "@core/domain";
import { localDecompose } from "./decompose";
import { DEMO_OWNER_ID, MockGoalRepo } from "./mock-repo";

describe("localDecompose", () => {
  it("produces a valid, acyclic, linearly-chained plan", () => {
    const plan = localDecompose({ title: "Build a thing" });
    expect(validatePlan(plan).ok).toBe(true);
    expect(plan.goal_summary).toBe("Build a thing");
    // Linear chain: edges = nodes - 1.
    expect(plan.edges).toHaveLength(plan.nodes.length - 1);
  });
});

describe("MockGoalRepo", () => {
  it("seeds sample goals with milestones", async () => {
    const repo = new MockGoalRepo();
    const goals = await repo.listGoals(DEMO_OWNER_ID);
    expect(goals.length).toBeGreaterThanOrEqual(2);
    const first = await repo.listMilestones(goals[0]!.id);
    expect(first.length).toBeGreaterThan(0);
  });

  it("creates a goal and materializes its decomposition with linked dependencies", async () => {
    const repo = new MockGoalRepo();
    const { goal, milestones } = await repo.createGoal({
      ownerId: DEMO_OWNER_ID,
      title: "New goal",
      description: "desc",
    });
    expect(goal.status).toBe("active");
    expect(goal.plan_json).not.toBeNull();
    expect(milestones.length).toBeGreaterThan(0);
    // First milestone has no prerequisite; the rest each depend on a real prior id.
    expect(milestones[0]!.depends_on_id).toBeNull();
    const ids = new Set(milestones.map((m) => m.id));
    for (const m of milestones.slice(1)) {
      expect(m.depends_on_id).not.toBeNull();
      expect(ids.has(m.depends_on_id!)).toBe(true);
    }
    // Round-trips through the read path.
    const reloaded = await repo.getGoal(goal.id);
    expect(reloaded?.id).toBe(goal.id);
  });
});

describe("MockGoalRepo — derived emotional-shell state", () => {
  it("derives the pet from completed milestones (null until the first completion)", async () => {
    const repo = new MockGoalRepo();
    const goals = await repo.listGoals(DEMO_OWNER_ID);
    const [inFlight, fresh] = goals; // seed: g1 has one completion, g2 has none

    const pet = await repo.getPet(inFlight!.id);
    const completedXp = (await repo.listMilestones(inFlight!.id))
      .filter((m) => m.status === "completed")
      .reduce((sum, m) => sum + m.xp_reward, 0);
    expect(pet).not.toBeNull();
    expect(pet?.xp).toBe(completedXp);
    expect(pet?.stage).toBe("egg");
    expect(pet?.goal_id).toBe(inFlight!.id);
    // Stable identity across reads (derived, but not flickering).
    expect((await repo.getPet(inFlight!.id))?.id).toBe(pet?.id);

    expect(await repo.getPet(fresh!.id)).toBeNull();
  });

  it("derives one badge per completed milestone with the mint-time metadata snapshot", async () => {
    const repo = new MockGoalRepo();
    const goals = await repo.listGoals(DEMO_OWNER_ID);
    const badges = await repo.listCollectibles(DEMO_OWNER_ID);

    expect(badges).toHaveLength(1); // seed has exactly one completed milestone
    const badge = badges[0]!;
    expect(badge.kind).toBe("milestone_badge");
    expect(badge.metadata.milestone_title).toBe("Scaffold the project");
    expect(badge.metadata.goal_title).toBe(goals.find((g) => g.id === badge.goal_id)?.title);
    expect(typeof badge.metadata.awarded_xp).toBe("number");
    // The first milestone of a goal is the deterministic demo shiny (rarity upgraded one tier).
    expect(badge.metadata.shiny).toBe(true);
    expect(badge.rarity).toBe("uncommon");
  });

  it("derives in-app pet-voice notifications for completed milestones", async () => {
    const repo = new MockGoalRepo();
    const notifications = await repo.listNotifications(DEMO_OWNER_ID);
    expect(notifications).toHaveLength(1);
    const n = notifications[0]!;
    expect(n.trigger).toBe("milestone_done");
    expect(n.channels).toContain("in_app");
    expect(n.persona_msg).toContain("Scaffold the project");
    expect(n.status).toBe("sent");
  });
});
