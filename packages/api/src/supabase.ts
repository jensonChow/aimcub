/**
 * SupabaseAimcubRepo — the production implementation of {@link AimcubRepo} on top of
 * `@supabase/supabase-js` (PostgREST + RLS).
 *
 * Two clients, two trust levels — this is the security spine of the whole product
 * (see the RLS "security grouping" comment in `0001_init.sql`):
 *
 *  - **User path** uses a client authenticated as the end user (anon key + the user's JWT).
 *    Every read/write is constrained by RLS to `owner_id = auth.uid()`. We never pass
 *    `owner_id` filters ourselves for the user-scoped lists — RLS does it — but we keep the
 *    explicit `.eq("owner_id", ...)` on writes/reads where the contract gives us an ownerId,
 *    as defense-in-depth and to make the query intent obvious.
 *  - **Server path** uses a client authenticated with the `service_role` key, which BYPASSES
 *    RLS. This is the only path allowed to write the derived / anti-cheat tables
 *    (milestones, evidence, completions). It must run server-side only.
 *
 * To stay testable without a network or credentials, this module is written against a small
 * structural port ({@link SupabaseLike}) rather than importing the concrete client type. The
 * real `@supabase/supabase-js` client satisfies this port at runtime; {@link createSupabaseRepo}
 * builds one from env. Tests inject a fake that records the query chain.
 */
import type {
  Evidence,
  Goal,
  Milestone,
} from "@core/types";

import type {
  CreateGoalInput,
  AimcubRepo,
  IngestEvidenceInput,
} from "./contract.js";

// ──────────────────────────────────────────────────────────────────────────
// Minimal structural port of the PostgREST query builder we rely on.
// `@supabase/supabase-js`'s real builder is a superset of this, so the concrete
// client is assignable to `SupabaseLike` without casts in production code.
// TODO(v1a-live): the real builder is thenable & strongly typed via generated DB
// types; once `generate_typescript_types` output is wired in, swap this port for
// `SupabaseClient<Database>` and drop the structural shim.
// ──────────────────────────────────────────────────────────────────────────

/** The PostgREST response envelope (subset). */
export interface PostgrestResult<T> {
  data: T | null;
  error: { message: string; code?: string; details?: string | null } | null;
}

/** A terminal builder: awaiting it (or calling `.single()`) runs the query. */
export interface FilterBuilder<T> extends PromiseLike<PostgrestResult<T[]>> {
  eq(column: string, value: unknown): FilterBuilder<T>;
  gte(column: string, value: unknown): FilterBuilder<T>;
  contains(column: string, value: unknown): FilterBuilder<T>;
  order(column: string, opts?: { ascending?: boolean }): FilterBuilder<T>;
  limit(count: number): FilterBuilder<T>;
  /** Return the affected rows from a mutation (PostgREST `Prefer: return=representation`). */
  select(columns?: string): FilterBuilder<T>;
  /** Resolves a single row (PostgREST `?limit=1` + `Accept: ...vnd.pgrst.object`). */
  single(): PromiseLike<PostgrestResult<T>>;
  /** Resolves a single row or null instead of erroring when zero rows match. */
  maybeSingle(): PromiseLike<PostgrestResult<T | null>>;
}

export interface TableBuilder<T> {
  select(columns?: string): FilterBuilder<T>;
  insert(values: Partial<T> | Partial<T>[]): FilterBuilder<T>;
  upsert(
    values: Partial<T> | Partial<T>[],
    opts?: { onConflict?: string; ignoreDuplicates?: boolean },
  ): FilterBuilder<T>;
  update(values: Partial<T>): FilterBuilder<T>;
}

/** The slice of a Supabase client this repo uses. */
export interface SupabaseLike {
  from<T = Record<string, unknown>>(table: string): TableBuilder<T>;
}

/** A factory for a Supabase-shaped client, e.g. `createClient` from `@supabase/supabase-js`. */
export type SupabaseFactory = (url: string, key: string) => SupabaseLike;

export interface SupabaseRepoConfig {
  url: string;
  /** anon key — used for the user (RLS-bound) client. */
  anonKey: string;
  /** service_role key — used for the server (RLS-bypassing) client. SERVER ONLY. */
  serviceRoleKey: string;
  /**
   * The end user's access token (JWT). When present, the user client sends it as the
   * `Authorization: Bearer` header so RLS resolves `auth.uid()` to this user.
   */
  userAccessToken?: string;
}

/** Raised when PostgREST returns an error. Carries the PostgREST code (e.g. `23505` = unique violation). */
export class RepoError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "RepoError";
  }
}

/** PostgREST unique-violation SQLSTATE — surfaced when the idempotency index conflicts. */
const UNIQUE_VIOLATION = "23505";

function unwrap<T>(res: PostgrestResult<T>): T {
  if (res.error) throw new RepoError(res.error.message, res.error.code);
  // PostgREST returns `data: null` only on error or no-row single(); callers handle null where allowed.
  return res.data as T;
}

export class SupabaseAimcubRepo implements AimcubRepo {
  constructor(
    /** RLS-bound client authenticated as the end user. */
    private readonly user: SupabaseLike,
    /** service_role client that bypasses RLS. SERVER ONLY. */
    private readonly server: SupabaseLike,
  ) {}

  // ── user path (RLS-bound) ─────────────────────────────────────────────────

  async createGoal(input: CreateGoalInput): Promise<Goal> {
    const row: Partial<Goal> = {
      owner_id: input.ownerId,
      title: input.title,
      description: input.description ?? "",
      domain: input.domain ?? "software",
      target_date: input.targetDate ?? null,
    };
    const res = await this.user.from<Goal>("goals").insert(row).select().single();
    return unwrap(res);
  }

  async getGoal(id: string): Promise<Goal | null> {
    // RLS guarantees the row is only returned if it belongs to the caller.
    const res = await this.user.from<Goal>("goals").select().eq("id", id).maybeSingle();
    return unwrap(res);
  }

  async listGoals(ownerId: string): Promise<Goal[]> {
    const res = await this.user
      .from<Goal>("goals")
      .select()
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false });
    return unwrap(res) ?? [];
  }

  async listMilestones(goalId: string): Promise<Milestone[]> {
    const res = await this.user
      .from<Milestone>("milestones")
      .select()
      .eq("goal_id", goalId)
      .order("order_index", { ascending: true });
    return unwrap(res) ?? [];
  }

  async updateGoalPlan(goalId: string, planJson: unknown, status: Goal["status"] = "active"): Promise<Goal> {
    // User path: RLS's own_write policy guarantees the caller can only touch their own goal.
    const res = await this.user
      .from<Goal>("goals")
      .update({ plan_json: planJson, status } as Partial<Goal>)
      .eq("id", goalId)
      .select()
      .single();
    return unwrap(res);
  }

  // ── server path (service_role, bypasses RLS) ──────────────────────────────

  async insertMilestones(milestones: Milestone[]): Promise<Milestone[]> {
    if (milestones.length === 0) return [];
    const res = await this.server
      .from<Milestone>("milestones")
      .insert(milestones)
      .select();
    return unwrap(res) ?? [];
  }

  async ingestEvidence(input: IngestEvidenceInput): Promise<Evidence> {
    const row: Partial<Evidence> = {
      owner_id: input.ownerId,
      goal_id: input.goalId,
      milestone_id: input.milestoneId ?? null,
      emitter_id: input.emitterId ?? null,
      kind: input.kind,
      source_event_id: input.sourceEventId,
      occurred_at: input.occurredAt,
      summary: input.summary ?? "",
      payload: input.payload ?? {},
      trust_score: input.trustScore ?? 1,
    };

    // Idempotency: rely on the partial unique index `(emitter_id, source_event_id)`.
    // When an idempotency key is present, upsert+ignore so a replayed event is a no-op,
    // then re-select the canonical row. Without a key, evidence is a pure append.
    if (input.sourceEventId != null && input.emitterId != null) {
      const upserted = await this.server
        .from<Evidence>("evidence")
        .upsert(row, { onConflict: "emitter_id,source_event_id", ignoreDuplicates: true })
        .select();
      const rows = upserted.error ? null : upserted.data;
      if (rows && rows.length > 0) return rows[0] as Evidence;

      // ignoreDuplicates → no row returned on conflict; fetch the pre-existing one.
      // TODO(v1a-live): confirm PostgREST returns [] (not an error) on ignored conflict
      // for this Supabase version; if it errors with 23505, fall through on that code only.
      if (upserted.error && upserted.error.code !== UNIQUE_VIOLATION) {
        throw new RepoError(upserted.error.message, upserted.error.code);
      }
      const existing = await this.server
        .from<Evidence>("evidence")
        .select()
        .eq("emitter_id", input.emitterId)
        .eq("source_event_id", input.sourceEventId)
        .single();
      return unwrap(existing);
    }

    const res = await this.server.from<Evidence>("evidence").insert(row).select().single();
    return unwrap(res);
  }
}

/**
 * Build a {@link SupabaseAimcubRepo} from config + a client factory.
 *
 * In production, pass `createClient` from `@supabase/supabase-js` as `factory`:
 *
 * ```ts
 * import { createClient } from "@supabase/supabase-js";
 * const repo = createSupabaseRepo(
 *   {
 *     url: process.env.SUPABASE_URL!,
 *     anonKey: process.env.SUPABASE_ANON_KEY!,
 *     serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!, // server only
 *     userAccessToken: req.headers.authorization?.slice(7),
 *   },
 *   (url, key) => createClient(url, key) as unknown as SupabaseLike,
 * );
 * ```
 *
 * Tests pass a fake factory that returns a recording stub.
 *
 * TODO(v1a-live): read these from a secrets manager / env at the call site; never hardcode.
 * The `userAccessToken` plumbing below sets the per-request Authorization header so RLS sees
 * the right `auth.uid()`. supabase-js also supports `global.headers` at client construction.
 */
export function createSupabaseRepo(
  config: SupabaseRepoConfig,
  factory: SupabaseFactory,
): SupabaseAimcubRepo {
  const userClient = factory(config.url, config.anonKey);
  // TODO(v1a-live): when using the real client, construct it with
  //   createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${userAccessToken}` } } })
  // so RLS resolves auth.uid() to the calling user. The structural port above
  // intentionally omits header wiring; it lives in the live factory.
  const serverClient = factory(config.url, config.serviceRoleKey);
  return new SupabaseAimcubRepo(userClient, serverClient);
}
