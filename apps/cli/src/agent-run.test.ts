import { EventEmitter } from "node:events";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import { createJsonFileStore } from "@core/store";
import type { DecompositionOutput } from "@core/types";
import {
  createLocalAgentRegistry,
  isRecord,
  listLocalAgents,
  runLocalAgent,
  safeJsonParse,
  type LocalAgentAdapter,
  type LocalAgentProcessRunner,
  type LocalAgentRunResult,
} from "@core/local-agent";

import { runAimAgent } from "./agent-run";

const PLAN: DecompositionOutput = {
  goal_summary: "Run one ready local-agent sub-aim",
  domain: "software",
  rationale: "The first task is agent-ready and the second waits on it.",
  nodes: [
    {
      key: "first",
      title: "Create the artifact",
      description: "Create and verify one workspace artifact.",
      est_effort: "s",
      xp_reward: 10,
      decomposition_contract: {
        why: "A local agent can create the artifact.",
        definition_of_done: "The artifact exists and verification passes.",
        required_evidence: ["A trusted commit."],
        likely_owner: "agent",
        context_gaps: [],
        eval_signal: "A trusted commit matches the artifact path.",
      },
      routing_override: {
        owner: "agent",
        agent_id: "codex",
        agent_label: "Codex CLI",
        run_mode: "local_cli",
        model: "gpt-test",
        model_label: "GPT Test",
        reason: "Use the test Codex runtime.",
      },
      acceptance_rule: {
        logic: "all",
        threshold: 1,
        completion_mode: "auto",
        clauses: [{ evaluator: "commit_pattern", auto_verifiable: true, match: { path_glob: "artifact.txt" } }],
      },
    },
    {
      key: "second",
      title: "Verify the follow-up",
      description: "Wait for the first sub-aim.",
      est_effort: "s",
      xp_reward: 10,
      decomposition_contract: {
        why: "It depends on the first artifact.",
        definition_of_done: "The follow-up is verified.",
        required_evidence: ["A passing CI run."],
        likely_owner: "agent",
        context_gaps: [],
        eval_signal: "CI passes after the artifact exists.",
      },
      routing_override: null,
      acceptance_rule: {
        logic: "all",
        threshold: 1,
        completion_mode: "auto",
        clauses: [{ evaluator: "ci_status", auto_verifiable: true, match: { conclusion: "success" } }],
      },
    },
  ],
  edges: [{ from: "first", to: "second" }],
};

/**
 * A community-style third runtime: one adapter module, no core dispatch edits.
 * It is registered in an isolated registry so the built-ins stay untouched.
 */
const GEMINI_FAKE_ADAPTER: LocalAgentAdapter = {
  id: "gemini-fake",
  name: "Fake Gemini",
  bin: "gemini-fake",
  envVar: "GEMINI_FAKE_BIN",
  versionArgs: ["--version"],
  authProbe: { args: ["auth", "print"] },
  fallbackModels: [{ id: "default", label: "Default" }],
  buildInvocation: (request) => ({
    args: ["generate", "--jsonl", "--sandbox", request.permission?.sandbox ?? "read-only"],
    stdin: request.prompt,
  }),
  parseLine(line) {
    const parsed = safeJsonParse(line);
    if (!isRecord(parsed)) return null;
    if (parsed.event === "start") {
      return [{ type: "agent.run.started", summary: "Fake Gemini session started.", sessionId: String(parsed.id ?? ""), raw: parsed }];
    }
    if (parsed.event === "tool") {
      const name = String(parsed.name ?? "tool");
      return [{
        type: parsed.phase === "end" ? "agent.tool.finished" : "agent.tool.started",
        summary: name,
        toolName: name,
        raw: parsed,
      }];
    }
    if (parsed.event === "text") return [{ type: "agent.message.delta", summary: String(parsed.chunk ?? ""), raw: parsed }];
    return null;
  },
};

function fakeExecutable(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), "aimcub-cli-agent-bin-"));
  const path = join(dir, name);
  writeFileSync(path, "#!/bin/sh\nexit 0\n", "utf8");
  chmodSync(path, 0o755);
  return path;
}

/** Probes succeed; the run streams the adapter's own JSONL dialect. */
function fakeGeminiRunner(
  lines: readonly Record<string, unknown>[],
  onSpawn: (file: string, args: readonly string[]) => void,
): LocalAgentProcessRunner {
  return {
    async execFile() {
      return { exitCode: 0, stdout: "gemini-fake 1.0.0", stderr: "" };
    },
    spawn(file, args) {
      onSpawn(file, args);
      const child = new EventEmitter() as ReturnType<LocalAgentProcessRunner["spawn"]>;
      const stdout = new PassThrough();
      child.stdout = stdout;
      child.stderr = new PassThrough();
      child.stdin = new PassThrough();
      child.kill = (() => true) as typeof child.kill;
      queueMicrotask(() => {
        for (const line of lines) stdout.write(`${JSON.stringify(line)}\n`);
        stdout.end();
        child.emit("close", 0);
      });
      return child;
    },
  };
}

describe("CLI local-agent run orchestration", () => {
  it("runs one ready agent milestone and persists streamed events plus low-trust evidence", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "aimcub-cli-agent-run-"));
    const workspace = mkdtempSync(join(tmpdir(), "aimcub-cli-agent-workspace-"));
    const store = createJsonFileStore(dataDir);
    const { goal, milestones } = await store.createGoal({ title: "Ship an artifact", plan: PLAN });
    const sediment = vi.spyOn(store, "sedimentContextFromGoal");
    const fakeRun: LocalAgentRunResult = {
      ok: true,
      agentId: "codex",
      command: "/tmp/fake-codex",
      args: ["exec", "--json"],
      events: [
        { type: "agent.run.started", summary: "Codex started." },
        { type: "agent.tool.started", summary: "shell", toolName: "shell" },
        { type: "agent.tool.finished", summary: "shell", toolName: "shell" },
        { type: "agent.run.completed", summary: "Local agent run completed." },
      ],
      outputText: "Created artifact.txt and ran verification.",
      exitCode: 0,
      error: null,
      failure: null,
      durationMs: 10,
    };

    const result = await runAimAgent(store, {
      goalId: goal.id,
      workspace,
      network: true,
      reasoning: "high",
    }, {
      async listLocalAgents() {
        return [{
          id: "codex",
          name: "Codex CLI",
          runMode: "local_cli",
          available: true,
          path: "/tmp/fake-codex",
          version: "codex-test",
          authStatus: "ok",
          authMessage: null,
          models: [{ id: "gpt-test", label: "GPT Test" }],
          modelsSource: "fallback",
          reasoningOptions: [{ id: "high", label: "High" }],
          diagnostics: [],
        }];
      },
      async runLocalAgent(request, options) {
        expect(request).toMatchObject({
          cwd: workspace,
          model: "gpt-test",
          reasoning: "high",
          permission: { sandbox: "workspace-write", network: true },
        });
        for (const event of fakeRun.events) await options?.onEvent?.(event);
        return fakeRun;
      },
    });

    expect(result.milestone.id).toBe(milestones[0]!.id);
    expect(result.completions).toEqual([]);
    expect(result.evidence).toMatchObject({
      milestone_id: milestones[0]!.id,
      kind: "mcp_report",
      trust_score: 0.6,
    });
    expect(sediment).toHaveBeenCalledWith(goal.id);

    const snapshot = await store.exportData();
    expect(snapshot.runs).toHaveLength(1);
    expect(snapshot.runs[0]).toMatchObject({
      milestone_id: milestones[0]!.id,
      status: "completed",
      workspace_root: workspace,
      sandbox: "workspace-write",
      network_enabled: true,
      reasoning: "high",
    });
    expect(snapshot.runEvents.map((event) => event.type)).toEqual(expect.arrayContaining([
      "run.started",
      "tool.started",
      "tool.finished",
      "run.completed",
    ]));
    expect(snapshot.evidenceAttributions[0]).toMatchObject({
      evidence_id: result.evidence.id,
      run_id: result.orchestrationRun.id,
    });
    expect(snapshot.completions).toEqual([]);
  });

  it("runs a fake third adapter end-to-end through agent-run", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "aimcub-cli-gemini-run-"));
    const workspace = mkdtempSync(join(tmpdir(), "aimcub-cli-gemini-workspace-"));
    const store = createJsonFileStore(dataDir);
    const plan: DecompositionOutput = {
      ...PLAN,
      nodes: PLAN.nodes.map((node, index) => index === 0
        ? {
            ...node,
            routing_override: {
              owner: "agent" as const,
              agent_id: "gemini-fake",
              agent_label: "Fake Gemini",
              run_mode: "local_cli" as const,
              model: "g-test",
              model_label: "Gemini Test",
              reason: "Use the fake community runtime.",
            },
          }
        : node),
    };
    const { goal, milestones } = await store.createGoal({ title: "Ship an artifact", plan });

    // An isolated registry holding only the community adapter: nothing in the
    // engine, the CLI or @core/types knows this runtime exists.
    const registry = createLocalAgentRegistry([GEMINI_FAKE_ADAPTER]);
    const env = { GEMINI_FAKE_BIN: fakeExecutable("gemini-fake"), PATH: "" };
    let spawnedArgs: readonly string[] = [];
    const runner = fakeGeminiRunner([
      { event: "start", id: "session-9" },
      { event: "tool", phase: "start", name: "shell" },
      { event: "tool", phase: "end", name: "shell" },
      { event: "text", chunk: "Created artifact.txt." },
    ], (_file, args) => {
      spawnedArgs = args;
    });

    const result = await runAimAgent(store, { goalId: goal.id, workspace }, {
      listLocalAgents: () => listLocalAgents({ registry, runner, env }),
      runLocalAgent: (request, options) => runLocalAgent(request, { ...options, registry, runner, env }),
    });

    expect(result.agent.id).toBe("gemini-fake");
    expect(result.agent.name).toBe("Fake Gemini");
    expect(result.model).toBe("g-test");
    expect(spawnedArgs).toEqual(["generate", "--jsonl", "--sandbox", "workspace-write"]);
    expect(result.run.ok).toBe(true);
    expect(result.run.outputText).toBe("Created artifact.txt.");
    expect(result.evidence.payload).toMatchObject({ agent_id: "gemini-fake", model: "g-test" });

    const snapshot = await store.exportData();
    expect(snapshot.runs).toHaveLength(1);
    expect(snapshot.runs[0]).toMatchObject({ milestone_id: milestones[0]!.id, status: "completed", model: "g-test" });
    expect(snapshot.runEvents.map((event) => event.type)).toEqual(expect.arrayContaining([
      "run.started",
      "tool.started",
      "tool.finished",
      "run.completed",
    ]));
  });
});
