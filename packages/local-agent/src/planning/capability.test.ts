import { describe, expect, it } from "vitest";

import { createLocalAgentRegistry } from "../registry";
import type { LocalAgentDetection } from "../types";
import { planningCapableAgentId, preferredPlanningModel } from "./embedded-session";

function detection(id: string, overrides: Partial<LocalAgentDetection> = {}): LocalAgentDetection {
  return {
    id,
    name: id,
    runMode: "local_cli",
    available: true,
    path: `/bin/${id}`,
    version: "1.0.0",
    authStatus: "ok",
    authMessage: null,
    models: [],
    modelsSource: "fallback",
    reasoningOptions: [],
    diagnostics: [],
    ...overrides,
  };
}

describe("planningCapableAgentId", () => {
  it("picks the first available, authenticated runtime with planning support", () => {
    const registry = createLocalAgentRegistry();
    // Both built-ins support planning sessions now; detection order decides.
    expect(planningCapableAgentId([detection("codex"), detection("claude")], registry)).toBe("codex");
    expect(planningCapableAgentId([detection("claude"), detection("codex")], registry)).toBe("claude");
    // An unauthenticated first choice falls through to the next capable one.
    expect(planningCapableAgentId([detection("claude", { authStatus: "missing" }), detection("codex")], registry)).toBe("codex");
  });

  it("returns null when no capable runtime is available and authenticated", () => {
    const registry = createLocalAgentRegistry();
    expect(planningCapableAgentId([detection("claude", { available: false })], registry)).toBeNull();
    expect(planningCapableAgentId([detection("claude", { authStatus: "missing" })], registry)).toBeNull();
    expect(planningCapableAgentId([detection("unknown-agent")], registry)).toBeNull();
    expect(planningCapableAgentId([], registry)).toBeNull();
  });
});

describe("preferredPlanningModel", () => {
  it("uses the first live-advertised concrete model, never a fallback catalog", () => {
    expect(preferredPlanningModel(detection("codex", {
      modelsSource: "live",
      models: [{ id: "default", label: "Default" }, { id: "gpt-5.5", label: "gpt-5.5" }, { id: "gpt-5.4", label: "gpt-5.4" }],
    }))).toBe("gpt-5.5");
    // A fallback catalog is a guess about the install, not what it can drive.
    expect(preferredPlanningModel(detection("codex", {
      modelsSource: "fallback",
      models: [{ id: "gpt-5.5", label: "gpt-5.5" }],
    }))).toBeUndefined();
    expect(preferredPlanningModel(detection("codex", { modelsSource: "live", models: [{ id: "default", label: "Default" }] }))).toBeUndefined();
    expect(preferredPlanningModel(undefined)).toBeUndefined();
  });
});
