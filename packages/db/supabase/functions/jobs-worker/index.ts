// @ts-nocheck — Deno Edge Function entry; typechecked under Deno, not the Node/tsc
// build for this package. Excluded from `tsc` via tsconfig and never imported by tests.
/**
 * Supabase Edge Function: `jobs-worker` — LIVE wiring (v1a).
 *
 * Triggered by pg_cron every minute (net.http_post with the project anon key —
 * the platform's verify_jwt gate authenticates the call). Thin Deno entry:
 *   - atomically claims a batch of queued jobs via the `claim_jobs` RPC
 *     (FOR UPDATE SKIP LOCKED, attempts incremented by the function),
 *   - delegates each to the pure `runJob` (in `_shared/worker.ts`),
 *   - marks each job done/failed.
 *
 * Deploy note: at deploy time `../_shared/*` is bundled as `./_shared/*` and
 * `@core/*` resolves via the function's deno.json import map to vendored sources.
 * This file MUST NOT be imported by the Vitest suite.
 *
 * deno-lint-ignore-file
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { runJob, type WorkerDeps } from "../_shared/worker.ts";
import type { CompletionWrite, JobEnqueue, WorkerRepo } from "../_shared/ports.ts";
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
      await supabase
        .from("milestones")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", write.milestoneId);
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
};

function buildRealDeps(): WorkerDeps {
  return { repo, now: () => new Date() };
}

async function claimJobs(batch: number): Promise<Job[]> {
  const { data, error } = await supabase.rpc("claim_jobs", { batch });
  if (error) throw new Error(`claim_jobs: ${error.message}`);
  return data ?? [];
}

async function markJob(job: Job, status: "done" | "failed", errorMsg?: string): Promise<void> {
  const { error } = await supabase
    .from("jobs")
    .update({ status, last_error: errorMsg ?? null })
    .eq("id", job.id);
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

Deno.serve(async (_req: Request) => {
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
