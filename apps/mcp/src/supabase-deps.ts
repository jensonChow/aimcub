/**
 * Live Supabase wiring for the MCP server (service_role).
 *
 * Read path: {@link SupabaseAimcubRepo} from `@core/api-client` with the
 * service-role client on both seats — the Worker never holds a user JWT (the
 * OAuth access token is verified, not forwarded), so RLS cannot scope reads;
 * the tool layer scopes every read by the verified `CallerIdentity` instead.
 *
 * Write path: {@link SupabaseEvidenceIngest} mirrors the canonical ingest
 * conventions of `packages/db/supabase/functions/_shared/ingest.ts` exactly,
 * so MCP-ingested evidence flows through the same pg_cron jobs-worker as
 * webhook evidence:
 *   resolve emitter → dedup pre-check → append (unique-violation fallback)
 *   → enqueue `judge_evidence` with dedup_key `judge:<evidenceId>`.
 *
 * Everything is written against the structural `SupabaseLike` port so tests
 * inject a fake at the same seam the `@core/api-client` suite uses.
 */
import type { Evidence } from "@core/domain";
import {
  RepoError,
  SupabaseAimcubRepo,
  type IngestEvidenceInput,
  type SupabaseLike,
} from "@core/api-client";
import type { AimcubReadPort, EvidenceIngestPort } from "./ports.js";

/** PostgREST unique-violation SQLSTATE — the idempotency backstop signal. */
const UNIQUE_VIOLATION = "23505";

/**
 * Judge-job dedup key. MUST stay byte-identical to `judgeJobDedupKey()` in
 * `packages/db/supabase/functions/_shared/ingest.ts` — the `jobs.dedup_key`
 * unique index is what guarantees one evidence row is judged at most once
 * across MCP and webhook ingestion.
 */
export function judgeJobDedupKey(evidenceId: string): string {
  return `judge:${evidenceId}`;
}

/**
 * Deterministic emitter id for a user's MCP emitter: a name-based uuid derived
 * from `sha256("mcp_agent:" + ownerId)` (version/variant bits set per RFC 9562).
 * Determinism is what makes auto-provisioning race-safe — two concurrent first
 * requests compute the same primary key, so the loser of the insert race hits
 * the pk unique violation instead of creating a duplicate emitter row.
 */
export async function mcpEmitterIdFor(ownerId: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`mcp_agent:${ownerId}`),
  );
  const bytes = new Uint8Array(digest).slice(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x80; // version 8 (custom / name-derived)
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The emitters columns this adapter touches (see 0001_init.sql). */
interface EmitterRow {
  id: string;
  owner_id: string;
  kind: string;
  display_name: string;
  token_hash: string | null;
  revoked_at: string | null;
}

/** Error surfaced (verbatim, via the tool error result) when the emitter is revoked. */
export const EMITTER_REVOKED_MESSAGE = "MCP evidence reporting was revoked for this account";

/** The jobs columns this adapter touches (see 0001_init.sql). */
interface JobRow {
  type: string;
  payload: Record<string, unknown>;
  dedup_key: string;
}

/**
 * Evidence ingest over the service-role client. `input.ownerId` is always the
 * token-derived caller identity (see `toIngestInput`); any `emitterId` on the
 * input is ignored — the adapter is the sole authority for emitter identity,
 * and the DB trigger `evidence_emitter_owner_guard` backstops the pairing.
 */
export class SupabaseEvidenceIngest implements EvidenceIngestPort {
  /**
   * ownerId → provisioned emitter id, memoized per isolate (warm-path: zero
   * extra reads). Evicted on ingest failure (see {@link ingest}) because the
   * underlying emitter row is user-deletable and the memo would otherwise stay
   * stale for the isolate's whole lifetime. Known trade-off: the warm path also
   * skips the `revoked_at` check, so revocation lands on cold resolves /
   * isolate recycle — deleting the row (also own-CRUD) is the immediate stop,
   * since the owner-guard trigger then rejects every cached-id insert.
   */
  private readonly emitterCache = new Map<string, string>();

  constructor(private readonly server: SupabaseLike) {}

  async ingest(input: IngestEvidenceInput): Promise<Evidence> {
    const hadCachedEmitter = this.emitterCache.has(input.ownerId);
    try {
      return await this.ingestOnce(input);
    } catch (err) {
      // Self-heal a stale memo: users have full own-CRUD on emitters (Group A in
      // the RLS design), so the auto-provisioned mcp_agent row can be deleted
      // while this isolate is warm. The cached id then fails the
      // evidence_emitter_owner_guard trigger on EVERY insert until the isolate
      // recycles — so on any failure that went through the cached path, evict
      // the entry and retry exactly once. The cold path re-resolves (and
      // re-provisions) the emitter; the whole pipeline is idempotent on
      // (emitter_id, source_event_id), so the retry can never double-append.
      if (!hadCachedEmitter) throw err;
      this.emitterCache.delete(input.ownerId);
      return this.ingestOnce(input);
    }
  }

  private async ingestOnce(input: IngestEvidenceInput): Promise<Evidence> {
    const emitterId = await this.resolveEmitter(input.ownerId);

    // Dedup pre-check (same order as _shared/ingest.ts): a replayed event
    // returns the existing row and does NOT enqueue a second judge job.
    if (input.sourceEventId != null) {
      const existing = await this.findBySourceEvent(emitterId, input.sourceEventId);
      if (existing) return existing;
    }

    const evidence = await this.insertEvidence(input, emitterId);
    await this.enqueueJudgeJob(evidence);
    return evidence;
  }

  /**
   * Resolve-or-create the caller's MCP emitter (one per owner, deterministic id).
   * `token_hash` stays NULL: MCP callers authenticate via OAuth at the Worker,
   * never via emitter bearer tokens, and the column is nullable by design.
   * A revoked row (`revoked_at` set) is the user's kill switch: fail closed —
   * never write evidence and never re-provision around the revocation.
   */
  private async resolveEmitter(ownerId: string): Promise<string> {
    const cached = this.emitterCache.get(ownerId);
    if (cached) return cached;

    const id = await mcpEmitterIdFor(ownerId);
    const found = await this.server
      .from<EmitterRow>("emitters")
      .select("id, revoked_at")
      .eq("id", id)
      .maybeSingle();
    if (found.error) throw new RepoError(found.error.message, found.error.code);
    if (found.data?.revoked_at != null) {
      throw new RepoError(EMITTER_REVOKED_MESSAGE);
    }

    if (!found.data) {
      const inserted = await this.server
        .from<EmitterRow>("emitters")
        .insert({ id, owner_id: ownerId, kind: "mcp_agent", display_name: "MCP agent (OAuth)", token_hash: null })
        .select()
        .single();
      // pk unique violation → a concurrent request provisioned the same
      // deterministic id first; that row is ours to reuse.
      if (inserted.error && inserted.error.code !== UNIQUE_VIOLATION) {
        throw new RepoError(inserted.error.message, inserted.error.code);
      }
    }

    this.emitterCache.set(ownerId, id);
    return id;
  }

  private async findBySourceEvent(emitterId: string, sourceEventId: string): Promise<Evidence | null> {
    const res = await this.server
      .from<Evidence>("evidence")
      .select()
      .eq("emitter_id", emitterId)
      .eq("source_event_id", sourceEventId)
      .limit(1)
      .maybeSingle();
    if (res.error) throw new RepoError(res.error.message, res.error.code);
    return res.data;
  }

  /** Append-only insert; on the `evidence_idempotency_idx` backstop, return the existing row. */
  private async insertEvidence(input: IngestEvidenceInput, emitterId: string): Promise<Evidence> {
    const row: Partial<Evidence> = {
      owner_id: input.ownerId,
      goal_id: input.goalId,
      milestone_id: input.milestoneId ?? null,
      emitter_id: emitterId,
      kind: input.kind,
      source_event_id: input.sourceEventId,
      occurred_at: input.occurredAt,
      summary: input.summary ?? "",
      payload: input.payload ?? {},
      trust_score: input.trustScore ?? 1,
    };
    const res = await this.server.from<Evidence>("evidence").insert(row).select().single();
    if (res.error) {
      if (res.error.code === UNIQUE_VIOLATION && input.sourceEventId != null) {
        const existing = await this.findBySourceEvent(emitterId, input.sourceEventId);
        if (existing) return existing;
      }
      throw new RepoError(res.error.message, res.error.code);
    }
    return res.data as Evidence;
  }

  /** Enqueue judging for the existing jobs-worker; the dedup_key index makes replays a no-op. */
  private async enqueueJudgeJob(evidence: Evidence): Promise<void> {
    const res = await this.server
      .from<JobRow>("jobs")
      .insert({
        type: "judge_evidence",
        payload: {
          evidence_id: evidence.id,
          owner_id: evidence.owner_id,
          goal_id: evidence.goal_id,
          milestone_id: evidence.milestone_id,
        },
        dedup_key: judgeJobDedupKey(evidence.id),
      })
      .select()
      .single();
    if (res.error && res.error.code !== UNIQUE_VIOLATION) {
      throw new RepoError(res.error.message, res.error.code);
    }
  }
}

/** The identity-agnostic half of {@link ToolDeps} — cacheable per isolate. */
export interface LiveDeps {
  repo: AimcubReadPort;
  ingest: EvidenceIngestPort;
}

/** Assemble the live read + write adapters over one service-role client. */
export function createLiveDeps(serviceClient: SupabaseLike): LiveDeps {
  // Both repo seats get the service client: there is no user JWT in the Worker,
  // so "user path" reads also run as service_role and the TOOL layer enforces
  // ownership from the verified token identity.
  const repo = new SupabaseAimcubRepo(serviceClient, serviceClient);
  return { repo, ingest: new SupabaseEvidenceIngest(serviceClient) };
}
