// @ts-nocheck — Deno Edge Function entry; typechecked under Deno, not the Node/tsc
// build for this package. Excluded from `tsc` via tsconfig and never imported by tests.
/**
 * Supabase Edge Function: `ingest`.
 *
 * Thin Deno entry wrapper. ALL it does is:
 *   - parse the HTTP request / webhook into an `IngestInput`,
 *   - build the REAL deps (service-role Supabase client, real emitter-token
 *     verifier),
 *   - delegate to the pure `handleIngest` (in `_shared/ingest.ts`).
 *
 * Every live wire is tagged `// TODO(v1a-live)`. This file MUST NOT be imported by
 * the Vitest suite — the pure handler is what tests drive.
 *
 * deno-lint-ignore-file
 */

// TODO(v1a-live): these are Deno/URL imports resolved at deploy time on Supabase
// Edge Runtime, not by the Node toolchain.
//   import { serve } from "https://deno.land/std/http/server.ts";
//   import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleIngest, type IngestDeps, type IngestInput } from "../_shared/ingest.ts";
import type { AuthContext, AuthCredential, EvidenceWrite, IngestRepo, JobEnqueue } from "../_shared/ports.ts";

// TODO(v1a-live): read from Deno.env; never hardcode. Tests never reach this file.
declare const Deno: { env: { get(key: string): string | undefined }; serve?: unknown };

function buildRealDeps(): IngestDeps {
  // TODO(v1a-live): construct the service-role Supabase client.
  //   const supabase = createClient(
  //     Deno.env.get("SUPABASE_URL")!,
  //     Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  //   );

  const repo: IngestRepo = {
    async findEvidenceBySourceEvent(_emitterId: string | null, _sourceEventId: string | null) {
      // TODO(v1a-live): select * from evidence
      //   where emitter_id = $1 and source_event_id = $2 limit 1;
      throw new Error("not wired: findEvidenceBySourceEvent");
    },
    async insertEvidence(_write: EvidenceWrite) {
      // TODO(v1a-live): insert into evidence (...) returning *.
      // The DB unique index evidence_idempotency_idx is the hard idempotency
      // backstop; on a 23505 conflict, re-select and return the existing row.
      throw new Error("not wired: insertEvidence");
    },
    async enqueueJob(_job: JobEnqueue) {
      // TODO(v1a-live): insert into jobs (...) on conflict (dedup_key) do nothing
      //   returning *; if no row returned, re-select by dedup_key.
      throw new Error("not wired: enqueueJob");
    },
  };

  const verifyAuth = async (credential: AuthCredential): Promise<AuthContext | null> => {
    // TODO(v1a-live): hash the bearer token and look it up against
    //   emitters.token_hash where revoked_at is null; for webhooks, verify the
    //   HMAC signature over rawBody. Return { ownerId, emitterId } or null.
    void credential;
    return null;
  };

  return { repo, verifyAuth, now: () => new Date() };
}

// TODO(v1a-live): parse method/headers/body into an IngestInput (commit vs ci),
// extracting the credential (Authorization header / webhook signature) and the
// goalId / milestoneId routing.
async function parseRequest(_req: Request): Promise<IngestInput | null> {
  throw new Error("not wired: parseRequest");
}

// TODO(v1a-live): register the HTTP handler on the Edge Runtime.
//   Deno.serve(async (req) => { ... });
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
