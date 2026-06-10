/**
 * Session helpers (server only). In live mode the owner is the authenticated
 * Supabase user; in mock mode it is the fixed demo owner so the app keeps working
 * with zero backend.
 */
import { hasLiveBackend } from "./env";
import { DEMO_OWNER_ID } from "./mock-repo";
import { createServerSupabase } from "./supabase/server-clients";

export interface SessionUser {
  id: string;
  email: string | null;
}

/** The signed-in user, or the demo owner in mock mode, or null (live + signed out). */
export async function getSessionUser(): Promise<SessionUser | null> {
  if (!hasLiveBackend()) {
    return { id: DEMO_OWNER_ID, email: null };
  }
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return { id: user.id, email: user.email ?? null };
}
