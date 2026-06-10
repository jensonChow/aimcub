// @ts-nocheck — Deno Edge Function entry; typechecked under Deno, not the Node/tsc
// build for this package. Excluded from `tsc` via tsconfig and never imported by tests.
/**
 * Supabase Edge Function: `github-webhook` — passive evidence from a GitHub App.
 *
 * Receives push / workflow_run events, verifies the `X-Hub-Signature-256` HMAC
 * with the app's webhook secret (stored in Vault, read via the `get_app_secret`
 * RPC), maps the payload to RawCommit / RawCiRun, resolves which goal(s) the
 * repository is bound to (`goals.metadata->>github_repo` = "owner/repo"), and
 * pushes each event through the same pure `handleIngest` pipeline the token
 * endpoint uses (idempotent insert + judge enqueue).
 *
 * Trust note: commits delivered here get `verified: true` (trust 1.0). The
 * trust anchor is the HMAC-verified, server-side webhook — the event provably
 * happened on GitHub — which is exactly the "signature-verified webhook" class
 * the acceptance kernel treats as auto-verifiable. (GPG signing of individual
 * commits is a different, stricter notion not available in push payloads.)
 *
 * Deployed with verify_jwt=false: GitHub cannot send a Supabase JWT; the HMAC
 * is the authentication.
 *
 * deno-lint-ignore-file
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleIngest, type IngestDeps, type IngestInput } from "../_shared/ingest.ts";
import type { AuthContext, EvidenceWrite, IngestRepo, JobEnqueue } from "../_shared/ports.ts";

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Promise<Response> | Response): unknown;
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

// ── webhook signature ───────────────────────────────────────────────────────

let cachedSecret: string | null = null;
async function webhookSecret(): Promise<string | null> {
  if (cachedSecret) return cachedSecret;
  const { data, error } = await supabase.rpc("get_app_secret", { secret_name: "github_webhook_secret" });
  if (error || !data) {
    console.error("github-webhook: secret unavailable:", error?.message ?? "not set");
    return null;
  }
  cachedSecret = data as string;
  return cachedSecret;
}

async function verifySignature(rawBody: string, header: string | null): Promise<boolean> {
  const secret = await webhookSecret();
  if (!secret || !header?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = "sha256=" + Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
  // Constant-time comparison.
  if (expected.length !== header.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ header.charCodeAt(i);
  return diff === 0;
}

// ── goal / emitter resolution ───────────────────────────────────────────────

interface GoalBinding {
  goalId: string;
  ownerId: string;
}

async function goalsBoundToRepo(fullName: string): Promise<GoalBinding[]> {
  const { data, error } = await supabase
    .from("goals")
    .select("id, owner_id")
    .eq("metadata->>github_repo", fullName)
    .in("status", ["draft", "active"]);
  if (error) throw new Error(`goalsBoundToRepo: ${error.message}`);
  return (data ?? []).map((g) => ({ goalId: g.id, ownerId: g.owner_id }));
}

async function githubEmitterFor(ownerId: string): Promise<string> {
  const existing = await supabase
    .from("emitters")
    .select("id")
    .eq("owner_id", ownerId)
    .eq("kind", "github")
    .is("revoked_at", null)
    .limit(1)
    .maybeSingle();
  if (existing.error) throw new Error(`githubEmitterFor: ${existing.error.message}`);
  if (existing.data) return existing.data.id;
  const inserted = await supabase
    .from("emitters")
    .insert({ owner_id: ownerId, kind: "github", display_name: "GitHub App" })
    .select("id")
    .single();
  if (inserted.error) throw new Error(`githubEmitterFor insert: ${inserted.error.message}`);
  return inserted.data.id;
}

// ── ingest repo (same contract as the token endpoint) ───────────────────────

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
    if (inserted.error.code === "23505" && job.dedupKey) {
      const { data, error } = await supabase.from("jobs").select("*").eq("dedup_key", job.dedupKey).single();
      if (error) throw new Error(`enqueueJob reselect: ${error.message}`);
      return data;
    }
    throw new Error(`enqueueJob: ${inserted.error.message}`);
  },
};

// ── event mapping ───────────────────────────────────────────────────────────

interface MappedEvent {
  input: Omit<IngestInput, "credential">;
}

function mapPush(payload: Record<string, unknown>): MappedEvent[] {
  const branch = String(payload.ref ?? "").replace("refs/heads/", "");
  const commits = Array.isArray(payload.commits) ? payload.commits : [];
  return commits
    .filter((c) => c && typeof c === "object" && typeof c.id === "string")
    .map((c) => ({
      input: {
        source: "commit" as const,
        goalId: "", // filled per goal binding
        milestoneId: null,
        occurredAt: typeof c.timestamp === "string" ? c.timestamp : undefined,
        commit: {
          sha: c.id,
          message: String(c.message ?? ""),
          branch,
          files: [
            ...(Array.isArray(c.added) ? c.added : []),
            ...(Array.isArray(c.modified) ? c.modified : []),
            ...(Array.isArray(c.removed) ? c.removed : []),
          ],
          // HMAC-verified server-side webhook: the auto-verifiable trust class (see header).
          verified: true,
        },
      },
    }));
}

function mapWorkflowRun(payload: Record<string, unknown>): MappedEvent[] {
  if (payload.action !== "completed") return [];
  const run = payload.workflow_run as Record<string, unknown> | undefined;
  if (!run || typeof run !== "object") return [];
  return [
    {
      input: {
        source: "ci" as const,
        goalId: "",
        milestoneId: null,
        occurredAt: typeof run.updated_at === "string" ? run.updated_at : undefined,
        run: {
          runId: String(run.id ?? ""),
          workflow: typeof run.name === "string" ? run.name : undefined,
          conclusion: String(run.conclusion ?? "failure"),
          branch: typeof run.head_branch === "string" ? run.head_branch : undefined,
        },
      },
    },
  ];
}

// ── entry ───────────────────────────────────────────────────────────────────

export async function githubWebhookHandler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405 });
  }
  const rawBody = await req.text();
  const ok = await verifySignature(rawBody, req.headers.get("x-hub-signature-256"));
  if (!ok) {
    return new Response(JSON.stringify({ error: "invalid signature" }), { status: 401 });
  }

  const event = req.headers.get("x-github-event") ?? "";
  if (event === "ping") {
    return new Response(JSON.stringify({ ok: true, pong: true }), { status: 200 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response(JSON.stringify({ error: "bad json" }), { status: 400 });
  }

  const repoFullName = (payload.repository as Record<string, unknown> | undefined)?.full_name;
  if (typeof repoFullName !== "string") {
    return new Response(JSON.stringify({ error: "no repository in payload" }), { status: 400 });
  }

  const mapped = event === "push" ? mapPush(payload) : event === "workflow_run" ? mapWorkflowRun(payload) : [];
  if (mapped.length === 0) {
    return new Response(JSON.stringify({ ok: true, ignored: event }), { status: 200 });
  }

  const bindings = await goalsBoundToRepo(repoFullName);
  if (bindings.length === 0) {
    return new Response(JSON.stringify({ ok: true, unbound: repoFullName }), { status: 200 });
  }

  let accepted = 0;
  let deduped = 0;
  for (const binding of bindings) {
    const emitterId = await githubEmitterFor(binding.ownerId);
    // Auth already happened (HMAC) and identity is resolved from the repo binding.
    const deps: IngestDeps = {
      repo,
      verifyAuth: async (): Promise<AuthContext> => ({ ownerId: binding.ownerId, emitterId }),
      now: () => new Date(),
    };
    for (const { input } of mapped) {
      const result = await handleIngest(deps, {
        ...input,
        goalId: binding.goalId,
        credential: {},
      } as IngestInput);
      if (result.ok) {
        if (result.deduped) deduped += 1;
        else accepted += 1;
      } else {
        console.error("github-webhook ingest failed:", result.error);
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, accepted, deduped, goals: bindings.length }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  try {
    return await githubWebhookHandler(req);
  } catch (err) {
    console.error("github-webhook: unhandled error", err);
    return new Response(JSON.stringify({ error: "internal error" }), { status: 500 });
  }
});
