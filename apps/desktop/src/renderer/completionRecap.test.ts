import { describe, expect, it } from "vitest";
import type { AimProgressReadModel } from "@aimcub/core";

import { hasCompletionRecap, stageForOpenedAim } from "./completionRecap";

describe("completion recap routing", () => {
  it("opens completed aims on the eval stage where the recap is shown", () => {
    const progress = {
      completion_recap: { complete: true },
    } as AimProgressReadModel;

    expect(hasCompletionRecap(progress)).toBe(true);
    expect(stageForOpenedAim(progress)).toBe("eval");
  });

  it("keeps incomplete or unknown aims on the overview stage", () => {
    const progress = {
      completion_recap: null,
    } as AimProgressReadModel;

    expect(hasCompletionRecap(progress)).toBe(false);
    expect(stageForOpenedAim(progress)).toBe("aim");
    expect(stageForOpenedAim(null)).toBe("aim");
  });
});
