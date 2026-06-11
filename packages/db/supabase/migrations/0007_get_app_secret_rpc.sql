-- 0007_get_app_secret_rpc
-- Backfill of the migration applied live on 2026-06-10 (version 20260610111258).
--
-- Edge Functions read GitHub App secrets (webhook secret / client secret / PEM)
-- from Supabase Vault. The `vault` schema is not exposed through PostgREST, so
-- this SECURITY DEFINER RPC is the single sanctioned read path. Execution is
-- restricted to service_role: anon/authenticated must never reach Vault.

create or replace function public.get_app_secret(secret_name text)
returns text
language sql
security definer
set search_path to ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = secret_name
$$;

revoke all on function public.get_app_secret(text) from public;
revoke all on function public.get_app_secret(text) from anon;
revoke all on function public.get_app_secret(text) from authenticated;
grant execute on function public.get_app_secret(text) to service_role;
