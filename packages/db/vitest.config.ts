import { defineConfig } from "vitest/config";

/**
 * Vitest config for @core/db.
 *
 * Only the Edge Function *shared* logic + its tests run here. The shared modules
 * use explicit `.ts` import specifiers (Deno convention); Vite resolves those
 * natively, so the same source runs under both Node (these tests) and the Deno
 * Edge Runtime (deploy time). The thin Deno entry wrappers (functions/ingest,
 * functions/jobs-worker) are excluded — they touch Deno globals and live I/O and
 * are never imported by tests.
 */
export default defineConfig({
  test: {
    include: ["supabase/functions/**/*.test.ts"],
    environment: "node",
  },
});
