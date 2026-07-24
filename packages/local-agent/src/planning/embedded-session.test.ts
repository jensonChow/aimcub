import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { createLocalAgentRegistry } from "../registry";
import type { LocalAgentProcessRunner } from "../types";
import {
  PlanningSessionUnsupportedError,
  startEmbeddedPlanningSession,
  type EmbeddedPlanningSessionHandle,
} from "./embedded-session";
import { validPlanInput } from "./mcp-bridge.test";

// ──────────────────────────────────────────────────────────────────────────
// Fake process plumbing: the "brain" is the test itself, talking to the real
// bridge over MCP while a scripted child stands in for the CLI process.
// ──────────────────────────────────────────────────────────────────────────

class FakeStdin {
  writable = true;
  writes: string[] = [];
  write(chunk: string): boolean {
    this.writes.push(String(chunk));
    return true;
  }
  end(chunk?: string): void {
    if (chunk !== undefined) this.writes.push(String(chunk));
    this.writable = false;
  }
}

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = new FakeStdin();
  killed = false;
  kill(): boolean {
    if (this.killed) return true;
    this.killed = true;
    setImmediate(() => this.emit("close", null));
    return true;
  }
}

function fakeRunner(): LocalAgentProcessRunner & { child: FakeChild; spawnArgs: string[]; spawnFile: string } {
  const child = new FakeChild();
  const holder = {
    child,
    spawnArgs: [] as string[],
    spawnFile: "",
    execFile: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    spawn(file: string, args: readonly string[]) {
      holder.spawnFile = file;
      holder.spawnArgs = [...args];
      return child as unknown as import("node:child_process").ChildProcess;
    },
  };
  return holder;
}

const TEST_ENV = { CLAUDE_BIN: "/bin/ls", PATH: "/usr/bin" } as NodeJS.ProcessEnv;

// The default factory already carries the claude + codex built-ins.
const registry = () => createLocalAgentRegistry();

/** Pull the bridge URL + token back out of the spawned --mcp-config argument. */
function mcpConfigFromArgs(args: string[]): { url: string; token: string } {
  const index = args.indexOf("--mcp-config");
  expect(index).toBeGreaterThan(-1);
  const parsed = JSON.parse(args[index + 1]!) as {
    mcpServers: Record<string, { url: string; headers: { Authorization: string } }>;
  };
  const server = parsed.mcpServers.aimcub!;
  return { url: server.url, token: server.headers.Authorization.replace("Bearer ", "") };
}

async function connectBrain(args: string[]): Promise<Client> {
  const { url, token } = mcpConfigFromArgs(args);
  const client = new Client({ name: "test-brain", version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  }));
  return client;
}

function parseToolText(result: unknown): Record<string, unknown> {
  const content = (result as { content: Array<{ type: string; text: string }> }).content;
  return JSON.parse(content.find((item) => item.type === "text")?.text ?? "{}") as Record<string, unknown>;
}

async function until(condition: () => boolean, timeoutMs = 3_000): Promise<void> {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error("condition not reached in time");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function startSession(
  overrides: Partial<Parameters<typeof startEmbeddedPlanningSession>[0]> = {},
  optionOverrides: Partial<Parameters<typeof startEmbeddedPlanningSession>[1] & object> = {},
): Promise<{ handle: EmbeddedPlanningSessionHandle; runner: ReturnType<typeof fakeRunner> }> {
  const runner = fakeRunner();
  const handle = await startEmbeddedPlanningSession(
    {
      agentId: "claude",
      aim: { title: "Ship the evidence ingester" },
      memories: [],
      webResearch: { enabled: false, required: false },
      cwd: "/tmp",
      ...overrides,
    },
    {
      registry: registry(),
      runner,
      env: TEST_ENV,
      promptOverride: "PLANNING MISSION PROMPT",
      exitGraceMs: 200,
      ...optionOverrides,
    },
  );
  return { handle, runner };
}

describe("embedded planning session", () => {
  it("refuses a runtime without planning-session support", async () => {
    const bare = createLocalAgentRegistry([]);
    bare.register({
      id: "bare",
      name: "Bare runtime",
      bin: "bare",
      envVar: "BARE_BIN",
      versionArgs: ["--version"],
      fallbackModels: [],
      buildInvocation: () => ({ args: [], stdin: "" }),
      parseLine: () => null,
    });
    await expect(
      startEmbeddedPlanningSession(
        { agentId: "bare", aim: { title: "x" }, webResearch: { enabled: false, required: false } },
        { registry: bare, runner: fakeRunner(), env: TEST_ENV },
      ),
    ).rejects.toBeInstanceOf(PlanningSessionUnsupportedError);
  });

  it("closes stdin after the prompt for one-shot runtimes like codex", async () => {
    const runner = fakeRunner();
    await startEmbeddedPlanningSession(
      { agentId: "codex", aim: { title: "x" }, webResearch: { enabled: false, required: false }, cwd: "/tmp" },
      {
        registry: registry(),
        runner,
        env: { CODEX_BIN: "/bin/ls", PATH: "/usr/bin" } as NodeJS.ProcessEnv,
        promptOverride: "CODEX MISSION",
        exitGraceMs: 200,
      },
    );
    // One-shot stdin: the prompt is written and the pipe is closed so exec starts.
    expect(runner.child.stdin.writes.join("")).toBe("CODEX MISSION");
    expect(runner.child.stdin.writable).toBe(false);
    const args = runner.spawnArgs;
    expect(args).toContain("--json");
    expect(args[args.indexOf("--sandbox") + 1]).toBe("read-only");
    expect(args.join(" ")).toContain("mcp_servers.aimcub.url=");
    expect(args.join(" ")).toContain("?token=");
    expect(args.join(" ")).toContain("tool_timeout_sec=604800");
    expect(args).not.toContain("--search");
    runner.child.emit("close", 1);
  });

  it("spawns Claude as a read-only planning brain wired to the session bridge", async () => {
    const { handle, runner } = await startSession();
    expect(runner.spawnFile).toBe("/bin/ls");
    const args = runner.spawnArgs;
    expect(args).toContain("--strict-mcp-config");
    expect(args).toContain("--input-format");
    expect(args).toContain("stream-json");
    const allowed = args[args.indexOf("--allowedTools") + 1]!;
    expect(allowed).toContain("mcp__aimcub__submit_plan");
    expect(allowed).toContain("mcp__aimcub__ask_user");
    expect(allowed).not.toContain("WebSearch");
    const disallowed = args[args.indexOf("--disallowedTools") + 1]!;
    expect(disallowed).toContain("Bash");
    expect(disallowed).toContain("Write");
    expect(disallowed).toContain("WebSearch");

    // The mission prompt reaches the brain as the first injected stream-json user turn.
    await until(() => runner.child.stdin.writes.length > 0);
    const firstTurn = JSON.parse(runner.child.stdin.writes[0]!) as { type: string; message: { content: Array<{ text: string }> } };
    expect(firstTurn.type).toBe("user");
    expect(firstTurn.message.content[0]?.text).toBe("PLANNING MISSION PROMPT");

    handle.cancel();
    const result = await handle.done;
    expect(result.snapshot.phase).toBe("canceled");
  });

  it("runs the full loop: research, blocking question, chat injection, accepted plan", async () => {
    const { handle, runner } = await startSession();
    const brain = await connectBrain(runner.spawnArgs);

    // Activity events flow from parsed runtime output.
    runner.child.stdout.emit("data", Buffer.from(`${JSON.stringify({ type: "system", session_id: "s1" })}\n`));

    const research = parseToolText(await brain.callTool({
      name: "report_research",
      arguments: { findings: [{ summary: "Policy constraint.", source_urls: ["https://example.com"] }] },
    }));
    expect(research.recorded).toBe(true);

    const pendingAsk = brain.callTool({
      name: "ask_user",
      arguments: { question: "Which platform should the first release target?", options: [{ label: "iOS" }, { label: "Web" }] },
    });
    await until(() => handle.session.state().phase === "waiting_user");

    // Temporary chat typed while the question is open: the stream-capable engine
    // drains it into a real injected user turn (the CLI queues it and reads it
    // right after the blocked tool call returns), so the answer body carries no
    // duplicate ride-along copy.
    handle.postUserMessage("Budget is 200 USD.");
    await until(() => runner.child.stdin.writes.some((write) => write.includes("Budget is 200 USD.")));
    const question = handle.session.state().pendingQuestion!;
    expect(handle.provideAnswer(question.id, { selected_labels: ["iOS"], other_text: null })).toBe(true);
    const askReply = parseToolText(await pendingAsk);
    expect(askReply.answer).toMatchObject({ selected_labels: ["iOS"] });
    expect(askReply.user_notes).toBeUndefined();

    // Chat sent while researching is injected as a live stream-json user turn.
    handle.postUserMessage("Prefer a lean first milestone.");
    await until(() => runner.child.stdin.writes.some((write) => write.includes("lean first milestone")));

    const submit = parseToolText(await brain.callTool({
      name: "submit_plan",
      arguments: { plan: validPlanInput() },
    }));
    expect(submit.accepted).toBe(true);

    // The brain exits cleanly; the engine settles with the session outcome.
    runner.child.emit("close", 0);
    const result = await handle.done;
    expect(result.snapshot.phase).toBe("draft_ready");
    expect(result.outcome?.plan.nodes).toHaveLength(2);
    expect(result.outcome?.research.findings).toHaveLength(1);
    expect(result.processFailure).toBeNull();
    expect(result.activityEvents.some((event) => event.type === "agent.run.started")).toBe(true);
    await brain.close();
  });

  it("finalize on process exit honors honesty: no submission means an explicit failure", async () => {
    const { handle, runner } = await startSession();
    runner.child.emit("close", 1);
    const result = await handle.done;
    expect(result.snapshot.phase).toBe("failed");
    expect(result.failure?.code).toBe("no_plan_submitted");
    expect(result.processFailure?.code).toBe("nonzero_exit");
  });

  it("closes stdin after an idle turn so a brain that stopped without submitting ends honestly", async () => {
    const { handle, runner } = await startSession({}, { exitGraceMs: 100 });
    // The runtime finishes its turn (e.g. auth failure, or it just stopped)
    // without any submission; bidirectional stream-json would idle forever.
    runner.child.stdout.emit(
      "data",
      Buffer.from(`${JSON.stringify({ type: "result", subtype: "success", result: "done without submitting" })}\n`),
    );
    await until(() => runner.child.stdin.writable === false, 3_000);
    runner.child.emit("close", 0);
    const result = await handle.done;
    expect(result.snapshot.phase).toBe("failed");
    expect(result.failure?.code).toBe("no_plan_submitted");
    expect(result.processFailure).toBeNull();
  });

  it("new chat cancels the idle grace so the user can revive a stopped brain", async () => {
    const { handle, runner } = await startSession({}, { exitGraceMs: 150 });
    runner.child.stdout.emit(
      "data",
      Buffer.from(`${JSON.stringify({ type: "result", subtype: "success", result: "paused" })}\n`),
    );
    handle.postUserMessage("Also research the pricing side.");
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(runner.child.stdin.writable).toBe(true);
    handle.cancel();
    await handle.done;
  });

  it("pauses the active-thinking clock while a question waits on the user", async () => {
    const { handle, runner } = await startSession({ activeTimeoutMs: 250 });
    const brain = await connectBrain(runner.spawnArgs);

    const pendingAsk = brain.callTool({
      name: "ask_user",
      arguments: { question: "Which platform should the first release target?" },
    });
    await until(() => handle.session.state().phase === "waiting_user");

    // Far longer than the active budget — but the clock is paused, so no kill.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(runner.child.killed).toBe(false);

    const question = handle.session.state().pendingQuestion!;
    handle.provideAnswer(question.id, { selected_labels: [], other_text: "web" });
    await pendingAsk;

    // Researching again: the remaining budget runs out and the brain is stopped.
    await until(() => runner.child.killed, 3_000);
    const result = await handle.done;
    expect(result.processFailure?.code).toBe("timeout");
    await brain.close();
  });
});
