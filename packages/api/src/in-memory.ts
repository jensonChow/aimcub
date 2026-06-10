/**
 * InMemoryAimcubRepo — a full in-memory implementation of {@link AimcubRepo}.
 *
 * Purpose:
 *  - unit tests for the contract and for any consumer that wants a deterministic backend;
 *  - local dev without a Supabase project.
 *
 * It enforces, in plain TS, the three invariants that the DB enforces with constraints
 * (see `packages/db/supabase/migrations/0001_init.sql`):
 *   1. evidence is idempotent — unique by `(emitter_id, source_event_id)` when
 *      `source_event_id` is non-null;
 *   2. `milestone_completions` is unique by `milestone_id` — a node completes only once;
 *   3. one pet per goal — `pets.goal_id` is unique.
 *
 * Reads are RLS-shaped: the user-path methods filter by `owner_id` exactly like the
 * `own_select` policy does, so test code sees the same isolation it would in production.
 */
import type {
  Collectible,
  Evidence,
  Goal,
  Milestone,
  MilestoneCompletion,
  Notification,
  Pet,
} from "@core/types";

import type {
  CreateGoalInput,
  AimcubRepo,
  IngestEvidenceInput,
} from "./contract.js";

/** Pluggable id/clock so tests can be deterministic. Defaults are good enough for dev. */
export interface InMemoryDeps {
  /** Returns a fresh unique id. Defaults to `crypto.randomUUID()`. */
  newId?: () => string;
  /** Returns the current time as an ISO string. Defaults to `new Date().toISOString()`. */
  now?: () => string;
}

/** Optional seed state, useful for tests that need pre-existing rows. */
export interface InMemorySeed {
  goals?: Goal[];
  milestones?: Milestone[];
  pets?: Pet[];
  collectibles?: Collectible[];
  notifications?: Notification[];
  evidence?: Evidence[];
  completions?: MilestoneCompletion[];
}

/** Thrown when an invariant would be violated. Mirrors the DB constraint that would fire. */
export class InvariantError extends Error {
  constructor(
    message: string,
    /** A stable machine-readable code so callers can branch without string matching. */
    public readonly code:
      | "evidence_idempotency"
      | "one_pet_per_goal"
      | "milestone_completion_unique"
      | "emitter_owner_mismatch",
  ) {
    super(message);
    this.name = "InvariantError";
  }
}

const defaultId = (): string => {
  // `globalThis.crypto` exists in Node >= 20 and all our runtimes.
  return globalThis.crypto.randomUUID();
};

const defaultNow = (): string => new Date().toISOString();

export class InMemoryAimcubRepo implements AimcubRepo {
  private readonly goals = new Map<string, Goal>();
  private readonly milestones = new Map<string, Milestone>();
  private readonly pets = new Map<string, Pet>(); // keyed by pet id
  private readonly petByGoal = new Map<string, string>(); // goal_id -> pet id (one-pet-per-goal index)
  private readonly collectibles = new Map<string, Collectible>();
  private readonly notifications = new Map<string, Notification>();
  private readonly evidence = new Map<string, Evidence>();
  private readonly completions = new Map<string, MilestoneCompletion>(); // keyed by completion id
  private readonly completionByMilestone = new Map<string, string>(); // milestone_id -> completion id (uniqueness index)
  /** Idempotency index for evidence: `${emitter_id}\u0000${source_event_id}` -> evidence id. */
  private readonly evidenceIdempotency = new Map<string, string>();
  /** owner_id of every emitter we have seen, used for the emitter-owner guard. */
  private readonly emitterOwner = new Map<string, string>();

  private readonly newId: () => string;
  private readonly now: () => string;

  constructor(deps: InMemoryDeps = {}, seed: InMemorySeed = {}) {
    this.newId = deps.newId ?? defaultId;
    this.now = deps.now ?? defaultNow;
    for (const g of seed.goals ?? []) this.goals.set(g.id, g);
    for (const m of seed.milestones ?? []) this.milestones.set(m.id, m);
    for (const p of seed.pets ?? []) {
      this.pets.set(p.id, p);
      this.petByGoal.set(p.goal_id, p.id);
    }
    for (const c of seed.collectibles ?? []) this.collectibles.set(c.id, c);
    for (const n of seed.notifications ?? []) this.notifications.set(n.id, n);
    for (const e of seed.evidence ?? []) {
      this.evidence.set(e.id, e);
      if (e.source_event_id != null && e.emitter_id != null) {
        this.evidenceIdempotency.set(idemKey(e.emitter_id, e.source_event_id), e.id);
      }
    }
    for (const mc of seed.completions ?? []) {
      this.completions.set(mc.id, mc);
      this.completionByMilestone.set(mc.milestone_id, mc.id);
    }
  }

  // ── test/dev helpers ──────────────────────────────────────────────────────

  /**
   * Register an emitter's owner so {@link ingestEvidence} can enforce the
   * `assert_evidence_emitter_owner` guard. In production this is implicit in the
   * `emitters` table; the in-memory repo needs it told explicitly.
   */
  registerEmitter(emitterId: string, ownerId: string): void {
    this.emitterOwner.set(emitterId, ownerId);
  }

  /** Upsert a pet directly (the jobs worker path materializes pets in production). */
  upsertPet(pet: Pet): Pet {
    const existingId = this.petByGoal.get(pet.goal_id);
    if (existingId && existingId !== pet.id) {
      throw new InvariantError(
        `goal ${pet.goal_id} already has pet ${existingId}`,
        "one_pet_per_goal",
      );
    }
    this.pets.set(pet.id, pet);
    this.petByGoal.set(pet.goal_id, pet.id);
    return pet;
  }

  /** Insert a collectible directly (minting is a server/worker concern). */
  addCollectible(c: Collectible): Collectible {
    this.collectibles.set(c.id, c);
    return c;
  }

  /** Queue a notification directly (the proactive worker writes these in production). */
  addNotification(n: Notification): Notification {
    this.notifications.set(n.id, n);
    return n;
  }

  /**
   * Record a milestone completion, enforcing the unique-by-milestone invariant.
   * Exposed for the jobs worker / tests; the user-facing contract never writes completions.
   */
  recordCompletion(c: MilestoneCompletion): MilestoneCompletion {
    if (this.completionByMilestone.has(c.milestone_id)) {
      throw new InvariantError(
        `milestone ${c.milestone_id} is already completed`,
        "milestone_completion_unique",
      );
    }
    this.completions.set(c.id, c);
    this.completionByMilestone.set(c.milestone_id, c.id);
    return c;
  }

  getCompletion(milestoneId: string): MilestoneCompletion | null {
    const id = this.completionByMilestone.get(milestoneId);
    return id ? (this.completions.get(id) ?? null) : null;
  }

  // ── user path (RLS-shaped: filtered by owner_id) ──────────────────────────

  async createGoal(input: CreateGoalInput): Promise<Goal> {
    const goal: Goal = {
      id: this.newId(),
      owner_id: input.ownerId,
      title: input.title,
      description: input.description ?? "",
      domain: input.domain ?? "software",
      status: "draft",
      target_date: input.targetDate ?? null,
      plan_json: null,
      metadata: {},
      created_at: this.now(),
    };
    this.goals.set(goal.id, goal);
    return goal;
  }

  async getGoal(id: string): Promise<Goal | null> {
    return this.goals.get(id) ?? null;
  }

  async listGoals(ownerId: string): Promise<Goal[]> {
    return [...this.goals.values()]
      .filter((g) => g.owner_id === ownerId)
      .sort(byCreatedAtDesc);
  }

  async listMilestones(goalId: string): Promise<Milestone[]> {
    return [...this.milestones.values()]
      .filter((m) => m.goal_id === goalId)
      .sort((a, b) => a.order_index - b.order_index);
  }

  async getPet(goalId: string): Promise<Pet | null> {
    const id = this.petByGoal.get(goalId);
    return id ? (this.pets.get(id) ?? null) : null;
  }

  async listCollectibles(ownerId: string): Promise<Collectible[]> {
    return [...this.collectibles.values()]
      .filter((c) => c.owner_id === ownerId)
      .sort((a, b) => (b.minted_at ?? "").localeCompare(a.minted_at ?? ""));
  }

  async listInbox(ownerId: string, since?: string): Promise<Notification[]> {
    return [...this.notifications.values()]
      .filter(
        (n) =>
          n.owner_id === ownerId &&
          n.channels.includes("agent_inbox") &&
          (since === undefined || (n.created_at ?? "") >= since),
      )
      .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));
  }

  async updateGoalPlan(goalId: string, planJson: unknown, status: Goal["status"] = "active"): Promise<Goal> {
    const goal = this.goals.get(goalId);
    if (!goal) throw new Error(`goal not found: ${goalId}`);
    const updated: Goal = { ...goal, plan_json: planJson, status };
    this.goals.set(goalId, updated);
    return updated;
  }

  // ── server path (service_role: bypasses RLS, writes derived/anti-cheat state) ──

  async insertMilestones(milestones: Milestone[]): Promise<Milestone[]> {
    const inserted: Milestone[] = [];
    for (const m of milestones) {
      const row: Milestone = { ...m, id: m.id || this.newId() };
      this.milestones.set(row.id, row);
      inserted.push(row);
    }
    return inserted;
  }

  async ingestEvidence(input: IngestEvidenceInput): Promise<Evidence> {
    // Guard: an emitter, if supplied and known, must belong to the same owner.
    // Mirrors the `assert_evidence_emitter_owner` trigger.
    if (input.emitterId != null) {
      const owner = this.emitterOwner.get(input.emitterId);
      if (owner !== undefined && owner !== input.ownerId) {
        throw new InvariantError(
          `emitter ${input.emitterId} does not belong to owner ${input.ownerId}`,
          "emitter_owner_mismatch",
        );
      }
    }

    // Idempotency: same (emitter_id, source_event_id) returns the existing row.
    // Matches the partial unique index `evidence_idempotency_idx`.
    if (input.sourceEventId != null && input.emitterId != null) {
      const key = idemKey(input.emitterId, input.sourceEventId);
      const existingId = this.evidenceIdempotency.get(key);
      if (existingId) {
        const existing = this.evidence.get(existingId);
        if (existing) return existing;
      }

      const row = this.buildEvidence(input);
      this.evidence.set(row.id, row);
      this.evidenceIdempotency.set(key, row.id);
      return row;
    }

    // No idempotency key → always inserts a new row (append-only stream).
    const row = this.buildEvidence(input);
    this.evidence.set(row.id, row);
    return row;
  }

  private buildEvidence(input: IngestEvidenceInput): Evidence {
    return {
      id: this.newId(),
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
      created_at: this.now(),
    };
  }

  // ── read-through helpers for tests ────────────────────────────────────────

  /** All evidence for a goal, newest first. Mirrors the server-side read of the stream. */
  listEvidence(goalId: string): Evidence[] {
    return [...this.evidence.values()]
      .filter((e) => e.goal_id === goalId)
      .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  }
}

const idemKey = (emitterId: string, sourceEventId: string): string =>
  `${emitterId}\u0000${sourceEventId}`;

const byCreatedAtDesc = (a: { created_at?: string }, b: { created_at?: string }): number =>
  (b.created_at ?? "").localeCompare(a.created_at ?? "");
