import { describe, expect, it } from "vitest";

import { createLocalAgentRegistry } from "../registry";
import type { LocalAgentDetection } from "../types";
import { planningCapableAgentId } from "./embedded-session";

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
    expect(planningCapableAgentId([detection("codex"), detection("claude")], registry)).toBe("claude");
  });

  it("returns null when the capable runtime is unavailable or unauthenticated", () => {
    const registry = createLocalAgentRegistry();
    expect(planningCapableAgentId([detection("claude", { available: false })], registry)).toBeNull();
    expect(planningCapableAgentId([detection("claude", { authStatus: "missing" })], registry)).toBeNull();
    expect(planningCapableAgentId([detection("codex")], registry)).toBeNull();
    expect(planningCapableAgentId([], registry)).toBeNull();
  });
});
