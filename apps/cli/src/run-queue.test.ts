import { EventEmitter } from "node:events";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import { routingOverrideForMilestone } from "@core/domain";
import { createJsonFileStore } from "@core/store";
import type { DecompositionOutput } from "@core/types";
import {
  createLocalAgentRegistry,
  createRunQueue,
  isRecord,
  listLocalAgents,
  runLocalAgent,
  safeJsonParse,
  type LocalAgentAdapter,
  type LocalAgentProcessRunner,
} from "@core/local-agent";

import { runAimAgent, runAimAgentUntilBlocked, type AimAgentRunDependencies } from "./agent-run";

/**
 * The run queue end to end, over a real on-disk store and a fake adapter driven by a fake process
 * runner: nothing is stubbed between "enqueue" and "the store holds the events". Child processes
 * are never really spawned.
 *
 * These live in the CLI package because it is the one place that has both halves — the persistence
 * layer (`@core/store`) and the runtime (`@core/local-agent`, which must not depend on it).
 */

const CONTRACT = {
  why: "A local agent can do this step.",
  definition_of_done: "The step is verifiably done.",
  required_evidence: ["A trusted commit."],
  likely_owner: "agent" as const,
  context_gaps: [],
  eval_signal: "A trusted commit matches the artifact path.",
};

function agentNode(key: string, title: string, glob: string) {
  return {
    key,
    title,
    description: `${title}.`,
    est_effort: "s" as const,
    xp_reward: 10,
    decomposition_contract: CONTRACT,
    routing_override: {
      owner: "agent" as const,
      agent_id: "fake",
      agent_label: "Fake Runtime",
      run_mode: "local_cli" as const,
      model: "fake-model",
      model_label: "Fake Model",
      reason: "Use the fake runtime.",
    },
    acceptance_rule: {
      logic: "all" as const,
      threshold: 1,
      completion_mode: "auto" as const,
      clauses: [{ evaluator: "commit_pattern" as const, auto_verifiable: true, match: { path_glob: glob } }],
    },
  };
}

/** Two independent agent-owned sub-aims, so a drain has more than one thing to do. */
const PLAN: DecompositionOutput = {
  goal_summary: "Drain a queue end to end",
  domain: "software",
  rationale: "Two independent agent steps.",
  nodes: [agentNode("first", "First step", "first.txt"), agentNode("second", "Second step", "second.txt")],
  edges: [],
};

/** A third sub-aim routed to a human, so a sweep has something to stop at. */
const PLAN_WITH_HUMAN_TAIL: DecompositionOutput = {
  ...PLAN,
  nodes: [
    ...PLAN.nodes,
    {
      ...agentNode("third", "Third step", "third.txt"),
      routing_override: {
        owner: "human" as const,
        agent_id: null,
        agent_label: null,
        run_mode: null,
        model: null,
        model_label: null,
        reason: "A person must sign this off.",
      },
    },
  ],
};

const FAKE_ADAPTER: LocalAgentAdapter = {
  id: "fake",
  name: "Fake Runtime",
  bin: "fake-runtime",
  envVar: "FAKE_RUNTIME_BIN",
  versionArgs: ["--version"],
  authProbe: { args: ["auth"] },
  fallbackModels: [{ id: "fake-model", label: "Fake Model" }],
  buildInvocation: (request) => ({
    args: ["run", "--sandbox", request.permission?.sandbox ?? "read-only"],
    stdin: request.prompt,
  }),
  parseLine(line) {
    const parsed = safeJsonParse(line);
    if (!isRecord(parsed)) return null;
    if (parsed.event === "tool") {
      const name = String(parsed.name ?? "tool");
      return [{
        type: parsed.phase === "end" ? "agent.tool.finished" : "agent.tool.started",
        summary: name,
        toolName: name,
      }];
    }
    if (parsed.event === "text") return [{ type: "agent.message.delta", summary: String(parsed.chunk ?? "") }];
    return null;
  },
};

function fakeExecutable(): string {
  const dir = mkdtempSync(join(tmpdir(), "aimcub-queue-bin-"));
  const path = join(dir, "fake-runtime");
  writeFileSync(path, "#!/bin/sh\nexit 0\n", "utf8");
  chmodSync(path, 0o755);
  return path;
}

interface ScriptedRun {
  lines?: readonly Record<string, unknown>[];
  /** Non-zero settles the run as a non-retryable failure. */
  exitCode?: number;
  /** Never closes on its own: only an abort or the engine's timeout can settle it. */
  hang?: boolean;
}

/** Streams one scripted run per spawn, in order. */
function scriptedRunner(script: readonly ScriptedRun[], onSpawn?: (index: number) => void): LocalAgentProcessRunner {
  let index = 0;
  return {
    async execFile() {
      return { exitCode: 0, stdout: "fake-runtime 1.0.0", stderr: "" };
    },
    spawn() {
      const step = script[index] ?? {};
      const spawnIndex = index;
      index += 1;
      const child = new EventEmitter() as ReturnType<LocalAgentProcessRunner["spawn"]>;
      const stdout = new PassThrough();
      child.stdout = stdout;
      child.stderr = new PassThrough();
      child.stdin = new PassThrough();
      let closed = false;
      const close = (code: number) => {
        if (closed) return;
        closed = true;
        stdout.end();
        child.emit("close", code);
      };
      // The engine kills with SIGTERM for both timeout and abort; a real CLI dies non-zero.
      child.kill = ((): boolean => {
        close(step.exitCode ?? 1);
        return true;
      }) as typeof child.kill;
      queueMicrotask(() => {
        for (const line of step.lines ?? []) stdout.write(`${JSON.stringify(line)}\n`);
        if (!step.hang) close(step.exitCode ?? 0);
        onSpawn?.(spawnIndex);
      });
      return child;
    },
  };
}

function agentDependencies(script: readonly ScriptedRun[], onSpawn?: (index: number) => void): AimAgentRunDependencies {
  const registry = createLocalAgentRegistry([FAKE_ADAPTER]);
  const env = { FAKE_RUNTIME_BIN: fakeExecutable(), PATH: "" };
  const runner = scriptedRunner(script, onSpawn);
  return {
    listLocalAgents: () => listLocalAgents({ registry, runner, env }),
    // A short engine timeout keeps the "retryable timeout" case fast.
    runLocalAgent: (request, options) => runLocalAgent(request, { ...options, registry, runner, env, timeoutMs: 1_500 }),
  };
}

function queueDependencies(script: readonly ScriptedRun[], onSpawn?: (index: number) => void) {
  return { ...agentDependencies(script, onSpawn), routingOverrideForMilestone };
}

async function seedAim(plan: DecompositionOutput = PLAN) {
  const store = createJsonFileStore(mkdtempSync(join(tmpdir(), "aimcub-queue-store-")));
  const workspace = mkdtempSync(join(tmpdir(), "aimcub-queue-workspace-"));
  const { goal, milestones } = await store.createGoal({ title: "Drain a queue end to end", plan });
  return { store, goal, milestones, workspace };
}

const OK_RUN: ScriptedRun = {
  lines: [
    { event: "tool", phase: "start", name: "shell" },
    { event: "tool", phase: "end", name: "shell" },
    { event: "text", chunk: "Did the work." },
  ],
};

describe("local agent run queue", () => {
  it("drains queued sub-aims serially in plan order and persists every event", async () => {
    const { store, goal, milestones, workspace } = await seedAim();
    const queue = createRunQueue(store, queueDependencies([OK_RUN, OK_RUN]));

    const first = await queue.enqueue({ goalId: goal.id, workspace, sandbox: "workspace-write", network: false });
    expect(first.run.status).toBe("queued");
    expect(first.row.milestone.id).toBe(milestones[0]!.id);
    const second = await queue.enqueue({
      goalId: goal.id,
      milestoneRef: milestones[1]!.id,
      workspace,
      sandbox: "workspace-write",
      network: false,
    });

    const drained = await queue.drain({ goalId: goal.id });
    expect(drained.map((entry) => entry.executed.row.milestone.id)).toEqual([milestones[0]!.id, milestones[1]!.id]);
    expect(drained.every((entry) => entry.executed.result.ok)).toBe(true);

    const runs = await store.listRuns(goal.id);
    expect(runs).toHaveLength(2);
    expect(runs.every((run) => run.status === "completed")).toBe(true);

    // Each run walked queued → running → completed, and nothing was dropped on the way.
    const events = await store.listRunEvents(goal.id);
    const firstRunEvents = events.filter((event) => event.run_id === first.run.id).map((event) => event.type);
    expect(firstRunEvents).toEqual([
      "run.queued",
      "run.started",
      "run.log",
      "tool.started",
      "tool.finished",
      "run.log",
      "run.log",
      "run.completed",
    ]);
    expect(events.filter((event) => event.run_id === second.run.id)).toHaveLength(firstRunEvents.length);

    // One attributed low-trust evidence row per run; completion stays derived, never written.
    const evidence = await store.listEvidence(goal.id);
    expect(evidence).toHaveLength(2);
    expect(evidence.every((row) => row.kind === "mcp_report" && row.trust_score === 0.6)).toBe(true);

    const progress = await store.getAimProgress(goal.id);
    expect(progress?.milestones.map((row) => row.latest_run?.status)).toEqual(["completed", "completed"]);
    expect(progress?.completed_milestones).toBe(0);
  });

  it("streams every normalized event live, not only the persisted flushes", async () => {
    const { store, goal, workspace } = await seedAim();
    const live: string[] = [];
    const queue = createRunQueue(store, queueDependencies([OK_RUN]), {
      onEvent: (event) => live.push(event.event.type),
    });
    const enqueued = await queue.enqueue({ goalId: goal.id, workspace, sandbox: "read-only", network: false });
    await queue.drain({ runId: enqueued.run.id });

    expect(live).toEqual([
      "agent.run.started",
      "agent.tool.started",
      "agent.tool.finished",
      "agent.message.delta",
      "agent.run.completed",
    ]);
  });

  it("retries a retryable failure exactly once, linked back to the attempt it replaces", async () => {
    const { store, goal, milestones, workspace } = await seedAim();
    // The first spawn hangs until the engine's timeout kills it (timeout is the retryable class);
    // the second succeeds.
    const queue = createRunQueue(store, queueDependencies([{ hang: true }, OK_RUN]), { maxAttempts: 2 });
    const enqueued = await queue.enqueue({ goalId: goal.id, workspace, sandbox: "workspace-write", network: false });

    const drained = await queue.drain({ runId: enqueued.run.id });
    expect(drained).toHaveLength(2);
    expect(drained[0]!.executed.result.failure).toMatchObject({ code: "timeout", retryable: true });
    expect(drained[0]!.retriedInto).toBe(drained[1]!.executed.run.id);
    expect(drained[1]!.executed.result.ok).toBe(true);
    expect(drained[1]!.retriedInto).toBeNull();

    const runs = (await store.listRuns(goal.id)).filter((run) => run.milestone_id === milestones[0]!.id);
    expect(runs).toHaveLength(2);
    expect(runs.map((run) => run.status).sort()).toEqual(["completed", "failed"]);

    const retryLog = (await store.listRunEvents(goal.id)).find(
      (event) => event.run_id === drained[1]!.executed.run.id && event.type === "run.log" && event.payload.retry_of,
    );
    expect(retryLog?.summary).toContain("Retry 1 of 1");
    expect(retryLog?.payload).toMatchObject({ retry_of: enqueued.run.id, attempt: 2, failure_code: "timeout" });
  }, 20_000);

  it("does not retry a non-retryable failure", async () => {
    const { store, goal, workspace } = await seedAim();
    const queue = createRunQueue(store, queueDependencies([{ exitCode: 3 }]));
    const enqueued = await queue.enqueue({ goalId: goal.id, workspace, sandbox: "read-only", network: false });

    const drained = await queue.drain({ runId: enqueued.run.id });
    expect(drained).toHaveLength(1);
    expect(drained[0]!.executed.result.failure).toMatchObject({ code: "nonzero_exit", retryable: false });
    expect(drained[0]!.retriedInto).toBeNull();
    expect(await store.listRuns(goal.id)).toHaveLength(1);
  });

  it("cancels the executing run, never retries it, and keeps draining the rest", async () => {
    const { store, goal, milestones, workspace } = await seedAim();
    // Cancel the first run once its process exists; the second must still execute.
    let cancelActiveRuns = () => {};
    const dependencies = queueDependencies([{ hang: true }, OK_RUN], (index) => {
      if (index === 0) cancelActiveRuns();
    });
    const queue = createRunQueue(store, dependencies);
    cancelActiveRuns = () => {
      for (const runId of queue.activeRunIds()) queue.cancel(runId);
    };

    const first = await queue.enqueue({ goalId: goal.id, workspace, sandbox: "workspace-write", network: false });
    const second = await queue.enqueue({
      goalId: goal.id,
      milestoneRef: milestones[1]!.id,
      workspace,
      sandbox: "workspace-write",
      network: false,
    });

    const drained = await queue.drain({ goalId: goal.id });
    expect(drained).toHaveLength(2);
    expect(drained[0]!.executed.result.failure).toMatchObject({ code: "canceled", retryable: false });
    expect(drained[0]!.retriedInto).toBeNull();
    expect(drained[1]!.executed.result.ok).toBe(true);

    const runs = await store.listRuns(goal.id);
    expect(runs.find((run) => run.id === first.run.id)?.status).toBe("failed");
    expect(runs.find((run) => run.id === second.run.id)?.status).toBe("completed");
    expect(queue.activeRunIds()).toEqual([]);
  });

  it("never enqueues a sub-aim that already has an active run", async () => {
    const { store, goal, workspace } = await seedAim();
    const queue = createRunQueue(store, queueDependencies([]));
    await queue.enqueue({ goalId: goal.id, workspace, sandbox: "read-only", network: false });

    // The first sub-aim is queued, so the automatic pick moves on to the second.
    const next = await queue.enqueue({ goalId: goal.id, workspace, sandbox: "read-only", network: false });
    expect(next.row.milestone.order_index).toBe(1);

    await expect(queue.enqueue({ goalId: goal.id, workspace, sandbox: "read-only", network: false }))
      .rejects.toThrow(/No dependency-ready, agent-owned, incomplete sub-aim/u);
  });

  it("executes a run enqueued by another process from the queued row alone", async () => {
    const { store, goal, workspace } = await seedAim();
    // The producer never drains; a separate queue instance (a second "process") picks the work up.
    const producer = createRunQueue(store, queueDependencies([]));
    const enqueued = await producer.enqueue({
      goalId: goal.id,
      workspace,
      sandbox: "workspace-write",
      network: true,
      reasoning: "high",
      instruction: "Prefer the smallest diff.",
    });

    const prompts: string[] = [];
    const worker = createRunQueue(store, {
      ...queueDependencies([]),
      async runLocalAgent(request) {
        prompts.push(request.prompt);
        expect(request).toMatchObject({
          agentId: "fake",
          cwd: workspace,
          model: "fake-model",
          reasoning: "high",
          permission: { sandbox: "workspace-write", network: true },
        });
        return {
          ok: true,
          agentId: request.agentId,
          command: "fake-runtime",
          args: [],
          events: [],
          outputText: "done",
          exitCode: 0,
          error: null,
          failure: null,
          durationMs: 1,
        };
      },
    });

    const drained = await worker.drain({ runId: enqueued.run.id });
    expect(drained).toHaveLength(1);
    expect(prompts[0]).toContain("User instruction: Prefer the smallest diff.");
    expect((await store.listRuns(goal.id))[0]?.status).toBe("completed");
  });
});

describe("aimcub run --until-blocked", () => {
  it("drains every ready agent-owned sub-aim and stops at the human-owned tail", async () => {
    const { store, goal, milestones, workspace } = await seedAim(PLAN_WITH_HUMAN_TAIL);
    const seen: string[] = [];

    const sweep = await runAimAgentUntilBlocked(store, {
      goalId: goal.id,
      workspace,
      onRunComplete: (result) => {
        seen.push(result.milestone.id);
      },
    }, agentDependencies([OK_RUN, OK_RUN]));

    expect(seen).toEqual([milestones[0]!.id, milestones[1]!.id]);
    expect(sweep.runs).toHaveLength(2);
    expect(sweep.stopReason).toBe("no_ready_sub_aim");
    expect((await store.listRuns(goal.id)).every((run) => run.status === "completed")).toBe(true);
  });

  it("stops the sweep on a terminal run failure instead of moving to the next sub-aim", async () => {
    const { store, goal, milestones, workspace } = await seedAim();

    const sweep = await runAimAgentUntilBlocked(store, { goalId: goal.id, workspace }, agentDependencies([{ exitCode: 4 }]));

    expect(sweep.runs).toHaveLength(1);
    expect(sweep.runs[0]!.milestone.id).toBe(milestones[0]!.id);
    expect(sweep.stopReason).toBe("run_failed");
    expect(await store.listRuns(goal.id)).toHaveLength(1);
  });

  it("keeps the single-run default: one sub-aim, one run, unchanged result shape", async () => {
    const { store, goal, milestones, workspace } = await seedAim();

    const result = await runAimAgent(store, { goalId: goal.id, workspace, network: true }, agentDependencies([OK_RUN]));

    expect(result.milestone.id).toBe(milestones[0]!.id);
    expect(result.agent.id).toBe("fake");
    expect(result.model).toBe("fake-model");
    expect(result.run.ok).toBe(true);
    expect(result.evidence).toMatchObject({ milestone_id: milestones[0]!.id, kind: "mcp_report", trust_score: 0.6 });
    expect(result.completions).toEqual([]);
    expect(result.progress?.milestones[0]?.latest_run?.status).toBe("completed");
    expect(await store.listRuns(goal.id)).toHaveLength(1);
  });
});
