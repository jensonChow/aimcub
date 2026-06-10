/**
 * Ports (dependency-injection boundaries) for the evidence ingest Edge Function
 * and the jobs worker.
 *
 * These are intentionally minimal interfaces — NOT the full `@core/api-client`
 * `AimcubRepo` — so the pure handlers (`handleIngest`, `runJob`) stay decoupled
 * from the concrete supabase-js implementation. The real Deno entry wrappers adapt
 * a service-role Supabase client to these ports; tests adapt an in-memory fake.
 *
 * Everything here is pure types + a thin shared shape; zero platform dependencies,
 * so it imports cleanly under both Node (Vitest) and Deno.
 */
import type {
  AcceptanceRule,
  Evidence,
  Job,
  JobType,
  Milestone,
  MilestoneCompletion,
} from "@core/types";

// ──────────────────────────────────────────────────────────────────────────
// Auth
// ──────────────────────────────────────────────────────────────────────────

/**
 * Result of verifying an inbound emitter credential. The verifier resolves the
 * caller's identity (owner) and the emitter row that signed the request — both are
 * needed to attribute and authorize the evidence write.
 */
export interface AuthContext {
  ownerId: string;
  emitterId: string | null;
}

/**
 * Verifies the inbound credential (emitter token / signed webhook) and resolves
 * the authenticated identity. Returns `null` when the credential is missing,
 * malformed, revoked, or invalid — callers MUST treat `null` as 401.
 *
 * Injected so the pure handler never imports a crypto/JWKS/DB stack.
 */
export type VerifyAuth = (credential: AuthCredential) => Promise<AuthContext | null>;

/** Opaque credential extracted from the request by the entry wrapper. */
export interface AuthCredential {
  /** Bearer token (emitter token / JWT). */
  token?: string;
  /** Raw signature header for webhook-signature verification (GitHub / CI). */
  signature?: string;
  /** Raw request body, needed to recompute the HMAC for signature verification. */
  rawBody?: string;
}

// ──────────────────────────────────────────────────────────────────────────
// Ingest repo
// ──────────────────────────────────────────────────────────────────────────

/** Evidence write payload (id/owner/timestamps filled in by the repo impl). */
export interface EvidenceWrite {
  ownerId: string;
  goalId: string;
  milestoneId: string | null;
  emitterId: string | null;
  kind: Evidence["kind"];
  sourceEventId: string | null;
  occurredAt: string;
  summary: string;
  payload: Record<string, unknown>;
  trustScore: number;
}

/** Job enqueue payload — `dedupKey` enforces the "enqueue once" invariant. */
export interface JobEnqueue {
  type: JobType;
  payload: Record<string, unknown>;
  dedupKey: string | null;
  runAfter?: string;
}

export interface IngestRepo {
  /**
   * Idempotent dedup lookup: returns the existing evidence row for
   * `(emitterId, sourceEventId)`, or `null` if none exists. Mirrors the DB's
   * `evidence_idempotency_idx` unique index. Only meaningful when
   * `sourceEventId` is non-null.
   */
  findEvidenceBySourceEvent(
    emitterId: string | null,
    sourceEventId: string | null,
  ): Promise<Evidence | null>;

  /** Append-only insert of a normalized evidence row. */
  insertEvidence(write: EvidenceWrite): Promise<Evidence>;

  /**
   * Idempotent enqueue: inserts the job, or returns the already-queued job if a
   * row with the same `dedupKey` exists (mirrors `jobs_dedup_idx`). When `dedupKey`
   * is null, always inserts.
   */
  enqueueJob(job: JobEnqueue): Promise<Job>;
}

// ──────────────────────────────────────────────────────────────────────────
// Worker repo
// ──────────────────────────────────────────────────────────────────────────

/** Idempotent completion write — `milestoneId` is unique (a milestone completes once). */
export interface CompletionWrite {
  milestoneId: string;
  ownerId: string;
  decidedBy: MilestoneCompletion["decided_by"];
  triggeringEvidenceIds: string[];
  awardedXp: number;
}

export interface WorkerRepo {
  /** Loads a milestone (its `acceptance_rule`, `xp_reward`, owner, etc.). */
  getMilestone(milestoneId: string): Promise<Milestone | null>;

  /**
   * Open (pending / in_progress) milestones of a goal — the judging targets for
   * goal-level evidence that arrived without a milestone (e.g. webhook pushes).
   */
  listPendingMilestones(goalId: string): Promise<Milestone[]>;

  /**
   * Evidence considered for judging a milestone. The worker passes the milestone
   * id; the impl returns the milestone's directly-attached evidence plus any
   * goal-level evidence still awaiting triage that the kernel should weigh.
   */
  listEvidenceForMilestone(milestoneId: string): Promise<Evidence[]>;

  /** Existing completion for a milestone, or null. Used to short-circuit re-judging. */
  getCompletion(milestoneId: string): Promise<MilestoneCompletion | null>;

  /**
   * Idempotent completion insert: writes the completion, or returns the existing
   * one if the milestone is already completed (mirrors the UNIQUE constraint on
   * `milestone_completions.milestone_id`). Returns `{ completion, created }` so the
   * worker knows whether to enqueue follow-up jobs.
   */
  insertCompletion(
    write: CompletionWrite,
  ): Promise<{ completion: MilestoneCompletion; created: boolean }>;

  /** Same idempotent enqueue contract as `IngestRepo`. */
  enqueueJob(job: JobEnqueue): Promise<Job>;
}

// Re-export for entry wrappers / tests that want the rule type without reaching
// into @core/types directly.
export type { AcceptanceRule };
