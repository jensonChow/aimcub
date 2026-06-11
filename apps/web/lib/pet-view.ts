/**
 * Pure presentation helpers for the pet card. View-model utilities only — the growth
 * rules (thresholds, stage derivation) live in @core/domain; this just shapes them
 * for display so the React component stays dumb.
 */
import { STAGE_THRESHOLDS, stageForXp } from "@core/domain";
import type { PetStage } from "@core/types";

export interface PetStageProgress {
  /** Stage derived from xp (the pets row stores the same derivation). */
  stage: PetStage;
  /** Display label, e.g. "Baby". */
  label: string;
  /** 0..1 fill toward the next stage threshold (1 at the final stage). */
  fraction: number;
  /** Rounded percentage 0..100 for display. */
  percent: number;
  /** XP needed to reach the next stage, or null at the final stage. */
  nextStageXp: number | null;
  /** Label of the next stage, or null at the final stage. */
  nextStageLabel: string | null;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Progress toward the next stage threshold: egg -> 100, baby -> 300, adult -> full bar. */
export function petStageProgress(xp: number): PetStageProgress {
  const safeXp = Math.max(0, xp);
  const stage = stageForXp(safeXp);
  const index = STAGE_THRESHOLDS.findIndex((t) => t.stage === stage);
  const floor = STAGE_THRESHOLDS[index]?.minXp ?? 0;
  const next = STAGE_THRESHOLDS[index + 1] ?? null;

  const fraction = next ? Math.min(1, (safeXp - floor) / (next.minXp - floor)) : 1;
  return {
    stage,
    label: capitalize(stage),
    fraction,
    percent: Math.round(fraction * 100),
    nextStageXp: next?.minXp ?? null,
    nextStageLabel: next ? capitalize(next.stage) : null,
  };
}
