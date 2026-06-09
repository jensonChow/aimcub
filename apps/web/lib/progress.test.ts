import { describe, expect, it } from "vitest";
import type { Milestone } from "@core/types";
import { computeProgress, isGoalComplete, nextEligibleMilestone, statusLabel } from "./progress";

function ms(partial: Partial<Milestone> & Pick<Milestone, "id" | "status" | "order_index">): Milestone {
  return {
    goal_id: "00000000-0000-4000-8000-0000000000aa",
    owner_id: "00000000-0000-4000-8000-0000000000bb",
    title: partial.title ?? "Step",
    description: "",
    depends_on_id: null,
    acceptance_rule: {
      logic: "all",
      threshold: 1,
      completion_mode: "auto_then_confirm",
      clauses: [{ evaluator: "commit_pattern", auto_verifiable: true, match: { min_files: 1 } }],
    },
    xp_reward: partial.xp_reward ?? 10,
    rarity: "common",
    completed_at: null,
    metadata: {},
    ...partial,
  };
}

describe("computeProgress", () => {
  it("returns zeroes for an empty list", () => {
    expect(computeProgress([])).toEqual({
      completed: 0,
      total: 0,
      fraction: 0,
      percent: 0,
      earnedXp: 0,
      totalXp: 0,
    });
  });

  it("counts completed milestones and xp", () => {
    const list = [
      ms({ id: "1", status: "completed", order_index: 0, xp_reward: 20 }),
      ms({ id: "2", status: "in_progress", order_index: 1, xp_reward: 30 }),
      ms({ id: "3", status: "pending", order_index: 2, xp_reward: 50 }),
    ];
    const p = computeProgress(list);
    expect(p.completed).toBe(1);
    expect(p.total).toBe(3);
    expect(p.percent).toBe(33);
    expect(p.earnedXp).toBe(20);
    expect(p.totalXp).toBe(100);
  });

  it("reaches 100% when all are completed", () => {
    const list = [
      ms({ id: "1", status: "completed", order_index: 0 }),
      ms({ id: "2", status: "completed", order_index: 1 }),
    ];
    expect(computeProgress(list).percent).toBe(100);
  });
});

describe("isGoalComplete", () => {
  it("is false for an empty list", () => {
    expect(isGoalComplete([])).toBe(false);
  });
  it("is true only when every milestone is completed", () => {
    expect(
      isGoalComplete([
        ms({ id: "1", status: "completed", order_index: 0 }),
        ms({ id: "2", status: "completed", order_index: 1 }),
      ]),
    ).toBe(true);
    expect(
      isGoalComplete([
        ms({ id: "1", status: "completed", order_index: 0 }),
        ms({ id: "2", status: "pending", order_index: 1 }),
      ]),
    ).toBe(false);
  });
});

describe("nextEligibleMilestone", () => {
  it("picks the lowest-order open milestone, skipping completed/skipped", () => {
    const list = [
      ms({ id: "1", status: "completed", order_index: 0 }),
      ms({ id: "2", status: "skipped", order_index: 1 }),
      ms({ id: "3", status: "pending", order_index: 2 }),
      ms({ id: "4", status: "pending", order_index: 3 }),
    ];
    expect(nextEligibleMilestone(list)?.id).toBe("3");
  });
  it("returns null when nothing is open", () => {
    expect(nextEligibleMilestone([ms({ id: "1", status: "completed", order_index: 0 })])).toBeNull();
  });
  it("ignores input order and uses order_index", () => {
    const list = [
      ms({ id: "b", status: "pending", order_index: 5 }),
      ms({ id: "a", status: "pending", order_index: 1 }),
    ];
    expect(nextEligibleMilestone(list)?.id).toBe("a");
  });
});

describe("statusLabel", () => {
  it("maps each status to a human label", () => {
    expect(statusLabel("in_progress")).toBe("In progress");
    expect(statusLabel("completed")).toBe("Completed");
    expect(statusLabel("blocked")).toBe("Blocked");
  });
});
