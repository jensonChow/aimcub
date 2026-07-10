import { describe, expect, it } from "vitest";

import {
  aimSurfaceAfterSubmit,
  deriveAimHelperProfile,
  hasPlanningRuntime,
  routeAfterAimSubmit,
  routeAfterRefresh,
} from "./firstRunFlow";

describe("first-run flow routing", () => {
  it("keeps first-run users in the aim stage instead of settings", () => {
    expect(routeAfterRefresh({ hasSelectedAim: false, hasActiveDraft: false, hasDrafts: false, hasGoals: false })).toEqual({
      autoOpenFirstGoal: false,
      stageOverride: "aim",
    });
  });

  it("opens the first saved aim instead of runtime settings when helpers are missing", () => {
    expect(routeAfterRefresh({ hasSelectedAim: false, hasActiveDraft: false, hasDrafts: false, hasGoals: true })).toEqual({
      autoOpenFirstGoal: true,
      stageOverride: "aim",
    });
  });

  it("keeps recoverable drafts visible instead of opening an arbitrary saved aim", () => {
    expect(routeAfterRefresh({ hasSelectedAim: false, hasActiveDraft: false, hasDrafts: true, hasGoals: true })).toEqual({
      autoOpenFirstGoal: false,
      stageOverride: "aim",
    });
    expect(routeAfterRefresh({ hasSelectedAim: false, hasActiveDraft: true, hasDrafts: true, hasGoals: true })).toEqual({
      autoOpenFirstGoal: false,
      stageOverride: null,
    });
  });

  it("shows helper guidance after aim submit when no provider or local agent is ready", () => {
    const action = routeAfterAimSubmit({ title: "Launch a local research app", provider: null, localAgents: [] });

    expect(action).toBe("show_helper_guidance");
    expect(aimSurfaceAfterSubmit({ action, current: "compose" })).toBe("summary");
  });

  it("keeps an explicit edit buffered when helper setup blocks regeneration", () => {
    expect(aimSurfaceAfterSubmit({ action: "show_helper_guidance", current: "edit" })).toBe("edit");
  });

  it("does not commit an empty aim", () => {
    expect(aimSurfaceAfterSubmit({ action: "missing_aim", current: "compose" })).toBe("compose");
  });

  it("starts planning when a provider or authenticated local agent exists", () => {
    const providerAction = routeAfterAimSubmit({
      title: "Launch a local research app",
      provider: { configured: true },
      localAgents: [],
    });
    expect(providerAction).toBe("start_planning");
    expect(aimSurfaceAfterSubmit({ action: providerAction, current: "compose" })).toBe("summary");
    expect(routeAfterAimSubmit({
      title: "Launch a local research app",
      provider: null,
      localAgents: [{ available: true, authStatus: "ok" }],
    })).toBe("start_planning");
  });

  it("keeps the existing local CLI readiness rule", () => {
    expect(hasPlanningRuntime(null, [{ available: true, authStatus: "unknown" }])).toBe(true);
    expect(hasPlanningRuntime(null, [{ available: true, authStatus: "missing" }])).toBe(false);
  });
});

describe("aim helper profile", () => {
  it("prefers local agents for coding or workspace aims", () => {
    expect(deriveAimHelperProfile({
      title: "Fix the onboarding bug in the Electron app",
      description: "Run tests and ship the change.",
    })).toMatchObject({
      capability: "code_execution",
      preferredHelper: "local_agent",
      settingsFocus: "local",
    });
  });

  it("prefers web-capable planning for current research aims", () => {
    expect(deriveAimHelperProfile({ title: "Compare the latest CRM pricing changes" })).toMatchObject({
      capability: "current_research",
      preferredHelper: "provider_with_web",
      settingsFocus: "web",
    });
  });

  it("explains source context needs for file-heavy aims", () => {
    expect(deriveAimHelperProfile({ title: "Summarize the PDF notes in this folder" })).toMatchObject({
      capability: "source_context",
      preferredHelper: "provider",
      settingsFocus: "context",
    });
  });
});
