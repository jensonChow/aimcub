"use client";

import { colors, radius, space } from "@ui/tokens";
import type { Goal, Milestone, Pet, PetStage, Rarity } from "@core/types";
import { useEffect, useMemo, useRef, useState } from "react";
import { MockRealtime } from "../lib/mock-realtime";
import { computeProgress, isGoalComplete } from "../lib/progress";
import type { RealtimePort } from "../lib/realtime-port";
import { SupabaseRealtime } from "../lib/supabase-realtime";
import { MilestoneCard } from "./MilestoneCard";
import { PetCard } from "./PetCard";
import { ProgressBar } from "./ProgressBar";
import { rarityColor } from "./styles";

/** NEXT_PUBLIC_* env is inlined into the client bundle, so this is decidable in the browser. */
function defaultRealtime(): RealtimePort {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return new SupabaseRealtime();
  }
  return new MockRealtime();
}

/** A badge minted during this session — shown immediately; the gallery on the home page has the canonical row. */
interface FreshBadge {
  id: string;
  title: string;
  rarity: Rarity;
}

/**
 * Client view of a goal: renders the decomposition and subscribes to the RealtimePort so
 * milestones light up on their own — no user action — the moment an (evidence-derived)
 * completion event arrives. The pet rides the same stream: grow_pet upserts the pets row
 * and the PetCard grows (with a celebration glow on stage-up). Live mode subscribes to
 * Supabase Realtime; mock mode drives the cascade locally.
 */
export function GoalDetail({
  goal,
  initialMilestones,
  initialPet = null,
  realtime,
}: {
  goal: Goal;
  initialMilestones: Milestone[];
  /** Null until the first completion — pets are derived state; render the 0-XP egg then. */
  initialPet?: Pet | null;
  /** Injectable for testing; defaults to SupabaseRealtime (live) or MockRealtime. */
  realtime?: RealtimePort;
}) {
  const [milestones, setMilestones] = useState<Milestone[]>(initialMilestones);
  const [recentlyLit, setRecentlyLit] = useState<string | null>(null);
  const [pet, setPet] = useState<{ xp: number; stage: PetStage }>({
    xp: initialPet?.xp ?? 0,
    stage: initialPet?.stage ?? "egg",
  });
  const [stagedUp, setStagedUp] = useState(false);
  const [freshBadges, setFreshBadges] = useState<FreshBadge[]>([]);
  const port = useMemo<RealtimePort>(() => realtime ?? defaultRealtime(), [realtime]);
  // Subscribe once against the initial snapshot; the mock drives the cascade itself.
  const snapshotRef = useRef(initialMilestones);
  // Last seen pet, kept in a ref so the realtime handler can detect stage-ups without stale closures.
  const petRef = useRef(pet);

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
      // Every completion mints a badge server-side; surface it immediately from the snapshot.
      const minted = snapshotRef.current.find((m) => m.id === event.milestoneId);
      if (minted) {
        setFreshBadges((prev) =>
          prev.some((b) => b.id === minted.id)
            ? prev
            : [...prev, { id: minted.id, title: minted.title, rarity: minted.rarity }],
        );
      }
    });
    return () => sub.unsubscribe();
  }, [goal.id, port]);

  useEffect(() => {
    const sub = port.subscribePet(goal.id, (event) => {
      const prev = petRef.current;
      const next = { xp: event.xp, stage: event.stage };
      petRef.current = next;
      setPet(next);
      if (next.stage !== prev.stage) setStagedUp(true);
    });
    return () => sub.unsubscribe();
  }, [goal.id, port]);

  const progress = computeProgress(milestones);
  const complete = isGoalComplete(milestones);

  return (
    <section>
      <div
        style={{
          display: "flex",
          gap: space.lg,
          alignItems: "flex-start",
          flexWrap: "wrap",
          marginBottom: space.lg,
        }}
      >
        <PetCard xp={pet.xp} justStagedUp={stagedUp} />

        <div style={{ flex: "1 1 280px" }}>
          <ProgressBar progress={progress} />

          {freshBadges.length > 0 ? (
            <div style={{ marginTop: space.md }}>
              <p style={{ margin: `0 0 ${space.xs}px`, color: colors.textMuted, fontSize: 12 }}>
                Badges minted this session
              </p>
              <div style={{ display: "flex", gap: space.sm, flexWrap: "wrap" }}>
                {freshBadges.map((b) => (
                  <span
                    key={b.id}
                    style={{
                      fontSize: 12,
                      padding: "2px 8px",
                      borderRadius: radius.pill,
                      color: rarityColor(b.rarity),
                      border: `1px solid ${rarityColor(b.rarity)}`,
                    }}
                  >
                    {b.title}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
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
    </section>
  );
}
