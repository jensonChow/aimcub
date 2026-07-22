import { describe, expect, it } from "vitest";
import type {
  FilterBuilder,
  IngestEvidenceInput,
  PostgrestResult,
  SupabaseLike,
  TableBuilder,
} from "@aimcub/api-client";
import {
  EMITTER_REVOKED_MESSAGE,
  SupabaseEvidenceIngest,
  createLiveDeps,
  judgeJobDedupKey,
  mcpEmitterIdFor,
} from "./supabase-deps";

const OWNER = "11111111-1111-1111-1111-111111111111";
const OTHER = "99999999-9999-9999-9999-999999999999";
const GOAL = "22222222-2222-2222-2222-222222222222";
const T = "2026-06-09T12:00:00.000Z";

type Row = Record<string, unknown>;

/**
 * A behavioral in-memory fake of the {@link SupabaseLike} seam (the same seam
 * the @aimcub/api-client suite mocks): it stores rows per table and enforces the
 * unique indexes the live adapter's idempotency relies on —
 *   emitters: pk(id) · evidence: (emitter_id, source_event_id) · jobs: dedup_key
 * — answering duplicates with SQLSTATE 23505 exactly like PostgREST. It also
 * emulates the `evidence_emitter_owner_guard` BEFORE INSERT trigger
 * (0001/0003): an evidence row whose emitter is missing or owned by someone
 * else fails with SQLSTATE P0001, like the live database.
 */
class FakeSupabaseDb implements SupabaseLike {
  readonly tables: Record<string, Row[]> = { emitters: [], evidence: [], jobs: [] };
  /** Next N selects on a table report no rows — simulates a lost check-then-insert race. */
  readonly missSelects: Record<string, number> = {};

  from<T = Row>(table: string): TableBuilder<T> {
    const rows = (): Row[] => (this.tables[table] ??= []);

    const selectBuilder = (): FilterBuilder<T> => {
      const filters: Array<{ col: string; val: unknown }> = [];
      let limitN: number | undefined;
      const run = (): Row[] => {
        if ((this.missSelects[table] ?? 0) > 0) {
          this.missSelects[table]!--;
          return [];
        }
        const out = rows().filter((r) => filters.every((f) => r[f.col] === f.val));
        return limitN === undefined ? out : out.slice(0, limitN);
      };
      const fb: FilterBuilder<T> = {
        eq(col, val) {
          filters.push({ col, val });
          return fb;
        },
        gte: () => fb,
        contains: () => fb,
        order: () => fb,
        select: () => fb,
        limit(n) {
          limitN = n;
          return fb;
        },
        single() {
          const out = run();
          return Promise.resolve(
            out.length === 1
              ? ({ data: out[0] as T, error: null } as PostgrestResult<T>)
              : { data: null, error: { message: `expected 1 row, got ${out.length}`, code: "PGRST116" } },
          );
        },
        maybeSingle() {
          return Promise.resolve({ data: (run()[0] ?? null) as T | null, error: null });
        },
        then(onfulfilled, onrejected) {
          return Promise.resolve({ data: run() as T[], error: null }).then(onfulfilled, onrejected);
        },
      };
      return fb;
    };

    const insertBuilder = (values: Partial<T> | Partial<T>[]): FilterBuilder<T> => {
      // Run eagerly; the terminal reports the outcome (the adapter always awaits one).
      const input = (Array.isArray(values) ? values : [values]) as Row[];
      let error: { message: string; code?: string } | null = null;
      const inserted: Row[] = [];
      for (const v of input) {
        const row: Row = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...v };
        // BEFORE INSERT triggers fire before constraint checks, like Postgres.
        const trigger = this.triggerViolation(table, row);
        if (trigger) {
          error = trigger;
          break;
        }
        const conflict = this.uniqueConflict(table, row);
        if (conflict) {
          error = { message: conflict, code: "23505" };
          break;
        }
        rows().push(row);
        inserted.push(row);
      }
      const done = <R>(data: R): PostgrestResult<R> =>
        error ? { data: null, error } : { data, error: null };
      const fb: FilterBuilder<T> = {
        eq: () => fb,
        gte: () => fb,
        contains: () => fb,
        order: () => fb,
        select: () => fb,
        limit: () => fb,
        single: () => Promise.resolve(done(inserted[0] as T)),
        maybeSingle: () => Promise.resolve(done((inserted[0] ?? null) as T | null)),
        then: (onfulfilled, onrejected) =>
          Promise.resolve(done(inserted as T[])).then(onfulfilled, onrejected),
      };
      return fb;
    };

    return {
      select: () => selectBuilder(),
      insert: (values) => insertBuilder(values),
      upsert: (values) => insertBuilder(values),
      update: () => {
        throw new Error("FakeSupabaseDb: update not used by the MCP adapter");
      },
    };
  }

  /** Emulates `assert_evidence_emitter_owner` (migrations 0001/0003). */
  private triggerViolation(table: string, row: Row): { message: string; code: string } | null {
    if (table !== "evidence" || row.emitter_id == null) return null;
    const owned = (this.tables.emitters ?? []).some(
      (e) => e.id === row.emitter_id && e.owner_id === row.owner_id,
    );
    return owned
      ? null
      : {
          message: `emitter ${String(row.emitter_id)} does not belong to owner ${String(row.owner_id)}`,
          code: "P0001",
        };
  }

  private uniqueConflict(table: string, row: Row): string | null {
    const existing = this.tables[table] ?? [];
    if (existing.some((r) => r.id === row.id)) {
      return `duplicate key value violates unique constraint "${table}_pkey"`;
    }
    if (table === "evidence" && row.source_event_id != null) {
      const dup = existing.some(
        (r) => r.emitter_id === row.emitter_id && r.source_event_id === row.source_event_id,
      );
      if (dup) return 'duplicate key value violates unique constraint "evidence_idempotency_idx"';
    }
    if (table === "jobs" && row.dedup_key != null) {
      if (existing.some((r) => r.dedup_key === row.dedup_key)) {
        return 'duplicate key value violates unique constraint "jobs_dedup_idx"';
      }
    }
    return null;
  }
}

function ingestInput(over: Partial<IngestEvidenceInput> = {}): IngestEvidenceInput {
  return {
    ownerId: OWNER,
    goalId: GOAL,
    milestoneId: null,
    kind: "git_commit",
    sourceEventId: "sha-1",
    occurredAt: T,
    summary: "feat: wire mcp",
    payload: {},
    trustScore: 0.8,
    ...over,
  };
}

describe("mcpEmitterIdFor", () => {
  it("is deterministic per owner and a valid uuid", async () => {
    const a = await mcpEmitterIdFor(OWNER);
    const b = await mcpEmitterIdFor(OWNER);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("differs across owners", async () => {
    expect(await mcpEmitterIdFor(OWNER)).not.toBe(await mcpEmitterIdFor(OTHER));
  });
});

describe("SupabaseEvidenceIngest — emitter auto-provisioning", () => {
  it("provisions one mcp_agent emitter per owner on first ingest (OAuth → token_hash stays null)", async () => {
    const db = new FakeSupabaseDb();
    const ingest = new SupabaseEvidenceIngest(db);

    const evidence = await ingest.ingest(ingestInput());

    expect(db.tables.emitters).toHaveLength(1);
    expect(db.tables.emitters![0]).toMatchObject({
      id: await mcpEmitterIdFor(OWNER),
      owner_id: OWNER,
      kind: "mcp_agent",
      token_hash: null,
    });
    expect(evidence.emitter_id).toBe(await mcpEmitterIdFor(OWNER));
  });

  it("never duplicates the emitter — across ingests and across cold adapter instances", async () => {
    const db = new FakeSupabaseDb();
    await new SupabaseEvidenceIngest(db).ingest(ingestInput({ sourceEventId: "sha-1" }));
    // A second isolate (empty memo cache) against the same database.
    await new SupabaseEvidenceIngest(db).ingest(ingestInput({ sourceEventId: "sha-2" }));

    expect(db.tables.emitters).toHaveLength(1);
    expect(db.tables.evidence).toHaveLength(2);
  });

  it("losing the provisioning race (pk conflict) reuses the concurrent winner's row", async () => {
    const db = new FakeSupabaseDb();
    // A concurrent request already provisioned the deterministic emitter…
    db.tables.emitters!.push({
      id: await mcpEmitterIdFor(OWNER),
      owner_id: OWNER,
      kind: "mcp_agent",
      display_name: "MCP agent (OAuth)",
      token_hash: null,
    });
    // …but this isolate's existence check raced ahead of that commit.
    db.missSelects.emitters = 1;

    const evidence = await new SupabaseEvidenceIngest(db).ingest(ingestInput());
    expect(db.tables.emitters).toHaveLength(1);
    expect(evidence.emitter_id).toBe(await mcpEmitterIdFor(OWNER));
  });

  it("self-heals a stale emitter memo: deleting the emitter under a warm isolate re-provisions, not bricks", async () => {
    const db = new FakeSupabaseDb();
    const ingest = new SupabaseEvidenceIngest(db);

    // Warm the per-isolate cache with a successful ingest…
    await ingest.ingest(ingestInput({ sourceEventId: "sha-1" }));
    expect(db.tables.emitters).toHaveLength(1);

    // …then the user deletes their auto-provisioned emitter row (own-CRUD per
    // the RLS design). The cached id now fails the emitter-owner trigger.
    db.tables.emitters!.length = 0;

    // The adapter must evict the stale entry and retry once — NOT hard-fail
    // every report_evidence until the isolate recycles.
    const evidence = await ingest.ingest(ingestInput({ sourceEventId: "sha-2" }));

    expect(db.tables.emitters).toHaveLength(1); // re-provisioned
    expect(evidence.emitter_id).toBe(await mcpEmitterIdFor(OWNER));
    expect(db.tables.evidence).toHaveLength(2);
    expect(db.tables.jobs).toHaveLength(2); // both rows got their judge job
  });

  it("fails closed on a revoked emitter — the user's kill switch wins, nothing is written", async () => {
    const db = new FakeSupabaseDb();
    // The user revoked their MCP emitter (Group A own-CRUD sets revoked_at).
    db.tables.emitters!.push({
      id: await mcpEmitterIdFor(OWNER),
      owner_id: OWNER,
      kind: "mcp_agent",
      display_name: "MCP agent (OAuth)",
      token_hash: null,
      revoked_at: T,
    });

    await expect(new SupabaseEvidenceIngest(db).ingest(ingestInput())).rejects.toThrow(
      EMITTER_REVOKED_MESSAGE,
    );
    // No evidence, no judge job, and no re-provisioning around the revocation.
    expect(db.tables.evidence).toHaveLength(0);
    expect(db.tables.jobs).toHaveLength(0);
    expect(db.tables.emitters).toHaveLength(1);
  });
});

describe("SupabaseEvidenceIngest — idempotent ingest + judge job", () => {
  it("double ingest with the same sourceEventId returns the same evidence id and enqueues one judge job", async () => {
    const db = new FakeSupabaseDb();
    const ingest = new SupabaseEvidenceIngest(db);

    const first = await ingest.ingest(ingestInput());
    const second = await ingest.ingest(ingestInput());

    expect(second.id).toBe(first.id);
    expect(db.tables.evidence).toHaveLength(1);
    expect(db.tables.jobs).toHaveLength(1);
  });

  it("falls back to the existing row on a unique violation when the dedup pre-check races", async () => {
    const db = new FakeSupabaseDb();
    const ingest = new SupabaseEvidenceIngest(db);
    const first = await ingest.ingest(ingestInput());

    // Simulate the race window: the pre-check misses, the insert hits the
    // evidence_idempotency_idx backstop, the fallback re-select returns the row.
    db.missSelects.evidence = 1;
    const second = await ingest.ingest(ingestInput());

    expect(second.id).toBe(first.id);
    expect(db.tables.evidence).toHaveLength(1);
    // The judge job insert conflicted on dedup_key and was tolerated: still one.
    expect(db.tables.jobs).toHaveLength(1);
  });

  it("enqueues judge_evidence with the exact dedup_key + payload convention of _shared/ingest.ts", async () => {
    expect(judgeJobDedupKey("ev-1")).toBe("judge:ev-1");

    const db = new FakeSupabaseDb();
    const evidence = await new SupabaseEvidenceIngest(db).ingest(ingestInput());

    expect(db.tables.jobs).toHaveLength(1);
    expect(db.tables.jobs![0]).toMatchObject({
      type: "judge_evidence",
      dedup_key: `judge:${evidence.id}`,
      payload: {
        evidence_id: evidence.id,
        owner_id: OWNER,
        goal_id: GOAL,
        milestone_id: null,
      },
    });
  });

  it("appends (and judges) every time when there is no sourceEventId", async () => {
    const db = new FakeSupabaseDb();
    const ingest = new SupabaseEvidenceIngest(db);
    await ingest.ingest(ingestInput({ sourceEventId: null }));
    await ingest.ingest(ingestInput({ sourceEventId: null }));
    expect(db.tables.evidence).toHaveLength(2);
    expect(db.tables.jobs).toHaveLength(2);
  });

  it("preserves the normalized trust score and overrides any emitterId smuggled into the input", async () => {
    const db = new FakeSupabaseDb();
    const evidence = await new SupabaseEvidenceIngest(db).ingest(
      ingestInput({ emitterId: "44444444-4444-4444-4444-444444444444", trustScore: 0.8 }),
    );
    expect(evidence.trust_score).toBe(0.8);
    // The adapter is the sole authority for the emitter: token owner's, always.
    expect(evidence.emitter_id).toBe(await mcpEmitterIdFor(OWNER));
  });
});

describe("createLiveDeps", () => {
  it("bundles the shared read repo with the MCP ingest adapter", () => {
    const deps = createLiveDeps(new FakeSupabaseDb());
    expect(typeof deps.repo.getGoal).toBe("function");
    expect(typeof deps.repo.listMilestones).toBe("function");
    expect(deps.ingest).toBeInstanceOf(SupabaseEvidenceIngest);
  });
});
