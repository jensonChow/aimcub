import { describe, expect, it } from "vitest";

import {
  availableWorkbenchStages,
  createDraftActivationTracker,
  deriveWorkspaceTarget,
  hasWorkbenchNavigation,
  isWorkbenchStageAvailable,
  settingsReturnStage,
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

  it("scopes workbench surfaces to the active content type", () => {
    expect(availableWorkbenchStages({ kind: "draft", id: "draft-1" })).toEqual(["aim", "context", "contracts"]);
    expect(availableWorkbenchStages({ kind: "goal", id: "goal-1" })).toEqual(["aim", "context", "contracts", "run", "eval"]);
    expect(availableWorkbenchStages({ kind: "home" })).toEqual(["aim"]);
    expect(availableWorkbenchStages({ kind: "newAim" })).toEqual(["aim"]);

    expect(hasWorkbenchNavigation({ kind: "draft", id: "draft-1" })).toBe(true);
    expect(isWorkbenchStageAvailable({ kind: "draft", id: "draft-1" }, "run")).toBe(false);
    expect(isWorkbenchStageAvailable({ kind: "goal", id: "goal-1" }, "run")).toBe(true);
  });

  it("returns from Settings to the originating surface without expanding draft stages", () => {
    const draftTarget = { kind: "draft", id: "draft-1" } as const;
    const captured = settingsReturnStage(draftTarget, "context", "aim");

    expect(captured).toBe("context");
    expect(settingsReturnStage(draftTarget, "settings", captured)).toBe("context");
    expect(settingsReturnStage(draftTarget, "run", captured)).toBe("context");
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
