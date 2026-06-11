-- H1 instrumentation (lean): one activity ping per user per day + two weekly cohort views.
-- The falsifiable H1 signal is WMCU (weekly milestone-completing users) against weekly
-- actives: evidence-driven completion — not app opens — is the value moment we measure.

-- ── activity_pings (web fires one fire-and-forget upsert per signed-in day) ──
create table activity_pings (
  owner_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, day)
);

-- RLS: users may insert/read their own pings only. Aggregation runs as service_role.
alter table activity_pings enable row level security;
create policy "own_select" on activity_pings for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy "own_insert" on activity_pings for insert to authenticated
  with check ((select auth.uid()) = owner_id);

-- ── weekly cohort views ──────────────────────────────────────────────────────
-- security_invoker: the caller's RLS applies to the underlying tables (no bypass);
-- query as service_role for the global series.

-- WMCU (H1 numerator): distinct owners with >=1 milestone completion per ISO week.
create view wmcu_weekly with (security_invoker = true) as
select
  (date_trunc('week', created_at))::date as week_start,
  count(distinct owner_id) as active_owners
from milestone_completions
group by 1
order by 1;

-- Weekly actives (H1 denominator): distinct owners with >=1 activity ping per ISO week.
create view weekly_active with (security_invoker = true) as
select
  (date_trunc('week', day))::date as week_start,
  count(distinct owner_id) as active_owners
from activity_pings
group by 1
order by 1;
