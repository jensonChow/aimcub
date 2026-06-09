/**
 * MockRealtime — simulates evidence-driven milestone auto-completion with zero backend.
 *
 * On subscribe it picks the next eligible (not completed/skipped) milestone in order and,
 * after a short delay, emits a MilestoneCompletedEvent — exactly the event a real Supabase
 * Realtime channel would deliver when the Edge Function writes a milestone_completions row.
 * This is what produces the "it lights up by itself" aha in the local demo.
 *
 * TODO(v1a-live): replace with a Supabase Realtime channel (see RealtimePort).
 */
import { nextEligibleMilestone } from "./progress";
import type {
  MilestoneCompletedHandler,
  RealtimePort,
  RealtimeSubscription,
} from "./realtime-port";
import type { Milestone } from "@core/types";

export interface MockRealtimeOptions {
  /** Delay before the first auto-completion fires. */
  firstDelayMs?: number;
  /** Whether to keep auto-completing subsequent milestones (one every intervalMs). */
  cascade?: boolean;
  intervalMs?: number;
}

export class MockRealtime implements RealtimePort {
  private readonly firstDelayMs: number;
  private readonly cascade: boolean;
  private readonly intervalMs: number;

  constructor(opts: MockRealtimeOptions = {}) {
    this.firstDelayMs = opts.firstDelayMs ?? 3500;
    this.cascade = opts.cascade ?? true;
    this.intervalMs = opts.intervalMs ?? 6000;
  }

  subscribeMilestones(
    goalId: string,
    snapshot: readonly Milestone[],
    onCompleted: MilestoneCompletedHandler,
  ): RealtimeSubscription {
    // Local working copy so the mock can advance through the chain.
    let working: Milestone[] = snapshot.map((m) => ({ ...m }));
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const flipOne = (): void => {
      if (cancelled) return;
      const next = nextEligibleMilestone(working);
      if (!next) return; // goal already complete
      working = working.map((m) =>
        m.id === next.id ? { ...m, status: "completed", completed_at: new Date().toISOString() } : m,
      );
      onCompleted({
        goalId,
        milestoneId: next.id,
        completedAt: new Date().toISOString(),
        awardedXp: next.xp_reward,
      });
      if (this.cascade && nextEligibleMilestone(working)) {
        timers.push(setTimeout(flipOne, this.intervalMs));
      }
    };

    timers.push(setTimeout(flipOne, this.firstDelayMs));

    return {
      unsubscribe: () => {
        cancelled = true;
        for (const t of timers) clearTimeout(t);
      },
    };
  }
}
