/* eslint-disable @typescript-eslint/ban-ts-comment -- Deno entry, see below */
// @ts-nocheck — Deno Edge Function entry; typechecked under Deno, not the Node/tsc
// build for this package. Excluded from `tsc` via tsconfig and never imported by tests.
/**
 * Supabase Edge Function: `ingest` — LIVE wiring (v1a).
 *
 * Thin Deno entry wrapper around the pure `handleIngest` (in `_shared/ingest.ts`):
 *   - parses the HTTP request into an `IngestInput`,
 *   - builds the real deps: service-role Supabase client + emitter-token verifier,
 *   - delegates; the pure handler owns auth/idempotency/normalize/enqueue order.
 *
 * Auth (v1a): `Authorization: Bearer emt_<random>` emitter tokens. We store only
 * `emitters.token_hash = hex(sha256(token))`; the plaintext is shown once at
 * creation. GitHub App webhook HMAC verification lands with the github-webhook
 * function (Step 6) — this endpoint stays token-only.
 *
 * Deploy note: at deploy time `../_shared/*` is bundled as `./_shared/*` and
 * `@aimcub/*` resolves via the function's deno.json import map to vendored sources
 * (pure TS, zero platform deps). This file MUST NOT be imported by the Vitest
 * suite — the pure handler is what tests drive.
 *
 * deno-lint-ignore-file
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleIngest, type IngestDeps, type IngestInput } from "../_shared/ingest.ts";
import type {
  AuthContext,
  AuthCredential,
  EvidenceWrite,
  IngestRepo,
  JobEnqueue,
} from "../_shared/ports.ts";

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Promise<Response> | Response): unknown;
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const repo: IngestRepo = {
  async findEvidenceBySourceEvent(emitterId, sourceEventId) {
    if (!sourceEventId) return null;
    let query = supabase.from("evidence").select("*").eq("source_event_id", sourceEventId);
    query = emitterId === null ? query.is("emitter_id", null) : query.eq("emitter_id", emitterId);
    const { data, error } = await query.limit(1).maybeSingle();
    if (error) throw new Error(`findEvidenceBySourceEvent: ${error.message}`);
    return data;
  },

  async insertEvidence(write: EvidenceWrite) {
    const row = {
      owner_id: write.ownerId,
      goal_id: write.goalId,
      milestone_id: write.milestoneId,
      emitter_id: write.emitterId,
      kind: write.kind,
      source_event_id: write.sourceEventId,
      occurred_at: write.occurredAt,
      summary: write.summary,
      payload: write.payload,
      trust_score: write.trustScore,
    };
    const { data, error } = await supabase.from("evidence").insert(row).select().single();
    if (error) {
      // evidence_idempotency_idx is the hard backstop: on a duplicate, return the
      // existing row instead of failing the request.
      if (error.code === "23505") {
        const existing = await repo.findEvidenceBySourceEvent(write.emitterId, write.sourceEventId);
        if (existing) return existing;
      }
      throw new Error(`insertEvidence: ${error.message}`);
    }
    return data;
  },

  async enqueueJob(job: JobEnqueue) {
    const row = {
      type: job.type,
      payload: job.payload,
      dedup_key: job.dedupKey,
      ...(job.runAfter ? { run_after: job.runAfter } : {}),
    };
    const inserted = await supabase.from("jobs").insert(row).select().single();
    if (!inserted.error) return inserted.data;
    // jobs_dedup_idx: same logical event is enqueued only once — return the queued job.
    if (inserted.error.code === "23505" && job.dedupKey) {
      const { data, error } = await supabase
        .from("jobs")
        .select("*")
        .eq("dedup_key", job.dedupKey)
        .single();
      if (error) throw new Error(`enqueueJob reselect: ${error.message}`);
      return data;
    }
    throw new Error(`enqueueJob: ${inserted.error.message}`);
  },
};

const verifyAuth = async (credential: AuthCredential): Promise<AuthContext | null> => {
  if (!credential.token) return null;
  const hash = await sha256Hex(credential.token);
  const { data, error } = await supabase
    .from("emitters")
    .select("id, owner_id")
    .eq("token_hash", hash)
    .is("revoked_at", null)
    .maybeSingle();
  if (error || !data) return null;
  return { ownerId: data.owner_id, emitterId: data.id };
};

function buildRealDeps(): IngestDeps {
  return { repo, verifyAuth, now: () => new Date() };
}

async function parseRequest(req: Request): Promise<IngestInput | null> {
  if (req.method !== "POST") return null;
  const authHeader = req.headers.get("authorization") ?? "";
  const token = /^Bearer\s+(.+)$/i.exec(authHeader.trim())?.[1];
  const credential: AuthCredential = { token };

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return null;
  }
  if (!body || typeof body.goalId !== "string") return null;
  const base = {
    credential,
    goalId: body.goalId,
    milestoneId: typeof body.milestoneId === "string" ? body.milestoneId : null,
    occurredAt: typeof body.occurredAt === "string" ? body.occurredAt : undefined,
  };
  if (body.source === "commit" && body.commit && typeof body.commit === "object") {
    return { source: "commit", commit: body.commit, ...base };
  }
  if (body.source === "ci" && body.run && typeof body.run === "object") {
    return { source: "ci", run: body.run, ...base };
  }
  return null;
}

export async function ingestHandler(req: Request): Promise<Response> {
  const deps = buildRealDeps();
  const input = await parseRequest(req);
  if (!input) {
    return new Response(JSON.stringify({ error: "bad request" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  const result = await handleIngest(deps, input);
  return new Response(JSON.stringify(result), {
    status: result.status,
    headers: { "content-type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  try {
    return await ingestHandler(req);
  } catch (err) {
    console.error("ingest: unhandled error", err);
    return new Response(JSON.stringify({ error: "internal error" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
});
