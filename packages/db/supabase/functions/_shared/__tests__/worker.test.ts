/**
 * Unit tests for the pure jobs-worker handler (`runJob`): the `judge_evidence`
 * path that evaluates evidence against a milestone's acceptance_rule and writes
 * an idempotent completion.
 *
 * Decoupling: a LOCAL in-memory repo (memory-repo.ts) implements the ports — no
 * import of `@aimcub/api-client`. The @aimcub/core `evaluate()` kernel and
 * `AUTO_VERIFY_MIN_TRUST` are the real ones (imported from `@aimcub/core`).
 */
import { describe, expect, it } from "vitest";
import { AUTO_VERIFY_MIN_TRUST } from "@aimcub/core";
import type {
  AcceptanceRule,
  CompletionMode,
  Evidence,
  Job,
  Milestone,
  MilestoneCompletion,
} from "@aimcub/types";
import { runJob, type WorkerDeps } from "../worker.ts";
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
    depends_on_ids: [],
    acceptance_rule: rule,
    xp_reward: xp,
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

function completionRow(id: string, milestoneId: string, xp: number): MilestoneCompletion {
  return {
    id,
    milestone_id: milestoneId,
    owner_id: OWNER,
    decided_by: "rule_auto",
    triggering_evidence_ids: [],
    awarded_xp: xp,
    created_at: FIXED_NOW.toISOString(),
  };
}

describe("runJob — judge_evidence auto-completes on trusted evidence", () => {
  it("writes a rule_auto completion carrying the milestone xp (never the caller's)", async () => {
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

    // exactly one completion persisted; the milestone status cache is flipped
    expect(repo.state.completions).toHaveLength(1);
    expect(repo.state.milestones.get(MILESTONE)!.status).toBe("completed");
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

describe("runJob — judge short-circuit heals a stale milestone status cache", () => {
  it("re-asserts status='completed' when a prior run crashed after the completion insert", async () => {
    const repo = createMemoryRepo(() => FIXED_NOW);
    // Crash after the completion insert: the status flip was lost.
    repo.seedMilestone({ ...milestone(commitRule("auto"), 40), status: "pending" });
    repo.seedCompletion(completionRow("00000000-0000-4000-8000-00000000d001", MILESTONE, 40));

    const outcome = await runJob(depsWith(repo), judgeJob());

    expect(outcome.kind).toBe("skipped");
    if (outcome.kind === "skipped") expect(outcome.reason).toContain("already completed");
    expect(repo.state.milestones.get(MILESTONE)!.status).toBe("completed");
    expect(repo.state.milestones.get(MILESTONE)!.completed_at).not.toBeNull();
    // No new completion — the existing row is the source of truth.
    expect(repo.state.completions).toHaveLength(1);
  });
});
