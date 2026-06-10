-- Security-advisor fixes:
--  * pin search_path on both SECURITY-relevant functions (lint 0011);
--  * move pg_net out of the public schema (lint 0014).
-- The jobs "RLS enabled, no policy" INFO is intentional: authenticated users get no access; only service_role touches jobs.

create or replace function assert_evidence_emitter_owner() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.emitter_id is not null then
    if not exists (
      select 1 from public.emitters e where e.id = new.emitter_id and e.owner_id = new.owner_id
    ) then
      raise exception 'emitter % does not belong to owner %', new.emitter_id, new.owner_id;
    end if;
  end if;
  return new;
end;
$$;

create or replace function claim_jobs(batch int default 10) returns setof public.jobs
language sql
set search_path = ''
as $$
  update public.jobs set status = 'running', attempts = attempts + 1
  where id in (
    select id from public.jobs
    where status = 'queued' and run_after <= now()
    order by run_after
    for update skip locked
    limit batch
  )
  returning *;
$$;

drop extension if exists pg_net;
create extension pg_net with schema extensions;
