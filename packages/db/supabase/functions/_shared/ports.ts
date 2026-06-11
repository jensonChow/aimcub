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
  Collectible,
  Evidence,
  Goal,
  Job,
  JobType,
  Milestone,
  MilestoneCompletion,
  Notification,
  NotificationChannel,
  NotificationStatus,
  NotificationTrigger,
  Pet,
  PetStage,
  Rarity,
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

/** Derived pet state write (one pet per goal — `goalId` is the conflict target). */
export interface PetUpsert {
  goalId: string;
  ownerId: string;
  xp: number;
  stage: PetStage;
}

/** Collectible mint write (id/minted_at filled in by the repo impl). */
export interface CollectibleWrite {
  ownerId: string;
  goalId: string | null;
  milestoneId: string | null;
  kind: Collectible["kind"];
  rarity: Rarity;
  metadata: Record<string, unknown>;
}

/** Notification write — `dedupKey` enforces the "deliver once" invariant. */
export interface NotificationWrite {
  ownerId: string;
  trigger: NotificationTrigger;
  channels: NotificationChannel[];
  dedupKey: string | null;
  refGoalId: string | null;
  refMilestoneId: string | null;
  personaMsg: string;
  status: NotificationStatus;
}

export interface WorkerRepo {
  /** Loads a milestone (its `acceptance_rule`, `xp_reward`, owner, etc.). */
  getMilestone(milestoneId: string): Promise<Milestone | null>;

  /** Loads a goal (title snapshot for collectible metadata, owner, status). */
  getGoal(goalId: string): Promise<Goal | null>;

  /**
   * Open (pending / in_progress) milestones of a goal — the judging targets for
   * goal-level evidence that arrived without a milestone (e.g. webhook pushes).
   * Also feeds the "goal finished?" derivation: a goal is complete when every
   * open milestone has a completion in the stream (the status cache alone is
   * not trusted — it is written non-atomically with the completion).
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

  // ── v1b: derived pet / collectible / notification state ──────────────────

  /**
   * All completions of a goal (joined through milestones). The source of truth
   * for pet XP: `grow_pet` RECOMPUTES from this stream, never increments.
   */
  listCompletionsForGoal(goalId: string): Promise<MilestoneCompletion[]>;

  /**
   * Healing write: re-asserts `milestones.status = 'completed'` for a milestone
   * whose completion row exists but whose status cache is stale (a crash landed
   * between the completion insert and the status flip). No-op when already
   * completed.
   */
  markMilestoneCompleted(milestoneId: string): Promise<void>;

  /** The goal's pet, or null if `grow_pet` has not run yet. */
  getPetByGoal(goalId: string): Promise<Pet | null>;

  /**
   * MONOTONIC upsert of the one-per-goal pets row (conflict target: `goal_id`
   * UNIQUE). xp is recomputed from the append-only completion stream, so it
   * never legitimately decreases: the impl keeps `greatest(stored.xp, write.xp)`
   * (live: `upsert_pet_monotonic` RPC, 0010) so a stale concurrent recompute
   * can never regress the pet. Returns the winning row.
   */
  upsertPet(write: PetUpsert): Promise<Pet>;

  /**
   * Backfills `milestone_completions.minted_collectible_id` — the idempotency
   * anchor for `mint_collectible` (mint only when it is still null). Conditional
   * (never overwrites an existing anchor); a lost anchor race is harmless because
   * the unique badge index (0010) guarantees both racers carry the same badge id.
   */
  setCompletionMinted(completionId: string, collectibleId: string): Promise<void>;

  /**
   * Idempotent collectible insert. The DB enforces mint-once via partial unique
   * indexes (0010): one `milestone_badge` per milestone, one `goal_trophy` per
   * goal. A unique violation means "already minted" — the impl returns the
   * existing row with `created: false` instead of inserting a duplicate.
   */
  insertCollectible(
    write: CollectibleWrite,
  ): Promise<{ collectible: Collectible; created: boolean }>;

  /**
   * CAS: marks the goal achieved (status = 'achieved') only when it is not
   * already. Returns true iff THIS call won the transition — a raced or retried
   * call sees false. (Live: conditional UPDATE with a rows-affected check.)
   */
  setGoalAchieved(goalId: string): Promise<boolean>;

  /**
   * Idempotent notification insert: writes the row, or returns the existing one
   * when `dedupKey` already exists (mirrors the partial UNIQUE index on
   * `notifications.dedup_key` — a unique violation means "already delivered").
   */
  insertNotification(
    write: NotificationWrite,
  ): Promise<{ notification: Notification; created: boolean }>;

  /** Whether a notification with this dedup_key has already been written. */
  notificationDedupExists(dedupKey: string): Promise<boolean>;

  /**
   * Nudges (non-celebration triggers) already sent to this USER today (UTC day
   * of `now`), aggregated across all goals — feeds the per-user daily cap.
   */
  countNudgesToday(ownerId: string, now: Date): Promise<number>;
}

// ──────────────────────────────────────────────────────────────────────────
// Persona message generation (pet-voice copy)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Everything the pet-voice generator needs to phrase a celebration. Stage info is
 * derived via repo reads (grow_pet's outcome is not visible across queue entries).
 */
export interface CelebrationContext {
  trigger: "milestone_done" | "goal_done";
  /** Owner attribution for LLM metering. */
  ownerId: string;
  goalTitle: string;
  milestoneTitle: string;
  petStage: PetStage;
  stagedUp: boolean;
  xpAwarded: number;
  goalCompleted: boolean;
}

/**
 * Pet-voice message generator (LLM-backed in production via @core/llm
 * `celebrate`). MUST resolve `null` on any failure — the worker then falls back
 * to the deterministic in-character message. Never throws by contract; the
 * worker still guards with try/catch.
 */
export type PersonaMessageGenerator = (ctx: CelebrationContext) => Promise<string | null>;

// Re-export for entry wrappers / tests that want the rule type without reaching
// into @core/types directly.
export type { AcceptanceRule };
