import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LocalAgentRunResult } from "./types";

vi.mock("./runtime", () => ({
  listLocalAgents: vi.fn(),
  runLocalAgent: vi.fn(),
}));

import { listLocalAgents, runLocalAgent } from "./runtime";
import { LocalCliLlmGateway } from "./llm-gateway";

const successfulRun: LocalAgentRunResult = {
  ok: true,
  agentId: "codex",
  command: "/tmp/codex",
  args: ["--search", "exec", "--json"],
  events: [],
  outputText: '{"ok":true}',
  exitCode: 0,
  error: null,
  failure: null,
  durationMs: 5,
};

describe("LocalCliLlmGateway", () => {
  beforeEach(() => {
    vi.mocked(runLocalAgent).mockReset();
    vi.mocked(listLocalAgents).mockReset();
    vi.mocked(listLocalAgents).mockResolvedValue([
      {
        id: "codex",
        name: "Codex CLI",
        runMode: "local_cli",
        available: true,
        path: "/tmp/codex",
        version: "codex-cli test",
        authStatus: "ok",
        authMessage: null,
        models: [{ id: "default", label: "Default" }, { id: "gpt-live", label: "GPT Live" }],
        modelsSource: "live",
        reasoningOptions: [],
        diagnostics: [],
      },
      {
        id: "claude",
        name: "Claude Code",
        runMode: "local_cli",
        available: true,
        path: "/tmp/claude",
        version: "claude test",
        authStatus: "ok",
        authMessage: null,
        models: [{ id: "default", label: "Default" }, { id: "sonnet", label: "Sonnet" }],
        modelsSource: "fallback",
        reasoningOptions: [],
        diagnostics: [],
      },
    ]);
  });

  it("uses a local CLI for structured planning and can enable live web search read-only", async () => {
    vi.mocked(runLocalAgent).mockResolvedValue(successfulRun);
    const gateway = new LocalCliLlmGateway({
      agentIds: ["codex"],
      cwd: "/tmp/workspace",
      network: true,
    });

    const result = await gateway.completeStructured<{ ok: boolean }>({
      task: "classify",
      prompt: "Return ok.",
      schema: {
        type: "object",
        properties: { ok: { type: "boolean" } },
        required: ["ok"],
      },
    });

    expect(result.output).toEqual({ ok: true });
    expect(runLocalAgent).toHaveBeenCalledWith(expect.objectContaining({
      agentId: "codex",
      cwd: "/tmp/workspace",
      model: "gpt-live",
      permission: { sandbox: "read-only", network: true },
    }), expect.objectContaining({}));
  });

  it("falls back across every registered agent in registration order by default", async () => {
    vi.mocked(runLocalAgent)
      .mockResolvedValueOnce({
        ...successfulRun,
        ok: false,
        agentId: "codex",
        error: "codex failed",
        failure: { code: "nonzero_exit", message: "codex failed", retryable: false },
      })
      .mockResolvedValueOnce({ ...successfulRun, agentId: "claude" });
    const gateway = new LocalCliLlmGateway();

    const result = await gateway.complete({ task: "classify", prompt: "Summarize." });

    expect(result.output).toBe('{"ok":true}');
    expect(vi.mocked(runLocalAgent).mock.calls.map(([request]) => request.agentId)).toEqual(["codex", "claude"]);
  });

  it("falls through configured local agents and reports their errors honestly", async () => {
    vi.mocked(runLocalAgent)
      .mockResolvedValueOnce({ ...successfulRun, ok: false, agentId: "codex", error: "codex failed" })
      .mockResolvedValueOnce({ ...successfulRun, ok: false, agentId: "claude", error: "claude failed" });
    const gateway = new LocalCliLlmGateway({ agentIds: ["codex", "claude"] });

    await expect(gateway.complete({ task: "classify", prompt: "Summarize." })).rejects.toThrow(
      "codex: codex failed; claude: claude failed",
    );
  });
});
