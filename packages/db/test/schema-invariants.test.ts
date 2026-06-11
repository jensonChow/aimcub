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

/** Collapse whitespace so multi-line DDL matches regardless of formatting. */
function flatMigration(name: string): string {
  const sql = readFileSync(join(here, "..", "supabase", "migrations", name), "utf8");
  return sql.replace(/\s+/g, " ");
}

const flat = flatMigration("0001_init.sql");
const flatV1b = flatMigration("0008_v1b_realtime_and_dedup.sql");
const flatMetrics = flatMigration("0009_metrics.sql");
const flatBackstops = flatMigration("0010_v1b_integrity_backstops.sql");

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

describe("0008_v1b_realtime_and_dedup.sql — v1b invariants", () => {
  it("pets are broadcast over realtime (live pet growth in the UI)", () => {
    expect(flatV1b).toMatch(/alter publication supabase_realtime add table pets/i);
  });

  it("notifications are broadcast over realtime (live celebrations)", () => {
    expect(flatV1b).toMatch(
      /alter publication supabase_realtime add table notifications/i,
    );
  });

  it("notifications dedup_key is unique where not null (deliver-once)", () => {
    expect(flatV1b).toMatch(
      /create unique index notifications_dedup_idx on notifications \(dedup_key\) where dedup_key is not null/i,
    );
  });
});

describe("0010_v1b_integrity_backstops.sql — race/retry backstops", () => {
  it("collectibles: at most one badge per milestone (partial unique index)", () => {
    expect(flatBackstops).toMatch(
      /create unique index collectibles_badge_once_idx on collectibles \(milestone_id\) where kind = 'milestone_badge' and milestone_id is not null/i,
    );
  });

  it("collectibles: at most one trophy per goal (partial unique index)", () => {
    expect(flatBackstops).toMatch(
      /create unique index collectibles_trophy_once_idx on collectibles \(goal_id\) where kind = 'goal_trophy' and goal_id is not null/i,
    );
  });

  it("pets: the recompute upsert is monotonic (greatest keeps the higher xp)", () => {
    expect(flatBackstops).toMatch(/function upsert_pet_monotonic/i);
    expect(flatBackstops).toMatch(/greatest\(pets\.xp, excluded\.xp\)/i);
    // Service-role only: derived state stays anti-cheat (Group B).
    expect(flatBackstops).toMatch(
      /revoke execute on function upsert_pet_monotonic\(uuid, uuid, int, text\) from public, anon, authenticated/i,
    );
  });

  it("jobs: claim_jobs reclaims stale 'running' jobs below the attempts cap", () => {
    expect(flatBackstops).toMatch(/alter table jobs add column claimed_at timestamptz/i);
    expect(flatBackstops).toMatch(
      /status = 'running' and coalesce\(claimed_at, created_at\) < now\(\) - interval '10 minutes' and attempts < 5/i,
    );
    expect(flatBackstops).toMatch(/for update skip locked/i);
  });

  it("jobs: exhausted stale jobs are dead-lettered to 'failed' (operator-visible)", () => {
    expect(flatBackstops).toMatch(/set status = 'failed'/i);
    expect(flatBackstops).toMatch(/attempts >= 5/i);
  });
});

describe("0009_metrics.sql — H1 instrumentation invariants", () => {
  it("activity_pings is one ping per user per day, RLS on, own insert/select only", () => {
    expect(flatMetrics).toMatch(/primary key \(owner_id, day\)/i);
    expect(flatMetrics).toMatch(/alter table activity_pings enable row level security/i);
    expect(flatMetrics).toMatch(
      /create policy "own_select" on activity_pings for select to authenticated/i,
    );
    expect(flatMetrics).toMatch(
      /create policy "own_insert" on activity_pings for insert to authenticated/i,
    );
  });

  it("weekly cohort views are security_invoker (no RLS bypass)", () => {
    expect(flatMetrics).toMatch(/create view wmcu_weekly with \(security_invoker = true\)/i);
    expect(flatMetrics).toMatch(/create view weekly_active with \(security_invoker = true\)/i);
  });
});
