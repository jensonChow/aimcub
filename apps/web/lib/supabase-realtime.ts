"use client";

/**
 * SupabaseRealtime — the live RealtimePort: subscribes to UPDATEs on `milestones`
 * for one goal and emits a MilestoneCompletedEvent whenever a row flips to
 * `completed` (written server-side by the jobs-worker after judging evidence).
 *
 * Uses the browser client (anon key + the user's session from cookies), so
 * postgres_changes is RLS-filtered to the signed-in user's rows.
 */
import { createBrowserClient } from "@supabase/ssr";
import type { Milestone, Pet } from "@core/types";
import type {
  MilestoneCompletedHandler,
  PetChangeHandler,
  RealtimePort,
  RealtimeSubscription,
} from "./realtime-port";

export class SupabaseRealtime implements RealtimePort {
  subscribeMilestones(
    goalId: string,
    _snapshot: readonly Milestone[],
    onCompleted: MilestoneCompletedHandler,
  ): RealtimeSubscription {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) return { unsubscribe() {} };

    const supabase = createBrowserClient(url, anonKey);
    const channel = supabase
      .channel(`milestones:${goalId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "milestones", filter: `goal_id=eq.${goalId}` },
        (payload) => {
          const next = payload.new as Partial<Milestone>;
          if (next.status === "completed" && typeof next.id === "string") {
            onCompleted({
              goalId,
              milestoneId: next.id,
              completedAt: next.completed_at ?? new Date().toISOString(),
              awardedXp: typeof next.xp_reward === "number" ? next.xp_reward : 0,
            });
          }
        },
      )
      .subscribe();

    return {
      unsubscribe() {
        void supabase.removeChannel(channel);
      },
    };
  }

  subscribePet(goalId: string, onChange: PetChangeHandler): RealtimeSubscription {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) return { unsubscribe() {} };

    const supabase = createBrowserClient(url, anonKey);
    // The grow_pet job INSERTs the row on the first completion and UPDATEs it afterwards.
    const emit = (payload: { new: Record<string, unknown> }): void => {
      const next = payload.new as Partial<Pet>;
      if (typeof next.xp === "number" && typeof next.stage === "string") {
        onChange({ goalId, xp: next.xp, stage: next.stage });
      }
    };
    const channel = supabase
      .channel(`pets:${goalId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "pets", filter: `goal_id=eq.${goalId}` },
        emit,
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "pets", filter: `goal_id=eq.${goalId}` },
        emit,
      )
      .subscribe();

    return {
      unsubscribe() {
        void supabase.removeChannel(channel);
      },
    };
  }
}
