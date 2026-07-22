import { EventEmitter } from "node:events";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import { isRecord, safeJsonParse } from "./adapters/helpers";
import { BUILT_IN_LOCAL_AGENT_ADAPTERS, createLocalAgentRegistry } from "./registry";
import { runLocalAgent } from "./runtime";
import type { LocalAgentAdapter, LocalAgentProcessRunner } from "./types";

function executable(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), "aimcub-local-agent-package-"));
  const path = join(dir, name);
  writeFileSync(path, "#!/bin/sh\nexit 0\n", "utf8");
  chmodSync(path, 0o755);
  return path;
}

function streamingRunner(
  lines: readonly (Record<string, unknown> | string)[],
  onSpawn: (file: string, args: readonly string[]) => void,
): LocalAgentProcessRunner {
  return {
    async execFile() {
      return { exitCode: 0, stdout: "", stderr: "" };
    },
    spawn(file, args) {
      onSpawn(file, args);
      const child = new EventEmitter() as ReturnType<LocalAgentProcessRunner["spawn"]>;
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const stdin = new PassThrough();
      child.stdout = stdout;
      child.stderr = stderr;
      child.stdin = stdin;
      child.kill = (() => true) as typeof child.kill;
      queueMicrotask(() => {
        for (const line of lines) stdout.write(`${typeof line === "string" ? line : JSON.stringify(line)}\n`);
        stdout.end();
        stderr.end();
        child.emit("close", 0);
      });
      return child;
    },
  };
}

/** A child that only ends when something kills it — for timeout/cancel paths. */
function pendingRunner(): { runner: LocalAgentProcessRunner; signals: string[] } {
  const signals: string[] = [];
  return {
    signals,
    runner: {
      async execFile() {
        return { exitCode: 0, stdout: "", stderr: "" };
      },
      spawn() {
        const child = new EventEmitter() as ReturnType<LocalAgentProcessRunner["spawn"]>;
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        child.stdin = new PassThrough();
        child.kill = ((signal?: string) => {
          signals.push(signal ?? "SIGTERM");
          queueMicrotask(() => child.emit("close", null));
          return true;
        }) as typeof child.kill;
        return child;
      },
    },
  };
}

const fakeAgentAdapter: LocalAgentAdapter = {
  id: "fake-agent",
  name: "Fake Agent",
  bin: "fake-agent",
  envVar: "FAKE_AGENT_BIN",
  versionArgs: ["--version"],
  fallbackModels: [{ id: "default", label: "Default" }],
  buildInvocation: (request) => ({
    args: ["--fake", "--sandbox", request.permission?.sandbox ?? "read-only"],
    stdin: request.prompt,
  }),
  parseLine(line) {
    const parsed = safeJsonParse(line);
    if (!isRecord(parsed)) return null;
    if (parsed.kind === "begin") return [{ type: "agent.run.started", summary: "Fake agent started.", raw: parsed }];
    if (parsed.kind === "say") return [{ type: "agent.message.delta", summary: String(parsed.text ?? ""), raw: parsed }];
    return null;
  },
};

describe("@core/local-agent runtime", () => {
  it("streams normalized events through an awaited callback", async () => {
    const codex = executable("codex");
    const delivered: string[] = [];
    const result = await runLocalAgent({
      agentId: "codex",
      prompt: "Say OK",
      cwd: "/tmp",
    }, {
      env: { CODEX_BIN: codex, PATH: "" },
      runner: streamingRunner([
        { type: "thread.started", thread_id: "thread-1" },
        { type: "item.started", item: { id: "item-1", type: "command_execution", command: "pwd" } },
        { type: "item.completed", item: { id: "item-1", type: "command_execution", command: "pwd" } },
        { type: "item.completed", item: { id: "item-2", type: "agent_message", text: "OK" } },
      ], () => {}),
      onEvent: async (event) => {
        await Promise.resolve();
        delivered.push(event.type);
      },
    });

    expect(result.ok).toBe(true);
    expect(result.outputText).toBe("OK");
    expect(delivered).toEqual(result.events.map((event) => event.type));
    expect(delivered[0]).toBe("agent.run.started");
    expect(delivered).toEqual(expect.arrayContaining(["agent.tool.started", "agent.tool.finished", "agent.message.delta"]));
    expect(delivered.at(-1)).toBe("agent.run.completed");
  });

  it("enables Codex live search and scoped workspace shell network together", async () => {
    const codex = executable("codex");
    let spawnedArgs: readonly string[] = [];
    await runLocalAgent({
      agentId: "codex",
      prompt: "Research and edit",
      cwd: "/tmp",
      permission: { sandbox: "workspace-write", network: true },
    }, {
      env: { CODEX_BIN: codex, PATH: "" },
      runner: streamingRunner([{ type: "agent_message.delta", delta: "done" }], (_file, args) => {
        spawnedArgs = args;
      }),
    });

    expect(spawnedArgs.slice(0, 2)).toEqual(["--search", "exec"]);
    expect(spawnedArgs).toEqual(expect.arrayContaining([
      "--sandbox",
      "workspace-write",
      "sandbox_workspace_write.network_access=true",
    ]));
  });

  it("uses Claude acceptEdits for workspace writes instead of bypassing permissions", async () => {
    const claude = executable("claude");
    let spawnedArgs: readonly string[] = [];
    const result = await runLocalAgent({
      agentId: "claude",
      prompt: "Edit the workspace",
      cwd: "/tmp",
      reasoning: "high",
      permission: { sandbox: "workspace-write", network: false },
    }, {
      env: { CLAUDE_BIN: claude, PATH: "" },
      runner: streamingRunner([
        { type: "system", session_id: "session-1" },
        { type: "assistant", message: { content: [{ type: "text", text: "done" }] } },
        { type: "result", result: "done", subtype: "success" },
      ], (_file, args) => {
        spawnedArgs = args;
      }),
    });

    expect(spawnedArgs).toEqual(expect.arrayContaining(["--permission-mode", "acceptEdits", "--effort", "high"]));
    expect(spawnedArgs).toEqual(expect.arrayContaining(["--disallowedTools", "WebSearch,WebFetch"]));
    expect(spawnedArgs).not.toContain("bypassPermissions");
    expect(result.outputText).toBe("done");
  });

  it("runs a third-party adapter end to end without any engine change", async () => {
    const fake = executable("fake-agent");
    let spawnedArgs: readonly string[] = [];
    const result = await runLocalAgent({
      agentId: "fake-agent",
      prompt: "Say hello",
      cwd: "/tmp",
      permission: { sandbox: "workspace-write" },
    }, {
      env: { FAKE_AGENT_BIN: fake, PATH: "" },
      registry: createLocalAgentRegistry([...BUILT_IN_LOCAL_AGENT_ADAPTERS, fakeAgentAdapter]),
      runner: streamingRunner([
        { kind: "begin" },
        { kind: "say", text: "Hello" },
        { kind: "say", text: " world" },
        { kind: "mystery" },
        "not json at all",
      ], (_file, args) => {
        spawnedArgs = args;
      }),
    });

    expect(result.ok).toBe(true);
    expect(spawnedArgs).toEqual(["--fake", "--sandbox", "workspace-write"]);
    expect(result.outputText).toBe("Hello world");
    expect(result.failure).toBeNull();
    expect(result.events.filter((event) => event.type === "agent.raw").map((event) => event.summary)).toEqual([
      '{"kind":"mystery"}',
      "not json at all",
    ]);
  });

  it("rejects an unregistered agent id with the registered ids", async () => {
    await expect(runLocalAgent({ agentId: "gemini", prompt: "Say OK" })).rejects.toThrow(
      'Unknown local agent "gemini". Registered agents: codex, claude.',
    );
  });

  it("classifies an aborted run as canceled after sending SIGTERM", async () => {
    const codex = executable("codex");
    const { runner, signals } = pendingRunner();
    const controller = new AbortController();
    const pending = runLocalAgent({
      agentId: "codex",
      prompt: "Wait forever",
      cwd: "/tmp",
    }, { env: { CODEX_BIN: codex, PATH: "" }, runner, signal: controller.signal });

    await Promise.resolve();
    controller.abort();
    const result = await pending;

    expect(signals).toEqual(["SIGTERM"]);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Local agent run was canceled.");
    expect(result.failure).toEqual({
      code: "canceled",
      message: "Local agent run was canceled.",
      retryable: false,
    });
  });

  it("classifies a timed-out run as retryable", async () => {
    const codex = executable("codex");
    const { runner, signals } = pendingRunner();
    const result = await runLocalAgent({
      agentId: "codex",
      prompt: "Wait forever",
      cwd: "/tmp",
    }, { env: { CODEX_BIN: codex, PATH: "" }, runner, timeoutMs: 5 });

    expect(signals).toEqual(["SIGTERM"]);
    expect(result.error).toBe("Local agent run timed out.");
    expect(result.failure).toEqual({
      code: "timeout",
      message: "Local agent run timed out.",
      retryable: true,
    });
  });
});
