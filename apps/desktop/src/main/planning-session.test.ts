import { describe, expect, it } from "vitest";

import type { LocalAgentDetection } from "@aimcub/local-agent";

import { resolvePlanningBrain, resolvePlanningSessionModel } from "./planning-session";

function detection(overrides: Partial<LocalAgentDetection> = {}): LocalAgentDetection {
  return {
    id: "codex",
    name: "Codex",
    runMode: "local_cli",
    available: true,
    path: "/bin/codex",
    version: "0.145.0",
    authStatus: "ok",
    authMessage: null,
    models: [
      { id: "default", label: "Default" },
      { id: "gpt-5.6-sol", label: "gpt-5.6-sol" },
      { id: "gpt-5.5", label: "gpt-5.5" },
    ],
    modelsSource: "live",
    reasoningOptions: [],
    diagnostics: [],
    ...overrides,
  };
}

describe("resolvePlanningBrain", () => {
  it("honors a session-ready pick and degrades stale picks to Auto", () => {
    const codex = detection();
    const claude = detection({ id: "claude", name: "Claude Code" });
    expect(resolvePlanningBrain("codex", [claude, codex])).toBe("codex");
    expect(resolvePlanningBrain(null, [claude, codex])).toBe("claude");
    // Signed-out pick → Auto, not a failed session.
    expect(resolvePlanningBrain("claude", [detection({ id: "claude", authStatus: "missing" }), codex])).toBe("codex");
    expect(resolvePlanningBrain("gone", [codex])).toBe("codex");
    expect(resolvePlanningBrain("codex", [])).toBeNull();
  });
});

describe("resolvePlanningSessionModel", () => {
  it("honors an explicit pick that the runtime still advertises live", () => {
    expect(resolvePlanningSessionModel({ agentId: "codex", model: "gpt-5.5" }, "codex", detection()))
      .toBe("gpt-5.5");
  });

  it("falls back to the first live-advertised model for Auto, other-agent, or stale picks", () => {
    expect(resolvePlanningSessionModel(null, "codex", detection())).toBe("gpt-5.6-sol");
    expect(resolvePlanningSessionModel({ agentId: "claude", model: "opus" }, "codex", detection()))
      .toBe("gpt-5.6-sol");
    // A model the upgraded/downgraded CLI no longer advertises must not resurrect.
    expect(resolvePlanningSessionModel({ agentId: "codex", model: "retired" }, "codex", detection()))
      .toBe("gpt-5.6-sol");
  });

  it("returns undefined (runtime default) when the live list is unavailable", () => {
    expect(resolvePlanningSessionModel({ agentId: "codex", model: "gpt-5.5" }, "codex", detection({ modelsSource: "fallback" })))
      .toBeUndefined();
    expect(resolvePlanningSessionModel(null, "codex", undefined)).toBeUndefined();
  });
});
