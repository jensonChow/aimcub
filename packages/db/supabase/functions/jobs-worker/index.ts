/* eslint-disable @typescript-eslint/ban-ts-comment -- Deno entry, see below */
// @ts-nocheck — Deno Edge Function entry; typechecked under Deno, not the Node/tsc
// build for this package. Excluded from `tsc` via tsconfig and never imported by tests.
/**
 * Supabase Edge Function: `jobs-worker` — LIVE wiring (v1a judge + v1b shell).
 *
 * Triggered by pg_cron every minute (net.http_post with the project anon key —
 * the platform's verify_jwt gate authenticates the call). Thin Deno entry:
 *   - atomically claims a batch of due jobs via the `claim_jobs` RPC
 *     (FOR UPDATE SKIP LOCKED, attempts incremented; since 0010 it also
 *     reclaims jobs stranded in 'running' by a crashed invocation),
 *   - delegates each to the pure `runJob` (in `_shared/worker.ts`),
 *   - marks each job done, requeues failures with backoff below MAX_ATTEMPTS,
 *     or terminally fails them at the cap.
 *
 * Deploy note: at deploy time `../_shared/*` is bundled as `./_shared/*` and
 * `@core/*` resolves via the function's deno.json import map to vendored sources
 * (v1b adds `@core/proactive` and `@core/llm` to that map).
 * This file MUST NOT be imported by the Vitest suite.
 *
 * deno-lint-ignore-file
 */
import { createHash } from "node:crypto";
import { createClient } from "jsr:@supabase/supabase-js@2";
// Persona pipelines (stream B): coded against the pinned v1b contract —
// celebrate(gateway, CelebrateInput) -> Promise<PersonaMessageResult> where
// `message` is null on any failure (the worker then uses the deterministic
// fallback). This entry is @ts-nocheck, so the import is safe to land even if
// @core/llm's pipelines merge slightly later; the fix phase reconciles.
import { AnthropicLlmGateway, celebrate } from "@core/llm";
import { runJob, type WorkerDeps } from "../_shared/worker.ts";
import type {
  CollectibleWrite,
  CompletionWrite,
  JobEnqueue,
  NotificationWrite,
  PersonaMessageGenerator,
  PetUpsert,
  WorkerRepo,
} from "../_shared/ports.ts";
import type { Job } from "@core/types";

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Promise<Response> | Response): unknown;
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const repo: WorkerRepo = {
  async getMilestone(milestoneId: string) {
    const { data, error } = await supabase
      .from("milestones")
      .select("*")
      .eq("id", milestoneId)
      .maybeSingle();
    if (error) throw new Error(`getMilestone: ${error.message}`);
    return data;
  },

  async listPendingMilestones(goalId: string) {
    const { data, error } = await supabase
      .from("milestones")
      .select("*")
      .eq("goal_id", goalId)
      .in("status", ["pending", "in_progress"])
      .order("order_index", { ascending: true });
    if (error) throw new Error(`listPendingMilestones: ${error.message}`);
    return data ?? [];
  },

  async listEvidenceForMilestone(milestoneId: string) {
    // Directly-attached evidence…
    const attached = await supabase
      .from("evidence")
      .select("*")
      .eq("milestone_id", milestoneId)
      .order("occurred_at", { ascending: true });
    if (attached.error) throw new Error(`listEvidenceForMilestone: ${attached.error.message}`);

    // …plus the goal's still-untriaged evidence, which the kernel should weigh.
    const milestone = await repo.getMilestone(milestoneId);
    if (!milestone) return attached.data ?? [];
    const untriaged = await supabase
      .from("evidence")
      .select("*")
      .eq("goal_id", milestone.goal_id)
      .is("milestone_id", null)
      .order("occurred_at", { ascending: true });
    if (untriaged.error) throw new Error(`listEvidenceForMilestone: ${untriaged.error.message}`);
    return [...(attached.data ?? []), ...(untriaged.data ?? [])];
  },

  async getCompletion(milestoneId: string) {
    const { data, error } = await supabase
      .from("milestone_completions")
      .select("*")
      .eq("milestone_id", milestoneId)
      .maybeSingle();
    if (error) throw new Error(`getCompletion: ${error.message}`);
    return data;
  },

  async insertCompletion(write: CompletionWrite) {
    const row = {
      milestone_id: write.milestoneId,
      owner_id: write.ownerId,
      decided_by: write.decidedBy,
      triggering_evidence_ids: write.triggeringEvidenceIds,
      awarded_xp: write.awardedXp,
    };
    const inserted = await supabase.from("milestone_completions").insert(row).select().single();
    if (!inserted.error) {
      // Reflect the derived state on the milestone row (UI reads milestones.status).
      // MUST throw on failure: a silently-stale 'pending' status would otherwise
      // strand the milestone (no realtime UPDATE, pending counts never converge).
      // Throwing fails the job → the retry's judge short-circuit heals the flip.
      const flipped = await supabase
        .from("milestones")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", write.milestoneId);
      if (flipped.error) {
        throw new Error(`insertCompletion status flip: ${flipped.error.message}`);
      }
      return { completion: inserted.data, created: true };
    }
    // UNIQUE(milestone_id): the milestone already completed — return the existing row.
    if (inserted.error.code === "23505") {
      const { data, error } = await supabase
        .from("milestone_completions")
        .select("*")
        .eq("milestone_id", write.milestoneId)
        .single();
      if (error) throw new Error(`insertCompletion reselect: ${error.message}`);
      return { completion: data, created: false };
    }
    throw new Error(`insertCompletion: ${inserted.error.message}`);
  },

  async enqueueJob(job: JobEnqueue) {
    const row = {
      type: job.type,
      payload: job.payload,
      dedup_key: job.dedupKey,
      ...(job.runAfter ? { run_after: job.runAfter } : {}),
    };
    const inserted = await supabase.from("jobs").insert(row).select().single();
    if (!inserted.error) return inserted.data;
    if (inserted.error.code === "23505" && job.dedupKey) {
      const { data, error } = await supabase
        .from("jobs")
        .select("*")
        .eq("dedup_key", job.dedupKey)
        .single();
      if (error) throw new Error(`enqueueJob reselect: ${error.message}`);
      return data;
    }
    throw new Error(`enqueueJob: ${inserted.error.message}`);
  },

  // ── v1b: derived pet / collectible / notification state ───────────────────

  async getGoal(goalId: string) {
    const { data, error } = await supabase
      .from("goals")
      .select("*")
      .eq("id", goalId)
      .maybeSingle();
    if (error) throw new Error(`getGoal: ${error.message}`);
    return data;
  },

  async listCompletionsForGoal(goalId: string) {
    // Completions don't carry goal_id — join through the goal's milestones.
    const ms = await supabase.from("milestones").select("id").eq("goal_id", goalId);
    if (ms.error) throw new Error(`listCompletionsForGoal milestones: ${ms.error.message}`);
    const ids = (ms.data ?? []).map((m) => m.id);
    if (ids.length === 0) return [];
    const { data, error } = await supabase
      .from("milestone_completions")
      .select("*")
      .in("milestone_id", ids)
      .order("created_at", { ascending: true });
    if (error) throw new Error(`listCompletionsForGoal: ${error.message}`);
    return data ?? [];
  },

  async markMilestoneCompleted(milestoneId: string) {
    // Healing write (judge short-circuit): re-assert the status cache from the
    // completion stream. Conditional so completed_at is only stamped once.
    const { error } = await supabase
      .from("milestones")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", milestoneId)
      .neq("status", "completed");
    if (error) throw new Error(`markMilestoneCompleted: ${error.message}`);
  },

  async getPetByGoal(goalId: string) {
    const { data, error } = await supabase
      .from("pets")
      .select("*")
      .eq("goal_id", goalId)
      .maybeSingle();
    if (error) throw new Error(`getPetByGoal: ${error.message}`);
    return data;
  },

  async upsertPet(write: PetUpsert) {
    // upsert_pet_monotonic (0010): ON CONFLICT (goal_id) DO UPDATE with
    // xp = greatest(stored, written) in ONE statement, so a stale concurrent
    // recompute (read-before / write-after a newer completion) can never
    // regress the pet's xp or stage.
    const { data, error } = await supabase.rpc("upsert_pet_monotonic", {
      p_goal_id: write.goalId,
      p_owner_id: write.ownerId,
      p_xp: write.xp,
      p_stage: write.stage,
    });
    if (error) throw new Error(`upsertPet: ${error.message}`);
    return Array.isArray(data) ? data[0] : data;
  },

  async setCompletionMinted(completionId: string, collectibleId: string) {
    // Conditional: never overwrite an existing anchor. Losing this race is
    // harmless — the unique badge index (0010) guarantees every racer resolved
    // the SAME collectible id, so whichever write lands the anchor is correct.
    const { error } = await supabase
      .from("milestone_completions")
      .update({ minted_collectible_id: collectibleId })
      .eq("id", completionId)
      .is("minted_collectible_id", null);
    if (error) throw new Error(`setCompletionMinted: ${error.message}`);
  },

  async insertCollectible(write: CollectibleWrite) {
    const row = {
      owner_id: write.ownerId,
      goal_id: write.goalId,
      milestone_id: write.milestoneId,
      kind: write.kind,
      rarity: write.rarity,
      metadata: write.metadata,
    };
    const inserted = await supabase.from("collectibles").insert(row).select().single();
    if (!inserted.error) return { collectible: inserted.data, created: true };
    // collectibles_badge_once_idx / collectibles_trophy_once_idx (0010): a unique
    // violation means "already minted" — reselect the existing row.
    if (inserted.error.code === "23505") {
      let query = supabase.from("collectibles").select("*").eq("kind", write.kind);
      query =
        write.kind === "goal_trophy"
          ? query.eq("goal_id", write.goalId)
          : query.eq("milestone_id", write.milestoneId);
      const { data, error } = await query.single();
      if (error) throw new Error(`insertCollectible reselect: ${error.message}`);
      return { collectible: data, created: false };
    }
    throw new Error(`insertCollectible: ${inserted.error.message}`);
  },

  async setGoalAchieved(goalId: string) {
    // CAS: only the call that transitions active → achieved wins; a raced or
    // retried call matches zero rows and returns false.
    const { data, error } = await supabase
      .from("goals")
      .update({ status: "achieved" })
      .eq("id", goalId)
      .neq("status", "achieved")
      .select("id");
    if (error) throw new Error(`setGoalAchieved: ${error.message}`);
    return (data ?? []).length > 0;
  },

  async insertNotification(write: NotificationWrite) {
    const row = {
      owner_id: write.ownerId,
      trigger: write.trigger,
      channels: write.channels,
      dedup_key: write.dedupKey,
      ref_goal_id: write.refGoalId,
      ref_milestone_id: write.refMilestoneId,
      persona_msg: write.personaMsg,
      status: write.status,
    };
    const inserted = await supabase.from("notifications").insert(row).select().single();
    if (!inserted.error) return { notification: inserted.data, created: true };
    // notifications_dedup_idx (0008): unique violation == already delivered.
    if (inserted.error.code === "23505" && write.dedupKey) {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .eq("dedup_key", write.dedupKey)
        .single();
      if (error) throw new Error(`insertNotification reselect: ${error.message}`);
      return { notification: data, created: false };
    }
    throw new Error(`insertNotification: ${inserted.error.message}`);
  },

  async notificationDedupExists(dedupKey: string) {
    const { data, error } = await supabase
      .from("notifications")
      .select("id")
      .eq("dedup_key", dedupKey)
      .limit(1);
    if (error) throw new Error(`notificationDedupExists: ${error.message}`);
    return (data ?? []).length > 0;
  },

  async countNudgesToday(ownerId: string, now: Date) {
    const dayStartUtc = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    ).toISOString();
    const { count, error } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", ownerId)
      .in("trigger", ["stale", "deadline_near", "scheduled"])
      .in("status", ["sent", "delivered"])
      .gte("created_at", dayStartUtc);
    if (error) throw new Error(`countNudgesToday: ${error.message}`);
    return count ?? 0;
  },
};

/** Seed for the shiny roll: sha256 over the completion id (pure, retry-stable). */
function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** No-op meter: v1b does not persist LLM usage yet (mirrors apps/web live-port). */
const NOOP_METER = {
  async record(ownerId, task, usage) {
    console.log(
      `[llm] owner=${ownerId} task=${task} model=${usage.model} in=${usage.inputTokens} out=${usage.outputTokens}`,
    );
  },
};

/**
 * Pet-voice generator: @core/llm `celebrate` when an ANTHROPIC_API_KEY is set;
 * otherwise undefined, which routes the worker to the deterministic fallback.
 * Resolves null on any LLM failure (the celebrate contract never throws, but we
 * still guard) so a model outage can never lose a celebration.
 */
function buildPersonaGenerator(): PersonaMessageGenerator | undefined {
  if (!Deno.env.get("ANTHROPIC_API_KEY")) return undefined;
  return async (ctx) => {
    try {
      const gateway = new AnthropicLlmGateway({ meter: NOOP_METER, ownerId: ctx.ownerId });
      const result = await celebrate(gateway, {
        goalTitle: ctx.goalTitle,
        milestoneTitle: ctx.milestoneTitle,
        petStage: ctx.petStage,
        stagedUp: ctx.stagedUp,
        xpAwarded: ctx.xpAwarded,
        goalCompleted: ctx.goalCompleted,
      });
      if (result.errors?.length) console.error("celebrate pipeline errors:", result.errors);
      return result.message;
    } catch (err) {
      console.error("persona generator failed; using deterministic fallback", err);
      return null;
    }
  };
}

const personaMessage = buildPersonaGenerator();

function buildRealDeps(): WorkerDeps {
  return { repo, now: () => new Date(), hashHex: sha256Hex, personaMessage };
}

async function claimJobs(batch: number): Promise<Job[]> {
  const { data, error } = await supabase.rpc("claim_jobs", { batch });
  if (error) throw new Error(`claim_jobs: ${error.message}`);
  return data ?? [];
}

/** Mirrors the attempts cap in claim_jobs' stale-running reclaim (0010). */
const MAX_ATTEMPTS = 5;

/**
 * Finalize a claimed job. Failures below MAX_ATTEMPTS requeue with exponential
 * run_after backoff (1m, 2m, 4m, … capped at 1h) — the handlers are idempotent
 * by construction, so retries are safe and derived state converges back to the
 * completions stream instead of being lost to one transient error. At the cap
 * the job is terminally 'failed' (operator-visible). If THIS update itself
 * fails, the job stays 'running' and claim_jobs' stale reclaim (0010) retries it.
 */
async function markJob(job: Job, status: "done" | "failed", errorMsg?: string): Promise<void> {
  const retryable = status === "failed" && job.attempts < MAX_ATTEMPTS;
  const patch = retryable
    ? {
        status: "queued",
        last_error: errorMsg ?? null,
        run_after: new Date(
          Date.now() + Math.min(60_000 * 2 ** Math.max(job.attempts - 1, 0), 3_600_000),
        ).toISOString(),
      }
    : { status, last_error: errorMsg ?? null };
  const { error } = await supabase.from("jobs").update(patch).eq("id", job.id);
  if (error) console.error(`markJob(${job.id}): ${error.message}`);
}

export async function jobsWorkerHandler(): Promise<Response> {
  const deps = buildRealDeps();
  const jobs = await claimJobs(10);
  const outcomes: Array<{ id: string; outcome: string }> = [];
  for (const job of jobs) {
    try {
      const outcome = await runJob(deps, job);
      await markJob(
        job,
        outcome.kind === "error" ? "failed" : "done",
        outcome.kind === "error" ? outcome.error : undefined,
      );
      outcomes.push({ id: job.id, outcome: outcome.kind });
    } catch (err) {
      await markJob(job, "failed", err instanceof Error ? err.message : String(err));
      outcomes.push({ id: job.id, outcome: "failed" });
    }
  }
  return new Response(JSON.stringify({ processed: jobs.length, outcomes }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

Deno.serve(async () => {
  try {
    return await jobsWorkerHandler();
  } catch (err) {
    console.error("jobs-worker: unhandled error", err);
    return new Response(JSON.stringify({ error: "internal error" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
});
