-- v1b integrity backstops: DB-level guarantees for the derived-state handlers.
-- The worker handlers are idempotent by construction, but idempotency alone cannot
-- survive crash-retries and overlapping invocations (pg_cron fires every minute;
-- a batch slowed by LLM calls can overlap the next claim). These backstops make
-- the races harmless at the only layer that can: the database.

-- ── collectibles: mint-once backstops ────────────────────────────────────────
-- A milestone badge exists at most once per milestone, a goal trophy at most once
-- per goal. The worker inserts and treats a unique violation as "already minted"
-- (same pattern as evidence_idempotency_idx / notifications_dedup_idx), so a
-- crash-retry that lost the minted_collectible_id anchor — or two overlapping
-- invocations racing on the final milestones — can never produce duplicate rows.
create unique index collectibles_badge_once_idx
  on collectibles (milestone_id) where kind = 'milestone_badge' and milestone_id is not null;
create unique index collectibles_trophy_once_idx
  on collectibles (goal_id) where kind = 'goal_trophy' and goal_id is not null;

-- ── pets: monotonic recompute upsert ─────────────────────────────────────────
-- pet.xp is RECOMPUTED from the append-only completion stream, so it is
-- monotonically non-decreasing. A stale concurrent grow_pet (read before a newer
-- completion landed, written after) must never regress the materialized row:
-- greatest() keeps the higher xp, and the stage follows whichever xp wins (the
-- caller derives stage from xp, so the paired stage is correct for its xp).
-- Stage thresholds stay in @core (stageForXp) — this function only arbitrates.
create or replace function upsert_pet_monotonic(
  p_goal_id uuid,
  p_owner_id uuid,
  p_xp int,
  p_stage text
) returns public.pets
language sql
set search_path = ''
as $$
  insert into public.pets (goal_id, owner_id, xp, stage, updated_at)
  values (p_goal_id, p_owner_id, p_xp, p_stage, now())
  on conflict (goal_id) do update set
    xp = greatest(pets.xp, excluded.xp),
    stage = case when excluded.xp >= pets.xp then excluded.stage else pets.stage end,
    updated_at = excluded.updated_at
  returning *;
$$;
-- Service-role only (pets are Group B: derived state, anti-cheat). Revoking
-- PUBLIC drops the default grant for every role, so service_role must be
-- granted back explicitly (same pattern as 0007 get_app_secret).
revoke execute on function upsert_pet_monotonic(uuid, uuid, int, text)
  from public, anon, authenticated;
grant execute on function upsert_pet_monotonic(uuid, uuid, int, text)
  to service_role;

-- ── jobs: real retries (requeue + stale-running reclaim) ─────────────────────
-- Without this, a transient error or a worker crash permanently loses the job's
-- derived state (pet growth / badge / celebration), and the dead row's dedup_key
-- blocks any re-enqueue forever. Two complementary mechanisms, both capped at
-- 5 attempts (mirrored by MAX_ATTEMPTS in the jobs-worker entry):
--   * transient handler errors: the worker requeues the job itself with
--     exponential run_after backoff (status flips back to 'queued');
--   * crashes (worker died mid-batch, markJob never ran): claim_jobs reclaims
--     jobs stuck in 'running' for over 10 minutes.
alter table jobs add column claimed_at timestamptz;
create index jobs_running_reclaim_idx on jobs (claimed_at) where status = 'running';

create or replace function claim_jobs(batch int default 10) returns setof public.jobs
language sql
set search_path = ''
as $$
  -- Dead-letter sweep: a stale 'running' job that exhausted its attempts is
  -- terminal — flip it to 'failed' so operators can see it (it would otherwise
  -- sit invisibly in 'running' forever).
  update public.jobs
  set status = 'failed',
      last_error = coalesce(last_error, 'worker crashed; attempts exhausted')
  where status = 'running'
    and coalesce(claimed_at, created_at) < now() - interval '10 minutes'
    and attempts >= 5;

  -- Atomic batch claim: due queued jobs, plus stale 'running' jobs (crashed
  -- worker) still below the attempts cap. FOR UPDATE SKIP LOCKED keeps
  -- overlapping invocations from claiming the same row.
  update public.jobs
  set status = 'running', attempts = attempts + 1, claimed_at = now()
  where id in (
    select id from public.jobs
    where (status = 'queued' and run_after <= now())
       or (status = 'running'
           and coalesce(claimed_at, created_at) < now() - interval '10 minutes'
           and attempts < 5)
    order by run_after
    for update skip locked
    limit batch
  )
  returning *;
$$;
