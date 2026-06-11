import { describe, expect, it } from "vitest";

import type { Collectible, MilestoneCompletion, Notification, Pet } from "@core/types";

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

  it("listInbox only returns agent_inbox notifications for the owner, filtered by since", async () => {
    const repo = makeRepo();
    repo.addNotification(notification(OWNER_A, ["agent_inbox"], "2026-06-01T00:00:00.000Z"));
    repo.addNotification(notification(OWNER_A, ["in_app"], "2026-06-02T00:00:00.000Z")); // wrong channel
    repo.addNotification(notification(OWNER_B, ["agent_inbox"], "2026-06-03T00:00:00.000Z")); // wrong owner
    repo.addNotification(notification(OWNER_A, ["agent_inbox"], "2026-06-05T00:00:00.000Z"));

    const all = await repo.listInbox(OWNER_A);
    expect(all).toHaveLength(2);

    const since = await repo.listInbox(OWNER_A, "2026-06-04T00:00:00.000Z");
    expect(since).toHaveLength(1);
    expect(since[0]?.created_at).toBe("2026-06-05T00:00:00.000Z");
  });

  it("listNotifications only returns in_app notifications for the owner, newest first, limited", async () => {
    const repo = makeRepo();
    repo.addNotification(notification(OWNER_A, ["in_app"], "2026-06-01T00:00:00.000Z"));
    repo.addNotification(notification(OWNER_A, ["agent_inbox"], "2026-06-02T00:00:00.000Z")); // wrong channel
    repo.addNotification(notification(OWNER_B, ["in_app"], "2026-06-03T00:00:00.000Z")); // wrong owner
    repo.addNotification(notification(OWNER_A, ["in_app", "agent_inbox"], "2026-06-05T00:00:00.000Z"));

    const all = await repo.listNotifications(OWNER_A);
    expect(all.map((n) => n.created_at)).toEqual([
      "2026-06-05T00:00:00.000Z",
      "2026-06-01T00:00:00.000Z",
    ]);

    const limited = await repo.listNotifications(OWNER_A, 1);
    expect(limited).toHaveLength(1);
    expect(limited[0]?.created_at).toBe("2026-06-05T00:00:00.000Z");
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

describe("invariant — one pet per goal", () => {
  it("rejects a second pet for the same goal", async () => {
    const repo = makeRepo();
    const g = await repo.createGoal({ ownerId: OWNER_A, title: "G" });
    repo.upsertPet(pet("pet-1", OWNER_A, g.id));
    expect(() => repo.upsertPet(pet("pet-2", OWNER_A, g.id))).toThrow(InvariantError);
    expect((await repo.getPet(g.id))?.id).toBe("pet-1");
  });

  it("upserting the same pet id updates in place", async () => {
    const repo = makeRepo();
    const g = await repo.createGoal({ ownerId: OWNER_A, title: "G" });
    repo.upsertPet(pet("pet-1", OWNER_A, g.id));
    repo.upsertPet({ ...pet("pet-1", OWNER_A, g.id), xp: 50, stage: "baby" });
    const p = await repo.getPet(g.id);
    expect(p?.xp).toBe(50);
    expect(p?.stage).toBe("baby");
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

describe("listCollectibles", () => {
  it("isolates by owner and sorts newest first", async () => {
    const repo = makeRepo();
    repo.addCollectible(collectible("col-1", OWNER_A, "2026-06-01T00:00:00.000Z"));
    repo.addCollectible(collectible("col-2", OWNER_A, "2026-06-03T00:00:00.000Z"));
    repo.addCollectible(collectible("col-3", OWNER_B, "2026-06-02T00:00:00.000Z"));
    const out = await repo.listCollectibles(OWNER_A);
    expect(out.map((c) => c.id)).toEqual(["col-2", "col-1"]);
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
    rarity: "common" as const,
    completed_at: null,
    metadata: {},
  };
}

function pet(id: string, ownerId: string, goalId: string): Pet {
  return {
    id,
    owner_id: ownerId,
    goal_id: goalId,
    species: "default",
    branch: "unset",
    stage: "egg",
    xp: 0,
    mood: 0.7,
    sprite_set: "default",
  };
}

function collectible(id: string, ownerId: string, mintedAt: string): Collectible {
  return {
    id,
    owner_id: ownerId,
    goal_id: null,
    milestone_id: null,
    kind: "milestone_badge",
    rarity: "common",
    metadata: {},
    image_url: null,
    minted_at: mintedAt,
  };
}

function notification(
  ownerId: string,
  channels: Notification["channels"],
  createdAt: string,
): Notification {
  return {
    id: `n-${createdAt}`,
    owner_id: ownerId,
    trigger: "milestone_done",
    channels,
    dedup_key: null,
    ref_goal_id: null,
    ref_milestone_id: null,
    persona_msg: "",
    status: "queued",
    created_at: createdAt,
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
    minted_collectible_id: null,
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
