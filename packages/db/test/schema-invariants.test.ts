/**
 * Schema invariant guard.
 *
 * The DB is the single source of truth and these constraints are load-bearing for the whole
 * product's anti-cheat / idempotency story. This test fails loudly if a future migration edit
 * silently drops one of them. It is a static SQL-text assertion (no Postgres needed): a thin
 * tripwire, not a substitute for `supabase db reset` integration tests.
 *
 * The emotional shell (pets / collectibles / notifications) was removed in 0011, so the
 * surviving invariants are the aim-management spine: evidence idempotency, milestone
 * completion uniqueness, the emitter-owner guard, the jobs queue, and metrics.
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
const flatMetrics = flatMigration("0009_metrics.sql");
const flatBackstops = flatMigration("0010_v1b_integrity_backstops.sql");
const flatDrop = flatMigration("0011_drop_emotional_shell.sql");
const flatContextCategory = flatMigration("0012_memory_context_category.sql");
const flatMemoryStatus = flatMigration("0013_memory_deprioritized_status.sql");

describe("0001_init.sql — core invariants", () => {
  it("evidence is idempotent: unique on (emitter_id, source_event_id) where source_event_id is not null", () => {
    expect(flat).toMatch(
      /create unique index evidence_idempotency_idx on evidence \(emitter_id, source_event_id\) where source_event_id is not null/i,
    );
  });

  it("milestone_completions: milestone_id is unique (a node completes once)", () => {
    expect(flat).toMatch(/milestone_id uuid not null unique references milestones/i);
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

  it("RLS is enabled and the surviving security groups match the contract", () => {
    // Group A: user read + write.
    expect(flat).toMatch(/array\['goals','emitters','memories'\]/i);
    // Group B: user read-only (writes via service_role). pets / collectibles /
    // notifications were dropped in 0011; the surviving members stay read-only.
    expect(flat).toContain("'milestones'");
    expect(flat).toContain("'evidence'");
    expect(flat).toContain("'milestone_completions'");
    expect(flat).toContain("'subscriptions'");
    // jobs: RLS on, no authenticated policy.
    expect(flat).toMatch(/alter table jobs enable row level security/i);
  });

  it("worker claim is concurrency-safe (FOR UPDATE SKIP LOCKED)", () => {
    expect(flat).toMatch(/for update skip locked/i);
    expect(flat).toMatch(/function claim_jobs\(batch int default 10\)/i);
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

describe("0010_v1b_integrity_backstops.sql — jobs retry/reclaim backstops", () => {
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

describe("0011_drop_emotional_shell.sql — the shell is gone", () => {
  it("drops the pets / collectibles / notifications tables", () => {
    expect(flatDrop).toMatch(/drop table if exists collectibles/i);
    expect(flatDrop).toMatch(/drop table if exists notifications/i);
    expect(flatDrop).toMatch(/drop table if exists pets/i);
  });

  it("drops the pet-xp upsert RPC", () => {
    expect(flatDrop).toMatch(/drop function if exists upsert_pet_monotonic/i);
  });

  it("drops the collectible-only columns (xp_reward is kept)", () => {
    expect(flatDrop).toMatch(/alter table milestones drop column if exists rarity/i);
    expect(flatDrop).toMatch(
      /alter table milestone_completions drop column if exists minted_collectible_id/i,
    );
    // xp_reward / awarded_xp are NOT dropped — they survive as a neutral weight.
    expect(flatDrop).not.toMatch(/drop column if exists xp_reward/i);
    expect(flatDrop).not.toMatch(/drop column if exists awarded_xp/i);
  });

  it("tightens the jobs type domain to the surviving job kinds", () => {
    expect(flatDrop).toMatch(/check \(type in \('judge_evidence', 'extract_memory'\)\)/i);
  });
});

describe("0012_memory_context_category.sql — typed planning memory", () => {
  it("adds the lean context category enum and an active-memory lookup index", () => {
    expect(flatContextCategory).toMatch(/alter table memories add column if not exists category text not null default 'project_fact'/i);
    expect(flatContextCategory).toContain("'preference'");
    expect(flatContextCategory).toContain("'constraint'");
    expect(flatContextCategory).toContain("'capability'");
    expect(flatContextCategory).toContain("'eval_signal'");
    expect(flatContextCategory).toContain("'project_fact'");
    expect(flatContextCategory).toContain("'procedure'");
    expect(flatContextCategory).toMatch(/create index if not exists memories_owner_category_idx/i);
  });
});

describe("0013_memory_deprioritized_status.sql — context priority lifecycle", () => {
  it("allows deprioritized memories without treating them as active planning input", () => {
    expect(flatMemoryStatus).toMatch(/drop constraint if exists memories_status_check/i);
    expect(flatMemoryStatus).toContain("'active'");
    expect(flatMemoryStatus).toContain("'pending'");
    expect(flatMemoryStatus).toContain("'deprioritized'");
    expect(flatMemoryStatus).toContain("'deleted'");
  });
});
