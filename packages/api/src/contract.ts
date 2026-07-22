/**
 * @aimcub/api-client — data-access contract (implementation-agnostic).
 * No client may build its own queries — all access goes through this contract, ensuring consistent query shapes and error handling.
 * v0: defines the AimcubRepo interface (using domain types); the concrete supabase-js implementation lands in v1a.
 */
import type {
  Evidence,
  Goal,
  GoalDomain,
  Milestone,
} from "@aimcub/types";

export interface CreateGoalInput {
  ownerId: string;
  title: string;
  description?: string;
  domain?: GoalDomain;
  targetDate?: string | null;
}

/** Normalized evidence written by the ingestion entry point (shape before the implementation fills in id/owner). */
export interface IngestEvidenceInput {
  ownerId: string;
  goalId: string;
  milestoneId?: string | null;
  emitterId?: string | null;
  kind: Evidence["kind"];
  sourceEventId: string | null;
  occurredAt: string;
  summary?: string;
  payload?: Record<string, unknown>;
  trustScore?: number;
}

/**
 * Data-access contract shared across all clients. The read path (user identity + RLS) is separated from the machine write path (service_role):
 * creating goals = user path; inserting milestones / ingesting evidence = server path.
 */
export interface AimcubRepo {
  // User path (reads/writes under RLS)
  createGoal(input: CreateGoalInput): Promise<Goal>;
  getGoal(id: string): Promise<Goal | null>;
  listGoals(ownerId: string): Promise<Goal[]>;
  listMilestones(goalId: string): Promise<Milestone[]>;
  /** Persist the decomposition snapshot on the goal and (by default) activate it. RLS-scoped to the caller. */
  updateGoalPlan(
    goalId: string,
    planJson: unknown,
    status?: Goal["status"],
    metadata?: Record<string, unknown>,
  ): Promise<Goal>;

  // Server path (service_role)
  insertMilestones(milestones: Milestone[]): Promise<Milestone[]>;
  ingestEvidence(input: IngestEvidenceInput): Promise<Evidence>;
}

export interface SupabaseClientConfig {
  url: string;
  /** anon key (client side) or service_role key (server side only). */
  key: string;
}
