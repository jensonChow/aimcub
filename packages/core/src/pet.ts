/**
 * Pet growth (one per goal): pure numeric XP + derived stage. No event sourcing —
 * the pet table is a materialized cache; the true source of truth is
 * milestone_completions, so if it breaks we just recompute it.
 */
import { type EstEffort, type PetBranch, type PetStage, type Rarity } from "@core/types";

/** v1 three-stage thresholds (egg → baby → adult). Extend by adding more thresholds later. */
export const STAGE_THRESHOLDS: ReadonlyArray<{ stage: PetStage; minXp: number }> = [
  { stage: "egg", minXp: 0 },
  { stage: "baby", minXp: 100 },
  { stage: "adult", minXp: 300 },
];

export function stageForXp(xp: number): PetStage {
  let stage: PetStage = "egg";
  for (const t of STAGE_THRESHOLDS) {
    if (xp >= t.minXp) stage = t.stage;
  }
  return stage;
}

export interface PetGrowth {
  xp: number;
  stage: PetStage;
  /** Whether this gain crossed a stage boundary (used to trigger a celebration animation / proactive message). */
  stagedUp: boolean;
}

/** Apply a single XP gain; returns the new xp/stage and whether a stage transition occurred. */
export function applyXpGain(currentXp: number, deltaXp: number): PetGrowth {
  const before = stageForXp(currentXp);
  const xp = currentXp + deltaXp;
  const stage = stageForXp(xp);
  return { xp, stage, stagedUp: stage !== before };
}

/** Evolution branch: determined by the distribution of domain tags across the goal's completed milestones (mostly backend → dragon, mostly frontend → bird). */
const BRANCH_BY_TAG: Readonly<Record<string, PetBranch>> = {
  backend: "dragon",
  frontend: "bird",
  data: "turtle",
  devops: "fox",
};

export function computeBranch(tagCounts: Record<string, number>): PetBranch {
  let best: PetBranch = "unset";
  let bestN = 0;
  for (const [tag, n] of Object.entries(tagCounts)) {
    const branch = BRANCH_BY_TAG[tag];
    if (branch !== undefined && n > bestN) {
      best = branch;
      bestN = n;
    }
  }
  return best;
}

/** Deterministic rarity: derived directly from milestone difficulty (est_effort), never random (value comes from difficulty, not gacha rolls). */
export function rarityForEffort(effort: EstEffort): Rarity {
  switch (effort) {
    case "xs":
    case "s":
      return "common";
    case "m":
      return "uncommon";
    case "l":
      return "rare";
    case "xl":
      return "epic";
  }
}
