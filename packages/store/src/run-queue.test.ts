import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { DecompositionOutput } from "@core/types";

import { createJsonFileStore } from "./index";

/**
 * The queue primitives the run orchestrator sits on: the `runs` collection IS the queue, so
 * "enqueue" is a run created with status `queued` and "claim" is one atomic store mutation that
 * flips the oldest queued row to `running`. These tests pin the two properties a queue needs —
 * ordered durable event batches, and a claim that cannot hand the same run to two workers.
 */

const CONTRACT = {
  why: "A local agent can do this step.",
  definition_of_done: "The step is verifiably done.",
  required_evidence: ["A trusted commit."],
  likely_owner: "agent",
  context_gaps: [],
  eval_signal: "A trusted commit matches the artifact path.",
};

const PLAN: DecompositionOutput = {
  goal_summary: "Drain a queue",
  domain: "software",
  rationale: "Two independent steps so both can queue at once.",
  nodes: [
    {
      key: "first",
      title: "First step",
      description: "The first step.",
      est_effort: "s",
      xp_reward: 10,
      decomposition_contract: CONTRACT,
      routing_override: null,
      acceptance_rule: {
        logic: "all",
        threshold: 1,
        completion_mode: "auto",
        clauses: [{ evaluator: "commit_pattern", auto_verifiable: true, match: { path_glob: "first.txt" } }],
      },
    },
    {
      key: "second",
      title: "Second step",
      description: "The second step.",
      est_effort: "s",
      xp_reward: 10,
      decomposition_contract: CONTRACT,
      routing_override: null,
      acceptance_rule: {
        logic: "all",
        threshold: 1,
        completion_mode: "auto",
        clauses: [{ evaluator: "commit_pattern", auto_verifiable: true, match: { path_glob: "second.txt" } }],
      },
    },
  ],
  edges: [],
};

function tempDataDir(): string {
  return mkdtempSync(join(tmpdir(), "aimcub-store-run-queue-"));
}

describe("run queue store primitives", () => {
  it("appends a batch of run events in order, atomically", async () => {
    const store = createJsonFileStore(tempDataDir());
    const { goal, milestones } = await store.createGoal({ title: "Drain a queue", plan: PLAN });
    const run = await store.createRun({
      goalId: goal.id,
      milestoneId: milestones[0]!.id,
      actorKind: "agent",
      status: "queued",
    });

    const appended = await store.appendRunEvents([
      { runId: run.id, type: "run.log", summary: "one" },
      { runId: run.id, type: "tool.started", summary: "two", payload: { tool_name: "shell" } },
      { runId: run.id, type: "tool.finished", summary: "three" },
      // An unknown run is skipped rather than failing the whole batch.
      { runId: "00000000-0000-4000-8000-0000000000ff", type: "run.log", summary: "dropped" },
    ]);

    expect(appended.map((event) => event.summary)).toEqual(["one", "two", "three"]);
    const persisted = (await store.listRunEvents(goal.id)).filter((event) => event.run_id === run.id);
    expect(persisted.map((event) => event.type)).toEqual([
      "run.queued",
      "run.log",
      "tool.started",
      "tool.finished",
    ]);
    expect(persisted[2]!.payload).toMatchObject({ tool_name: "shell" });
  });

  it("appends nothing and touches no lock for an empty batch", async () => {
    const store = createJsonFileStore(tempDataDir());
    expect(await store.appendRunEvents([])).toEqual([]);
  });

  it("claims queued runs oldest-first and returns null when the queue is empty", async () => {
    const dataDir = tempDataDir();
    let tick = 0;
    // A monotonic clock so "oldest" is unambiguous.
    const store = createJsonFileStore(dataDir, { now: () => new Date(1_700_000_000_000 + tick++ * 1_000).toISOString() });
    const { goal, milestones } = await store.createGoal({ title: "Drain a queue", plan: PLAN });
    const first = await store.createRun({ goalId: goal.id, milestoneId: milestones[0]!.id, actorKind: "agent", status: "queued" });
    const second = await store.createRun({ goalId: goal.id, milestoneId: milestones[1]!.id, actorKind: "agent", status: "queued" });

    const claimedFirst = await store.claimNextQueuedRun();
    expect(claimedFirst?.id).toBe(first.id);
    expect(claimedFirst?.status).toBe("running");
    expect(claimedFirst?.started_at).toBeTruthy();

    const claimedSecond = await store.claimNextQueuedRun();
    expect(claimedSecond?.id).toBe(second.id);

    expect(await store.claimNextQueuedRun()).toBeNull();

    const events = await store.listRunEvents(goal.id);
    expect(events.filter((event) => event.run_id === first.id).map((event) => event.type))
      .toEqual(["run.queued", "run.started"]);
  });

  it("honors the goal and run filters", async () => {
    const store = createJsonFileStore(tempDataDir());
    const a = await store.createGoal({ title: "Aim A", plan: PLAN });
    const b = await store.createGoal({ title: "Aim B", plan: PLAN });
    const runA = await store.createRun({ goalId: a.goal.id, milestoneId: a.milestones[0]!.id, actorKind: "agent", status: "queued" });
    const runB1 = await store.createRun({ goalId: b.goal.id, milestoneId: b.milestones[0]!.id, actorKind: "agent", status: "queued" });
    const runB2 = await store.createRun({ goalId: b.goal.id, milestoneId: b.milestones[1]!.id, actorKind: "agent", status: "queued" });

    expect((await store.claimNextQueuedRun({ runId: runB2.id }))?.id).toBe(runB2.id);
    expect((await store.claimNextQueuedRun({ goalId: b.goal.id }))?.id).toBe(runB1.id);
    expect(await store.claimNextQueuedRun({ goalId: b.goal.id })).toBeNull();
    expect((await store.claimNextQueuedRun())?.id).toBe(runA.id);
  });

  it("never hands a more permissive run to a worker claiming at a lower sandbox level", async () => {
    const store = createJsonFileStore(tempDataDir());
    const { goal, milestones } = await store.createGoal({ title: "Drain a queue", plan: PLAN });
    const writing = await store.createRun({
      goalId: goal.id,
      milestoneId: milestones[0]!.id,
      actorKind: "agent",
      status: "queued",
      sandbox: "workspace-write",
      workspaceRoot: "/tmp/some-repo",
    });
    const reading = await store.createRun({
      goalId: goal.id,
      milestoneId: milestones[1]!.id,
      actorKind: "agent",
      status: "queued",
      sandbox: "read-only",
    });

    // A read-only worker skips the older writing run entirely rather than "upgrading" itself.
    expect((await store.claimNextQueuedRun({ sandbox: "read-only" }))?.id).toBe(reading.id);
    expect(await store.claimNextQueuedRun({ sandbox: "read-only" })).toBeNull();
    expect((await store.claimNextQueuedRun())?.id).toBe(writing.id);
  });

  it("records the queue request payload on the opening event so another process can execute the run", async () => {
    const store = createJsonFileStore(tempDataDir());
    const { goal, milestones } = await store.createGoal({ title: "Drain a queue", plan: PLAN });
    const run = await store.createRun({
      goalId: goal.id,
      milestoneId: milestones[0]!.id,
      actorKind: "agent",
      status: "queued",
      requestPayload: { agent_id: "codex", attempt: 1 },
    });

    const queued = (await store.listRunEvents(goal.id)).find((event) => event.run_id === run.id && event.type === "run.queued");
    expect(queued?.payload).toMatchObject({ agent_id: "codex", attempt: 1 });
  });

  it("cannot hand one queued run to two racing workers", async () => {
    const dataDir = tempDataDir();
    // Two independent store instances over one data dir stand in for Desktop and the CLI: the
    // cross-process advisory lock, not shared memory, is what makes the claim exclusive.
    const desktop = createJsonFileStore(dataDir);
    const cli = createJsonFileStore(dataDir);
    const { goal, milestones } = await desktop.createGoal({ title: "Drain a queue", plan: PLAN });
    const run = await desktop.createRun({ goalId: goal.id, milestoneId: milestones[0]!.id, actorKind: "agent", status: "queued" });

    const [a, b] = await Promise.all([desktop.claimNextQueuedRun(), cli.claimNextQueuedRun()]);
    const winners = [a, b].filter((claimed) => claimed !== null);
    expect(winners).toHaveLength(1);
    expect(winners[0]!.id).toBe(run.id);

    const runs = await cli.listRuns(goal.id);
    expect(runs.filter((row) => row.status === "running")).toHaveLength(1);
  });
});
