import { EventEmitter } from "node:events";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import { listLocalAgents, runLocalAgent, type LocalAgentProcessRunner } from "./local-agents";

function executable(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), "aimcub-local-agent-"));
  const path = join(dir, name);
  writeFileSync(path, "#!/bin/sh\nexit 0\n", "utf8");
  chmodSync(path, 0o755);
  return path;
}

function runnerWithExec(handler: LocalAgentProcessRunner["execFile"]): LocalAgentProcessRunner {
  return {
    execFile: handler,
    spawn() {
      throw new Error("spawn should not be called");
    },
  };
}

function streamingRunner(onSpawn: (file: string, args: readonly string[]) => void): LocalAgentProcessRunner {
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
        stdout.write(JSON.stringify({ type: "thread.started", thread_id: "thread-1" }) + "\n");
        stdout.write(JSON.stringify({ type: "agent_message.delta", delta: "OK" }) + "\n");
        stdout.end();
        stderr.end();
        child.emit("close", 0);
      });
      return child;
    },
  };
}

describe("desktop local agents", () => {
  it("detects Codex from CODEX_BIN and parses live models", async () => {
    const codex = executable("codex");
    const agents = await listLocalAgents({
      env: { CODEX_BIN: codex, PATH: "" },
      runner: runnerWithExec(async (_file, args) => {
        if (args.join(" ") === "--version") return { exitCode: 0, stdout: "codex-cli 0.1.0\n", stderr: "" };
        if (args.join(" ") === "login status") return { exitCode: 0, stdout: "logged in", stderr: "" };
        if (args.join(" ") === "debug models") {
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              models: [
                { slug: "gpt-live", display_name: "GPT Live" },
                { slug: "hidden", visibility: "hidden" },
              ],
            }),
            stderr: "",
          };
        }
        return { exitCode: 1, stdout: "", stderr: "" };
      }),
    });

    const detected = agents.find((agent) => agent.id === "codex");
    expect(detected).toMatchObject({
      available: true,
      path: codex,
      version: "codex-cli 0.1.0",
      authStatus: "ok",
      modelsSource: "live",
    });
    expect(detected?.models.map((model) => model.id)).toEqual(["default", "gpt-live"]);
  });

  it("reports unavailable agents without invoking probes", async () => {
    const agents = await listLocalAgents({
      env: { CODEX_BIN: "/missing/codex", CLAUDE_BIN: "/missing/claude", PATH: "" },
      runner: runnerWithExec(async () => {
        throw new Error("probe should not run");
      }),
    });

    expect(agents.every((agent) => !agent.available)).toBe(true);
    expect(agents.find((agent) => agent.id === "codex")?.diagnostics[0]).toContain("CODEX_BIN");
  });

  it("runs Codex through exec JSONL and normalizes events", async () => {
    const codex = executable("codex");
    let spawnedArgs: readonly string[] = [];
    const result = await runLocalAgent({
      agentId: "codex",
      prompt: "Say OK",
      cwd: "/tmp",
      model: "gpt-live",
      reasoning: "high",
      permission: { sandbox: "workspace-write", network: true },
    }, {
      env: { CODEX_BIN: codex, PATH: "" },
      runner: streamingRunner((_file, args) => {
        spawnedArgs = args;
      }),
    });

    expect(result.ok).toBe(true);
    expect(result.outputText).toBe("OK");
    expect(spawnedArgs.slice(0, 2)).toEqual(["--search", "exec"]);
    expect(spawnedArgs).toEqual(expect.arrayContaining([
      "--json",
      "--skip-git-repo-check",
      "--sandbox",
      "workspace-write",
      "-C",
      "/tmp",
      "--model",
      "gpt-live",
    ]));
    expect(spawnedArgs.join(" ")).toContain("model_reasoning_effort=");
    expect(result.events.map((event) => event.type)).toEqual(expect.arrayContaining([
      "agent.run.started",
      "agent.message.delta",
      "agent.run.completed",
    ]));
  });

  it("defaults local agent runs to read-only sandboxing", async () => {
    const codex = executable("codex");
    let spawnedArgs: readonly string[] = [];

    await runLocalAgent({
      agentId: "codex",
      prompt: "Say OK",
    }, {
      env: { CODEX_BIN: codex, PATH: "" },
      runner: streamingRunner((_file, args) => {
        spawnedArgs = args;
      }),
    });

    expect(spawnedArgs).toEqual(expect.arrayContaining(["--sandbox", "read-only"]));
  });
});
