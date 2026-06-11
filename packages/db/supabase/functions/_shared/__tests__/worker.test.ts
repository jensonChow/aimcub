/**
 * Unit tests for the pure jobs-worker handlers (`runJob`):
 *   - v1a `judge_evidence`
 *   - v1b `grow_pet` / `mint_collectible` / `deliver_notification`
 *
 * Decoupling: a LOCAL in-memory repo (memory-repo.ts) implements the ports — no
 * import of `@core/api-client`. The @core `evaluate()` kernel and
 * `AUTO_VERIFY_MIN_TRUST` are the real ones (imported from `@core/domain`).
 * sha256 comes from node:crypto here (the db package is not the pure kernel) —
 * the same digest the live Deno entry injects.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AUTO_VERIFY_MIN_TRUST, planMint } from "@core/domain";
import type {
  AcceptanceRule,
  CompletionMode,
  Evidence,
  Goal,
  Job,
  JobType,
  Milestone,
  MilestoneCompletion,
  Notification,
  Pet,
  Rarity,
} from "@core/types";
import type { CelebrationContext, PersonaMessageGenerator } from "../ports.ts";
import { fallbackCelebrationMessage } from "../persona.ts";
import {
  followUpDedupKey,
  notificationDedupKey,
  runJob,
  type WorkerDeps,
} from "../worker.ts";
import { createMemoryRepo, type MemoryRepo } from "./memory-repo.ts";

const FIXED_NOW = new Date("2026-06-09T12:00:00.000Z");
const OWNER = "00000000-0000-4000-8000-000000000001";
const GOAL = "00000000-0000-4000-8000-0000000000b1";
const MILESTONE = "00000000-0000-4000-8000-0000000000c1";

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function depsWith(repo: MemoryRepo, personaMessage?: PersonaMessageGenerator): WorkerDeps {
  return { repo, now: () => FIXED_NOW, hashHex: sha256Hex, personaMessage };
}

/** A commit_pattern rule that auto-completes; clauses are auto_verifiable by default. */
function commitRule(mode: CompletionMode): AcceptanceRule {
  return {
    logic: "all",
    threshold: 1,
    completion_mode: mode,
    clauses: [
      {
        evaluator: "commit_pattern",
        auto_verifiable: true,
        match: { message_pattern: "feat" },
      },
    ],
  };
}

function milestone(rule: AcceptanceRule, xp = 25): Milestone {
  return {
    id: MILESTONE,
    goal_id: GOAL,
    owner_id: OWNER,
    title: "Ship the login flow",
    description: "",
    status: "in_progress",
    order_index: 0,
    depends_on_id: null,
    acceptance_rule: rule,
    xp_reward: xp,
    rarity: "common",
    completed_at: null,
    metadata: {},
  };
}

function commitEvidence(trust: number, id: string): Evidence {
  return {
    id,
    owner_id: OWNER,
    goal_id: GOAL,
    milestone_id: MILESTONE,
    emitter_id: "00000000-0000-4000-8000-0000000000a1",
    kind: "git_commit",
    source_event_id: id,
    occurred_at: FIXED_NOW.toISOString(),
    summary: "feat: login",
    payload: { sha: id, message: "feat: login", files: ["src/login.ts"] },
    trust_score: trust,
    created_at: FIXED_NOW.toISOString(),
  };
}

function judgeJob(milestoneId: string | null = MILESTONE): Job {
  return {
    id: "00000000-0000-4000-8000-0000000000f1",
    type: "judge_evidence",
    payload: { milestone_id: milestoneId, owner_id: OWNER, goal_id: GOAL },
    status: "running",
    dedup_key: "judge:e1",
    run_after: FIXED_NOW.toISOString(),
    attempts: 1,
    last_error: null,
    created_at: FIXED_NOW.toISOString(),
  };
}

describe("runJob — judge_evidence auto-completes on trusted evidence", () => {
  it("writes a rule_auto completion carrying the milestone xp and enqueues follow-ups", async () => {
    const repo = createMemoryRepo(() => FIXED_NOW);
    repo.seedMilestone(milestone(commitRule("auto"), 25));
    repo.seedEvidenceForMilestone(MILESTONE, [commitEvidence(1.0, "ev-trusted")]);

    const outcome = await runJob(depsWith(repo), judgeJob());

    expect(outcome.kind).toBe("completed");
    if (outcome.kind !== "completed") return;
    expect(outcome.created).toBe(true);
    expect(outcome.completion.decided_by).toBe("rule_auto");
    expect(outcome.completion.awarded_xp).toBe(25); // from the milestone, not the caller
    expect(outcome.completion.triggering_evidence_ids).toContain("ev-trusted");

    // exactly one completion persisted
    expect(repo.state.completions).toHaveLength(1);

    // follow-up jobs enqueued with deterministic dedup keys
    const types = repo.state.jobs.map((j) => j.type).sort();
    expect(types).toEqual(["deliver_notification", "grow_pet", "mint_collectible"]);
    const grow = repo.state.jobs.find((j) => j.type === "grow_pet")!;
    expect(grow.dedup_key).toBe(followUpDedupKey("grow_pet", outcome.completion.id));
    expect(grow.payload.awarded_xp).toBe(25);
  });
});

describe("runJob — anti-spoofing: does NOT auto-complete on low-trust evidence", () => {
  it("rejects an unverified commit (0.7 < AUTO_VERIFY_MIN_TRUST 0.8) against an auto_verifiable clause", async () => {
    expect(AUTO_VERIFY_MIN_TRUST).toBe(0.8); // contract anchor
    const repo = createMemoryRepo(() => FIXED_NOW);
    repo.seedMilestone(milestone(commitRule("auto")));
    repo.seedEvidenceForMilestone(MILESTONE, [commitEvidence(0.7, "ev-weak")]);

    const outcome = await runJob(depsWith(repo), judgeJob());

    expect(outcome.kind).toBe("evaluated");
    if (outcome.kind !== "evaluated") return;
    expect(outcome.passed).toBe(false);
    expect(outcome.completed).toBe(false);
    expect(repo.state.completions).toHaveLength(0);
    expect(repo.state.jobs).toHaveLength(0); // no follow-ups
  });
});

describe("runJob — completion_mode gating", () => {
  it("does not auto-complete a manual milestone even when the rule passes", async () => {
    const repo = createMemoryRepo(() => FIXED_NOW);
    repo.seedMilestone(milestone(commitRule("manual")));
    repo.seedEvidenceForMilestone(MILESTONE, [commitEvidence(1.0, "ev-trusted")]);

    const outcome = await runJob(depsWith(repo), judgeJob());

    expect(outcome.kind).toBe("evaluated");
    if (outcome.kind !== "evaluated") return;
    expect(outcome.passed).toBe(true);
    expect(outcome.completed).toBe(false);
    expect(repo.state.completions).toHaveLength(0);
  });

  it("auto-completes auto_then_confirm milestones (auto path is allowed)", async () => {
    const repo = createMemoryRepo(() => FIXED_NOW);
    repo.seedMilestone(milestone(commitRule("auto_then_confirm")));
    repo.seedEvidenceForMilestone(MILESTONE, [commitEvidence(1.0, "ev-trusted")]);

    const outcome = await runJob(depsWith(repo), judgeJob());
    expect(outcome.kind).toBe("completed");
  });
});

describe("runJob — idempotency & guards", () => {
  it("does not double-write or double-award when a milestone is already completed", async () => {
    const repo = createMemoryRepo(() => FIXED_NOW);
    repo.seedMilestone(milestone(commitRule("auto"), 25));
    repo.seedEvidenceForMilestone(MILESTONE, [commitEvidence(1.0, "ev-trusted")]);

    const first = await runJob(depsWith(repo), judgeJob());
    expect(first.kind).toBe("completed");

    // Re-judge the same milestone (e.g. a duplicate/raced job).
    const second = await runJob(depsWith(repo), judgeJob());
    expect(second.kind).toBe("skipped");

    expect(repo.state.completions).toHaveLength(1);
    // follow-ups enqueued only once
    expect(repo.state.jobs.filter((j) => j.type === "grow_pet")).toHaveLength(1);
  });

  it("skips goal-level evidence when the goal has no open milestones", async () => {
    const repo = createMemoryRepo(() => FIXED_NOW);
    const outcome = await runJob(depsWith(repo), judgeJob(null));
    expect(outcome.kind).toBe("skipped");
  });

  it("skips when the milestone does not exist", async () => {
    const repo = createMemoryRepo(() => FIXED_NOW);
    const outcome = await runJob(depsWith(repo), judgeJob());
    expect(outcome.kind).toBe("skipped");
  });

  it("does not complete when the rule is not satisfied (no matching evidence)", async () => {
    const repo = createMemoryRepo(() => FIXED_NOW);
    repo.seedMilestone(milestone(commitRule("auto")));
    repo.seedEvidenceForMilestone(MILESTONE, []); // no evidence at all
    const outcome = await runJob(depsWith(repo), judgeJob());
    expect(outcome.kind).toBe("evaluated");
    if (outcome.kind === "evaluated") expect(outcome.passed).toBe(false);
  });

  it("returns an error for a structurally invalid acceptance_rule", async () => {
    const repo = createMemoryRepo(() => FIXED_NOW);
    // clauses must have >= 1 entry; an empty rule is invalid per the schema.
    const bad = { logic: "all", threshold: 1, completion_mode: "auto", clauses: [] } as unknown as AcceptanceRule;
    repo.seedMilestone(milestone(bad));
    repo.seedEvidenceForMilestone(MILESTONE, [commitEvidence(1.0, "ev")]);
    const outcome = await runJob(depsWith(repo), judgeJob());
    expect(outcome.kind).toBe("error");
  });
});

describe("runJob — goal-level fan-out (webhook pushes name no milestone)", () => {
  const MILESTONE_2 = "00000000-0000-4000-8000-0000000000c2";

  it("judges every open milestone of the goal and completes only the satisfied ones", async () => {
    const repo = createMemoryRepo(() => FIXED_NOW);
    // m1: commit rule, satisfied by trusted evidence.
    repo.seedMilestone(milestone(commitRule("auto"), 25));
    repo.seedEvidenceForMilestone(MILESTONE, [commitEvidence(1.0, "ev-trusted")]);
    // m2: ci rule, no matching evidence — must stay open.
    const ciRule: AcceptanceRule = {
      logic: "all",
      threshold: 1,
      completion_mode: "auto",
      clauses: [{ evaluator: "ci_status", auto_verifiable: true, match: { conclusion: "success" } }],
    };
    repo.seedMilestone({ ...milestone(ciRule), id: MILESTONE_2 });

    const outcome = await runJob(depsWith(repo), judgeJob(null));

    expect(outcome.kind).toBe("fanout");
    if (outcome.kind !== "fanout") return;
    expect(outcome.judged).toBe(2);
    expect(outcome.completed).toBe(1);
    expect(repo.state.completions).toHaveLength(1);
    expect(repo.state.completions[0]!.milestone_id).toBe(MILESTONE);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// v1b — grow_pet / mint_collectible / deliver_notification
// ────────────────────────────────────────────────────────────────────────────

const M1 = "00000000-0000-4000-8000-00000000d001";
const M2 = "00000000-0000-4000-8000-00000000d002";
const M3 = "00000000-0000-4000-8000-00000000d003";
const C1 = "00000000-0000-4000-8000-00000000e001";
const C2 = "00000000-0000-4000-8000-00000000e002";

function goalRow(status: Goal["status"] = "active"): Goal {
  return {
    id: GOAL,
    owner_id: OWNER,
    title: "Launch Aimcub v1b",
    description: "",
    domain: "software",
    status,
    target_date: null,
    plan_json: null,
    metadata: {},
    created_at: FIXED_NOW.toISOString(),
  };
}

function v1bMilestone(
  id: string,
  opts: { status?: Milestone["status"]; xp?: number; rarity?: Rarity; title?: string } = {},
): Milestone {
  return {
    ...milestone(commitRule("auto"), opts.xp ?? 50),
    id,
    title: opts.title ?? "Ship the login flow",
    status: opts.status ?? "completed",
    rarity: opts.rarity ?? "common",
  };
}

function completionRow(
  id: string,
  milestoneId: string,
  xp: number,
  minted: string | null = null,
): MilestoneCompletion {
  return {
    id,
    milestone_id: milestoneId,
    owner_id: OWNER,
    decided_by: "rule_auto",
    triggering_evidence_ids: [],
    awarded_xp: xp,
    minted_collectible_id: minted,
    created_at: FIXED_NOW.toISOString(),
  };
}

function followUpJob(type: JobType, completionId: string, milestoneId: string): Job {
  return {
    id: "00000000-0000-4000-8000-0000000000f2",
    type,
    payload: {
      completion_id: completionId,
      milestone_id: milestoneId,
      owner_id: OWNER,
      goal_id: GOAL,
    },
    status: "running",
    dedup_key: followUpDedupKey(type as never, completionId),
    run_after: FIXED_NOW.toISOString(),
    attempts: 1,
    last_error: null,
    created_at: FIXED_NOW.toISOString(),
  };
}

function nudgeRow(n: number): Notification {
  return {
    id: `00000000-0000-4000-8000-00000000a${String(n).padStart(3, "0")}`,
    owner_id: OWNER,
    trigger: "stale",
    channels: ["in_app"],
    dedup_key: `nudge:${n}`,
    ref_goal_id: GOAL,
    ref_milestone_id: null,
    persona_msg: "psst",
    status: "sent",
    scheduled_for: FIXED_NOW.toISOString(),
    created_at: FIXED_NOW.toISOString(),
  };
}

describe("runJob — grow_pet recomputes derived pet state from the completion stream", () => {
  it("retro-backfills a pet from completions that predate the pet row", async () => {
    const repo = createMemoryRepo(() => FIXED_NOW);
    repo.seedGoal(goalRow());
    repo.seedMilestone(v1bMilestone(M1, { xp: 60 }));
    repo.seedMilestone(v1bMilestone(M2, { xp: 60 }));
    repo.seedCompletion(completionRow(C1, M1, 60));
    repo.seedCompletion(completionRow(C2, M2, 60));

    const outcome = await runJob(depsWith(repo), followUpJob("grow_pet", C2, M2));

    expect(outcome.kind).toBe("pet_grown");
    if (outcome.kind !== "pet_grown") return;
    expect(outcome.pet.xp).toBe(120); // Σ awarded_xp, recomputed from source
    expect(outcome.pet.stage).toBe("baby"); // 120 ≥ 100
    expect(outcome.pet.goal_id).toBe(GOAL);
    expect(outcome.pet.owner_id).toBe(OWNER);
    expect(outcome.stagedUp).toBe(true); // egg (no row) → baby
    expect(repo.state.pets).toHaveLength(1);
  });

  it("is idempotent: a second run lands on the same xp with no duplicate pet", async () => {
    const repo = createMemoryRepo(() => FIXED_NOW);
    repo.seedGoal(goalRow());
    repo.seedMilestone(v1bMilestone(M1, { xp: 60 }));
    repo.seedMilestone(v1bMilestone(M2, { xp: 60 }));
    repo.seedCompletion(completionRow(C1, M1, 60));
    repo.seedCompletion(completionRow(C2, M2, 60));

    const first = await runJob(depsWith(repo), followUpJob("grow_pet", C2, M2));
    const second = await runJob(depsWith(repo), followUpJob("grow_pet", C2, M2));

    expect(first.kind).toBe("pet_grown");
    expect(second.kind).toBe("pet_grown");
    if (second.kind !== "pet_grown") return;
    expect(second.pet.xp).toBe(120); // recompute, never increment
    expect(second.stagedUp).toBe(false); // stored 120 → recomputed 120
    expect(repo.state.pets).toHaveLength(1); // goal_id UNIQUE upsert
  });

  it("stays an egg below the first threshold (no false stage-up)", async () => {
    const repo = createMemoryRepo(() => FIXED_NOW);
    repo.seedGoal(goalRow());
    repo.seedMilestone(v1bMilestone(M1, { xp: 25 }));
    repo.seedCompletion(completionRow(C1, M1, 25));

    const outcome = await runJob(depsWith(repo), followUpJob("grow_pet", C1, M1));
    expect(outcome.kind).toBe("pet_grown");
    if (outcome.kind !== "pet_grown") return;
    expect(outcome.pet.stage).toBe("egg");
    expect(outcome.stagedUp).toBe(false);
  });

  it("skips when the goal does not exist", async () => {
    const repo = createMemoryRepo(() => FIXED_NOW);
    const outcome = await runJob(depsWith(repo), followUpJob("grow_pet", C1, M1));
    expect(outcome.kind).toBe("skipped");
  });

  it("a stale concurrent recompute can never regress the pet (monotonic upsert)", async () => {
    const repo = createMemoryRepo(() => FIXED_NOW);
    repo.seedGoal(goalRow());
    repo.seedMilestone(v1bMilestone(M1, { xp: 60 }));
    repo.seedCompletion(completionRow(C1, M1, 60));
    // A fresher invocation already materialized a higher xp (it read the stream
    // AFTER a later completion landed); this run's recompute is stale (60).
    repo.seedPet({
      id: "00000000-0000-4000-8000-000000000aa2",
      owner_id: OWNER,
      goal_id: GOAL,
      species: "default",
      branch: "unset",
      stage: "baby",
      xp: 120,
      mood: 0.7,
      sprite_set: "default",
      updated_at: FIXED_NOW.toISOString(),
    });

    const outcome = await runJob(depsWith(repo), followUpJob("grow_pet", C1, M1));

    expect(outcome.kind).toBe("pet_grown");
    if (outcome.kind !== "pet_grown") return;
    expect(outcome.pet.xp).toBe(120); // greatest(stored, recomputed) — no regression
    expect(outcome.pet.stage).toBe("baby");
    expect(outcome.stagedUp).toBe(false); // no phantom transition reported
    expect(repo.state.pets).toHaveLength(1);
  });
});

describe("runJob — mint_collectible (floor rarity, seeded shiny, anchored idempotence)", () => {
  function seedOneDone(repo: MemoryRepo, rarity: Rarity = "rare") {
    repo.seedGoal(goalRow());
    repo.seedMilestone(v1bMilestone(M1, { rarity, xp: 40 }));
    repo.seedMilestone(v1bMilestone(M2, { status: "pending" }));
    repo.seedCompletion(completionRow(C1, M1, 40));
  }

  it("mints exactly the pure plan (floor = milestone rarity) and backfills the anchor", async () => {
    const repo = createMemoryRepo(() => FIXED_NOW);
    seedOneDone(repo, "rare");

    const outcome = await runJob(depsWith(repo), followUpJob("mint_collectible", C1, M1));

    expect(outcome.kind).toBe("minted");
    if (outcome.kind !== "minted") return;
    expect(outcome.goalCompleted).toBe(false); // M2 still pending
    expect(outcome.trophy).toBeNull();
    const badge = outcome.collectible!;
    expect(badge.kind).toBe("milestone_badge");

    // The badge must equal the pure plan seeded by sha256(completion.id).
    const expected = planMint(completionRow(C1, M1, 40), v1bMilestone(M1, { rarity: "rare", xp: 40 }), {
      goalTitle: goalRow().title,
      hashHex: sha256Hex,
    });
    expect(badge.rarity).toBe(expected.rarity);
    expect(badge.metadata).toEqual(expected.metadata);
    expect(badge.metadata.goal_title).toBe("Launch Aimcub v1b");
    expect(badge.metadata.awarded_xp).toBe(40);

    // Idempotency anchor backfilled in the same logical step.
    expect(repo.state.completions[0]!.minted_collectible_id).toBe(badge.id);
    expect(repo.state.collectibles).toHaveLength(1);
  });

  it("is idempotent: a second run mints no second collectible", async () => {
    const repo = createMemoryRepo(() => FIXED_NOW);
    seedOneDone(repo);

    const first = await runJob(depsWith(repo), followUpJob("mint_collectible", C1, M1));
    const second = await runJob(depsWith(repo), followUpJob("mint_collectible", C1, M1));

    expect(first.kind).toBe("minted");
    expect(second.kind).toBe("skipped");
    expect(repo.state.collectibles).toHaveLength(1);
  });

  it("seeded roll is stable across retries (fresh repo, same completion id → same plan)", async () => {
    const run = async () => {
      const repo = createMemoryRepo(() => FIXED_NOW);
      seedOneDone(repo);
      const outcome = await runJob(depsWith(repo), followUpJob("mint_collectible", C1, M1));
      if (outcome.kind !== "minted") throw new Error(`expected minted, got ${outcome.kind}`);
      return outcome.collectible!;
    };
    const a = await run();
    const b = await run();
    expect(a.rarity).toBe(b.rarity);
    expect(a.metadata.shiny).toBe(b.metadata.shiny);
    expect(a.metadata).toEqual(b.metadata);
  });

  it("mints the goal trophy exactly once, when the last milestone completes", async () => {
    const repo = createMemoryRepo(() => FIXED_NOW);
    repo.seedGoal(goalRow());
    repo.seedMilestone(v1bMilestone(M1, { xp: 40 }));
    repo.seedMilestone(v1bMilestone(M2, { status: "pending", xp: 40, title: "Ship the final boss" }));
    repo.seedCompletion(completionRow(C1, M1, 40));

    // First milestone: badge only — M2 is still open.
    const first = await runJob(depsWith(repo), followUpJob("mint_collectible", C1, M1));
    expect(first.kind).toBe("minted");
    if (first.kind === "minted") expect(first.trophy).toBeNull();

    // Last milestone lands.
    repo.seedMilestone(v1bMilestone(M2, { status: "completed", xp: 40, title: "Ship the final boss" }));
    repo.seedCompletion(completionRow(C2, M2, 40));
    const last = await runJob(depsWith(repo), followUpJob("mint_collectible", C2, M2));

    expect(last.kind).toBe("minted");
    if (last.kind !== "minted") return;
    expect(last.goalCompleted).toBe(true);
    expect(last.trophy).not.toBeNull();
    expect(last.trophy!.kind).toBe("goal_trophy");
    expect(last.trophy!.rarity).toBe("legendary");
    expect(last.trophy!.metadata.goal_title).toBe("Launch Aimcub v1b");
    // Named after the chronologically FINAL milestone of the stream.
    expect(last.trophy!.metadata.final_milestone_title).toBe("Ship the final boss");
    expect(repo.state.goals.get(GOAL)!.status).toBe("achieved");

    // Retries (either completion's job) never mint a second trophy.
    const retryLast = await runJob(depsWith(repo), followUpJob("mint_collectible", C2, M2));
    const retryFirst = await runJob(depsWith(repo), followUpJob("mint_collectible", C1, M1));
    expect(retryLast.kind).toBe("skipped");
    expect(retryFirst.kind).toBe("skipped");
    const trophies = repo.state.collectibles.filter((c) => c.kind === "goal_trophy");
    expect(trophies).toHaveLength(1);
    expect(repo.state.collectibles).toHaveLength(3); // 2 badges + 1 trophy
  });

  it("heals a missed trophy: badge already anchored but goal not yet achieved", async () => {
    const repo = createMemoryRepo(() => FIXED_NOW);
    repo.seedGoal(goalRow("active"));
    repo.seedMilestone(v1bMilestone(M1, { xp: 40 }));
    repo.seedCompletion(
      completionRow(C1, M1, 40, "00000000-0000-4000-8000-00000000beef"),
    );

    const outcome = await runJob(depsWith(repo), followUpJob("mint_collectible", C1, M1));

    expect(outcome.kind).toBe("minted");
    if (outcome.kind !== "minted") return;
    expect(outcome.collectible).toBeNull(); // badge anchor respected — not re-minted
    expect(outcome.trophy).not.toBeNull();
    expect(repo.state.goals.get(GOAL)!.status).toBe("achieved");
  });

  it("skips when the completion does not exist yet", async () => {
    const repo = createMemoryRepo(() => FIXED_NOW);
    repo.seedGoal(goalRow());
    repo.seedMilestone(v1bMilestone(M1));
    const outcome = await runJob(depsWith(repo), followUpJob("mint_collectible", C1, M1));
    expect(outcome.kind).toBe("skipped");
    expect(repo.state.collectibles).toHaveLength(0);
  });

  it("crash-retry with a lost anchor heals: no second badge row, anchor restored (DB backstop)", async () => {
    const repo = createMemoryRepo(() => FIXED_NOW);
    seedOneDone(repo);
    const first = await runJob(depsWith(repo), followUpJob("mint_collectible", C1, M1));
    expect(first.kind).toBe("minted");

    // Simulate a crash between insertCollectible and setCompletionMinted: the
    // badge row exists but the anchor was never written.
    repo.state.completions[0]!.minted_collectible_id = null;

    const retry = await runJob(depsWith(repo), followUpJob("mint_collectible", C1, M1));
    expect(retry.kind).toBe("minted");
    if (retry.kind !== "minted") return;
    // collectibles_badge_once_idx: the "insert" resolved the SAME existing row.
    expect(repo.state.collectibles).toHaveLength(1);
    expect(retry.collectible!.id).toBe(repo.state.collectibles[0]!.id);
    expect(repo.state.completions[0]!.minted_collectible_id).toBe(
      repo.state.collectibles[0]!.id,
    );
  });

  it("derives goal completion from the stream: a stale 'pending' cache cannot block the trophy", async () => {
    const repo = createMemoryRepo(() => FIXED_NOW);
    repo.seedGoal(goalRow());
    repo.seedMilestone(v1bMilestone(M1, { xp: 40 }));
    // Crash left this milestone 'pending' even though its completion exists.
    repo.seedMilestone(
      v1bMilestone(M2, { status: "pending", xp: 40, title: "Ship the final boss" }),
    );
    repo.seedCompletion(completionRow(C1, M1, 40));
    repo.seedCompletion(completionRow(C2, M2, 40));

    const outcome = await runJob(depsWith(repo), followUpJob("mint_collectible", C2, M2));

    expect(outcome.kind).toBe("minted");
    if (outcome.kind !== "minted") return;
    expect(outcome.goalCompleted).toBe(true);
    expect(outcome.trophy).not.toBeNull();
    expect(outcome.trophy!.metadata.final_milestone_title).toBe("Ship the final boss");
    expect(repo.state.goals.get(GOAL)!.status).toBe("achieved");
  });

  it("DB backstop under a race: one trophy per goal, one CAS winner for 'achieved'", async () => {
    const repo = createMemoryRepo(() => FIXED_NOW);
    repo.seedGoal(goalRow());
    repo.seedMilestone(v1bMilestone(M1, { xp: 40 }));
    repo.seedCompletion(completionRow(C1, M1, 40));

    // Two overlapping invocations both passed the in-memory `status !== 'achieved'`
    // precheck and both reached the insert: the unique trophy index admits one.
    const write = {
      ownerId: OWNER,
      goalId: GOAL,
      milestoneId: null,
      kind: "goal_trophy" as const,
      rarity: "legendary" as Rarity,
      metadata: {},
    };
    const a = await repo.insertCollectible(write);
    const b = await repo.insertCollectible(write);
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.collectible.id).toBe(a.collectible.id);
    expect(repo.state.collectibles.filter((c) => c.kind === "goal_trophy")).toHaveLength(1);

    // setGoalAchieved is a CAS: exactly one transition winner.
    expect(await repo.setGoalAchieved(GOAL)).toBe(true);
    expect(await repo.setGoalAchieved(GOAL)).toBe(false);
  });

  it("heals a crash between the trophy insert and the achieved flip without double-minting", async () => {
    const repo = createMemoryRepo(() => FIXED_NOW);
    repo.seedGoal(goalRow("active")); // crash happened before the CAS flipped it
    repo.seedMilestone(v1bMilestone(M1, { xp: 40 }));
    repo.seedCompletion(
      completionRow(C1, M1, 40, "00000000-0000-4000-8000-00000000beef"),
    );
    // The trophy row landed before the crash.
    repo.state.collectibles.push({
      id: "00000000-0000-4000-8000-00000000cafe",
      owner_id: OWNER,
      goal_id: GOAL,
      milestone_id: null,
      kind: "goal_trophy",
      rarity: "legendary",
      metadata: { goal_title: "Launch Aimcub v1b" },
      image_url: null,
      minted_at: FIXED_NOW.toISOString(),
    });

    const retry = await runJob(depsWith(repo), followUpJob("mint_collectible", C1, M1));

    // Nothing newly minted (badge anchored, trophy unique) — but the CAS heals.
    expect(retry.kind).toBe("skipped");
    expect(repo.state.collectibles.filter((c) => c.kind === "goal_trophy")).toHaveLength(1);
    expect(repo.state.goals.get(GOAL)!.status).toBe("achieved");
  });
});

describe("runJob — deliver_notification (gated, deduped, pet-voiced)", () => {
  function seedDelivery(repo: MemoryRepo, opts: { goalDone?: boolean } = {}) {
    repo.seedGoal(goalRow());
    repo.seedMilestone(v1bMilestone(M1, { xp: 30 }));
    repo.seedMilestone(
      v1bMilestone(M2, { status: opts.goalDone ? "completed" : "pending", xp: 30 }),
    );
    repo.seedCompletion(completionRow(C1, M1, 30));
  }

  it("writes a sent milestone_done celebration on the v1b channels with a dedup key", async () => {
    const repo = createMemoryRepo(() => FIXED_NOW);
    seedDelivery(repo);

    const outcome = await runJob(depsWith(repo), followUpJob("deliver_notification", C1, M1));

    expect(outcome.kind).toBe("delivered");
    if (outcome.kind !== "delivered") return;
    expect(outcome.created).toBe(true);
    expect(outcome.channels).toEqual(["in_app", "agent_inbox"]); // email deferred
    const n = outcome.notification;
    expect(n.trigger).toBe("milestone_done");
    expect(n.status).toBe("sent");
    expect(n.dedup_key).toBe(notificationDedupKey("milestone_done", C1));
    expect(n.ref_goal_id).toBe(GOAL);
    expect(n.ref_milestone_id).toBe(M1);
    expect(n.owner_id).toBe(OWNER);
    expect(repo.state.notifications).toHaveLength(1);

    // No generator injected → deterministic in-character fallback.
    const ctx: CelebrationContext = {
      trigger: "milestone_done",
      ownerId: OWNER,
      goalTitle: "Launch Aimcub v1b",
      milestoneTitle: "Ship the login flow",
      petStage: "egg", // no pet row; 30 xp recomputed from the stream
      stagedUp: false,
      xpAwarded: 30,
      goalCompleted: false,
    };
    expect(n.persona_msg).toBe(fallbackCelebrationMessage(ctx));
  });

  it("respects dedup: a re-run delivers nothing and writes no second row", async () => {
    const repo = createMemoryRepo(() => FIXED_NOW);
    seedDelivery(repo);

    const first = await runJob(depsWith(repo), followUpJob("deliver_notification", C1, M1));
    const second = await runJob(depsWith(repo), followUpJob("deliver_notification", C1, M1));

    expect(first.kind).toBe("delivered");
    expect(second.kind).toBe("skipped");
    if (second.kind === "skipped") expect(second.reason).toContain("duplicate");
    expect(repo.state.notifications).toHaveLength(1);
  });

  it("escalates to goal_done when the completion finished the goal (deduped on the goal)", async () => {
    const repo = createMemoryRepo(() => FIXED_NOW);
    seedDelivery(repo, { goalDone: true });
    repo.seedCompletion(completionRow(C2, M2, 30));

    const outcome = await runJob(depsWith(repo), followUpJob("deliver_notification", C2, M2));

    expect(outcome.kind).toBe("delivered");
    if (outcome.kind !== "delivered") return;
    expect(outcome.notification.trigger).toBe("goal_done");
    // goal_done is scoped to the GOAL, not the completion: a goal finishes once.
    expect(outcome.notification.dedup_key).toBe(notificationDedupKey("goal_done", GOAL));
    expect(outcome.notification.persona_msg).toContain("Launch Aimcub v1b");
  });

  it("last two milestones in one batch: exactly one goal_done (the final completion) plus the other's milestone_done", async () => {
    const repo = createMemoryRepo(() => FIXED_NOW);
    repo.seedGoal(goalRow());
    repo.seedMilestone(v1bMilestone(M1, { xp: 30 }));
    repo.seedMilestone(v1bMilestone(M2, { xp: 30 }));
    // One judge fan-out completed both before any deliver job ran.
    repo.seedCompletion(completionRow(C1, M1, 30));
    repo.seedCompletion(completionRow(C2, M2, 30));

    const nonFinal = await runJob(depsWith(repo), followUpJob("deliver_notification", C1, M1));
    const final = await runJob(depsWith(repo), followUpJob("deliver_notification", C2, M2));

    // The non-final completion celebrates its own milestone — not the goal.
    expect(nonFinal.kind).toBe("delivered");
    if (nonFinal.kind === "delivered") {
      expect(nonFinal.notification.trigger).toBe("milestone_done");
      expect(nonFinal.notification.dedup_key).toBe(notificationDedupKey("milestone_done", C1));
    }
    // The chronologically final completion (tie broken by id) owns goal_done.
    expect(final.kind).toBe("delivered");
    if (final.kind === "delivered") {
      expect(final.notification.trigger).toBe("goal_done");
      expect(final.notification.dedup_key).toBe(notificationDedupKey("goal_done", GOAL));
    }
    expect(repo.state.notifications).toHaveLength(2);
    expect(repo.state.notifications.filter((n) => n.trigger === "goal_done")).toHaveLength(1);
  });

  it("celebrations are exempt from the daily nudge cap", async () => {
    const repo = createMemoryRepo(() => FIXED_NOW);
    seedDelivery(repo);
    // The user already burned 5 nudges today (cap is 2) — celebrations still land.
    for (let i = 1; i <= 5; i++) repo.seedNotification(nudgeRow(i));

    const outcome = await runJob(depsWith(repo), followUpJob("deliver_notification", C1, M1));

    expect(outcome.kind).toBe("delivered");
    if (outcome.kind !== "delivered") return;
    expect(outcome.channels).toEqual(["in_app", "agent_inbox"]);
  });

  it("uses the generated pet-voice message when the generator succeeds", async () => {
    const repo = createMemoryRepo(() => FIXED_NOW);
    seedDelivery(repo);
    const generator: PersonaMessageGenerator = async () => "Custom roar of triumph!";

    const outcome = await runJob(
      depsWith(repo, generator),
      followUpJob("deliver_notification", C1, M1),
    );

    expect(outcome.kind).toBe("delivered");
    if (outcome.kind !== "delivered") return;
    expect(outcome.notification.persona_msg).toBe("Custom roar of triumph!");
  });

  it("falls back to the deterministic message when the generator returns null or throws", async () => {
    for (const generator of [
      (async () => null) as PersonaMessageGenerator,
      (async () => {
        throw new Error("model down");
      }) as PersonaMessageGenerator,
    ]) {
      const repo = createMemoryRepo(() => FIXED_NOW);
      seedDelivery(repo);
      const outcome = await runJob(
        depsWith(repo, generator),
        followUpJob("deliver_notification", C1, M1),
      );
      expect(outcome.kind).toBe("delivered");
      if (outcome.kind !== "delivered") continue;
      expect(outcome.notification.persona_msg).toContain("Ship the login flow");
      expect(outcome.notification.persona_msg).toContain("+30 XP");
    }
  });

  it("derives stage context from the completion stream — a stale pet row cannot misname the stage", async () => {
    // deliver may run BEFORE grow_pet (queue order is not guaranteed), so the
    // materialized pet row can be one completion behind: {xp:60, stage:'egg'}
    // while this completion's +60 makes the true after-stage 'baby'. petStage
    // must be the stage AFTER this completion (the CelebrateInput contract).
    const repo = createMemoryRepo(() => FIXED_NOW);
    repo.seedGoal(goalRow());
    repo.seedMilestone(v1bMilestone(M1, { xp: 60 }));
    repo.seedMilestone(v1bMilestone(M2, { xp: 60 }));
    repo.seedMilestone(v1bMilestone(M3, { status: "pending" })); // goal still open
    repo.seedCompletion(completionRow(C1, M1, 60));
    repo.seedCompletion(completionRow(C2, M2, 60));
    const stalePet: Pet = {
      id: "00000000-0000-4000-8000-000000000aa1",
      owner_id: OWNER,
      goal_id: GOAL,
      species: "default",
      branch: "unset",
      stage: "egg", // grow_pet for C2 has not landed yet
      xp: 60,
      mood: 0.7,
      sprite_set: "default",
      updated_at: FIXED_NOW.toISOString(),
    };
    repo.seedPet(stalePet);

    let seen: CelebrationContext | null = null;
    const spy: PersonaMessageGenerator = async (ctx) => {
      seen = ctx;
      return null; // fall through to the deterministic copy so we can assert it
    };
    const outcome = await runJob(depsWith(repo, spy), followUpJob("deliver_notification", C2, M2));

    expect(outcome.kind).toBe("delivered");
    if (outcome.kind !== "delivered") return;
    expect(seen).not.toBeNull();
    expect(seen!.petStage).toBe("baby"); // recomputed stream wins over the stale row
    expect(seen!.stagedUp).toBe(true); // 60 (egg) → 120 (baby)
    expect(seen!.trigger).toBe("milestone_done");
    expect(seen!.goalCompleted).toBe(false);
    // The fallback names the NEW stage, never the stale one.
    expect(outcome.notification.persona_msg).toContain("Say hi to your baby");
  });

  it("each stage boundary is claimed by exactly one completion (chronological prefix sums)", async () => {
    const repo = createMemoryRepo(() => FIXED_NOW);
    repo.seedGoal(goalRow());
    repo.seedMilestone(v1bMilestone(M1, { xp: 60 }));
    repo.seedMilestone(v1bMilestone(M2, { xp: 60 }));
    repo.seedMilestone(v1bMilestone(M3, { status: "pending" }));
    repo.seedCompletion(completionRow(C1, M1, 60));
    repo.seedCompletion(completionRow(C2, M2, 60));

    const contexts: CelebrationContext[] = [];
    const spy: PersonaMessageGenerator = async (ctx) => {
      contexts.push(ctx);
      return "ok";
    };
    await runJob(depsWith(repo, spy), followUpJob("deliver_notification", C1, M1));
    await runJob(depsWith(repo, spy), followUpJob("deliver_notification", C2, M2));

    expect(contexts).toHaveLength(2);
    // C1: 0 → 60 stays egg; C2: 60 → 120 crosses into baby. Only C2 claims it.
    expect(contexts[0]!.petStage).toBe("egg");
    expect(contexts[0]!.stagedUp).toBe(false);
    expect(contexts[1]!.petStage).toBe("baby");
    expect(contexts[1]!.stagedUp).toBe(true);
  });
});

describe("runJob — judge short-circuit heals a stale milestone status cache", () => {
  it("re-asserts status='completed' and the follow-up fan-out when the original run crashed mid-way", async () => {
    const repo = createMemoryRepo(() => FIXED_NOW);
    repo.seedGoal(goalRow());
    // Crash after the completion insert: status flip lost AND follow-ups never enqueued.
    repo.seedMilestone(v1bMilestone(M1, { status: "pending", xp: 40 }));
    repo.seedCompletion(completionRow(C1, M1, 40));

    const outcome = await runJob(depsWith(repo), judgeJob(M1));

    expect(outcome.kind).toBe("skipped");
    if (outcome.kind === "skipped") expect(outcome.reason).toContain("already completed");
    expect(repo.state.milestones.get(M1)!.status).toBe("completed");
    expect(repo.state.milestones.get(M1)!.completed_at).not.toBeNull();
    // No new completion — the existing row is the source of truth.
    expect(repo.state.completions).toHaveLength(1);
    // The fan-out is re-asserted with the canonical dedup keys (idempotent).
    const types = repo.state.jobs.map((j) => j.type).sort();
    expect(types).toEqual(["deliver_notification", "grow_pet", "mint_collectible"]);
    const grow = repo.state.jobs.find((j) => j.type === "grow_pet")!;
    expect(grow.dedup_key).toBe(followUpDedupKey("grow_pet", C1));
    expect(grow.payload.awarded_xp).toBe(40);
  });

  it("a re-judge of an already-completed milestone does not duplicate the follow-up jobs", async () => {
    const repo = createMemoryRepo(() => FIXED_NOW);
    repo.seedMilestone(milestone(commitRule("auto"), 25));
    repo.seedEvidenceForMilestone(MILESTONE, [commitEvidence(1.0, "ev-trusted")]);

    const first = await runJob(depsWith(repo), judgeJob());
    expect(first.kind).toBe("completed");
    const second = await runJob(depsWith(repo), judgeJob());
    expect(second.kind).toBe("skipped");

    // The re-assertion hit the dedup keys: still exactly one job per type.
    expect(repo.state.jobs.filter((j) => j.type === "grow_pet")).toHaveLength(1);
    expect(repo.state.jobs.filter((j) => j.type === "mint_collectible")).toHaveLength(1);
    expect(repo.state.jobs.filter((j) => j.type === "deliver_notification")).toHaveLength(1);
  });
});

describe("fallbackCelebrationMessage — deterministic in-character copy", () => {
  const base: CelebrationContext = {
    trigger: "milestone_done",
    ownerId: OWNER,
    goalTitle: "Launch Aimcub v1b",
    milestoneTitle: "Ship the login flow",
    petStage: "baby",
    stagedUp: false,
    xpAwarded: 30,
    goalCompleted: false,
  };

  it("is a pure function: same context → same string", () => {
    expect(fallbackCelebrationMessage(base)).toBe(fallbackCelebrationMessage(base));
  });

  it("celebrates the goal when it completed", () => {
    const msg = fallbackCelebrationMessage({ ...base, trigger: "goal_done", goalCompleted: true });
    expect(msg).toContain("Launch Aimcub v1b");
    expect(msg).toContain("Trophy");
  });

  it("mentions the new stage on a stage-up", () => {
    const msg = fallbackCelebrationMessage({ ...base, stagedUp: true });
    expect(msg).toContain("baby");
    expect(msg).toContain("+30 XP");
  });

  it("celebrates the milestone otherwise", () => {
    const msg = fallbackCelebrationMessage(base);
    expect(msg).toContain("Ship the login flow");
    expect(msg).toContain("+30 XP");
  });
});
