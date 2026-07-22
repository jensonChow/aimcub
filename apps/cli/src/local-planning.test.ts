import { describe, expect, it, vi } from "vitest";

import type { LlmGateway } from "@aimcub/llm";
import type { LocalAgentDetection } from "@aimcub/local-agent";

import { localPlanningGateway } from "./local-planning";

function detection(overrides: Partial<LocalAgentDetection> = {}): LocalAgentDetection {
  return {
    id: "codex",
    name: "Codex CLI",
    runMode: "local_cli",
    available: true,
    path: "/tmp/codex",
    version: "test",
    authStatus: "ok",
    authMessage: null,
    models: [{ id: "default", label: "Default" }],
    modelsSource: "fallback",
    reasoningOptions: [],
    diagnostics: [],
    ...overrides,
  };
}

describe("CLI local planning fallback", () => {
  it("creates a gateway from authenticated local agents", async () => {
    const gateway = {} as LlmGateway;
    const createGateway = vi.fn(() => gateway);

    await expect(localPlanningGateway({
      listLocalAgents: async () => [detection(), detection({ id: "claude", name: "Claude Code" })],
      createGateway,
    })).resolves.toBe(gateway);
    expect(createGateway).toHaveBeenCalledWith(["codex", "claude"]);
  });

  it("does not treat unauthenticated or unknown-auth CLIs as a planning runtime", async () => {
    const createGateway = vi.fn(() => ({} as LlmGateway));
    await expect(localPlanningGateway({
      listLocalAgents: async () => [
        detection({ authStatus: "missing" }),
        detection({ id: "claude", name: "Claude Code", authStatus: "unknown" }),
      ],
      createGateway,
    })).resolves.toBeNull();
    expect(createGateway).not.toHaveBeenCalled();
  });
});
