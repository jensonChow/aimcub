import { defineConfig } from "vitest/config";

/**
 * Vitest config for @aimcub/db. Runs two test suites:
 *  - test/**            — static schema-invariant tripwires over the SQL migration.
 *  - supabase/functions — the Edge Function *shared* logic (ingest / jobs worker).
 *
 * The shared modules use explicit `.ts` import specifiers (Deno convention); Vite
 * resolves those natively, so the same source runs under both Node (these tests)
 * and the Deno Edge Runtime (deploy time). The thin Deno entry wrappers
 * (functions/ingest, functions/jobs-worker) are not *.test.ts and touch Deno
 * globals + live I/O, so they are never picked up or imported by tests.
 */
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "supabase/functions/**/*.test.ts"],
    environment: "node",
  },
});
