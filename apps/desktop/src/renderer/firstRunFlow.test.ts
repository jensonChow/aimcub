import { describe, expect, it } from "vitest";

import {
  deriveAimHelperProfile,
  hasPlanningRuntime,
  routeAfterAimSubmit,
  routeAfterRefresh,
} from "./firstRunFlow";

describe("first-run flow routing", () => {
  it("starts first-run users on aim capture instead of settings", () => {
    expect(routeAfterRefresh({ hasSelectedAim: false, hasGoals: false })).toEqual({
      autoOpenFirstGoal: false,
      stageOverride: "aim",
    });
  });

  it("opens the first saved aim instead of runtime settings when helpers are missing", () => {
    expect(routeAfterRefresh({ hasSelectedAim: false, hasGoals: true })).toEqual({
      autoOpenFirstGoal: true,
      stageOverride: "aim",
    });
  });

  it("shows helper guidance after aim submit when no provider or local agent is ready", () => {
    expect(routeAfterAimSubmit({ title: "Launch a local research app", provider: null, localAgents: [] })).toBe("show_helper_guidance");
  });

  it("starts planning when a provider or authenticated local agent exists", () => {
    expect(routeAfterAimSubmit({
      title: "Launch a local research app",
      provider: { configured: true },
      localAgents: [],
    })).toBe("start_planning");
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
