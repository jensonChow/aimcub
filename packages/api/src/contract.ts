/**
 * @core/api-client — data-access contract (implementation-agnostic).
 * No client may build its own queries — all access goes through this contract, ensuring consistent query shapes and error handling.
 * v0: defines the AimcubRepo interface (using domain types); the concrete supabase-js implementation lands in v1a.
 */
import type {
  Collectible,
  Evidence,
  Goal,
  GoalDomain,
  Milestone,
  Notification,
  Pet,
} from "@core/types";

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
 * creating goals = user path; inserting milestones / ingesting evidence / growing pets = server path.
 */
export interface AimcubRepo {
  // User path (reads/writes under RLS)
  createGoal(input: CreateGoalInput): Promise<Goal>;
  getGoal(id: string): Promise<Goal | null>;
  listGoals(ownerId: string): Promise<Goal[]>;
  listMilestones(goalId: string): Promise<Milestone[]>;
  getPet(goalId: string): Promise<Pet | null>;
  listCollectibles(ownerId: string): Promise<Collectible[]>;
  /** agent_inbox channel: proactive messages from the pet to the user (Claude Code pulls these via the MCP get_inbox call). */
  listInbox(ownerId: string, since?: string): Promise<Notification[]>;

  // Server path (service_role)
  insertMilestones(milestones: Milestone[]): Promise<Milestone[]>;
  ingestEvidence(input: IngestEvidenceInput): Promise<Evidence>;
}

export interface SupabaseClientConfig {
  url: string;
  /** anon key (client side) or service_role key (server side only). */
  key: string;
}
