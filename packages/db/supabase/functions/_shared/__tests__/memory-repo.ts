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
 */
import type {
  Evidence,
  Job,
  Milestone,
  MilestoneCompletion,
} from "@core/types";
import type {
  CompletionWrite,
  EvidenceWrite,
  IngestRepo,
  JobEnqueue,
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
  /** milestoneId -> evidence the worker should consider. */
  evidenceByMilestone: Map<string, Evidence[]>;
}

export interface MemoryRepo extends IngestRepo, WorkerRepo {
  state: MemoryRepoState;
  seedMilestone(m: Milestone): void;
  /** Attach evidence to a milestone for the worker's `listEvidenceForMilestone`. */
  seedEvidenceForMilestone(milestoneId: string, evidence: Evidence[]): void;
}

export function createMemoryRepo(now: () => Date = () => new Date()): MemoryRepo {
  const state: MemoryRepoState = {
    evidence: [],
    jobs: [],
    completions: [],
    milestones: new Map(),
    evidenceByMilestone: new Map(),
  };

  return {
    state,

    seedMilestone(m: Milestone) {
      state.milestones.set(m.id, m);
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
      return { completion: row, created: true };
    },
  };
}
