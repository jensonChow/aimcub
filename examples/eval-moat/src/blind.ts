/**
 * Blind labelling.
 *
 * The judge sees two plans called A and B and is never told which store produced them. Which
 * condition gets which letter is decided by a seeded RNG, so the assignment is random with respect
 * to the plans but reproducible for anyone re-running the same seed — and re-checkable by hand
 * against the label map persisted next to the raw judge output.
 */
import type { ConditionId } from "./types.ts";

/** FNV-1a over the seed key. Small, dependency-free, and stable across platforms. */
export function hashSeed(key: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** mulberry32 — a deterministic 32-bit PRNG. Same seed, same stream, forever. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type BlindLabel = "A" | "B";

export interface BlindAssignment {
  labelMap: Record<BlindLabel, ConditionId>;
  conditionMap: Record<ConditionId, BlindLabel>;
}

/** Decide which condition is shown as A for one aim and repetition. */
export function assignBlindLabels(seed: string, aimId: string, repetition: number): BlindAssignment {
  const random = seededRandom(hashSeed(`${seed}:${aimId}:${repetition}`));
  const bareIsA = random() < 0.5;
  const labelMap: Record<BlindLabel, ConditionId> = bareIsA
    ? { A: "bare", B: "contexted" }
    : { A: "contexted", B: "bare" };
  return {
    labelMap,
    conditionMap: bareIsA ? { bare: "A", contexted: "B" } : { bare: "B", contexted: "A" },
  };
}
