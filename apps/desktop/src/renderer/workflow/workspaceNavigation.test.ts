import { describe, expect, it } from "vitest";

import {
  createDraftActivationTracker,
  deriveWorkspaceTarget,
} from "./workspaceNavigation";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("workspace navigation", () => {
  it("keeps the active content target mutually exclusive", () => {
    expect(deriveWorkspaceTarget({
      selectedGoalId: null,
      activeDraftId: "draft-1",
      showAimComposer: true,
    })).toEqual({ kind: "draft", id: "draft-1" });

    expect(deriveWorkspaceTarget({
      selectedGoalId: null,
      activeDraftId: null,
      showAimComposer: true,
    })).toEqual({ kind: "newAim" });

    expect(deriveWorkspaceTarget({
      selectedGoalId: null,
      activeDraftId: null,
      showAimComposer: false,
    })).toEqual({ kind: "home" });

    expect(deriveWorkspaceTarget({
      selectedGoalId: "goal-1",
      activeDraftId: null,
      showAimComposer: false,
    })).toEqual({ kind: "goal", id: "goal-1" });
  });

  it("invalidates a deferred draft activation when that draft is discarded", async () => {
    const tracker = createDraftActivationTracker();
    const activation = tracker.capture("draft-b");
    const draftRead = deferred<{ id: string }>();
    const applied = draftRead.promise.then((draft) => tracker.isCurrent(activation) ? draft : null);

    tracker.invalidate("draft-b");
    draftRead.resolve({ id: "draft-b" });

    await expect(applied).resolves.toBeNull();
    expect(tracker.isCurrent(tracker.capture("draft-a"))).toBe(true);
  });
});
