-- GoalPet initial schema (lean MVP).
-- Design principles:
--  * Supabase is the single source of truth; evidence is append-only + idempotent; completions/pets/collectibles are derived state.
--  * Every business table carries owner_id (the RLS anchor; denormalized to avoid joins inside RLS).
--  * Enums use text + CHECK (easy to evolve); the single source of truth for union types is @core/types (zod).
--  * Complexity is intentionally minimized: a jobs table + pg_cron (not pgmq); a linear depends_on_id (not a DAG edge table).

-- ── extensions ──────────────────────────────────────────────────────────────
create extension if not exists pgcrypto;      -- gen_random_uuid()
-- pg_cron / pg_net are enabled in the Supabase dashboard or a deploy script (used to schedule the jobs worker):
--   create extension if not exists pg_cron;
--   create extension if not exists pg_net;

-- ── goals ───────────────────────────────────────────────────────────────────
create table goals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  description text not null default '',
  domain text not null default 'software'
    check (domain in ('software','career','learning','health','creative','custom')),
  status text not null default 'draft'
    check (status in ('draft','active','paused','achieved','abandoned')),
  target_date date,
  plan_json jsonb,                 -- snapshot of the current breakdown (replaces a heavyweight milestone_versions table)
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index goals_owner_status_idx on goals (owner_id, status);

-- ── milestones ────────────────────────────────────────────────────────────--
create table milestones (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references goals (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  description text not null default '',
  status text not null default 'pending'
    check (status in ('pending','in_progress','completed','skipped','blocked')),
  order_index int not null default 0,
  depends_on_id uuid references milestones (id) on delete set null, -- single-parent linear chain / shallow tree
  acceptance_rule jsonb not null default '{}',
  xp_reward int not null default 10,
  rarity text not null default 'common'
    check (rarity in ('common','uncommon','rare','epic','legendary')),
  completed_at timestamptz,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index milestones_goal_status_idx on milestones (goal_id, status);
create index milestones_owner_idx on milestones (owner_id);

-- ── emitters (evidence emitters: mcp / github / ci / manual) ─────────────────
create table emitters (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('mcp_agent','github','ci','manual','calendar','custom_webhook')),
  display_name text not null default '',
  token_hash text,                 -- store only the hash; the plaintext is returned exactly once at creation
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index emitters_owner_idx on emitters (owner_id);
create unique index emitters_token_hash_idx on emitters (token_hash) where revoked_at is null;

-- ── evidence (append-only fact stream + idempotency key) ────────────────────--
create table evidence (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  goal_id uuid not null references goals (id) on delete cascade,
  milestone_id uuid references milestones (id) on delete set null, -- nullable: awaiting triage
  emitter_id uuid references emitters (id) on delete set null,
  kind text not null check (kind in (
    'git_commit','pr_opened','pr_merged','ci_passed','ci_failed',
    'mcp_report','manual_check','file_artifact','external_event','note')),
  source_event_id text,            -- upstream native id; combined with emitter_id to form the idempotency key
  occurred_at timestamptz not null,
  summary text not null default '',
  payload jsonb not null default '{}',
  trust_score numeric not null default 1 check (trust_score >= 0 and trust_score <= 1),
  created_at timestamptz not null default now()
);
-- ★ Idempotency: the same upstream event (emitter + source_event_id) is ingested only once
create unique index evidence_idempotency_idx
  on evidence (emitter_id, source_event_id) where source_event_id is not null;
create index evidence_milestone_idx on evidence (milestone_id, occurred_at desc);
create index evidence_triage_idx on evidence (goal_id) where milestone_id is null;
create index evidence_owner_idx on evidence (owner_id);

-- Security guardrail (P1-7): an evidence row's emitter must belong to the same owner, preventing cross-user evidence writes.
create or replace function assert_evidence_emitter_owner() returns trigger
language plpgsql as $$
begin
  if new.emitter_id is not null then
    if not exists (
      select 1 from emitters e where e.id = new.emitter_id and e.owner_id = new.owner_id
    ) then
      raise exception 'emitter % does not belong to owner %', new.emitter_id, new.owner_id;
    end if;
  end if;
  return new;
end;
$$;
create trigger evidence_emitter_owner_guard
  before insert or update on evidence
  for each row execute function assert_evidence_emitter_owner();

-- ── milestone_completions (idempotent completions) ──────────────────────────
create table milestone_completions (
  id uuid primary key default gen_random_uuid(),
  milestone_id uuid not null unique references milestones (id) on delete cascade, -- a milestone can only be completed once
  owner_id uuid not null references auth.users (id) on delete cascade,
  decided_by text not null check (decided_by in ('rule_auto','user_confirm','agent_suggest')),
  triggering_evidence_ids uuid[] not null default '{}',
  awarded_xp int not null default 0,
  minted_collectible_id uuid,
  created_at timestamptz not null default now()
);
create index milestone_completions_owner_idx on milestone_completions (owner_id);

-- ── pets (★ one per goal) ────────────────────────────────────────────────────
create table pets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  goal_id uuid not null unique references goals (id) on delete cascade,
  species text not null default 'default',
  branch text not null default 'unset' check (branch in ('unset','dragon','bird','turtle','fox')),
  stage text not null default 'egg'
    check (stage in ('egg','baby','adult','juvenile','elder','ascended')),
  xp int not null default 0,
  mood numeric not null default 0.7 check (mood >= 0 and mood <= 1),
  sprite_set text not null default 'default',
  updated_at timestamptz not null default now()
);
create index pets_owner_idx on pets (owner_id);

-- ── collectibles (deterministic rarity) ─────────────────────────────────────
create table collectibles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  goal_id uuid references goals (id) on delete set null,        -- collectibles are kept permanently; they are not cascade-deleted with milestones
  milestone_id uuid references milestones (id) on delete set null,
  kind text not null default 'milestone_badge'
    check (kind in ('milestone_badge','goal_trophy','achievement','seasonal')),
  rarity text not null check (rarity in ('common','uncommon','rare','epic','legendary')),
  metadata jsonb not null default '{}',  -- snapshot at mint time: goal name / elapsed time / commit count
  image_url text,
  minted_at timestamptz not null default now()
);
create index collectibles_owner_idx on collectibles (owner_id, minted_at desc);

-- ── memories (v1 single table, no vectors; includes write-side confidence/status) ─
create table memories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  goal_id uuid references goals (id) on delete cascade,        -- null = user-level global memory
  kind text not null check (kind in ('episodic','semantic','procedural')),
  content text not null,
  confidence numeric not null default 1 check (confidence >= 0 and confidence <= 1),
  source text not null default 'agent_inferred'
    check (source in ('agent_inferred','user_stated','evidence_derived')),
  status text not null default 'active' check (status in ('active','pending','deleted')),
  superseded_by uuid references memories (id) on delete set null,
  created_at timestamptz not null default now()
);
create index memories_owner_kind_idx on memories (owner_id, kind) where status = 'active';

-- ── notifications ─────────────────────────────────────────────────────────--
create table notifications (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  trigger text not null check (trigger in ('milestone_done','goal_done','stale','deadline_near','scheduled')),
  channels text[] not null default '{}',   -- in_app / email / agent_inbox / push / web_push
  dedup_key text,
  ref_goal_id uuid references goals (id) on delete cascade,
  ref_milestone_id uuid references milestones (id) on delete set null,
  persona_msg text not null default '',
  status text not null default 'queued' check (status in ('queued','sent','delivered','failed','suppressed')),
  scheduled_for timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index notifications_dispatch_idx on notifications (status, scheduled_for);
create index notifications_owner_idx on notifications (owner_id);

-- ── subscriptions (unified entitlement: normalizes multiple payment sources, stripe / appstore) ──--
create table subscriptions (
  owner_id uuid not null references auth.users (id) on delete cascade,
  source text not null check (source in ('stripe','appstore','playstore')),
  tier text not null default 'free' check (tier in ('free','pro')),
  expires_at timestamptz,
  primary key (owner_id, source)
);

-- ── jobs (replaces pgmq: one table + pg_cron polling + FOR UPDATE SKIP LOCKED) ─
create table jobs (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in
    ('judge_evidence','grow_pet','mint_collectible','deliver_notification','extract_memory')),
  payload jsonb not null default '{}',
  status text not null default 'queued' check (status in ('queued','running','done','failed')),
  dedup_key text,                  -- idempotency key: the same logical event is enqueued only once
  run_after timestamptz not null default now(),
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now()
);
create index jobs_claim_idx on jobs (status, run_after) where status = 'queued';
create unique index jobs_dedup_idx on jobs (dedup_key) where dedup_key is not null;

-- Worker atomic batch claim: concurrency-safe, skips locked rows. Called by an Edge Function (triggered by pg_cron every minute).
create or replace function claim_jobs(batch int default 10) returns setof jobs
language sql as $$
  update jobs set status = 'running', attempts = attempts + 1
  where id in (
    select id from jobs
    where status = 'queued' and run_after <= now()
    order by run_after
    for update skip locked
    limit batch
  )
  returning *;
$$;

-- ── RLS: all four clients share the same policy set. owner = auth.uid(). Machine writes go through service_role (bypassing RLS). ──
-- 2026 best practice: (select auth.uid()) triggers initPlan caching; TO authenticated short-circuits anon;
-- referenced columns (owner_id) are all indexed.
--
-- Security grouping (the crux: anti-forgery):
--  * Group A — users can read and write directly (own CRUD): goals / emitters / memories.
--      Users create goals, generate emitter tokens, and add/remove their own memories (right to be forgotten).
--  * Group B — users have read-only access; writes can only go through service_role (Edge Function / judging worker).
--      milestones (generated by breakdown, status decided server-side), evidence (written by the ingestion endpoint),
--      milestone_completions / pets / collectibles (derived state, anti-cheat),
--      notifications, subscriptions (entitlement written by the payment webhook; users must never be able to set their own pro tier).
--  * jobs — internal table: RLS on, with no authenticated policy → all user reads/writes are denied; service_role bypasses it.

-- Group A: read + write
do $$
declare t text;
begin
  foreach t in array array['goals','emitters','memories'] loop
    execute format('alter table %I enable row level security;', t);
    execute format($f$create policy "own_select" on %I for select to authenticated
        using ((select auth.uid()) = owner_id);$f$, t);
    execute format($f$create policy "own_write" on %I for all to authenticated
        using ((select auth.uid()) = owner_id)
        with check ((select auth.uid()) = owner_id);$f$, t);
  end loop;
end $$;

-- Group B: read-only (writes go through service_role)
do $$
declare t text;
begin
  foreach t in array array[
    'milestones','evidence','milestone_completions','pets','collectibles','notifications','subscriptions'
  ] loop
    execute format('alter table %I enable row level security;', t);
    execute format($f$create policy "own_select" on %I for select to authenticated
        using ((select auth.uid()) = owner_id);$f$, t);
  end loop;
end $$;

-- jobs is an internal table: enable RLS but grant authenticated no policy at all.
alter table jobs enable row level security;
