/**
 * Unit tests for the pure jobs-worker handler (`runJob` / judge_evidence).
 *
 * Decoupling: a LOCAL in-memory repo (memory-repo.ts) implements the ports — no
 * import of `@core/api-client`. The @core `evaluate()` kernel and
 * `AUTO_VERIFY_MIN_TRUST` are the real ones (imported from `@core/domain`).
 */
import { describe, expect, it } from "vitest";
import { AUTO_VERIFY_MIN_TRUST } from "@core/domain";
import type {
  AcceptanceRule,
  CompletionMode,
  Evidence,
  Job,
  Milestone,
} from "@core/types";
import { followUpDedupKey, runJob, type WorkerDeps } from "../worker.ts";
import { createMemoryRepo, type MemoryRepo } from "./memory-repo.ts";

const FIXED_NOW = new Date("2026-06-09T12:00:00.000Z");
const OWNER = "00000000-0000-4000-8000-000000000001";
const GOAL = "00000000-0000-4000-8000-0000000000b1";
const MILESTONE = "00000000-0000-4000-8000-0000000000c1";

function depsWith(repo: MemoryRepo): WorkerDeps {
  return { repo, now: () => FIXED_NOW };
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

  it("skips when the job has no milestone_id (untriaged evidence)", async () => {
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
