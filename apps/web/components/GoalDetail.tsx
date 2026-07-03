"use client";

import { colors, space } from "@ui/tokens";
import type { Goal, Milestone } from "@core/types";
import { useEffect, useMemo, useRef, useState } from "react";
import { goalDebugTraceFromMetadata } from "../lib/debug-trace";
import { MockRealtime } from "../lib/mock-realtime";
import { computeProgress, isGoalComplete } from "../lib/progress";
import type { RealtimePort } from "../lib/realtime-port";
import { SupabaseRealtime } from "../lib/supabase-realtime";
import { GoalDebugPanel } from "./GoalDebugPanel";
import { MilestoneCard } from "./MilestoneCard";
import { ProgressBar } from "./ProgressBar";

/** NEXT_PUBLIC_* env is inlined into the client bundle, so this is decidable in the browser. */
function defaultRealtime(): RealtimePort {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return new SupabaseRealtime();
  }
  return new MockRealtime();
}

/**
 * Client view of a goal: renders the decomposition and subscribes to the RealtimePort so
 * milestones light up on their own — no user action — the moment an (evidence-derived)
 * completion event arrives. Live mode subscribes to Supabase Realtime; mock mode drives
 * the cascade locally.
 */
export function GoalDetail({
  goal,
  initialMilestones,
  realtime,
}: {
  goal: Goal;
  initialMilestones: Milestone[];
  /** Injectable for testing; defaults to SupabaseRealtime (live) or MockRealtime. */
  realtime?: RealtimePort;
}) {
  const [milestones, setMilestones] = useState<Milestone[]>(initialMilestones);
  const [recentlyLit, setRecentlyLit] = useState<string | null>(null);
  const port = useMemo<RealtimePort>(() => realtime ?? defaultRealtime(), [realtime]);
  // Subscribe once against the initial snapshot; the mock drives the cascade itself.
  const snapshotRef = useRef(initialMilestones);

  useEffect(() => {
    const sub = port.subscribeMilestones(goal.id, snapshotRef.current, (event) => {
      setMilestones((prev) =>
        prev.map((m) =>
          m.id === event.milestoneId
            ? { ...m, status: "completed", completed_at: event.completedAt }
            : m,
        ),
      );
      setRecentlyLit(event.milestoneId);
    });
    return () => sub.unsubscribe();
  }, [goal.id, port]);

  const progress = computeProgress(milestones);
  const complete = isGoalComplete(milestones);
  const debugTrace = goalDebugTraceFromMetadata(goal.metadata);

  return (
    <section>
      <div style={{ marginBottom: space.lg }}>
        <ProgressBar progress={progress} />
      </div>

      {complete ? (
        <p style={{ color: colors.success, fontWeight: 700, marginBottom: space.md }}>
          Goal achieved — every milestone lit up.
        </p>
      ) : (
        <p style={{ color: colors.textMuted, fontSize: 13, marginBottom: space.md }}>
          Keep working. As real evidence (commits / CI) arrives, milestones complete
          themselves — watch this list update on its own.
        </p>
      )}

      <ul style={{ display: "flex", flexDirection: "column", gap: space.sm, margin: 0, padding: 0 }}>
        {milestones.map((m, i) => (
          <MilestoneCard key={m.id} milestone={m} index={i} justCompleted={m.id === recentlyLit} />
        ))}
      </ul>

      <GoalDebugPanel trace={debugTrace} />
    </section>
  );
}
