/**
 * In-memory fake repo for the evidence-ingest / jobs-worker unit tests.
 *
 * Decoupling note: this implements the LOCAL `IngestRepo` + `WorkerRepo` ports
 * (defined in `../ports.ts`) — it deliberately does NOT import `@core/api-client`.
 *
 * It enforces the same idempotency invariants the Postgres schema does, so the
 * tests exercise the real behaviour:
 *   - evidence unique on (emitter_id, source_event_id)   [evidence_idempotency_idx]
 *   - milestone_completions unique on milestone_id        [PK / unique]
 *   - jobs unique on dedup_key when present               [jobs_dedup_idx]
 *   - pets unique on goal_id (one pet per goal)           [pets.goal_id UNIQUE]
 *     with a MONOTONIC upsert (xp never lowered)          [upsert_pet_monotonic, 0010]
 *   - notifications unique on dedup_key when present      [notifications_dedup_idx, 0008]
 *   - collectibles: one badge per milestone, one trophy
 *     per goal (insert returns the existing row instead)  [0010 partial uniques]
 *   - goals: setGoalAchieved is a CAS (true only for the winning transition)
 * Side effects mirror the live repo too: inserting a completion flips the
 * milestone to status 'completed' (the UI reads milestones.status).
 */
import type {
  Collectible,
  Evidence,
  Goal,
  Job,
  Milestone,
  MilestoneCompletion,
  Notification,
  Pet,
} from "@core/types";
import type {
  CollectibleWrite,
  CompletionWrite,
  EvidenceWrite,
  IngestRepo,
  JobEnqueue,
  NotificationWrite,
  PetUpsert,
  WorkerRepo,
} from "../ports.ts";

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  // Deterministic uuid-shaped id so anything that validates against z.string().uuid() passes.
  const n = counter.toString(16).padStart(12, "0");
  return `${prefix.padEnd(8, "0").slice(0, 8)}-0000-4000-8000-${n}`;
}

export interface MemoryRepoState {
  evidence: Evidence[];
  jobs: Job[];
  completions: MilestoneCompletion[];
  milestones: Map<string, Milestone>;
  goals: Map<string, Goal>;
  pets: Pet[];
  collectibles: Collectible[];
  notifications: Notification[];
  /** milestoneId -> evidence the worker should consider. */
  evidenceByMilestone: Map<string, Evidence[]>;
}

export interface MemoryRepo extends IngestRepo, WorkerRepo {
  state: MemoryRepoState;
  seedGoal(g: Goal): void;
  seedMilestone(m: Milestone): void;
  seedCompletion(c: MilestoneCompletion): void;
  seedPet(p: Pet): void;
  seedNotification(n: Notification): void;
  /** Attach evidence to a milestone for the worker's `listEvidenceForMilestone`. */
  seedEvidenceForMilestone(milestoneId: string, evidence: Evidence[]): void;
}

const NUDGE_TRIGGERS = new Set(["stale", "deadline_near", "scheduled"]);

function sameUtcDay(isoA: string, b: Date): boolean {
  const a = new Date(isoA);
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

export function createMemoryRepo(now: () => Date = () => new Date()): MemoryRepo {
  const state: MemoryRepoState = {
    evidence: [],
    jobs: [],
    completions: [],
    milestones: new Map(),
    goals: new Map(),
    pets: [],
    collectibles: [],
    notifications: [],
    evidenceByMilestone: new Map(),
  };

  return {
    state,

    seedGoal(g: Goal) {
      state.goals.set(g.id, g);
    },

    seedMilestone(m: Milestone) {
      state.milestones.set(m.id, m);
    },

    seedCompletion(c: MilestoneCompletion) {
      state.completions.push(c);
    },

    seedPet(p: Pet) {
      state.pets.push(p);
    },

    seedNotification(n: Notification) {
      state.notifications.push(n);
    },

    seedEvidenceForMilestone(milestoneId: string, evidence: Evidence[]) {
      state.evidenceByMilestone.set(milestoneId, evidence);
    },

    // ── IngestRepo ──────────────────────────────────────────────────────────
    async findEvidenceBySourceEvent(emitterId, sourceEventId) {
      if (sourceEventId === null) return null;
      return (
        state.evidence.find(
          (e) => e.emitter_id === emitterId && e.source_event_id === sourceEventId,
        ) ?? null
      );
    },

    async insertEvidence(write: EvidenceWrite) {
      // Enforce the unique (emitter_id, source_event_id) index.
      if (write.sourceEventId !== null) {
        const dup = state.evidence.find(
          (e) =>
            e.emitter_id === write.emitterId &&
            e.source_event_id === write.sourceEventId,
        );
        if (dup) {
          throw new Error("duplicate key value violates evidence_idempotency_idx");
        }
      }
      const row: Evidence = {
        id: nextId("evidence"),
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
        created_at: now().toISOString(),
      };
      state.evidence.push(row);
      return row;
    },

    async enqueueJob(job: JobEnqueue) {
      // Enforce the unique dedup_key index: return the existing job instead of
      // inserting a duplicate.
      if (job.dedupKey !== null) {
        const existing = state.jobs.find((j) => j.dedup_key === job.dedupKey);
        if (existing) return existing;
      }
      const row: Job = {
        id: nextId("job"),
        type: job.type,
        payload: job.payload,
        status: "queued",
        dedup_key: job.dedupKey,
        run_after: job.runAfter ?? now().toISOString(),
        attempts: 0,
        last_error: null,
        created_at: now().toISOString(),
      };
      state.jobs.push(row);
      return row;
    },

    // ── WorkerRepo ──────────────────────────────────────────────────────────
    async getMilestone(milestoneId: string) {
      return state.milestones.get(milestoneId) ?? null;
    },

    async getGoal(goalId: string) {
      return state.goals.get(goalId) ?? null;
    },

    async listPendingMilestones(goalId: string) {
      return [...state.milestones.values()].filter(
        (m) => m.goal_id === goalId && (m.status === "pending" || m.status === "in_progress"),
      );
    },

    async listEvidenceForMilestone(milestoneId: string) {
      return state.evidenceByMilestone.get(milestoneId) ?? [];
    },

    async getCompletion(milestoneId: string) {
      return state.completions.find((c) => c.milestone_id === milestoneId) ?? null;
    },

    async insertCompletion(write: CompletionWrite) {
      // Enforce the UNIQUE(milestone_id) constraint: a milestone completes once.
      const existing = state.completions.find(
        (c) => c.milestone_id === write.milestoneId,
      );
      if (existing) {
        return { completion: existing, created: false };
      }
      const row: MilestoneCompletion = {
        id: nextId("compl"),
        milestone_id: write.milestoneId,
        owner_id: write.ownerId,
        decided_by: write.decidedBy,
        triggering_evidence_ids: write.triggeringEvidenceIds,
        awarded_xp: write.awardedXp,
        minted_collectible_id: null,
        created_at: now().toISOString(),
      };
      state.completions.push(row);
      // Mirror the live repo: reflect the derived state on the milestone row.
      const milestone = state.milestones.get(write.milestoneId);
      if (milestone) {
        state.milestones.set(write.milestoneId, {
          ...milestone,
          status: "completed",
          completed_at: now().toISOString(),
        });
      }
      return { completion: row, created: true };
    },

    // ── WorkerRepo (v1b: pets / collectibles / notifications) ───────────────
    async listCompletionsForGoal(goalId: string) {
      return state.completions.filter(
        (c) => state.milestones.get(c.milestone_id)?.goal_id === goalId,
      );
    },

    async markMilestoneCompleted(milestoneId: string) {
      const milestone = state.milestones.get(milestoneId);
      if (milestone && milestone.status !== "completed") {
        state.milestones.set(milestoneId, {
          ...milestone,
          status: "completed",
          completed_at: now().toISOString(),
        });
      }
    },

    async getPetByGoal(goalId: string) {
      return state.pets.find((p) => p.goal_id === goalId) ?? null;
    },

    async upsertPet(write: PetUpsert) {
      // Mirror upsert_pet_monotonic (0010): ON CONFLICT (goal_id) DO UPDATE with
      // xp = greatest(stored, written) — a stale lower recompute never regresses.
      const existing = state.pets.find((p) => p.goal_id === write.goalId);
      if (existing) {
        if (write.xp >= existing.xp) {
          existing.xp = write.xp;
          existing.stage = write.stage;
        }
        existing.owner_id = write.ownerId;
        existing.updated_at = now().toISOString();
        return existing;
      }
      const row: Pet = {
        id: nextId("pet"),
        owner_id: write.ownerId,
        goal_id: write.goalId,
        species: "default",
        branch: "unset",
        stage: write.stage,
        xp: write.xp,
        mood: 0.7,
        sprite_set: "default",
        updated_at: now().toISOString(),
      };
      state.pets.push(row);
      return row;
    },

    async setCompletionMinted(completionId: string, collectibleId: string) {
      const completion = state.completions.find((c) => c.id === completionId);
      if (completion) completion.minted_collectible_id = collectibleId;
    },

    async insertCollectible(write: CollectibleWrite) {
      // Enforce the 0010 partial unique indexes: a unique violation means
      // "already minted" — return the existing row, created = false.
      const existing = state.collectibles.find((c) => {
        if (c.kind !== write.kind) return false;
        if (write.kind === "milestone_badge") {
          return write.milestoneId !== null && c.milestone_id === write.milestoneId;
        }
        if (write.kind === "goal_trophy") {
          return write.goalId !== null && c.goal_id === write.goalId;
        }
        return false;
      });
      if (existing) return { collectible: existing, created: false };
      const row: Collectible = {
        id: nextId("coll"),
        owner_id: write.ownerId,
        goal_id: write.goalId,
        milestone_id: write.milestoneId,
        kind: write.kind,
        rarity: write.rarity,
        metadata: write.metadata,
        image_url: null,
        minted_at: now().toISOString(),
      };
      state.collectibles.push(row);
      return { collectible: row, created: true };
    },

    async setGoalAchieved(goalId: string) {
      // CAS: only the call that performs the transition wins.
      const goal = state.goals.get(goalId);
      if (!goal || goal.status === "achieved") return false;
      state.goals.set(goalId, { ...goal, status: "achieved" });
      return true;
    },

    async insertNotification(write: NotificationWrite) {
      // Enforce the partial UNIQUE index on dedup_key (0008): a unique violation
      // means "already delivered" — return the existing row, created = false.
      if (write.dedupKey !== null) {
        const existing = state.notifications.find((n) => n.dedup_key === write.dedupKey);
        if (existing) return { notification: existing, created: false };
      }
      const row: Notification = {
        id: nextId("notif"),
        owner_id: write.ownerId,
        trigger: write.trigger,
        channels: write.channels,
        dedup_key: write.dedupKey,
        ref_goal_id: write.refGoalId,
        ref_milestone_id: write.refMilestoneId,
        persona_msg: write.personaMsg,
        status: write.status,
        scheduled_for: now().toISOString(),
        created_at: now().toISOString(),
      };
      state.notifications.push(row);
      return { notification: row, created: true };
    },

    async notificationDedupExists(dedupKey: string) {
      return state.notifications.some((n) => n.dedup_key === dedupKey);
    },

    async countNudgesToday(ownerId: string, nowDate: Date) {
      return state.notifications.filter(
        (n) =>
          n.owner_id === ownerId &&
          NUDGE_TRIGGERS.has(n.trigger) &&
          (n.status === "sent" || n.status === "delivered") &&
          n.created_at !== undefined &&
          sameUtcDay(n.created_at, nowDate),
      ).length;
    },
  };
}
