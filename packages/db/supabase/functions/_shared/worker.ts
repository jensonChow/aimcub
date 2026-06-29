/**
 * runJob — the pure, dependency-injected core of the jobs worker.
 *
 * The worker evaluates evidence against milestone acceptance rules. When a
 * milestone's `acceptance_rule` passes AND its `completion_mode` permits
 * auto-completion, it writes an idempotent `milestone_completion`
 * (`decided_by = 'rule_auto'`, `awarded_xp` taken from the milestone) and flips
 * the milestone's status cache. Milestone completion is DERIVED state — always
 * recomputable from the append-only evidence stream, never written directly.
 *
 * "Is the goal finished?" is likewise derived from the SOURCE stream (open
 * milestones minus those with a completion row), never from the
 * milestones.status cache alone, which is written non-atomically with the
 * completion and can go stale on a crash (the judge short-circuit heals such
 * stale rows on the next run).
 *
 * No I/O of its own: `deps` carries the repo and a `now()` clock. Handlers are
 * total: every expected state maps to a JobOutcome variant.
 */
import { AcceptanceRule } from "@core/types";
import { evaluate } from "@core/domain";
import type { Job, MilestoneCompletion } from "@core/types";
import type { WorkerRepo } from "./ports.ts";

export interface WorkerDeps {
  repo: WorkerRepo;
  /** Injected clock (kept out of the pure handler). */
  now: () => Date;
}

/** Discriminated outcome so the entry wrapper (and tests) can branch precisely. */
export type JobOutcome =
  | { kind: "skipped"; reason: string }
  | { kind: "evaluated"; passed: boolean; completed: false; reason: string }
  | { kind: "completed"; completion: MilestoneCompletion; created: boolean }
  | { kind: "fanout"; judged: number; completed: number }
  | { kind: "error"; error: string };

export async function runJob(deps: WorkerDeps, job: Job): Promise<JobOutcome> {
  switch (job.type) {
    case "judge_evidence":
      return judgeEvidence(deps, job);
    // extract_memory is deferred (the memory pillar ships in a later phase).
    default:
      return { kind: "skipped", reason: `unhandled job type: ${job.type}` };
  }
}

async function judgeEvidence(deps: WorkerDeps, job: Job): Promise<JobOutcome> {
  const milestoneId = job.payload?.milestone_id;
  if (typeof milestoneId === "string" && milestoneId.length > 0) {
    return judgeOneMilestone(deps, milestoneId);
  }

  // Goal-level evidence (e.g. a webhook push that names no milestone): judge every
  // open milestone of the goal. evaluate() filters per-rule, so a commit only
  // completes the milestones whose acceptance clauses it actually satisfies.
  const goalId = job.payload?.goal_id;
  if (typeof goalId !== "string" || goalId.length === 0) {
    return { kind: "skipped", reason: "no milestone_id or goal_id on job payload" };
  }
  const open = await deps.repo.listPendingMilestones(goalId);
  if (open.length === 0) {
    return { kind: "skipped", reason: "no open milestones for goal" };
  }
  let completed = 0;
  for (const m of open) {
    const outcome = await judgeOneMilestone(deps, m.id);
    if (outcome.kind === "error") return outcome;
    if (outcome.kind === "completed" && outcome.created) completed += 1;
  }
  return { kind: "fanout", judged: open.length, completed };
}

async function judgeOneMilestone(deps: WorkerDeps, milestoneId: string): Promise<JobOutcome> {
  const milestone = await deps.repo.getMilestone(milestoneId);
  if (!milestone) {
    return { kind: "skipped", reason: `milestone ${milestoneId} not found` };
  }

  // Short-circuit: a milestone completes exactly once. If it's already done, do
  // not re-judge. (The DB UNIQUE constraint is the hard guarantee; this just
  // avoids needless work.)
  const already = await deps.repo.getCompletion(milestoneId);
  if (already) {
    // Healing write: the completion insert and the status flip are separate
    // statements in the live repo — a crash between them can strand the
    // milestone as 'pending' (UI never lights it; pending counts never
    // converge). markMilestoneCompleted is conditional and idempotent.
    if (milestone.status !== "completed") {
      await deps.repo.markMilestoneCompleted(milestoneId);
    }
    return { kind: "skipped", reason: "milestone already completed" };
  }

  // The acceptance_rule is stored as jsonb; parse it through the @core schema so
  // defaults (logic, threshold, completion_mode, clause defaults) are applied.
  const parsedRule = AcceptanceRule.safeParse(milestone.acceptance_rule);
  if (!parsedRule.success) {
    return { kind: "error", error: `invalid acceptance_rule: ${parsedRule.error.message}` };
  }
  const rule = parsedRule.data;

  const evidence = await deps.repo.listEvidenceForMilestone(milestoneId);

  // The kernel decides. It enforces anti-spoofing internally: an `auto_verifiable`
  // clause rejects evidence with trust_score < AUTO_VERIFY_MIN_TRUST (0.8), so a
  // 0.7-trust unverified commit cannot satisfy it on its own.
  const result = evaluate(rule, evidence);

  if (!result.passed) {
    return {
      kind: "evaluated",
      passed: false,
      completed: false,
      reason: "acceptance rule not satisfied",
    };
  }

  // The rule passed. Only `auto` and `auto_then_confirm` may auto-complete; pure
  // `manual` milestones require an explicit user confirmation elsewhere.
  if (rule.completion_mode === "manual") {
    return {
      kind: "evaluated",
      passed: true,
      completed: false,
      reason: "completion_mode=manual: awaiting user confirmation",
    };
  }

  // Idempotent completion write (decided_by = rule_auto). awarded_xp comes from
  // the milestone — never from the caller — so it cannot be inflated.
  const { completion, created } = await deps.repo.insertCompletion({
    milestoneId,
    ownerId: milestone.owner_id,
    decidedBy: "rule_auto",
    triggeringEvidenceIds: result.matchedEvidenceIds,
    awardedXp: milestone.xp_reward,
  });

  return { kind: "completed", completion, created };
}
