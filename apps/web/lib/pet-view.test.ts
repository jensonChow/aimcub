import { describe, expect, it } from "vitest";
import { petStageProgress } from "./pet-view";

describe("petStageProgress", () => {
  it("egg: progresses toward the 100 XP hatch threshold", () => {
    expect(petStageProgress(0)).toMatchObject({
      stage: "egg",
      label: "Egg",
      percent: 0,
      nextStageXp: 100,
      nextStageLabel: "Baby",
    });
    expect(petStageProgress(50).percent).toBe(50);
  });

  it("baby: progresses from 100 toward the 300 XP adult threshold", () => {
    const v = petStageProgress(100);
    expect(v.stage).toBe("baby");
    expect(v.percent).toBe(0);
    expect(v.nextStageXp).toBe(300);
    expect(v.nextStageLabel).toBe("Adult");
    expect(petStageProgress(200).percent).toBe(50);
  });

  it("adult: full bar with no next stage", () => {
    const v = petStageProgress(300);
    expect(v).toMatchObject({
      stage: "adult",
      label: "Adult",
      fraction: 1,
      percent: 100,
      nextStageXp: null,
      nextStageLabel: null,
    });
    expect(petStageProgress(9999).percent).toBe(100);
  });

  it("clamps negative xp to the empty egg", () => {
    const v = petStageProgress(-5);
    expect(v.stage).toBe("egg");
    expect(v.percent).toBe(0);
  });
});
