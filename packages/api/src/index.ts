/**
 * @aimcub/api-client — data-access layer.
 *
 * The contract ({@link AimcubRepo}) is the single seam every client and edge function
 * goes through; no consumer builds its own queries. Two implementations ship:
 *  - {@link SupabaseAimcubRepo} — production, on `@supabase/supabase-js` (PostgREST + RLS),
 *    with the user (RLS-bound) path separated from the service_role (RLS-bypassing) path.
 *  - {@link InMemoryAimcubRepo} — tests + local dev; enforces the same invariants in TS.
 */

// Contract (the frozen seam).
export type {
  CreateGoalInput,
  AimcubRepo,
  IngestEvidenceInput,
  SupabaseClientConfig,
} from "./contract.js";

// Supabase implementation + its structural client port.
export {
  SupabaseAimcubRepo,
  createSupabaseRepo,
  RepoError,
} from "./supabase.js";
export type {
  SupabaseLike,
  SupabaseFactory,
  SupabaseRepoConfig,
  TableBuilder,
  FilterBuilder,
  PostgrestResult,
} from "./supabase.js";

// In-memory implementation (tests / local dev).
export { InMemoryAimcubRepo, InvariantError } from "./in-memory.js";
export type { InMemoryDeps, InMemorySeed } from "./in-memory.js";
