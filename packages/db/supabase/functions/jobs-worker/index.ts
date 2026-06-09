// @ts-nocheck — Deno Edge Function entry; typechecked under Deno, not the Node/tsc
// build for this package. Excluded from `tsc` via tsconfig and never imported by tests.
/**
 * Supabase Edge Function: `jobs-worker`.
 *
 * Thin Deno entry wrapper. Triggered by pg_cron (every minute). ALL it does is:
 *   - build the REAL deps (service-role Supabase client),
 *   - atomically claim a batch of queued jobs via the `claim_jobs` RPC,
 *   - delegate each to the pure `runJob` (in `_shared/worker.ts`),
 *   - mark each job done/failed.
 *
 * Every live wire is tagged `// TODO(v1a-live)`. This file MUST NOT be imported by
 * the Vitest suite — the pure handler is what tests drive.
 *
 * deno-lint-ignore-file
 */

// TODO(v1a-live): Deno/URL imports resolved at deploy time on Supabase Edge Runtime.
//   import { createClient } from "jsr:@supabase/supabase-js@2";
import { runJob, type WorkerDeps } from "../_shared/worker.ts";
import type { CompletionWrite, JobEnqueue, WorkerRepo } from "../_shared/ports.ts";
import type { Job } from "@core/types";

// TODO(v1a-live): read from Deno.env; never hardcode. Tests never reach this file.
declare const Deno: { env: { get(key: string): string | undefined }; serve?: unknown };

function buildRealDeps(): WorkerDeps {
  // TODO(v1a-live): construct the service-role Supabase client (bypasses RLS).
  //   const supabase = createClient(
  //     Deno.env.get("SUPABASE_URL")!,
  //     Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  //   );

  const repo: WorkerRepo = {
    async getMilestone(_milestoneId: string) {
      // TODO(v1a-live): select * from milestones where id = $1.
      throw new Error("not wired: getMilestone");
    },
    async listEvidenceForMilestone(_milestoneId: string) {
      // TODO(v1a-live): select * from evidence where milestone_id = $1
      //   (optionally union goal-level untriaged evidence) order by occurred_at.
      throw new Error("not wired: listEvidenceForMilestone");
    },
    async getCompletion(_milestoneId: string) {
      // TODO(v1a-live): select * from milestone_completions where milestone_id = $1.
      throw new Error("not wired: getCompletion");
    },
    async insertCompletion(_write: CompletionWrite) {
      // TODO(v1a-live): insert into milestone_completions (...) on conflict
      //   (milestone_id) do nothing returning *; created = (row was returned).
      throw new Error("not wired: insertCompletion");
    },
    async enqueueJob(_job: JobEnqueue) {
      // TODO(v1a-live): insert into jobs (...) on conflict (dedup_key) do nothing.
      throw new Error("not wired: enqueueJob");
    },
  };

  return { repo, now: () => new Date() };
}

// TODO(v1a-live): claim a batch via the claim_jobs RPC (FOR UPDATE SKIP LOCKED).
//   const { data: jobs } = await supabase.rpc("claim_jobs", { batch: 10 });
async function claimJobs(_batch: number): Promise<Job[]> {
  throw new Error("not wired: claimJobs");
}

// TODO(v1a-live): mark a job's terminal state.
//   await supabase.from("jobs").update({ status, last_error }).eq("id", job.id);
async function markJob(_job: Job, _status: "done" | "failed", _error?: string): Promise<void> {
  throw new Error("not wired: markJob");
}

// TODO(v1a-live): the pg_cron-triggered entry point.
export async function jobsWorkerHandler(): Promise<Response> {
  const deps = buildRealDeps();
  const jobs = await claimJobs(10);
  for (const job of jobs) {
    try {
      const outcome = await runJob(deps, job);
      await markJob(job, outcome.kind === "error" ? "failed" : "done");
    } catch (err) {
      await markJob(job, "failed", err instanceof Error ? err.message : String(err));
    }
  }
  return new Response(JSON.stringify({ processed: jobs.length }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
