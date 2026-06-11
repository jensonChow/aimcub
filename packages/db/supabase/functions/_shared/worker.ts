/**
 * runJob — the pure, dependency-injected core of the jobs worker.
 *
 * v1a implements the `judge_evidence` job: load the milestone's acceptance_rule
 * plus the evidence relevant to it, run the @core `evaluate()` kernel, and — when
 * the rule passes AND `completion_mode` permits auto-completion — write an
 * idempotent `milestone_completion` (`decided_by = 'rule_auto'`, `awarded_xp`
 * taken from the milestone) and enqueue the follow-up jobs (`grow_pet`,
 * `mint_collectible`, `deliver_notification`).
 *
 * v1b implements those three follow-ups (the emotional shell). All three are
 * DERIVED state, recomputable from `milestone_completions`:
 *   - grow_pet:            RECOMPUTE pet xp from the goal's completion stream,
 *                          derive the stage, monotonically upsert the
 *                          one-per-goal pets row (a stale concurrent recompute
 *                          can never lower xp).
 *   - mint_collectible:    badge per completion (idempotency anchor:
 *                          `minted_collectible_id`; DB backstop: one badge per
 *                          milestone, 0010), plus a goal trophy (DB backstop:
 *                          one per goal) + a CAS goal 'achieved' flip exactly
 *                          once when the last milestone lands.
 *   - deliver_notification: celebration message gated by @core/proactive
 *                          `decideDelivery`, pet-voice copy via an injected
 *                          generator with a deterministic in-character fallback.
 *                          goal_done fires only for the chronologically FINAL
 *                          completion (deduped at the goal level); every other
 *                          completion celebrates as milestone_done.
 *
 * "Goal finished?" is derived from the SOURCE stream — open milestones minus
 * those with a completion row — never from the milestones.status cache alone,
 * which is written non-atomically with the completion and can go stale on a
 * crash (the judge short-circuit heals such stale rows).
 *
 * The three follow-ups are independent queue entries — ordering between them is
 * NOT guaranteed, so none may rely on another's output (deliver re-derives stage
 * info from the completion stream instead of consuming grow_pet's `stagedUp`).
 *
 * No I/O of its own: `deps` carries the repo, a `now()` clock, an injected hex
 * hash (sha256 — kept out of @core/the pure layer), and the optional persona
 * generator. Handlers are total: expected states map to JobOutcome variants.
 */
import { AcceptanceRule } from "@core/types";
import { evaluate, planMint, stageForXp } from "@core/domain";
import { decideDelivery, localHour } from "@core/proactive";
import type {
  Collectible,
  Job,
  MilestoneCompletion,
  Notification,
  NotificationChannel,
  NotificationTrigger,
  Pet,
} from "@core/types";
import type { CelebrationContext, PersonaMessageGenerator, WorkerRepo } from "./ports.ts";
import { fallbackCelebrationMessage } from "./persona.ts";

export interface WorkerDeps {
  repo: WorkerRepo;
  now: () => Date;
  /** Hex digest (sha256 in production) — injected so this module stays platform-free. */
  hashHex: (input: string) => string;
  /** Pet-voice generator (LLM-backed). Absent → deterministic fallback copy. */
  personaMessage?: PersonaMessageGenerator;
}

/** Discriminated outcome so the entry wrapper (and tests) can branch precisely. */
export type JobOutcome =
  | { kind: "skipped"; reason: string }
  | { kind: "evaluated"; passed: boolean; completed: false; reason: string }
  | {
      kind: "completed";
      completion: MilestoneCompletion;
      created: boolean;
      enqueued: Job[];
    }
  | { kind: "fanout"; judged: number; completed: number }
  | { kind: "pet_grown"; pet: Pet; stagedUp: boolean }
  | {
      kind: "minted";
      collectible: Collectible | null;
      trophy: Collectible | null;
      goalCompleted: boolean;
    }
  | {
      kind: "delivered";
      notification: Notification;
      created: boolean;
      channels: NotificationChannel[];
    }
  | { kind: "error"; error: string };

/**
 * v1b delivery defaults. No per-user prefs exist yet: UTC clock (tz offset 0),
 * standard 22:00–08:00 quiet window, 2 nudges/day per user. in_app/agent_inbox
 * are the only live channels (email deferred — no provider).
 */
const V1B_CHANNELS: readonly NotificationChannel[] = ["in_app", "agent_inbox"];
const DEFAULT_TZ_OFFSET_MINUTES = 0;
const DEFAULT_QUIET_HOURS: readonly [number, number] = [22, 8];
const DEFAULT_NUDGE_DAILY_CAP = 2;

/**
 * Deliver-once key. `scopeId` is the COMPLETION id for milestone_done but the
 * GOAL id for goal_done: a goal finishes once, so its celebration is deduped at
 * the goal level — two final-batch completions racing to "goal_done" collapse
 * onto one key (and one notifications_dedup_idx row) instead of double-firing.
 */
export function notificationDedupKey(trigger: NotificationTrigger, scopeId: string): string {
  return `notif:${trigger}:${scopeId}`;
}

/** Follow-up jobs fanned out after an auto-completion. */
const FOLLOW_UP_JOBS = ["grow_pet", "mint_collectible", "deliver_notification"] as const;

export function followUpDedupKey(
  type: (typeof FOLLOW_UP_JOBS)[number],
  completionId: string,
): string {
  return `${type}:${completionId}`;
}

function whichJobType(job: Job): string {
  return job.type;
}

export async function runJob(deps: WorkerDeps, job: Job): Promise<JobOutcome> {
  switch (whichJobType(job)) {
    case "judge_evidence":
      return judgeEvidence(deps, job);
    case "grow_pet":
      return growPet(deps, job);
    case "mint_collectible":
      return mintCollectible(deps, job);
    case "deliver_notification":
      return deliverNotification(deps, job);
    // extract_memory is deferred (v1b ships event-driven celebrations only).
    default:
      return { kind: "skipped", reason: `unhandled job type: ${job.type}` };
  }
}

function stringField(job: Job, key: string): string | null {
  const v = job.payload?.[key];
  return typeof v === "string" && v.length > 0 ? v : null;
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
  // not re-judge or re-award. (The DB UNIQUE constraint is the hard guarantee;
  // this just avoids needless work and duplicate follow-up enqueues.)
  const already = await deps.repo.getCompletion(milestoneId);
  if (already) {
    // Healing writes: the completion insert, the status flip, and the follow-up
    // fan-out are separate statements in the live repo — a crash between any of
    // them leaves the completion (the source of truth) without its derived
    // effects: a milestone stranded as 'pending' (UI never lights it; pending
    // counts never converge) and/or follow-up jobs that never existed (pet /
    // badge / celebration lost). Both re-assertions are idempotent: the status
    // write is conditional, and enqueueJob dedups on `<type>:<completionId>` —
    // an already-processed follow-up is returned as-is, never re-run.
    if (milestone.status !== "completed") {
      await deps.repo.markMilestoneCompleted(milestoneId);
    }
    for (const type of FOLLOW_UP_JOBS) {
      await deps.repo.enqueueJob({
        type,
        payload: {
          completion_id: already.id,
          milestone_id: milestoneId,
          owner_id: milestone.owner_id,
          goal_id: milestone.goal_id,
          awarded_xp: already.awarded_xp,
        },
        dedupKey: followUpDedupKey(type, already.id),
      });
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

  // Only fan out follow-up jobs on first creation, so a re-judge that loses the
  // short-circuit race does not double-enqueue (jobs.dedup_key is the backstop).
  const enqueued: Job[] = [];
  if (created) {
    for (const type of FOLLOW_UP_JOBS) {
      const enqueuedJob = await deps.repo.enqueueJob({
        type,
        payload: {
          completion_id: completion.id,
          milestone_id: milestoneId,
          owner_id: milestone.owner_id,
          goal_id: milestone.goal_id,
          awarded_xp: completion.awarded_xp,
        },
        dedupKey: followUpDedupKey(type, completion.id),
      });
      enqueued.push(enqueuedJob);
    }
  }

  return { kind: "completed", completion, created, enqueued };
}

// ──────────────────────────────────────────────────────────────────────────
// grow_pet — RECOMPUTE pet state from the completion stream (derived state)
// ──────────────────────────────────────────────────────────────────────────

/**
 * pet.xp = Σ awarded_xp over the goal's completions; stage = stageForXp(xp).
 * Recompute-from-source makes the handler idempotent by construction AND
 * retro-grows pets for completions that predate v1b. The upsert is MONOTONIC
 * (`greatest(stored, recomputed)`, see ports): xp is derived from an
 * append-only stream, so a stale concurrent recompute — read before a newer
 * completion landed, written after — can never regress the pet. `stagedUp`
 * compares the previously stored xp's stage (egg when no pet row yet) to the
 * stage that actually landed on the row.
 */
async function growPet(deps: WorkerDeps, job: Job): Promise<JobOutcome> {
  const goalId = stringField(job, "goal_id");
  if (!goalId) return { kind: "skipped", reason: "no goal_id on job payload" };

  const goal = await deps.repo.getGoal(goalId);
  if (!goal) return { kind: "skipped", reason: `goal ${goalId} not found` };

  const completions = await deps.repo.listCompletionsForGoal(goalId);
  const xp = completions.reduce((sum, c) => sum + c.awarded_xp, 0);
  const stage = stageForXp(xp);

  const prior = await deps.repo.getPetByGoal(goalId);
  const pet = await deps.repo.upsertPet({ goalId, ownerId: goal.owner_id, xp, stage });
  // Compare against the row that actually won the monotonic upsert, so a stale
  // (lower) recompute never reports a phantom stage transition.
  const stagedUp = stageForXp(prior?.xp ?? 0) !== pet.stage;
  return { kind: "pet_grown", pet, stagedUp };
}

// ──────────────────────────────────────────────────────────────────────────
// Derived goal state — computed from the SOURCE stream, not the status cache
// ──────────────────────────────────────────────────────────────────────────

/** Chronological order with a deterministic tie-break, so every handler agrees
 * on which completion is "the final one" even when a batch shares a timestamp. */
function byCreatedAtThenId(a: MilestoneCompletion, b: MilestoneCompletion): number {
  const ta = a.created_at ?? "";
  const tb = b.created_at ?? "";
  if (ta !== tb) return ta < tb ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

interface GoalCompletionState {
  /** All completions of the goal, chronologically ordered (ties broken by id). */
  ordered: MilestoneCompletion[];
  /** True when every open milestone has a completion in the stream. */
  goalCompleted: boolean;
  /** The chronologically final completion (null only when the stream is empty). */
  finalCompletion: MilestoneCompletion | null;
}

/**
 * "Is the goal finished?" — derived from the completion stream joined against
 * the still-open milestones. The milestones.status cache is written in a
 * separate statement from the completion insert, so a crash can leave a
 * completed-but-'pending' milestone; trusting the cache alone would make the
 * trophy / goal_done / 'achieved' flip permanently unreachable. A milestone
 * counts as done when its status says so OR a completion row exists for it.
 */
async function deriveGoalCompletion(
  deps: WorkerDeps,
  goalId: string,
): Promise<GoalCompletionState> {
  const completions = await deps.repo.listCompletionsForGoal(goalId);
  const openCached = await deps.repo.listPendingMilestones(goalId);
  const completedIds = new Set(completions.map((c) => c.milestone_id));
  const stillOpen = openCached.filter((m) => !completedIds.has(m.id));
  const ordered = [...completions].sort(byCreatedAtThenId);
  return {
    ordered,
    goalCompleted: stillOpen.length === 0 && ordered.length > 0,
    finalCompletion: ordered[ordered.length - 1] ?? null,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// mint_collectible — badge per completion (+ goal trophy on the last one)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Idempotency anchors + DB backstops:
 *   - badge:  `milestone_completions.minted_collectible_id` — mint only while
 *     null, backfill it in the same logical step. The unique badge index (0010)
 *     is the hard guarantee: a crash-retry that lost the anchor re-"inserts",
 *     gets the SAME existing row back (created=false), and heals the anchor —
 *     never a second badge. Retries never re-roll the shiny upgrade: the roll
 *     is a pure function of sha256(completion.id).
 *   - trophy: the unique trophy index (0010) admits one trophy per goal no
 *     matter how many invocations race on the final milestones; `trophy` is
 *     non-null only for the run whose insert actually created the row.
 *     `setGoalAchieved` is a CAS (idempotent), run after the insert so a crash
 *     between the two heals on retry. The `goal.status !== 'achieved'` read is
 *     just a cheap precheck; the index is the backstop.
 */
async function mintCollectible(deps: WorkerDeps, job: Job): Promise<JobOutcome> {
  const milestoneId = stringField(job, "milestone_id");
  if (!milestoneId) return { kind: "skipped", reason: "no milestone_id on job payload" };

  const milestone = await deps.repo.getMilestone(milestoneId);
  if (!milestone) return { kind: "skipped", reason: `milestone ${milestoneId} not found` };

  // Completions are unique per milestone, so the milestone resolves the completion.
  const completion = await deps.repo.getCompletion(milestoneId);
  if (!completion) {
    return { kind: "skipped", reason: `no completion for milestone ${milestoneId}` };
  }

  const goal = await deps.repo.getGoal(milestone.goal_id);
  if (!goal) return { kind: "skipped", reason: `goal ${milestone.goal_id} not found` };

  let badge: Collectible | null = null;
  if (completion.minted_collectible_id === null) {
    const plan = planMint(completion, milestone, {
      goalTitle: goal.title,
      hashHex: deps.hashHex,
    });
    const minted = await deps.repo.insertCollectible({
      ownerId: completion.owner_id,
      goalId: milestone.goal_id,
      milestoneId: milestone.id,
      kind: plan.kind,
      rarity: plan.rarity,
      metadata: plan.metadata,
    });
    // created=false ⇒ a previous run crashed after inserting but before
    // anchoring: re-anchor the existing row (heal), do not count a new mint.
    badge = minted.collectible;
    await deps.repo.setCompletionMinted(completion.id, badge.id);
  }

  const { goalCompleted, finalCompletion } = await deriveGoalCompletion(deps, milestone.goal_id);

  let trophy: Collectible | null = null;
  if (goalCompleted && goal.status !== "achieved" && finalCompletion) {
    // The trophy names the goal's chronologically FINAL milestone — which may
    // not be this job's milestone when several completions land in one batch.
    const finalMilestone =
      finalCompletion.milestone_id === milestone.id
        ? milestone
        : await deps.repo.getMilestone(finalCompletion.milestone_id);
    const minted = await deps.repo.insertCollectible({
      ownerId: goal.owner_id,
      goalId: goal.id,
      milestoneId: null,
      kind: "goal_trophy",
      // The goal trophy is the rare highlight of the loop: fixed legendary, no roll.
      rarity: "legendary",
      metadata: {
        goal_title: goal.title,
        final_milestone_title: (finalMilestone ?? milestone).title,
        completed_at: finalCompletion.created_at ?? deps.now().toISOString(),
        awarded_xp: finalCompletion.awarded_xp,
      },
    });
    trophy = minted.created ? minted.collectible : null;
    // CAS after the insert: a crash between them retries into created=false
    // above and still flips the status here — the trophy can never double-mint
    // (unique index) and 'achieved' can never be missed.
    await deps.repo.setGoalAchieved(goal.id);
  }

  if (badge === null && trophy === null) {
    return { kind: "skipped", reason: "collectible already minted" };
  }
  return { kind: "minted", collectible: badge, trophy, goalCompleted };
}

// ──────────────────────────────────────────────────────────────────────────
// deliver_notification — celebration (milestone_done / goal_done)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Gates through @core/proactive `decideDelivery` per channel (celebrations are
 * exempt from the daily nudge cap; in_app/agent_inbox bypass quiet hours), then
 * writes one notifications row with a deterministic dedup_key. Stage info is
 * re-derived from the completion stream — grow_pet's outcome is not visible
 * across queue entries and may not have run yet (and its materialized row may
 * be one completion behind, so the stream is the only trustworthy source).
 *
 * Trigger classification: goal_done belongs to the completion that actually
 * finished the goal — the chronologically final one — NOT to "any completion
 * delivered while the goal happens to be finished". When the last two
 * milestones complete in one judged batch, the non-final one still celebrates
 * as milestone_done and exactly one goal_done fires (deduped on the goal id as
 * the DB-level backstop).
 */
async function deliverNotification(deps: WorkerDeps, job: Job): Promise<JobOutcome> {
  const milestoneId = stringField(job, "milestone_id");
  if (!milestoneId) return { kind: "skipped", reason: "no milestone_id on job payload" };

  const milestone = await deps.repo.getMilestone(milestoneId);
  if (!milestone) return { kind: "skipped", reason: `milestone ${milestoneId} not found` };

  const completion = await deps.repo.getCompletion(milestoneId);
  if (!completion) {
    return { kind: "skipped", reason: `no completion for milestone ${milestoneId}` };
  }

  const goal = await deps.repo.getGoal(milestone.goal_id);
  if (!goal) return { kind: "skipped", reason: `goal ${milestone.goal_id} not found` };

  const { ordered, goalCompleted, finalCompletion } = await deriveGoalCompletion(
    deps,
    milestone.goal_id,
  );
  const finishedGoal = goalCompleted && finalCompletion?.id === completion.id;
  const trigger: "milestone_done" | "goal_done" = finishedGoal ? "goal_done" : "milestone_done";
  // goal_done is scoped to the GOAL (a goal finishes once); milestone_done to
  // the completion. See notificationDedupKey.
  const dedupKey = notificationDedupKey(trigger, finishedGoal ? goal.id : completion.id);

  const isDuplicate = await deps.repo.notificationDedupExists(dedupKey);
  const hour = localHour(deps.now().getTime(), DEFAULT_TZ_OFFSET_MINUTES);
  const nudgeCountToday = await deps.repo.countNudgesToday(completion.owner_id, deps.now());
  const channels = V1B_CHANNELS.filter(
    (channel) =>
      !decideDelivery({
        trigger,
        channel,
        localHour: hour,
        quietHours: DEFAULT_QUIET_HOURS,
        nudgeCountToday,
        nudgeDailyCap: DEFAULT_NUDGE_DAILY_CAP,
        isDuplicate,
      }).suppress,
  );
  if (channels.length === 0) {
    return {
      kind: "skipped",
      reason: isDuplicate ? "duplicate notification (already delivered)" : "all channels suppressed",
    };
  }

  // Stage context: ALWAYS recomputed from the source stream. The materialized
  // pet row may not exist yet (deliver can run before grow_pet) or be one
  // completion behind — using it can announce a stage-up while naming the OLD
  // stage. Chronological prefix sums give each completion its own before/after
  // pair, so a stage boundary is claimed by exactly one completion and
  // `petStage` is the stage AFTER this completion (the CelebrateInput contract).
  const idx = ordered.findIndex((c) => c.id === completion.id);
  const xpBefore = ordered
    .slice(0, idx === -1 ? ordered.length : idx)
    .reduce((sum, c) => sum + c.awarded_xp, 0);
  const xpAfter = xpBefore + completion.awarded_xp;
  const petStage = stageForXp(xpAfter);
  const stagedUp = stageForXp(xpBefore) !== petStage;

  const ctx: CelebrationContext = {
    trigger,
    ownerId: completion.owner_id,
    goalTitle: goal.title,
    milestoneTitle: milestone.title,
    petStage,
    stagedUp,
    xpAwarded: completion.awarded_xp,
    // "This completion finished the whole goal" — false for the non-final
    // completions of a finished goal (they celebrate their own milestone).
    goalCompleted: finishedGoal,
  };

  let generated: string | null = null;
  if (deps.personaMessage) {
    try {
      generated = await deps.personaMessage(ctx);
    } catch {
      generated = null; // generator contract is "never throw", but stay total anyway
    }
  }
  const personaMsg = generated ?? fallbackCelebrationMessage(ctx);

  const { notification, created } = await deps.repo.insertNotification({
    ownerId: completion.owner_id,
    trigger,
    channels: [...channels],
    dedupKey,
    refGoalId: goal.id,
    refMilestoneId: milestone.id,
    personaMsg,
    status: "sent",
  });
  return { kind: "delivered", notification, created, channels: [...channels] };
}
