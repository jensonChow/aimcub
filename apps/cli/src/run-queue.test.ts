import { EventEmitter } from "node:events";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import { routingOverrideForMilestone } from "@aimcub/core";
import { createJsonFileStore } from "@aimcub/store";
import type { DecompositionOutput } from "@aimcub/types";
import {
  createLocalAgentRegistry,
  createRunQueue,
  fileArtifactsFromChanges,
  isRecord,
  listLocalAgents,
  reconcileInterruptedRuns,
  runLocalAgent,
  safeJsonParse,
  INTERRUPTED_RUN_ERROR,
  RUN_EVENT_RAW_CHAR_CAP,
  RUN_RAW_CHAR_BUDGET,
  type LocalAgentAdapter,
  type LocalAgentProcessRunner,
} from "@aimcub/local-agent";

import { runAimAgent, runAimAgentUntilBlocked, type AimAgentRunDependencies } from "./agent-run";

/**
 * The run queue end to end, over a real on-disk store and a fake adapter driven by a fake process
 * runner: nothing is stubbed between "enqueue" and "the store holds the events". Child processes
 * are never really spawned.
 *
 * These live in the CLI package because it is the one place that has both halves — the persistence
 * layer (`@aimcub/store`) and the runtime (`@aimcub/local-agent`, which must not depend on it).
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
      // `files` and `raw` are optional in the fake dialect, exactly as they are for a real
      // adapter: a tool step that names no file simply leaves the artifact fields unset.
      const artifacts = fileArtifactsFromChanges(parsed.files);
      return [{
        type: parsed.phase === "end" ? "agent.tool.finished" : "agent.tool.started",
        summary: name,
        toolName: name,
        ...(parsed.raw === undefined ? {} : { raw: parsed.raw }),
        ...(artifacts.length > 0 ? { artifacts } : {}),
      }];
    }
    if (parsed.event === "text") {
      return [{
        type: "agent.message.delta",
        summary: String(parsed.chunk ?? ""),
        ...(parsed.raw === undefined ? {} : { raw: parsed.raw }),
      }];
    }
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

/** One file written, then edited, then a second file deleted — the same path touched twice. */
const ARTIFACT_RUN: ScriptedRun = {
  lines: [
    { event: "tool", phase: "start", name: "write_file", files: [{ path: "src/queue.ts", kind: "add" }], raw: { call: "write_file" } },
    { event: "tool", phase: "end", name: "write_file", files: [{ path: "src/queue.ts", kind: "add" }] },
    { event: "tool", phase: "start", name: "edit_file", files: [{ path: "src/queue.ts", kind: "update" }] },
    { event: "tool", phase: "end", name: "remove_file", files: [{ path: "docs/old.md", kind: "delete" }] },
    { event: "text", chunk: "Rewrote the queue." },
  ],
};

describe("local agent run queue", () => {
  it("drains every queued sub-aim and persists every event", async () => {
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
    // Independent runs execute concurrently, so completion order is not a contract — that
    // every claimed run is executed exactly once, and every event persisted, still is.
    expect(drained.map((entry) => entry.executed.row.milestone.id).sort())
      .toEqual([milestones[0]!.id, milestones[1]!.id].sort());
    expect(drained.every((entry) => entry.executed.result.ok)).toBe(true);

    const runs = await store.listRuns(goal.id);
    expect(runs).toHaveLength(2);
    expect(runs.every((run) => run.status === "completed")).toBe(true);

    // Each run walked queued → running → evidence → completed, and nothing was dropped on the way.
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
      "evidence.reported",
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

  it("starts independent sub-aims at the same time instead of waiting for the previous one", async () => {
    const { store, goal, milestones, workspace } = await seedAim();
    let activeWhenSecondStarted = 0;
    let cancelHangingRun = () => {};
    let activeRunIds: () => string[] = () => [];
    // The first run HANGS. Under the old serial drain (claim → await → claim) the second run
    // could never start at all, which is exactly what made an aim move one sub-aim at a time.
    const dependencies = queueDependencies([{ hang: true }, OK_RUN], (index) => {
      if (index !== 1) return;
      activeWhenSecondStarted = activeRunIds().length;
      cancelHangingRun();
    });
    const queue = createRunQueue(store, dependencies);
    activeRunIds = () => queue.activeRunIds();

    const hanging = await queue.enqueue({ goalId: goal.id, workspace, sandbox: "workspace-write", network: false });
    await queue.enqueue({
      goalId: goal.id,
      milestoneRef: milestones[1]!.id,
      workspace,
      sandbox: "workspace-write",
      network: false,
    });
    cancelHangingRun = () => queue.cancel(hanging.run.id);

    const drained = await queue.drain({ goalId: goal.id });

    // The second process started while the first was still executing — genuine overlap.
    expect(activeWhenSecondStarted).toBe(2);
    expect(drained).toHaveLength(2);
    const healthy = drained.find((entry) => entry.executed.row.milestone.id === milestones[1]!.id)!;
    expect(healthy.executed.result.ok).toBe(true);
    expect(queue.activeRunIds()).toEqual([]);
  });

  it("honours a maxConcurrentRuns of 1 — the queue stays strictly serial when asked", async () => {
    const { store, goal, milestones, workspace } = await seedAim();
    let peakActive = 0;
    let activeRunIds: () => string[] = () => [];
    const dependencies = queueDependencies([OK_RUN, OK_RUN], () => {
      peakActive = Math.max(peakActive, activeRunIds().length);
    });
    const queue = createRunQueue(store, dependencies, { maxConcurrentRuns: 1 });
    activeRunIds = () => queue.activeRunIds();

    await queue.enqueue({ goalId: goal.id, workspace, sandbox: "workspace-write", network: false });
    await queue.enqueue({
      goalId: goal.id,
      milestoneRef: milestones[1]!.id,
      workspace,
      sandbox: "workspace-write",
      network: false,
    });

    const drained = await queue.drain({ goalId: goal.id });
    expect(drained).toHaveLength(2);
    expect(peakActive).toBe(1);
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
    let cancelHangingRun = () => {};
    const dependencies = queueDependencies([{ hang: true }, OK_RUN], (index) => {
      if (index === 0) cancelHangingRun();
    });
    const queue = createRunQueue(store, dependencies);

    const first = await queue.enqueue({ goalId: goal.id, workspace, sandbox: "workspace-write", network: false });
    const second = await queue.enqueue({
      goalId: goal.id,
      milestoneRef: milestones[1]!.id,
      workspace,
      sandbox: "workspace-write",
      network: false,
    });
    // Cancel exactly the hanging run, by id. Independent runs now execute concurrently, so
    // cancelling "every active run" would take the healthy sibling down with it.
    cancelHangingRun = () => queue.cancel(first.run.id);

    const drained = await queue.drain({ goalId: goal.id });
    expect(drained).toHaveLength(2);
    // Indexed by milestone, not by position: with concurrent execution the hung run settles
    // whenever its process dies, which need not be before the healthy run finishes.
    const canceled = drained.find((entry) => entry.executed.row.milestone.id === milestones[0]!.id)!;
    const healthy = drained.find((entry) => entry.executed.row.milestone.id === milestones[1]!.id)!;
    expect(canceled.executed.result.failure).toMatchObject({ code: "canceled", retryable: false });
    expect(canceled.retriedInto).toBeNull();
    expect(healthy.executed.result.ok).toBe(true);

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

  it("persists file artifacts as durable events and folds them into the run's evidence", async () => {
    const { store, goal, workspace } = await seedAim();
    const queue = createRunQueue(store, queueDependencies([ARTIFACT_RUN]));
    const enqueued = await queue.enqueue({ goalId: goal.id, workspace, sandbox: "workspace-write", network: false });

    const drained = await queue.drain({ runId: enqueued.run.id });
    expect(drained[0]!.executed.result.ok).toBe(true);

    // Each artifact event sits directly after the tool event that produced it, and the second
    // touch of an already-announced path+kind does NOT repeat the event.
    const events = (await store.listRunEvents(goal.id)).filter((event) => event.run_id === enqueued.run.id);
    expect(events.map((event) => event.type)).toEqual([
      "run.queued",
      "run.started",
      "run.log",
      "tool.started",
      "artifact.created",
      "tool.finished",
      "tool.started",
      "artifact.created",
      "tool.finished",
      "artifact.created",
      "run.log",
      "run.log",
      "evidence.reported",
      "run.completed",
    ]);
    const artifacts = events.filter((event) => event.type === "artifact.created");
    expect(artifacts.map((event) => event.summary)).toEqual([
      "Wrote src/queue.ts",
      "Edited src/queue.ts",
      "Deleted docs/old.md",
    ]);
    expect(artifacts[0]!.payload).toMatchObject({
      path: "src/queue.ts",
      kind: "file_write",
      tool_name: "write_file",
      source_event_type: "agent.tool.started",
    });

    // The evidence keeps the deduped tally, including the repeat touch the journal does not repeat.
    const evidence = await store.listEvidence(goal.id);
    expect(evidence[0]!.payload.artifacts).toEqual([
      { path: "src/queue.ts", kinds: ["file_write", "file_edit"], touches: 3 },
      { path: "docs/old.md", kinds: ["file_delete"], touches: 1 },
    ]);

    // ...and the run timeline points at the evidence row it produced.
    const reported = events.find((event) => event.type === "evidence.reported");
    expect(reported?.payload).toMatchObject({
      evidence_id: evidence[0]!.id,
      kind: "mcp_report",
      trust_score: 0.6,
      artifact_count: 2,
      completion_count: 0,
    });
    expect(reported?.summary).toBe("Fake Runtime reported evidence for: First step");
  });

  it("keeps a run with no artifacts free of artifact events and reports an empty summary", async () => {
    const { store, goal, workspace } = await seedAim();
    const queue = createRunQueue(store, queueDependencies([OK_RUN]));
    const enqueued = await queue.enqueue({ goalId: goal.id, workspace, sandbox: "read-only", network: false });
    await queue.drain({ runId: enqueued.run.id });

    const events = await store.listRunEvents(goal.id);
    expect(events.some((event) => event.type === "artifact.created")).toBe(false);
    expect((await store.listEvidence(goal.id))[0]!.payload.artifacts).toEqual([]);
  });

  it("retains runtime raw payloads under the per-event cap and the per-run budget", async () => {
    const { store, goal, workspace } = await seedAim();
    // 8 KB retained per event means the 256 KB run budget covers exactly 32 oversized events.
    const retainedPerEvent = RUN_EVENT_RAW_CHAR_CAP;
    const budgetedEvents = Math.floor(RUN_RAW_CHAR_BUDGET / retainedPerEvent);
    const oversized = { blob: "x".repeat(RUN_EVENT_RAW_CHAR_CAP * 2) };
    const queue = createRunQueue(store, queueDependencies([{
      lines: [
        { event: "tool", phase: "start", name: "shell", raw: { call: "shell", argv: ["pnpm", "test"] } },
        { event: "tool", phase: "end", name: "shell", raw: oversized },
        ...Array.from({ length: budgetedEvents }, (_unused, index) => ({
          event: "text",
          chunk: `chunk ${index}`,
          raw: oversized,
        })),
      ],
    }]));
    const enqueued = await queue.enqueue({ goalId: goal.id, workspace, sandbox: "read-only", network: false });
    await queue.drain({ runId: enqueued.run.id });

    const events = (await store.listRunEvents(goal.id)).filter((event) => event.run_id === enqueued.run.id);
    // A small payload is kept verbatim.
    expect(events.find((event) => event.type === "tool.started")?.payload.raw)
      .toEqual({ call: "shell", argv: ["pnpm", "test"] });

    // An oversized one is truncated, and says so.
    const truncated = events.find((event) => event.type === "tool.finished")!;
    expect(truncated.payload).toMatchObject({ raw_truncated: true });
    expect(truncated.payload.raw).toBeUndefined();
    expect(String(truncated.payload.raw_preview)).toHaveLength(RUN_EVENT_RAW_CHAR_CAP);
    expect(Number(truncated.payload.raw_chars)).toBeGreaterThan(RUN_EVENT_RAW_CHAR_CAP);

    // Past the run budget raw stops being retained — but the events themselves still persist.
    const overBudget = events.filter((event) => event.payload.raw_omitted === "run_budget");
    expect(overBudget.length).toBeGreaterThan(0);
    expect(overBudget.every((event) => event.summary === "Agent response updated.")).toBe(true);
    const retainedChars = events.reduce((total, event) => {
      if (typeof event.payload.raw_preview === "string") return total + event.payload.raw_preview.length;
      return event.payload.raw === undefined ? total : total + JSON.stringify(event.payload.raw).length;
    }, 0);
    expect(retainedChars).toBeLessThanOrEqual(RUN_RAW_CHAR_BUDGET);
    expect(retainedChars).toBeGreaterThan(RUN_RAW_CHAR_BUDGET - retainedPerEvent);
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

/**
 * Wake-time reconciliation: a `running` row whose worker process died is settled as interrupted
 * and re-queued, so reopening the app continues the flow instead of wedging the aim behind a row
 * nothing can cancel, finish, or re-run.
 */
describe("interrupted-run reconciliation", () => {
  async function seedAimWithDataDir() {
    const dataDir = mkdtempSync(join(tmpdir(), "aimcub-queue-store-"));
    const store = createJsonFileStore(dataDir);
    const workspace = mkdtempSync(join(tmpdir(), "aimcub-queue-workspace-"));
    const { goal, milestones } = await store.createGoal({ title: "Drain a queue end to end", plan: PLAN });
    return { dataDir, store, goal, milestones, workspace };
  }

  /** Rewrites one run row directly on disk — how a foreign worker's pid gets into a test store. */
  function patchStoredRun(dataDir: string, runId: string, patch: Record<string, unknown>): void {
    const path = join(dataDir, "store.json");
    const data = JSON.parse(readFileSync(path, "utf8")) as { runs: Array<Record<string, unknown>> };
    Object.assign(data.runs.find((row) => row.id === runId)!, patch);
    writeFileSync(path, JSON.stringify(data), "utf8");
  }

  it("settles an orphaned run at wake and queues a continuation that then really runs", async () => {
    const { store, goal, milestones, workspace } = await seedAimWithDataDir();
    const queue = createRunQueue(store, queueDependencies([OK_RUN]));
    const enqueued = await queue.enqueue({
      goalId: goal.id,
      milestoneRef: milestones[0]!.id,
      workspace,
      sandbox: "read-only",
      network: false,
      model: "fake-model",
      instruction: "Keep going.",
    });
    // Claim as a worker would, then "die" without ever settling. The claim stamped OUR pid, and
    // a pid equal to the reconciler's own is proof of a previous incarnation, not a live worker.
    const claimed = await store.claimNextQueuedRun({ runId: enqueued.run.id });
    expect(claimed?.worker_pid).toBe(process.pid);

    const outcomes = await reconcileInterruptedRuns(store, queueDependencies([]));
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ runId: enqueued.run.id, disposition: "continued" });
    const continuationId = outcomes[0]!.continuationRunId!;

    const runs = await store.listRuns(goal.id);
    expect(runs.find((row) => row.id === enqueued.run.id)).toMatchObject({
      status: "failed",
      error: INTERRUPTED_RUN_ERROR,
    });
    // The continuation carries the interrupted run's recorded permission, runtime and brief.
    expect(runs.find((row) => row.id === continuationId)).toMatchObject({
      status: "queued",
      milestone_id: milestones[0]!.id,
      sandbox: "read-only",
      network_enabled: false,
      model: "fake-model",
    });
    const events = await store.listRunEvents(goal.id);
    expect(events.find((event) => event.run_id === continuationId && event.type === "run.queued")?.payload)
      .toMatchObject({ resumed_from: enqueued.run.id, attempt: 1, instruction: "Keep going." });

    // The ordinary drain picks the continuation up: reopening the app continues the flow.
    const drained = await queue.drain({ runId: continuationId });
    expect(drained).toHaveLength(1);
    expect(drained[0]!.executed.result.ok).toBe(true);
    expect((await store.listRuns(goal.id)).find((row) => row.id === continuationId)?.status).toBe("completed");
  });

  it("leaves a running row alone while a live foreign worker owns it", async () => {
    const { dataDir, store, goal, milestones, workspace } = await seedAimWithDataDir();
    const queue = createRunQueue(store, queueDependencies([]));
    const enqueued = await queue.enqueue({ goalId: goal.id, milestoneRef: milestones[0]!.id, workspace, sandbox: "read-only", network: false });
    await store.claimNextQueuedRun({ runId: enqueued.run.id });
    patchStoredRun(dataDir, enqueued.run.id, { worker_pid: process.pid + 1 });

    const outcomes = await reconcileInterruptedRuns(store, queueDependencies([]), { isProcessAlive: () => true });
    expect(outcomes).toEqual([]);
    expect((await store.listRuns(goal.id)).find((row) => row.id === enqueued.run.id)?.status).toBe("running");
  });

  it("treats a pre-worker-identity running row as orphaned — the shape every pre-fix store holds", async () => {
    const { dataDir, store, goal, milestones, workspace } = await seedAimWithDataDir();
    const queue = createRunQueue(store, queueDependencies([]));
    const enqueued = await queue.enqueue({ goalId: goal.id, milestoneRef: milestones[0]!.id, workspace, sandbox: "read-only", network: false });
    await store.claimNextQueuedRun({ runId: enqueued.run.id });
    patchStoredRun(dataDir, enqueued.run.id, { worker_pid: null });

    // `isProcessAlive` says everything lives, but a row nothing can vouch for is still an orphan.
    const outcomes = await reconcileInterruptedRuns(store, queueDependencies([]), { isProcessAlive: () => true });
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.disposition).toBe("continued");
    expect((await store.listRuns(goal.id)).find((row) => row.id === enqueued.run.id)?.status).toBe("failed");
  });

  it("never touches a running row the queue did not create", async () => {
    const { store, goal, milestones } = await seedAimWithDataDir();
    // Demo seeds create `running` rows directly — no `run.queued` event, so not the queue's.
    const demo = await store.createRun({ goalId: goal.id, milestoneId: milestones[0]!.id, actorKind: "agent", status: "running" });

    const outcomes = await reconcileInterruptedRuns(store, queueDependencies([]), { isProcessAlive: () => false });
    expect(outcomes).toEqual([]);
    expect((await store.listRuns(goal.id)).find((row) => row.id === demo.id)?.status).toBe("running");
  });

  it("nets exactly one continuation when two orphans share a milestone", async () => {
    const { dataDir, store, goal, milestones, workspace } = await seedAimWithDataDir();
    const queue = createRunQueue(store, queueDependencies([]));
    const first = await queue.enqueue({ goalId: goal.id, milestoneRef: milestones[0]!.id, workspace, sandbox: "read-only", network: false });
    await store.claimNextQueuedRun({ runId: first.run.id });
    // Park the first orphan as failed just long enough to get a second run past the
    // one-active-run enqueue guard, then restore it: two `running` rows, one milestone.
    patchStoredRun(dataDir, first.run.id, { status: "failed" });
    const second = await queue.enqueue({ goalId: goal.id, milestoneRef: milestones[0]!.id, workspace, sandbox: "read-only", network: false });
    await store.claimNextQueuedRun({ runId: second.run.id });
    patchStoredRun(dataDir, first.run.id, { status: "running" });

    const outcomes = await reconcileInterruptedRuns(store, queueDependencies([]));
    expect(outcomes).toHaveLength(2);
    const continued = outcomes.filter((outcome) => outcome.disposition === "continued");
    expect(continued).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.disposition === "milestone_no_longer_runnable")).toHaveLength(1);

    const runs = await store.listRuns(goal.id);
    expect(runs.filter((row) => row.status === "queued")).toHaveLength(1);
    expect(runs.filter((row) => row.status === "failed")).toHaveLength(2);
  });

  it("settles honestly even when no runtime is left to continue with", async () => {
    const { store, goal, milestones, workspace } = await seedAimWithDataDir();
    const queue = createRunQueue(store, queueDependencies([]));
    const enqueued = await queue.enqueue({ goalId: goal.id, milestoneRef: milestones[0]!.id, workspace, sandbox: "read-only", network: false });
    await store.claimNextQueuedRun({ runId: enqueued.run.id });

    const outcomes = await reconcileInterruptedRuns(store, {
      listLocalAgents: async () => [],
      runLocalAgent,
      routingOverrideForMilestone,
    });
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ disposition: "no_runtime_available", continuationRunId: null });
    // The settle stands: an honest blocked row beats a phantom "agents are working" forever.
    expect((await store.listRuns(goal.id)).find((row) => row.id === enqueued.run.id)?.status).toBe("failed");
  });

  it("runAimAgent reconciles an interrupted run and becomes its continuation's worker", async () => {
    const { store, goal, milestones, workspace } = await seedAimWithDataDir();
    // Orphan the first sub-aim: enqueue + claim, then the worker "dies" without settling.
    const setupQueue = createRunQueue(store, queueDependencies([]));
    const orphan = await setupQueue.enqueue({ goalId: goal.id, milestoneRef: milestones[0]!.id, workspace, sandbox: "read-only", network: false });
    await store.claimNextQueuedRun({ runId: orphan.run.id });

    // `aimcub run <m1>`: wake-time reconciliation queues the continuation, the explicit enqueue
    // then finds the milestone already owned by that queued row — and drains it instead of failing.
    const result = await runAimAgent(
      store,
      { goalId: goal.id, milestoneRef: milestones[0]!.id, workspace, readOnly: true },
      agentDependencies([OK_RUN]),
    );

    expect(result.milestone.id).toBe(milestones[0]!.id);
    expect(result.run.ok).toBe(true);
    const runs = await store.listRuns(goal.id);
    expect(runs).toHaveLength(2);
    expect(runs.find((row) => row.id === orphan.run.id)?.status).toBe("failed");
    expect(runs.find((row) => row.id === result.orchestrationRun.id)?.status).toBe("completed");
    // The run this invocation executed IS the interrupted run's continuation.
    const events = await store.listRunEvents(goal.id);
    expect(events.find((event) => event.run_id === result.orchestrationRun.id && event.type === "run.queued")?.payload)
      .toMatchObject({ resumed_from: orphan.run.id });
  });

  it("a shutdown abort leaves the row running, and the next wake continues it", async () => {
    const { store, goal, milestones, workspace } = await seedAimWithDataDir();
    let abortAll = () => {};
    const dependencies = queueDependencies([{ hang: true }, OK_RUN], (index) => {
      if (index === 0) abortAll();
    });
    const queue = createRunQueue(store, dependencies);
    abortAll = () => queue.abortAllForShutdown();
    const enqueued = await queue.enqueue({ goalId: goal.id, milestoneRef: milestones[0]!.id, workspace, sandbox: "read-only", network: false });

    // The quit: the running child is aborted for shutdown — no settle, no retry, no evidence.
    const drained = await queue.drain({ runId: enqueued.run.id });
    expect(drained).toEqual([]);
    const runs = await store.listRuns(goal.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ id: enqueued.run.id, status: "running" });
    const interruptedEvents = await store.listRunEvents(goal.id);
    expect(interruptedEvents.some((event) => event.run_id === enqueued.run.id && event.type === "evidence.reported")).toBe(false);

    // The relaunch: reconcile settles it and queues the continuation; the drain finishes the work.
    const outcomes = await reconcileInterruptedRuns(store, dependencies);
    expect(outcomes[0]?.disposition).toBe("continued");
    const continuationId = outcomes[0]!.continuationRunId!;
    await queue.drain({ runId: continuationId });
    expect((await store.listRuns(goal.id)).find((row) => row.id === continuationId)?.status).toBe("completed");
  });
});
