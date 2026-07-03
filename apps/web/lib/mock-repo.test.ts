import { describe, expect, it } from "vitest";
import { validatePlan } from "@core/domain";
import { localDecompose } from "./decompose";
import { goalDebugTraceFromMetadata } from "./debug-trace";
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
    const trace = goalDebugTraceFromMetadata(goal.metadata);
    expect(trace?.model.status).toBe("local_only");
    expect(trace?.context.preModel.progress.pendingCount).toBeGreaterThan(0);
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
