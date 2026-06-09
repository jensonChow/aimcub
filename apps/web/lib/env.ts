/**
 * Environment access. Secrets are read from process.env ONLY — never hardcoded, never
 * required for the app to boot. v1a runs fully on mocks; these values document the live
 * wiring points and gate whether a real backend could be used.
 */
export interface AppEnv {
  /** Set when a real Supabase project is configured. */
  supabaseUrl: string | undefined;
  /** Public anon key (client-safe). */
  supabaseAnonKey: string | undefined;
  /** Present only server-side; used by the (future) decomposition Edge Function, never the browser. */
  anthropicApiKey: string | undefined;
}

export function readEnv(): AppEnv {
  return {
    // TODO(v1a-live): when these are set, prefer SupabaseDataPort / SupabaseRealtime over the mocks.
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  };
}

/** True when a live Supabase backend is fully configured. v1a: always false → use mocks. */
export function hasLiveBackend(): boolean {
  const env = readEnv();
  return Boolean(env.supabaseUrl && env.supabaseAnonKey);
}
