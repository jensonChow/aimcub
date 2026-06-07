-- GoalPet 初始 schema(精简 MVP)。
-- 设计原则:
--  * Supabase 为唯一事实源;证据 append-only + 幂等;完成/宠物/收藏是派生状态。
--  * 每业务表带 owner_id(RLS 锚点,冗余以避免 RLS 内 join)。
--  * 枚举用 text + CHECK(易演进);union 类型的单一事实源是 @core/types(zod)。
--  * 复杂度刻意精简:jobs 表 + pg_cron(非 pgmq);线性 depends_on_id(非 DAG 边表)。

-- ── 扩展 ────────────────────────────────────────────────────────────────────
create extension if not exists pgcrypto;      -- gen_random_uuid()
-- pg_cron / pg_net 在 Supabase 控制台或部署脚本启用(jobs worker 调度用):
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
  plan_json jsonb,                 -- 当前拆解快照(代替重型 milestone_versions)
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
  depends_on_id uuid references milestones (id) on delete set null, -- 单父线性/浅树
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

-- ── emitters(证据发射器:mcp / github / ci / manual)─────────────────────────
create table emitters (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('mcp_agent','github','ci','manual','calendar','custom_webhook')),
  display_name text not null default '',
  token_hash text,                 -- 只存 hash,明文仅创建时返回一次
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index emitters_owner_idx on emitters (owner_id);
create unique index emitters_token_hash_idx on emitters (token_hash) where revoked_at is null;

-- ── evidence(append-only 事实流 + 幂等键)──────────────────────────────────--
create table evidence (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  goal_id uuid not null references goals (id) on delete cascade,
  milestone_id uuid references milestones (id) on delete set null, -- 可空:待分诊
  emitter_id uuid references emitters (id) on delete set null,
  kind text not null check (kind in (
    'git_commit','pr_opened','pr_merged','ci_passed','ci_failed',
    'mcp_report','manual_check','file_artifact','external_event','note')),
  source_event_id text,            -- 上游原生 id;与 emitter_id 组成幂等键
  occurred_at timestamptz not null,
  summary text not null default '',
  payload jsonb not null default '{}',
  trust_score numeric not null default 1 check (trust_score >= 0 and trust_score <= 1),
  created_at timestamptz not null default now()
);
-- ★ 幂等:同一上游事件(emitter + source_event_id)只入一次
create unique index evidence_idempotency_idx
  on evidence (emitter_id, source_event_id) where source_event_id is not null;
create index evidence_milestone_idx on evidence (milestone_id, occurred_at desc);
create index evidence_triage_idx on evidence (goal_id) where milestone_id is null;
create index evidence_owner_idx on evidence (owner_id);

-- 安全护栏(P1-7):证据的 emitter 必须属于同一 owner,防跨用户写证据。
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

-- ── milestone_completions(完成幂等)─────────────────────────────────────────
create table milestone_completions (
  id uuid primary key default gen_random_uuid(),
  milestone_id uuid not null unique references milestones (id) on delete cascade, -- 一节点只完成一次
  owner_id uuid not null references auth.users (id) on delete cascade,
  decided_by text not null check (decided_by in ('rule_auto','user_confirm','agent_suggest')),
  triggering_evidence_ids uuid[] not null default '{}',
  awarded_xp int not null default 0,
  minted_collectible_id uuid,
  created_at timestamptz not null default now()
);
create index milestone_completions_owner_idx on milestone_completions (owner_id);

-- ── pets(★ 每目标一只)──────────────────────────────────────────────────────
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

-- ── collectibles(确定性稀有度)──────────────────────────────────────────────
create table collectibles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  goal_id uuid references goals (id) on delete set null,        -- 收藏永久保留,不随节点级联删除
  milestone_id uuid references milestones (id) on delete set null,
  kind text not null default 'milestone_badge'
    check (kind in ('milestone_badge','goal_trophy','achievement','seasonal')),
  rarity text not null check (rarity in ('common','uncommon','rare','epic','legendary')),
  metadata jsonb not null default '{}',  -- 铸造瞬间快照:goal 名/耗时/commit 数
  image_url text,
  minted_at timestamptz not null default now()
);
create index collectibles_owner_idx on collectibles (owner_id, minted_at desc);

-- ── memories(v1 单表,无向量;含写入侧 confidence/status)─────────────────────
create table memories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  goal_id uuid references goals (id) on delete cascade,        -- null = 用户级全局记忆
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

-- ── subscriptions(统一 entitlement:stripe / appstore 多支付源归一)──────────--
create table subscriptions (
  owner_id uuid not null references auth.users (id) on delete cascade,
  source text not null check (source in ('stripe','appstore','playstore')),
  tier text not null default 'free' check (tier in ('free','pro')),
  expires_at timestamptz,
  primary key (owner_id, source)
);

-- ── jobs(代替 pgmq:一张表 + pg_cron 轮询 + FOR UPDATE SKIP LOCKED)───────────
create table jobs (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in
    ('judge_evidence','grow_pet','mint_collectible','deliver_notification','extract_memory')),
  payload jsonb not null default '{}',
  status text not null default 'queued' check (status in ('queued','running','done','failed')),
  dedup_key text,                  -- 幂等键:同一逻辑事件只入一次
  run_after timestamptz not null default now(),
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now()
);
create index jobs_claim_idx on jobs (status, run_after) where status = 'queued';
create unique index jobs_dedup_idx on jobs (dedup_key) where dedup_key is not null;

-- worker 原子取批:并发安全,跳过被占用行。由 Edge Function(pg_cron 每分钟触发)调用。
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

-- ── RLS:四端共享同一套策略。owner = auth.uid()。机器写入走 service_role(绕过 RLS)。──
-- 2026 最佳实践:(select auth.uid()) 触发 initPlan 缓存;TO authenticated 短路 anon;
-- 引用列(owner_id)均已建索引。
--
-- 安全分组(命门:防伪造):
--  * 组 A —— 用户可直接读写(own CRUD):goals / emitters / memories。
--      用户创建目标、生成 emitter token、增删自己的记忆(被遗忘权)。
--  * 组 B —— 用户只读;写入只能走 service_role(Edge Function / 判定 worker)。
--      milestones(由拆解生成、状态服务端判定)、evidence(摄取入口写)、
--      milestone_completions / pets / collectibles(派生状态,防刷)、
--      notifications、subscriptions(entitlement 由支付 webhook 写,绝不许用户自设 pro)。
--  * jobs —— 内部表:RLS 开,无 authenticated 策略 → 用户读写全拒;service_role 绕过。

-- 组 A:读 + 写
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

-- 组 B:仅读(写入走 service_role)
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

-- jobs 为内部表:启用 RLS 但不给 authenticated 任何策略。
alter table jobs enable row level security;
