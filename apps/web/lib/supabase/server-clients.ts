/**
 * Server-side Supabase clients. SERVER ONLY — never import from a client component.
 *
 * - `createServerSupabase()` — cookie-bound client (@supabase/ssr): RLS resolves
 *   `auth.uid()` to the signed-in user. Build one PER REQUEST (cookies differ).
 * - `createAdminSupabase()` — service_role client that BYPASSES RLS. Used only for
 *   the server write path (milestone materialization); requires
 *   SUPABASE_SERVICE_ROLE_KEY, which exists only in server env (Vercel / local).
 */
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { readEnv } from "../env";

export function createServerSupabase(): SupabaseClient {
  const env = readEnv();
  if (!env.supabaseUrl || !env.supabaseAnonKey) {
    throw new Error("createServerSupabase called without NEXT_PUBLIC_SUPABASE_URL/_ANON_KEY");
  }
  const store = cookies();
  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return store.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Called from a Server Component (read-only cookies): safe to ignore —
          // the middleware refreshes the session cookie instead.
        }
      },
    },
  });
}

export function createAdminSupabase(): SupabaseClient {
  const env = readEnv();
  if (!env.supabaseUrl) {
    throw new Error("createAdminSupabase called without NEXT_PUBLIC_SUPABASE_URL");
  }
  if (!env.serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set — the server write path (milestone materialization) needs it",
    );
  }
  return createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
