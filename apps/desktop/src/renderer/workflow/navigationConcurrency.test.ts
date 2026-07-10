import { describe, expect, it } from "vitest";

import {
  beginNavigation,
  beginPlanningActivity,
  canActivateGoal,
  canApplyDeferredSurfaceRoute,
  canApplyDeferredWorkspaceResponse,
  canStartWorkflowMutation,
  captureDeferredNavigation,
  createNavigationConcurrencyState,
  finishSaveInFlight,
  withSaveInFlight,
} from "./navigationConcurrency";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("navigation concurrency policy", () => {
  it("allows deferred data refresh but rejects its route after later surface navigation", async () => {
    let state = createNavigationConcurrencyState();
    const token = captureDeferredNavigation(state);
    const response = deferred<{ nextStage: string }>();

    const applied = response.promise.then(({ nextStage }) => ({
      data: canApplyDeferredWorkspaceResponse(token, state),
      route: canApplyDeferredSurfaceRoute(token, state) ? nextStage : null,
    }));

    state = beginNavigation(state, "surface");
    response.resolve({ nextStage: "eval" });

    await expect(applied).resolves.toEqual({ data: true, route: null });
  });

  it("invalidates planning and clears busy state when target navigation begins", () => {
    let state = createNavigationConcurrencyState();
    state = beginPlanningActivity(state, "planning-run-1", "Drafting plan");
    const planningToken = captureDeferredNavigation(state);

    state = beginNavigation(state, "target");

    expect(state).toMatchObject({
      workspace: 1,
      surface: 1,
      planningRunId: null,
      busy: null,
    });
    expect(canApplyDeferredWorkspaceResponse(planningToken, state)).toBe(false);
    expect(canApplyDeferredSurfaceRoute(planningToken, state)).toBe(false);
  });

  it("keeps a side-effect operation locked while browsing another surface", () => {
    const state = {
      ...createNavigationConcurrencyState(),
      busy: "Recording proof",
    };

    expect(beginNavigation(state, "surface")).toMatchObject({
      workspace: 0,
      surface: 1,
      planningRunId: null,
      busy: "Recording proof",
    });
  });

  it("lets save success activate its goal while external activation remains guarded", () => {
    let state = createNavigationConcurrencyState();
    state = withSaveInFlight(state, true);

    expect(canActivateGoal(state, "external_navigation")).toBe(false);
    expect(canActivateGoal(state, "save_success")).toBe(true);
  });

  it("releases save busy after the saved goal advances the target epoch", () => {
    let state = createNavigationConcurrencyState<string>();
    state = { ...state, busy: "Saving aim" };
    state = withSaveInFlight(state, true);
    state = beginNavigation(state, "target");
    state = { ...state, busy: "Switching aim" };

    expect(finishSaveInFlight(state)).toMatchObject({
      workspace: 1,
      busy: null,
      saveInFlight: false,
    });
  });

  it("blocks old-surface mutations until a pending target navigation commits", () => {
    expect(canStartWorkflowMutation({
      saveInFlight: false,
      discardInFlight: false,
      pendingTargetNavigation: true,
      sideEffectInFlight: false,
    })).toBe(false);
    expect(canStartWorkflowMutation({
      saveInFlight: false,
      discardInFlight: false,
      pendingTargetNavigation: false,
      sideEffectInFlight: false,
    })).toBe(true);
  });
});
