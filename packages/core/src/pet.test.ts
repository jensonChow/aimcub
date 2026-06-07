import { describe, expect, it } from "vitest";
import { applyXpGain, computeBranch, rarityForEffort, stageForXp } from "./pet";

describe("stageForXp", () => {
  it("maps xp to the three v1 stages", () => {
    expect(stageForXp(0)).toBe("egg");
    expect(stageForXp(99)).toBe("egg");
    expect(stageForXp(100)).toBe("baby");
    expect(stageForXp(299)).toBe("baby");
    expect(stageForXp(300)).toBe("adult");
    expect(stageForXp(99999)).toBe("adult");
  });
});

describe("applyXpGain", () => {
  it("reports a stage-up when crossing a threshold", () => {
    expect(applyXpGain(95, 10)).toEqual({ xp: 105, stage: "baby", stagedUp: true });
  });
  it("reports no stage-up within a stage", () => {
    expect(applyXpGain(105, 10)).toEqual({ xp: 115, stage: "baby", stagedUp: false });
  });
});

describe("computeBranch", () => {
  it("picks the dominant domain tag", () => {
    expect(computeBranch({ backend: 3, frontend: 1 })).toBe("dragon");
    expect(computeBranch({ frontend: 5 })).toBe("bird");
  });
  it("returns unset when no recognized tags", () => {
    expect(computeBranch({})).toBe("unset");
    expect(computeBranch({ misc: 9 })).toBe("unset");
  });
});

describe("rarityForEffort", () => {
  it("is deterministic by difficulty", () => {
    expect(rarityForEffort("xs")).toBe("common");
    expect(rarityForEffort("m")).toBe("uncommon");
    expect(rarityForEffort("l")).toBe("rare");
    expect(rarityForEffort("xl")).toBe("epic");
  });
});
