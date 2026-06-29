/* eslint-disable @typescript-eslint/ban-ts-comment -- Deno entry, see below */
// @ts-nocheck — Deno Edge Function entry; typechecked under Deno, not the Node/tsc
// build for this package. Excluded from `tsc` via tsconfig and never imported by tests.
/**
 * Supabase Edge Function: `jobs-worker` — LIVE wiring for the evidence judge.
 *
 * Triggered by pg_cron every minute (net.http_post with the project anon key —
 * the platform's verify_jwt gate authenticates the call). Thin Deno entry:
 *   - atomically claims a batch of due jobs via the `claim_jobs` RPC
 *     (FOR UPDATE SKIP LOCKED, attempts incremented; it also reclaims jobs
 *     stranded in 'running' by a crashed invocation),
 *   - delegates each to the pure `runJob` (in `_shared/worker.ts`),
 *   - marks each job done, requeues failures with backoff below MAX_ATTEMPTS,
 *     or terminally fails them at the cap.
 *
 * Deploy note: at deploy time `../_shared/*` is bundled as `./_shared/*` and
 * `@core/*` resolves via the function's deno.json import map to vendored sources.
 * This file MUST NOT be imported by the Vitest suite.
 *
 * deno-lint-ignore-file
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { runJob, type WorkerDeps } from "../_shared/worker.ts";
import type { CompletionWrite, WorkerRepo } from "../_shared/ports.ts";
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
};

function buildRealDeps(): WorkerDeps {
  return { repo, now: () => new Date() };
}

async function claimJobs(batch: number): Promise<Job[]> {
  const { data, error } = await supabase.rpc("claim_jobs", { batch });
  if (error) throw new Error(`claim_jobs: ${error.message}`);
  return data ?? [];
}

/** Mirrors the attempts cap in claim_jobs' stale-running reclaim. */
const MAX_ATTEMPTS = 5;

/**
 * Finalize a claimed job. Failures below MAX_ATTEMPTS requeue with exponential
 * run_after backoff (1m, 2m, 4m, … capped at 1h) — judge_evidence is idempotent
 * by construction, so retries are safe and derived state converges back to the
 * completions stream instead of being lost to one transient error. At the cap
 * the job is terminally 'failed' (operator-visible). If THIS update itself
 * fails, the job stays 'running' and claim_jobs' stale reclaim retries it.
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
