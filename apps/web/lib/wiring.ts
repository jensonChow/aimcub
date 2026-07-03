/**
 * Composition root: picks which DataPort the app uses.
 *
 * - Live (NEXT_PUBLIC_SUPABASE_* set): a fresh SupabaseDataPort PER REQUEST — the user
 *   client is cookie-bound, so it must never be cached across requests.
 * - Mock (no env): a module-level MockGoalRepo singleton keeps the in-memory state stable
 *   across server-component renders within one process (zero-backend demo).
 *
 * Nothing else in the app knows which one it got.
 */
import type { DataPort } from "./data-port";
import { hasLiveBackend } from "./env";
import { SupabaseDataPort } from "./live-port";
import { MockGoalRepo } from "./mock-repo";
import { createAdminSupabase, createServerSupabase } from "./supabase/server-clients";

type AimcubGlobal = typeof globalThis & {
  __aimcubMockDataPort?: DataPort;
};

function getMockDataPort(): DataPort {
  const globalState = globalThis as AimcubGlobal;
  globalState.__aimcubMockDataPort ??= new MockGoalRepo();
  return globalState.__aimcubMockDataPort;
}

export function getDataPort(): DataPort {
  if (hasLiveBackend()) {
    return new SupabaseDataPort(createServerSupabase(), createAdminSupabase());
  }
  return getMockDataPort();
}
