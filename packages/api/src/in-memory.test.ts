import { describe, expect, it } from "vitest";

import type { MilestoneCompletion } from "@core/types";

import { InMemoryAimcubRepo, InvariantError } from "./in-memory.js";
import type { AimcubRepo } from "./contract.js";

const OWNER_A = "00000000-0000-0000-0000-00000000000a";
const OWNER_B = "00000000-0000-0000-0000-00000000000b";
const EMITTER_A = "10000000-0000-0000-0000-00000000000a";

/** Deterministic id generator for stable assertions. */
function seq() {
  let n = 0;
  return () => `id-${(n++).toString().padStart(4, "0")}`;
}

function makeRepo() {
  return new InMemoryAimcubRepo({ newId: seq(), now: () => "2026-06-09T00:00:00.000Z" });
}

describe("InMemoryAimcubRepo — structural conformance", () => {
  it("satisfies the AimcubRepo contract", () => {
    const repo: AimcubRepo = makeRepo();
    expect(typeof repo.createGoal).toBe("function");
    expect(typeof repo.ingestEvidence).toBe("function");
  });
});

describe("user path — RLS-shaped reads", () => {
  it("createGoal applies defaults and listGoals isolates by owner", async () => {
    const repo = makeRepo();
    const g1 = await repo.createGoal({ ownerId: OWNER_A, title: "Ship v1" });
    await repo.createGoal({ ownerId: OWNER_B, title: "Other owner goal" });

    expect(g1.status).toBe("draft");
    expect(g1.domain).toBe("software");
    expect(g1.description).toBe("");
    expect(g1.target_date).toBeNull();

    const ownerAGoals = await repo.listGoals(OWNER_A);
    expect(ownerAGoals).toHaveLength(1);
    expect(ownerAGoals[0]?.owner_id).toBe(OWNER_A);

    // Owner B never sees owner A's rows (mirrors the own_select RLS policy).
    const ownerBGoals = await repo.listGoals(OWNER_B);
    expect(ownerBGoals.every((g) => g.owner_id === OWNER_B)).toBe(true);
  });

  it("listMilestones returns rows for a goal sorted by order_index", async () => {
    const repo = makeRepo();
    const g = await repo.createGoal({ ownerId: OWNER_A, title: "G" });
    await repo.insertMilestones([
      milestone(g.id, OWNER_A, "m-b", 2),
      milestone(g.id, OWNER_A, "m-a", 1),
    ]);
    const ms = await repo.listMilestones(g.id);
    expect(ms.map((m) => m.order_index)).toEqual([1, 2]);
  });

  it("updateGoalPlan can persist plan quality metadata", async () => {
    const repo = makeRepo();
    const g = await repo.createGoal({ ownerId: OWNER_A, title: "G" });

    const updated = await repo.updateGoalPlan(g.id, { nodes: [] }, "active", {
      plan_quality: { grade: "pass", score: 100, issues: [] },
    });

    expect(updated.status).toBe("active");
    expect(updated.plan_json).toEqual({ nodes: [] });
    expect(updated.metadata).toMatchObject({ plan_quality: { grade: "pass", score: 100 } });
  });

});

describe("invariant — evidence idempotency by (emitter_id, source_event_id)", () => {
  it("returns the same row for a replayed (emitter, source_event_id)", async () => {
    const repo = makeRepo();
    repo.registerEmitter(EMITTER_A, OWNER_A);
    const g = await repo.createGoal({ ownerId: OWNER_A, title: "G" });

    const first = await repo.ingestEvidence({
      ownerId: OWNER_A,
      goalId: g.id,
      emitterId: EMITTER_A,
      kind: "git_commit",
      sourceEventId: "sha-123",
      occurredAt: "2026-06-09T00:00:00.000Z",
    });
    const replay = await repo.ingestEvidence({
      ownerId: OWNER_A,
      goalId: g.id,
      emitterId: EMITTER_A,
      kind: "git_commit",
      sourceEventId: "sha-123",
      occurredAt: "2026-06-09T01:00:00.000Z", // later replay, same key
    });

    expect(replay.id).toBe(first.id);
    expect(repo.listEvidence(g.id)).toHaveLength(1);
  });

  it("appends a new row each time when source_event_id is null", async () => {
    const repo = makeRepo();
    const g = await repo.createGoal({ ownerId: OWNER_A, title: "G" });
    await repo.ingestEvidence({
      ownerId: OWNER_A,
      goalId: g.id,
      kind: "note",
      sourceEventId: null,
      occurredAt: "2026-06-09T00:00:00.000Z",
    });
    await repo.ingestEvidence({
      ownerId: OWNER_A,
      goalId: g.id,
      kind: "note",
      sourceEventId: null,
      occurredAt: "2026-06-09T00:00:01.000Z",
    });
    expect(repo.listEvidence(g.id)).toHaveLength(2);
  });

  it("rejects evidence whose emitter belongs to another owner", async () => {
    const repo = makeRepo();
    repo.registerEmitter(EMITTER_A, OWNER_B); // emitter owned by B
    const g = await repo.createGoal({ ownerId: OWNER_A, title: "G" });
    await expect(
      repo.ingestEvidence({
        ownerId: OWNER_A,
        goalId: g.id,
        emitterId: EMITTER_A,
        kind: "git_commit",
        sourceEventId: "sha-1",
        occurredAt: "2026-06-09T00:00:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "emitter_owner_mismatch" });
  });
});

describe("invariant — milestone_completions unique by milestone_id", () => {
  it("rejects completing the same milestone twice", () => {
    const repo = makeRepo();
    repo.recordCompletion(completion("c-1", "m-1", OWNER_A));
    expect(() => repo.recordCompletion(completion("c-2", "m-1", OWNER_A))).toMatchInvariant(
      "milestone_completion_unique",
    );
    expect(repo.getCompletion("m-1")?.id).toBe("c-1");
  });
});

// ── factory helpers ─────────────────────────────────────────────────────────

function milestone(goalId: string, ownerId: string, title: string, order: number) {
  return {
    id: "",
    goal_id: goalId,
    owner_id: ownerId,
    title,
    description: "",
    status: "pending" as const,
    order_index: order,
    depends_on_id: null,
    acceptance_rule: {
      logic: "all" as const,
      clauses: [
        { evaluator: "commit_pattern" as const, auto_verifiable: true, match: {} },
      ],
      threshold: 1,
      completion_mode: "auto_then_confirm" as const,
    },
    xp_reward: 10,
    completed_at: null,
    metadata: {},
  };
}

function completion(id: string, milestoneId: string, ownerId: string): MilestoneCompletion {
  return {
    id,
    milestone_id: milestoneId,
    owner_id: ownerId,
    decided_by: "rule_auto",
    triggering_evidence_ids: [],
    awarded_xp: 10,
  };
}

// Small custom matcher so the completion test reads cleanly.
expect.extend({
  toMatchInvariant(received: () => unknown, code: string) {
    try {
      received();
      return { pass: false, message: () => `expected an InvariantError(${code}) to be thrown` };
    } catch (err) {
      const ok = err instanceof InvariantError && err.code === code;
      return {
        pass: ok,
        message: () =>
          ok
            ? `expected not to throw InvariantError(${code})`
            : `expected InvariantError(${code}), got ${String(err)}`,
      };
    }
  },
});

declare module "vitest" {
  interface Assertion {
    toMatchInvariant(code: string): void;
  }
}
