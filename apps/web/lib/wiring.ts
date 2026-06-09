/**
 * Composition root: picks which DataPort the app uses. Today that is always the in-memory
 * mock; once a live backend is configured the SupabaseDataPort would take over here, and
 * nothing else in the app changes.
 *
 * A module-level singleton keeps the mock's in-memory state stable across server-component
 * renders within a single process (good enough for a local demo; not multi-user).
 *
 * TODO(v1a-live): if hasLiveBackend(), return a SupabaseDataPort instead of the mock.
 */
import type { DataPort } from "./data-port";
import { hasLiveBackend } from "./env";
import { MockGoalRepo } from "./mock-repo";

let singleton: DataPort | null = null;

export function getDataPort(): DataPort {
  if (singleton) return singleton;
  if (hasLiveBackend()) {
    // TODO(v1a-live): singleton = new SupabaseDataPort(readEnv()); — falls through to mock for now.
  }
  singleton = new MockGoalRepo();
  return singleton;
}
