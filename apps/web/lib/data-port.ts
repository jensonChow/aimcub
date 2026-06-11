/**
 * DataPort — the read/write slice of the data layer the web app depends on.
 *
 * It is intentionally a SUBSET of @core/api-client's AimcubRepo: the web app only needs
 * the user-path reads plus goal creation. Keeping it as a narrow injected port means the
 * real supabase-js AimcubRepo drops in later without touching any component.
 */
import type { CreateGoalInput } from "@core/api-client";
import type { Collectible, Goal, Milestone, Notification, Pet } from "@core/types";

export interface DataPort {
  listGoals(ownerId: string): Promise<Goal[]>;
  getGoal(id: string): Promise<Goal | null>;
  listMilestones(goalId: string): Promise<Milestone[]>;
  /** Create a goal AND its decomposition (milestones) in one call; returns both. */
  createGoal(input: CreateGoalInput): Promise<{ goal: Goal; milestones: Milestone[] }>;
  /** One pet per goal; null until the first completion materializes it (derived state). */
  getPet(goalId: string): Promise<Pet | null>;
  /** The user's minted badges/trophies, newest first. */
  listCollectibles(ownerId: string): Promise<Collectible[]>;
  /** Recent in_app notifications (pet voice), newest first. */
  listNotifications(ownerId: string, limit?: number): Promise<Notification[]>;
}
