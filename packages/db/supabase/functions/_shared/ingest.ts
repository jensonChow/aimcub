/**
 * handleIngest — the pure, dependency-injected core of the evidence ingest
 * Edge Function.
 *
 * Pipeline:
 *   1. verify auth (injected verifier) → resolve owner + emitter
 *   2. idempotent dedup by (emitter_id, source_event_id) via the injected repo
 *   3. normalize the raw event via @core (commit / CI)
 *   4. append the evidence row via the repo
 *   5. enqueue a `judge_evidence` job with a dedup_key so the same evidence is
 *      judged at most once
 *
 * No I/O of its own: `deps` carries the repo, the auth verifier, and a `now()`
 * clock. This is what the Vitest suite drives directly and what the Deno entry
 * wrapper wires to real infrastructure.
 */
import {
  normalizeCiEvidence,
  normalizeCommitEvidence,
  type NormalizedEvidence,
  type RawCiRun,
  type RawCommit,
} from "@core/domain";
import type { Evidence } from "@core/types";
import type {
  AuthCredential,
  IngestRepo,
  VerifyAuth,
} from "./ports.ts";

export interface IngestDeps {
  repo: IngestRepo;
  verifyAuth: VerifyAuth;
  /** Deterministic clock — injected so tests are reproducible. */
  now: () => Date;
}

/**
 * The raw inbound payload, discriminated by `source`. The entry wrapper parses
 * the HTTP request / webhook into one of these before calling `handleIngest`.
 * `goalId` / `milestoneId` describe where the evidence attaches; `milestoneId`
 * may be null (awaiting triage).
 */
export type IngestInput =
  | {
      source: "commit";
      credential: AuthCredential;
      goalId: string;
      milestoneId?: string | null;
      commit: RawCommit;
      /** Override for occurred_at; defaults to deps.now(). */
      occurredAt?: string;
    }
  | {
      source: "ci";
      credential: AuthCredential;
      goalId: string;
      milestoneId?: string | null;
      run: RawCiRun;
      occurredAt?: string;
    };

export type IngestResult =
  | { ok: true; evidence: Evidence; deduped: boolean; status: 200 | 201 }
  | { ok: false; status: 400 | 401; error: string };

/** Stable dedup key for the judge job, so one evidence row triggers one judging. */
export function judgeJobDedupKey(evidenceId: string): string {
  return `judge:${evidenceId}`;
}

function normalize(input: IngestInput, occurredAt: string): NormalizedEvidence {
  // @core owns the trust-score policy (verified commit = 1.0, unverified = 0.7,
  // CI = 1.0) — we never recompute trust here.
  switch (input.source) {
    case "commit":
      return normalizeCommitEvidence(input.commit, occurredAt);
    case "ci":
      return normalizeCiEvidence(input.run, occurredAt);
  }
}

export async function handleIngest(
  deps: IngestDeps,
  input: IngestInput,
): Promise<IngestResult> {
  // 1. Auth — never trust the caller's claimed owner; derive it from the credential.
  const auth = await deps.verifyAuth(input.credential);
  if (!auth) {
    return { ok: false, status: 401, error: "unauthorized" };
  }

  if (!input.goalId) {
    return { ok: false, status: 400, error: "goalId is required" };
  }

  const occurredAt = input.occurredAt ?? deps.now().toISOString();
  const normalized = normalize(input, occurredAt);

  // 2. Idempotent dedup. The DB enforces this with a unique index, but checking
  //    up front lets us return the existing row (and avoid re-enqueueing) instead
  //    of relying on a unique-violation round-trip.
  if (normalized.source_event_id) {
    const existing = await deps.repo.findEvidenceBySourceEvent(
      auth.emitterId,
      normalized.source_event_id,
    );
    if (existing) {
      return { ok: true, evidence: existing, deduped: true, status: 200 };
    }
  }

  // 3 + 4. Append the normalized evidence row.
  const evidence = await deps.repo.insertEvidence({
    ownerId: auth.ownerId,
    goalId: input.goalId,
    milestoneId: input.milestoneId ?? null,
    emitterId: auth.emitterId,
    kind: normalized.kind,
    sourceEventId: normalized.source_event_id,
    occurredAt: normalized.occurred_at,
    summary: normalized.summary,
    payload: normalized.payload,
    trustScore: normalized.trust_score,
  });

  // 5. Enqueue judging. Dedup on the evidence id so retries / duplicate webhook
  //    deliveries that somehow slip past step 2 still judge only once.
  await deps.repo.enqueueJob({
    type: "judge_evidence",
    payload: {
      evidence_id: evidence.id,
      owner_id: evidence.owner_id,
      goal_id: evidence.goal_id,
      milestone_id: evidence.milestone_id,
    },
    dedupKey: judgeJobDedupKey(evidence.id),
  });

  return { ok: true, evidence, deduped: false, status: 201 };
}
