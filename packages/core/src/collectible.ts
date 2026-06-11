/**
 * Collectible minting plan (pure). Collectibles are DERIVED state: a badge is a
 * snapshot of a milestone completion, recomputable and idempotent. Rarity is
 * deterministic — the milestone's own rarity is the floor — with one seeded
 * "shiny" upgrade: ~10% of mints jump exactly one tier and carry
 * `metadata.shiny = true`.
 *
 * Determinism contract: the roll is seeded by the completion's id
 * (sha256(completion.id) → first 8 bytes → uniform [0,1)), so job retries can
 * NEVER re-roll — the same completion always produces the same plan. The hash
 * function is injected (`opts.hashHex`) so this module stays dependency-free
 * (no node:crypto / WebCrypto in @core).
 */
import { type Rarity } from "@core/types";

/** Rarity tiers, lowest → highest. The upgrade moves exactly one step right. */
export const RARITY_ORDER: readonly Rarity[] = [
  "common",
  "uncommon",
  "rare",
  "epic",
  "legendary",
];

/** Probability that a mint upgrades one rarity tier (the "shiny" roll). */
export const SHINY_UPGRADE_PROBABILITY = 0.1;

/** One tier up, capped at legendary (legendary stays legendary, shiny still applies). */
export function upgradeRarity(rarity: Rarity): Rarity {
  const i = RARITY_ORDER.indexOf(rarity);
  return RARITY_ORDER[Math.min(i + 1, RARITY_ORDER.length - 1)] ?? rarity;
}

const HEX16 = /^[0-9a-f]{16}$/i;

/**
 * First 8 bytes (16 hex chars) of a hex digest → uniform number in [0,1).
 * Malformed input (too short / non-hex) maps to 1 — i.e. "never shiny" — so a
 * broken hash can only withhold upgrades, never grant them.
 * (Float note: the all-ones digest rounds to exactly 1.0, which the strict `<`
 * threshold treats as "no upgrade" — harmless at this tail.)
 */
export function rollFromHashHex(hashHex: string): number {
  const head = hashHex.slice(0, 16);
  if (!HEX16.test(head)) return 1;
  return Number.parseInt(head, 16) / 0x10000000000000000; // 2^64
}

/** The completion fields the plan needs (a structural subset of MilestoneCompletion). */
export interface MintCompletion {
  id: string;
  awarded_xp: number;
  created_at?: string | null;
}

/** The milestone fields the plan needs (a structural subset of Milestone). */
export interface MintMilestone {
  title: string;
  rarity: Rarity;
}

export interface MintOptions {
  /** Snapshot of the goal title at mint time (goals are mutable; metadata is not). */
  goalTitle: string;
  /**
   * Injected hex-digest hash (sha256 in production). Injected so @core stays
   * dependency-free; the seed input is exactly `completion.id`.
   */
  hashHex?: (input: string) => string;
  /** Precomputed roll in [0,1) — takes precedence over `hashHex` (mainly for tests). */
  roll?: number;
}

export interface MintPlan {
  kind: "milestone_badge";
  rarity: Rarity;
  shiny: boolean;
  /** Real snapshot persisted into `collectibles.metadata` (jsonb). */
  metadata: {
    goal_title: string;
    milestone_title: string;
    completed_at: string;
    awarded_xp: number;
    shiny: boolean;
    base_rarity: Rarity;
  };
}

/**
 * Plan a milestone-badge mint. Pure and total: same inputs → same plan.
 * Without `roll`/`hashHex` the roll defaults to 1 (never shiny) — deterministic
 * and safe, never random.
 */
export function planMint(
  completion: MintCompletion,
  milestone: MintMilestone,
  opts: MintOptions,
): MintPlan {
  const roll =
    opts.roll ?? (opts.hashHex ? rollFromHashHex(opts.hashHex(completion.id)) : 1);
  const shiny = roll < SHINY_UPGRADE_PROBABILITY;
  const rarity = shiny ? upgradeRarity(milestone.rarity) : milestone.rarity;
  return {
    kind: "milestone_badge",
    rarity,
    shiny,
    metadata: {
      goal_title: opts.goalTitle,
      milestone_title: milestone.title,
      completed_at: completion.created_at ?? "",
      awarded_xp: completion.awarded_xp,
      shiny,
      base_rarity: milestone.rarity,
    },
  };
}
