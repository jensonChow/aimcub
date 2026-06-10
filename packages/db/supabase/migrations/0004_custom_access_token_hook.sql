-- Auth Path A (AUTH_FINDINGS.md): stamp a fixed per-OAuth-client `aud` so the MCP
-- resource server can hard-assert aud === its canonical URI.
-- Config-driven: the client_id -> audience mapping lives in a table, so registering
-- the MCP OAuth client later is an INSERT, not a function change.
-- NOTE: the hook itself must still be enabled in Dashboard -> Auth -> Hooks
-- (Custom Access Token = pg-functions://postgres/public/custom_access_token).

create table if not exists auth_client_audiences (
  client_id text primary key,
  audience text not null,
  note text not null default '',
  created_at timestamptz not null default now()
);

alter table auth_client_audiences enable row level security;
-- No authenticated/anon policies: users never see this table. The auth service reads it.
create policy "auth_admin_select" on auth_client_audiences
  for select to supabase_auth_admin using (true);

create or replace function public.custom_access_token(event jsonb) returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  claims jsonb := event->'claims';
  cid text := event->>'client_id';
  mapped text;
begin
  if cid is not null then
    select audience into mapped
      from public.auth_client_audiences
      where client_id = cid;
    if mapped is not null then
      claims := jsonb_set(claims, '{aud}', to_jsonb(mapped));
      event := jsonb_set(event, '{claims}', claims);
    end if;
  end if;
  return event;
end;
$$;

-- The hook runs as supabase_auth_admin; nobody else may execute it.
grant usage on schema public to supabase_auth_admin;
grant select on table public.auth_client_audiences to supabase_auth_admin;
grant execute on function public.custom_access_token(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token(jsonb) from authenticated, anon, public;
