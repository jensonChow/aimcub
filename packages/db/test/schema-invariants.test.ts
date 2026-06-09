/**
 * Schema invariant guard.
 *
 * The DB is the single source of truth and these constraints are load-bearing for the whole
 * product's anti-cheat / idempotency story. This test fails loudly if a future migration edit
 * silently drops one of them. It is a static SQL-text assertion (no Postgres needed): a thin
 * tripwire, not a substitute for `supabase db reset` integration tests.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(
  join(here, "..", "supabase", "migrations", "0001_init.sql"),
  "utf8",
);

/** Collapse whitespace so multi-line DDL matches regardless of formatting. */
const flat = sql.replace(/\s+/g, " ");

describe("0001_init.sql — core invariants", () => {
  it("evidence is idempotent: unique on (emitter_id, source_event_id) where source_event_id is not null", () => {
    expect(flat).toMatch(
      /create unique index evidence_idempotency_idx on evidence \(emitter_id, source_event_id\) where source_event_id is not null/i,
    );
  });

  it("milestone_completions: milestone_id is unique (a node completes once)", () => {
    expect(flat).toMatch(/milestone_id uuid not null unique references milestones/i);
  });

  it("pets: one pet per goal (goal_id unique)", () => {
    expect(flat).toMatch(/goal_id uuid not null unique references goals/i);
  });

  it("evidence emitter-owner guard trigger exists", () => {
    expect(flat).toMatch(/create trigger evidence_emitter_owner_guard/i);
    expect(flat).toMatch(/function assert_evidence_emitter_owner\(\)/i);
  });

  it("jobs dedup_key is unique where not null (enqueue-once)", () => {
    expect(flat).toMatch(
      /create unique index jobs_dedup_idx on jobs \(dedup_key\) where dedup_key is not null/i,
    );
  });

  it("RLS is enabled and the security groups match the contract", () => {
    // Group A: user read + write.
    expect(flat).toMatch(/array\['goals','emitters','memories'\]/i);
    // Group B: user read-only (writes via service_role).
    expect(flat).toContain(
      "'milestones','evidence','milestone_completions','pets','collectibles','notifications','subscriptions'",
    );
    // jobs: RLS on, no authenticated policy.
    expect(flat).toMatch(/alter table jobs enable row level security/i);
  });

  it("worker claim is concurrency-safe (FOR UPDATE SKIP LOCKED)", () => {
    expect(flat).toMatch(/for update skip locked/i);
    expect(flat).toMatch(/function claim_jobs\(batch int default 10\)/i);
  });
});
