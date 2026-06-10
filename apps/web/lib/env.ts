/**
 * Environment access. Secrets are read from process.env ONLY — never hardcoded, never
 * required for the app to boot. With no env the app runs fully on mocks; with
 * NEXT_PUBLIC_SUPABASE_* set the live Supabase ports take over.
 */
export interface AppEnv {
  /** Set when a real Supabase project is configured. */
  supabaseUrl: string | undefined;
  /** Public anon key (client-safe). */
  supabaseAnonKey: string | undefined;
  /** Present only server-side; enables the live Claude decomposition. Never sent to the browser. */
  anthropicApiKey: string | undefined;
  /** service_role key — server-only; powers the milestone-materialization write path. */
  serviceRoleKey: string | undefined;
}

export function readEnv(): AppEnv {
  return {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
}

/** True when a live Supabase backend is configured → SupabaseDataPort / SupabaseRealtime take over. */
export function hasLiveBackend(): boolean {
  const env = readEnv();
  return Boolean(env.supabaseUrl && env.supabaseAnonKey);
}
