/**
 * @core/api-client — data-access layer.
 *
 * The contract ({@link GoalPetRepo}) is the single seam every client and edge function
 * goes through; no consumer builds its own queries. Two implementations ship:
 *  - {@link SupabaseGoalPetRepo} — production, on `@supabase/supabase-js` (PostgREST + RLS),
 *    with the user (RLS-bound) path separated from the service_role (RLS-bypassing) path.
 *  - {@link InMemoryGoalPetRepo} — tests + local dev; enforces the same invariants in TS.
 */

// Contract (the frozen seam).
export type {
  CreateGoalInput,
  GoalPetRepo,
  IngestEvidenceInput,
  SupabaseClientConfig,
} from "./contract.js";

// Supabase implementation + its structural client port.
export {
  SupabaseGoalPetRepo,
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
export { InMemoryGoalPetRepo, InvariantError } from "./in-memory.js";
export type { InMemoryDeps, InMemorySeed } from "./in-memory.js";
