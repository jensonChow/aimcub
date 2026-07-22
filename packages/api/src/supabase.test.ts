import { describe, expect, it } from "vitest";

import type { Evidence, Goal } from "@aimcub/types";

import type { AimcubRepo } from "./contract.js";
import {
  SupabaseAimcubRepo,
  createSupabaseRepo,
  RepoError,
  type PostgrestResult,
  type SupabaseLike,
} from "./supabase.js";
import { FakeSupabase, type RecordedCall } from "./test/fake-supabase.js";

const OWNER = "00000000-0000-0000-0000-00000000000a";
const GOAL = "20000000-0000-0000-0000-000000000001";
const EMITTER = "30000000-0000-0000-0000-000000000001";

function ok<T>(data: T): PostgrestResult<unknown> {
  return { data, error: null };
}

describe("SupabaseAimcubRepo — structural conformance", () => {
  it("satisfies the AimcubRepo contract", () => {
    const repo: AimcubRepo = new SupabaseAimcubRepo(new FakeSupabase(), new FakeSupabase());
    expect(typeof repo.createGoal).toBe("function");
    expect(typeof repo.ingestEvidence).toBe("function");
  });

  it("createSupabaseRepo builds two clients from config (anon + service_role)", () => {
    const seen: Array<{ url: string; key: string }> = [];
    const factory = (url: string, key: string): SupabaseLike => {
      seen.push({ url, key });
      return new FakeSupabase();
    };
    const repo = createSupabaseRepo(
      { url: "https://x.supabase.co", anonKey: "anon", serviceRoleKey: "service" },
      factory,
    );
    expect(repo).toBeInstanceOf(SupabaseAimcubRepo);
    expect(seen.map((s) => s.key)).toEqual(["anon", "service"]);
  });
});

describe("user path issues RLS-bound queries on the user client", () => {
  it("createGoal inserts into goals on the USER client and returns the row", async () => {
    const user = new FakeSupabase({
      respond: () => ok<Goal>(goalRow()),
    });
    const server = new FakeSupabase();
    const repo = new SupabaseAimcubRepo(user, server);

    const goal = await repo.createGoal({ ownerId: OWNER, title: "Ship v1" });
    expect(goal.id).toBe(GOAL);

    // It hit the user client, not the server client.
    expect(server.calls).toHaveLength(0);
    const call = user.calls[0] as RecordedCall;
    expect(call.table).toBe("goals");
    expect(call.op).toBe("insert");
    expect(call.terminal).toBe("single");
    expect(call.values).toMatchObject({ owner_id: OWNER, title: "Ship v1", domain: "software" });
  });

  it("listGoals filters by owner and orders by created_at desc on the user client", async () => {
    const user = new FakeSupabase({ respond: () => ok<Goal[]>([goalRow()]) });
    const repo = new SupabaseAimcubRepo(user, new FakeSupabase());
    const out = await repo.listGoals(OWNER);
    expect(out).toHaveLength(1);

    const call = user.calls[0] as RecordedCall;
    expect(call.table).toBe("goals");
    expect(call.op).toBe("select");
    expect(call.filters).toContainEqual({ kind: "eq", column: "owner_id", value: OWNER });
    expect(call.modifiers).toContainEqual({
      kind: "order",
      args: ["created_at", { ascending: false }],
    });
  });

  it("getGoal uses maybeSingle so a missing row is null, not an error", async () => {
    const user = new FakeSupabase({ respond: () => ok<Goal | null>(null) });
    const repo = new SupabaseAimcubRepo(user, new FakeSupabase());
    expect(await repo.getGoal(GOAL)).toBeNull();
    expect((user.calls[0] as RecordedCall).terminal).toBe("maybeSingle");
  });

  it("updateGoalPlan writes the plan snapshot and optional metadata on the user client", async () => {
    const user = new FakeSupabase({
      respond: () =>
        ok<Goal>({
          ...goalRow(),
          status: "active",
          plan_json: { nodes: [] },
          metadata: { plan_quality: { grade: "pass", score: 100, issues: [] } },
        }),
    });
    const repo = new SupabaseAimcubRepo(user, new FakeSupabase());

    const updated = await repo.updateGoalPlan(GOAL, { nodes: [] }, "active", {
      plan_quality: { grade: "pass", score: 100, issues: [] },
    });

    expect(updated.status).toBe("active");
    const call = user.calls[0] as RecordedCall;
    expect(call.table).toBe("goals");
    expect(call.op).toBe("update");
    expect(call.values).toMatchObject({
      plan_json: { nodes: [] },
      status: "active",
      metadata: { plan_quality: { grade: "pass", score: 100 } },
    });
    expect(call.filters).toContainEqual({ kind: "eq", column: "id", value: GOAL });
    expect(call.terminal).toBe("single");
  });
});

describe("server path uses the service_role client (bypasses RLS)", () => {
  it("insertMilestones writes on the SERVER client", async () => {
    const user = new FakeSupabase();
    const server = new FakeSupabase({ respond: () => ok([{}]) });
    const repo = new SupabaseAimcubRepo(user, server);
    await repo.insertMilestones([
      {
        id: "m-1",
        goal_id: GOAL,
        owner_id: OWNER,
        title: "M",
        description: "",
        status: "pending",
        order_index: 0,
        depends_on_id: null,
        acceptance_rule: {
          logic: "all",
          clauses: [{ evaluator: "ci_status", auto_verifiable: true, match: { conclusion: "success" } }],
          threshold: 1,
          completion_mode: "auto_then_confirm",
        },
        xp_reward: 10,
        completed_at: null,
        metadata: {},
      },
    ]);
    expect(user.calls).toHaveLength(0);
    expect((server.calls[0] as RecordedCall).table).toBe("milestones");
    expect((server.calls[0] as RecordedCall).op).toBe("insert");
  });

  it("insertMilestones short-circuits on an empty array (no query)", async () => {
    const server = new FakeSupabase();
    const repo = new SupabaseAimcubRepo(new FakeSupabase(), server);
    expect(await repo.insertMilestones([])).toEqual([]);
    expect(server.calls).toHaveLength(0);
  });

  it("ingestEvidence with an idempotency key upserts with onConflict + ignoreDuplicates", async () => {
    // Upsert returns the freshly-inserted row.
    const server = new FakeSupabase({
      respond: (call) => (call.op === "upsert" ? ok<Evidence[]>([evidenceRow()]) : ok(null)),
    });
    const repo = new SupabaseAimcubRepo(new FakeSupabase(), server);
    const ev = await repo.ingestEvidence({
      ownerId: OWNER,
      goalId: GOAL,
      emitterId: EMITTER,
      kind: "git_commit",
      sourceEventId: "sha-1",
      occurredAt: "2026-06-09T00:00:00.000Z",
    });
    expect(ev.source_event_id).toBe("sha-1");

    const upsert = server.calls.find((c) => c.op === "upsert") as RecordedCall;
    expect(upsert.table).toBe("evidence");
    expect(upsert.upsertOpts).toEqual({
      onConflict: "emitter_id,source_event_id",
      ignoreDuplicates: true,
    });
  });

  it("ingestEvidence re-selects the canonical row when upsert ignores a duplicate", async () => {
    let upsertCount = 0;
    const server = new FakeSupabase({
      respond: (call) => {
        if (call.op === "upsert") {
          upsertCount++;
          return ok<Evidence[]>([]); // duplicate ignored → no row returned
        }
        // the follow-up select(...).single()
        return ok<Evidence>(evidenceRow());
      },
    });
    const repo = new SupabaseAimcubRepo(new FakeSupabase(), server);
    const ev = await repo.ingestEvidence({
      ownerId: OWNER,
      goalId: GOAL,
      emitterId: EMITTER,
      kind: "git_commit",
      sourceEventId: "sha-dup",
      occurredAt: "2026-06-09T00:00:00.000Z",
    });
    expect(upsertCount).toBe(1);
    expect(ev.id).toBe(evidenceRow().id);

    const reselect = server.calls.find((c) => c.op === "select") as RecordedCall;
    expect(reselect.filters).toContainEqual({ kind: "eq", column: "emitter_id", value: EMITTER });
    expect(reselect.filters).toContainEqual({
      kind: "eq",
      column: "source_event_id",
      value: "sha-dup",
    });
  });

  it("ingestEvidence without an idempotency key does a plain append insert", async () => {
    const server = new FakeSupabase({ respond: () => ok<Evidence>(evidenceRow()) });
    const repo = new SupabaseAimcubRepo(new FakeSupabase(), server);
    await repo.ingestEvidence({
      ownerId: OWNER,
      goalId: GOAL,
      kind: "note",
      sourceEventId: null,
      occurredAt: "2026-06-09T00:00:00.000Z",
    });
    const call = server.calls[0] as RecordedCall;
    expect(call.op).toBe("insert");
    expect(call.terminal).toBe("single");
  });
});

describe("error mapping", () => {
  it("wraps PostgREST errors in RepoError with the SQLSTATE code", async () => {
    const user = new FakeSupabase({
      respond: () => ({ data: null, error: { message: "boom", code: "42501" } }),
    });
    const repo = new SupabaseAimcubRepo(user, new FakeSupabase());
    await expect(repo.listGoals(OWNER)).rejects.toBeInstanceOf(RepoError);
    await expect(repo.listGoals(OWNER)).rejects.toMatchObject({ code: "42501" });
  });
});

// ── canned rows ──────────────────────────────────────────────────────────────

function goalRow(): Goal {
  return {
    id: GOAL,
    owner_id: OWNER,
    title: "Ship v1",
    description: "",
    domain: "software",
    status: "draft",
    target_date: null,
    plan_json: null,
    metadata: {},
    created_at: "2026-06-09T00:00:00.000Z",
  };
}

function evidenceRow(): Evidence {
  return {
    id: "40000000-0000-0000-0000-000000000001",
    owner_id: OWNER,
    goal_id: GOAL,
    milestone_id: null,
    emitter_id: EMITTER,
    kind: "git_commit",
    source_event_id: "sha-1",
    occurred_at: "2026-06-09T00:00:00.000Z",
    summary: "",
    payload: {},
    trust_score: 1,
    created_at: "2026-06-09T00:00:00.000Z",
  };
}
