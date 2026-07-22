import { describe, expect, it } from "vitest";

import { assignBlindLabels, hashSeed, seededRandom } from "./blind.ts";

describe("blind labelling", () => {
  it("is reproducible for the same seed, aim, and repetition", () => {
    const first = assignBlindLabels("seed-1", "receipt-scanning", 1);
    const second = assignBlindLabels("seed-1", "receipt-scanning", 1);
    expect(first.labelMap).toEqual(second.labelMap);
  });

  it("keeps the label map and the condition map consistent", () => {
    for (const seed of ["a", "b", "c", "d"]) {
      const { labelMap, conditionMap } = assignBlindLabels(seed, "impact-report", 1);
      expect(labelMap[conditionMap.bare]).toBe("bare");
      expect(labelMap[conditionMap.contexted]).toBe("contexted");
      expect(labelMap.A).not.toBe(labelMap.B);
    }
  });

  it("puts each condition first sometimes — the order is not fixed", () => {
    const seeds = Array.from({ length: 40 }, (_, index) => `seed-${index}`);
    const firsts = new Set(seeds.map((seed) => assignBlindLabels(seed, "pottery-course", 1).labelMap.A));
    expect(firsts).toEqual(new Set(["bare", "contexted"]));
  });

  it("varies the order across repetitions of the same aim", () => {
    const orders = Array.from({ length: 20 }, (_, index) => assignBlindLabels("fixed", "pottery-course", index + 1).labelMap.A);
    expect(new Set(orders).size).toBe(2);
  });

  it("produces a stable, uniform-ish random stream", () => {
    const random = seededRandom(hashSeed("stable"));
    const draws = Array.from({ length: 500 }, () => random());
    expect(draws.every((value) => value >= 0 && value < 1)).toBe(true);
    const heads = draws.filter((value) => value < 0.5).length;
    expect(heads).toBeGreaterThan(200);
    expect(heads).toBeLessThan(300);

    const replay = seededRandom(hashSeed("stable"));
    expect(Array.from({ length: 5 }, () => replay())).toEqual(draws.slice(0, 5));
  });
});
