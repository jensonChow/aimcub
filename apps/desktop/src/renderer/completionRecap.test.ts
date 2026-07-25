import { describe, expect, it } from "vitest";
import type { AimProgressReadModel } from "@aimcub/core";

import { hasCompletionRecap } from "./completionRecap";

describe("completion recap", () => {
  it("detects a complete recap (the Journey then leads with it)", () => {
    const progress = {
      completion_recap: { complete: true },
    } as AimProgressReadModel;

    expect(hasCompletionRecap(progress)).toBe(true);
  });

  it("stays false for incomplete or unknown aims", () => {
    expect(hasCompletionRecap({ completion_recap: null } as AimProgressReadModel)).toBe(false);
    expect(hasCompletionRecap(null)).toBe(false);
  });
});
