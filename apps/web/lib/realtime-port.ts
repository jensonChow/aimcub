/**
 * RealtimePort — the "milestones light up by themselves" channel.
 *
 * In production this is a Supabase Realtime subscription: when the Edge Function judges
 * incoming evidence and writes a `milestone_completions` row (flipping a milestone to
 * `completed`), Realtime pushes the change to every connected client. The UI just listens.
 *
 * Here we model the same contract with a MockRealtime driver that flips the next eligible
 * milestone to `completed` on a timer — so the aha moment is demoable with zero backend.
 *
 * TODO(v1a-live): provide a SupabaseRealtime implementing this against a channel on
 * `milestones` (or `milestone_completions`) filtered by goal_id, using process.env
 * NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.
 */
import type { Milestone } from "@core/types";

/** A single auto-completion event: a milestone flipped to `completed` server-side. */
export interface MilestoneCompletedEvent {
  goalId: string;
  milestoneId: string;
  completedAt: string;
  awardedXp: number;
}

export type MilestoneCompletedHandler = (event: MilestoneCompletedEvent) => void;

export interface RealtimeSubscription {
  unsubscribe(): void;
}

export interface RealtimePort {
  /**
   * Subscribe to auto-completion events for a goal. The provided milestones are the
   * current client-side snapshot, used by the mock to decide what to flip next.
   */
  subscribeMilestones(
    goalId: string,
    snapshot: readonly Milestone[],
    onCompleted: MilestoneCompletedHandler,
  ): RealtimeSubscription;
}
