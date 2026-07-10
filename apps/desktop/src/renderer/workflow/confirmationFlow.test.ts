import { describe, expect, it, vi } from "vitest";

import { confirmMilestoneAndRefresh } from "./confirmationFlow";

describe("confirmMilestoneAndRefresh", () => {
  it("does not refresh when the confirmation mutation fails", async () => {
    const mutationError = new Error("confirmation failed");
    const refresh = vi.fn(async () => ({ complete: false }));

    await expect(confirmMilestoneAndRefresh(
      async () => { throw mutationError; },
      refresh,
    )).resolves.toEqual({ status: "confirmation_failed", error: mutationError });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("returns the confirmed detail and refreshed progress", async () => {
    await expect(confirmMilestoneAndRefresh(
      async () => ({ evidenceCount: 1 }),
      async () => ({ complete: false }),
    )).resolves.toEqual({
      status: "confirmed",
      detail: { evidenceCount: 1 },
      progress: { complete: false },
    });
  });

  it("keeps the confirmation successful when only the refresh fails", async () => {
    const refreshError = new Error("refresh failed");

    await expect(confirmMilestoneAndRefresh(
      async () => ({ evidenceCount: 1 }),
      async () => { throw refreshError; },
    )).resolves.toEqual({
      status: "refresh_failed",
      detail: { evidenceCount: 1 },
      error: refreshError,
    });
  });
});
