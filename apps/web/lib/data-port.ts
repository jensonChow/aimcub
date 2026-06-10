/**
 * DataPort — the read/write slice of the data layer the web app depends on.
 *
 * It is intentionally a SUBSET of @core/api-client's AimcubRepo: the web app only needs
 * the user-path reads plus goal creation. Keeping it as a narrow injected port means the
 * real supabase-js AimcubRepo drops in later without touching any component.
 *
 * TODO(v1a-live): provide a SupabaseDataPort implementing this against @core/api-client's
 * AimcubRepo (user identity + RLS). The UI never changes.
 */
import type { CreateGoalInput } from "@core/api-client";
import type { Goal, Milestone } from "@core/types";

export interface DataPort {
  listGoals(ownerId: string): Promise<Goal[]>;
  getGoal(id: string): Promise<Goal | null>;
  listMilestones(goalId: string): Promise<Milestone[]>;
  /** Create a goal AND its decomposition (milestones) in one call; returns both. */
  createGoal(input: CreateGoalInput): Promise<{ goal: Goal; milestones: Milestone[] }>;
}
