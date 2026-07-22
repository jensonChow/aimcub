import { readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createJsonFileStore } from "@aimcub/store";
import type { DecompositionOutput } from "@aimcub/types";
import type { LocalAgentEvent, LocalAgentRunRequest, LocalAgentRunResult } from "@aimcub/local-agent";

import type { RunLiveEvent } from "../shared/ipc";
import {
  claimConsentedRun,
  createDesktopRunQueue,
  DESKTOP_RUN_PERMISSION,
  enqueueDesktopRun,
  isConsentedEscalation,
  kickRunQueue,
  resolveDesktopRunPermission,
} from "./run-queue";

/**
 * The desktop worker over the shared run queue: enqueue answers immediately with a queued run,
 * the drain streams every normalized event out on the live channel, and the store ends up holding
 * the whole run. Electron is never imported — the transport is injected.
 */

vi.mock("./local-agents", () => ({
  async listLocalAgents() {
    return [{
      id: "fake",
      name: "Fake Runtime",
      runMode: "local_cli",
      available: true,
      path: "/tmp/fake-runtime",
      version: "1.0.0",
      authStatus: "ok",
      authMessage: null,
      models: [{ id: "fake-model", label: "Fake Model" }],
      modelsSource: "fallback",
      reasoningOptions: [],
      diagnostics: [],
    }];
  },
  async runLocalAgent(request: LocalAgentRunRequest, options?: { onEvent?: (event: unknown) => Promise<void> }) {
    spawnedRequests.push(request);
    const events: LocalAgentEvent[] = [
      { type: "agent.run.started", summary: "Fake Runtime started." },
      { type: "agent.tool.started", summary: "read", toolName: "read" },
      { type: "agent.tool.finished", summary: "read", toolName: "read" },
      { type: "agent.run.completed", summary: "Local agent run completed." },
    ];
    for (const event of events) await options?.onEvent?.(event);
    return {
      ok: true,
      agentId: request.agentId,
      command: "/tmp/fake-runtime",
      args: [],
      events,
      outputText: "Read the sub-aim and reported.",
      exitCode: 0,
      error: null,
      failure: null,
      durationMs: 5,
    } satisfies LocalAgentRunResult as LocalAgentRunResult;
  },
}));

const spawnedRequests: LocalAgentRunRequest[] = [];

const CONTRACT = {
  why: "A local agent can inspect this.",
  definition_of_done: "The sub-aim is inspected and reported.",
  required_evidence: ["A written report."],
  likely_owner: "agent" as const,
  context_gaps: [],
  eval_signal: "A report exists for the sub-aim.",
};

const PLAN: DecompositionOutput = {
  goal_summary: "Stream a run to the cockpit",
  domain: "software",
  rationale: "One agent-owned step is enough to stream.",
  nodes: [{
    key: "first",
    title: "Inspect the repository",
    description: "Look at what is there.",
    est_effort: "s",
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
      clauses: [{ evaluator: "commit_pattern" as const, auto_verifiable: true, match: { path_glob: "report.md" } }],
    },
  }],
  edges: [],
};

async function seedAim() {
  const store = createJsonFileStore(mkdtempSync(join(tmpdir(), "aimcub-desktop-queue-")));
  const { goal, milestones } = await store.createGoal({ title: "Stream a run to the cockpit", plan: PLAN });
  return { store, goal, milestone: milestones[0]! };
}

describe("desktop run queue", () => {
  it("enqueues without executing, so the IPC handler can answer immediately", async () => {
    const { store, goal, milestone } = await seedAim();
    const queue = createDesktopRunQueue(store, () => {});

    const runId = await enqueueDesktopRun(queue, { goalId: goal.id, milestoneId: milestone.id });

    const runs = await store.listRuns(goal.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      id: runId,
      status: "queued",
      milestone_id: milestone.id,
      // Desktop never grants a workspace or the network implicitly.
      workspace_root: null,
      sandbox: "read-only",
      network_enabled: false,
    });
    expect(queue.activeRunIds()).toEqual([]);
  });

  it("streams every normalized event of a worker-executed run on the live channel", async () => {
    const { store, goal, milestone } = await seedAim();
    const live: RunLiveEvent[] = [];
    const queue = createDesktopRunQueue(store, (event) => live.push(event));
    const runId = await enqueueDesktopRun(queue, { goalId: goal.id, milestoneId: milestone.id });

    await queue.drain();

    expect(live.map((entry) => entry.event.type)).toEqual([
      "agent.run.started",
      "agent.tool.started",
      "agent.tool.finished",
      "agent.run.completed",
    ]);
    expect(live.every((entry) => entry.runId === runId && entry.goalId === goal.id)).toBe(true);
    expect(live.every((entry) => entry.milestoneId === milestone.id)).toBe(true);
    expect(live.every((entry) => typeof entry.at === "string" && entry.at.length > 0)).toBe(true);

    // The same run is durably recorded, not only streamed.
    const runs = await store.listRuns(goal.id);
    expect(runs[0]?.status).toBe("completed");
    expect((await store.listRunEvents(goal.id)).map((event) => event.type)).toEqual([
      "run.queued",
      "run.started",
      "run.log",
      "tool.started",
      "tool.finished",
      "run.log",
      "evidence.reported",
      "run.completed",
    ]);
    expect(await store.listEvidence(goal.id)).toHaveLength(1);
  });

  it("passes the desktop permission floor down to the runtime", async () => {
    spawnedRequests.length = 0;
    const { store, goal, milestone } = await seedAim();
    const queue = createDesktopRunQueue(store, () => {});
    await enqueueDesktopRun(queue, { goalId: goal.id, milestoneId: milestone.id, instruction: "Summarize only." });
    await queue.drain();

    expect(spawnedRequests).toHaveLength(1);
    expect(spawnedRequests[0]).toMatchObject({
      agentId: "fake",
      model: "fake-model",
      permission: { sandbox: DESKTOP_RUN_PERMISSION.sandbox, network: DESKTOP_RUN_PERMISSION.network },
    });
    expect(spawnedRequests[0]?.cwd).toBeUndefined();
    expect(spawnedRequests[0]?.prompt).toContain("User instruction: Summarize only.");
  });

  it("drains runs left queued by a previous session", async () => {
    const { store, goal, milestone } = await seedAim();
    // A "previous session" queued this and exited without draining.
    const producer = createDesktopRunQueue(store, () => {});
    await enqueueDesktopRun(producer, { goalId: goal.id, milestoneId: milestone.id });

    const resumed = createDesktopRunQueue(store, () => {});
    kickRunQueue(resumed);
    await resumed.drain({ sandbox: DESKTOP_RUN_PERMISSION.sandbox });

    expect((await store.listRuns(goal.id))[0]?.status).toBe("completed");
  });

  it("leaves a workspace-write run queued for the surface that asked for the permission", async () => {
    const { store, goal, milestone } = await seedAim();
    // A CLI-style run: an explicit workspace, write permission. Desktop never granted that.
    const cliRun = await store.createRun({
      goalId: goal.id,
      milestoneId: milestone.id,
      actorKind: "agent",
      status: "queued",
      workspaceRoot: "/tmp/some-repo",
      sandbox: "workspace-write",
      model: "fake-model",
      requestPayload: { agent_id: "fake", attempt: 1 },
    });

    const queue = createDesktopRunQueue(store, () => {});
    kickRunQueue(queue);
    await queue.drain({ sandbox: DESKTOP_RUN_PERMISSION.sandbox });

    expect((await store.listRuns(goal.id)).find((run) => run.id === cliRun.id)?.status).toBe("queued");
  });

  it("never lets the background drain pick up a workspace-write run this session did not consent to", async () => {
    const { store, goal, milestone } = await seedAim();
    const workspace = mkdtempSync(join(tmpdir(), "aimcub-desktop-consent-"));
    // A previous desktop session's consented run, left queued when that window closed. The consent
    // died with the session, so the background drain must not resurrect it.
    const stranded = await enqueueDesktopRun(createDesktopRunQueue(store, () => {}), {
      goalId: goal.id,
      milestoneId: milestone.id,
      permission: { sandbox: "workspace-write", network: true, workspace },
    });

    const resumed = createDesktopRunQueue(store, () => {});
    kickRunQueue(resumed);
    await resumed.drain({ sandbox: DESKTOP_RUN_PERMISSION.sandbox });

    expect((await store.listRuns(goal.id)).find((run) => run.id === stranded)?.status).toBe("queued");
  });

  it("records the consented permission and executes it by run id, at the sandbox the user chose", async () => {
    spawnedRequests.length = 0;
    const { store, goal, milestone } = await seedAim();
    const workspace = mkdtempSync(join(tmpdir(), "aimcub-desktop-workspace-"));
    const queue = createDesktopRunQueue(store, () => {});

    const runId = await enqueueDesktopRun(queue, {
      goalId: goal.id,
      milestoneId: milestone.id,
      permission: { sandbox: "workspace-write", network: true, workspace },
    });

    // The consent is on the queued row before anything executes.
    expect((await store.listRuns(goal.id))[0]).toMatchObject({
      id: runId,
      status: "queued",
      sandbox: "workspace-write",
      network_enabled: true,
      workspace_root: workspace,
    });

    // Claim-by-id is the only path that runs it — the same move the CLI makes for `--workspace`.
    claimConsentedRun(queue, runId);
    await queue.drain({ runId });

    expect((await store.listRuns(goal.id))[0]?.status).toBe("completed");
    expect(spawnedRequests).toHaveLength(1);
    expect(spawnedRequests[0]).toMatchObject({
      cwd: workspace,
      permission: { sandbox: "workspace-write", network: true },
    });
  });

  it("resolves renderer consent into what main is willing to record", () => {
    const workspace = mkdtempSync(join(tmpdir(), "aimcub-desktop-resolve-"));

    expect(resolveDesktopRunPermission(undefined)).toEqual({ sandbox: "read-only", network: false, workspace: null });
    // A read-only run never carries a workspace, even when the renderer sends one.
    expect(resolveDesktopRunPermission({ sandbox: "read-only", network: true, workspace }))
      .toEqual({ sandbox: "read-only", network: true, workspace: null });
    expect(resolveDesktopRunPermission({ sandbox: "workspace-write", network: false, workspace }))
      .toEqual({ sandbox: "workspace-write", network: false, workspace });

    // The renderer is not the security boundary: main rejects what the UI never offers.
    expect(() => resolveDesktopRunPermission({ sandbox: "danger-full-access" as never, network: false }))
      .toThrow(/does not grant/);
    expect(() => resolveDesktopRunPermission({ sandbox: "workspace-write", network: false }))
      .toThrow(/Choose the folder/);
    expect(() => resolveDesktopRunPermission({ sandbox: "workspace-write", network: false, workspace: "relative/path" }))
      .toThrow(/absolute folder path/);
    expect(() => resolveDesktopRunPermission({ sandbox: "workspace-write", network: false, workspace: join(workspace, "nope") }))
      .toThrow(/not a folder/);
  });

  it("treats anything above the read-only, network-off floor as a consented escalation", () => {
    expect(isConsentedEscalation({ sandbox: "read-only", network: false })).toBe(false);
    expect(isConsentedEscalation({ sandbox: "read-only", network: true })).toBe(true);
    expect(isConsentedEscalation({ sandbox: "workspace-write", network: false })).toBe(true);
  });

  it("kicks the queue without awaiting it and swallows nothing", async () => {
    const { store, goal, milestone } = await seedAim();
    const queue = createDesktopRunQueue(store, () => {});
    await enqueueDesktopRun(queue, { goalId: goal.id, milestoneId: milestone.id });

    kickRunQueue(queue);
    // The kick returns synchronously; joining the same drain pass is how a caller waits.
    await queue.drain({ sandbox: DESKTOP_RUN_PERMISSION.sandbox });

    expect((await store.listRuns(goal.id))[0]?.status).toBe("completed");
  });

  it("wires the run IPC as enqueue-and-return plus cancel, with no inline execution", () => {
    const source = readFileSync(new URL("./ipc.ts", import.meta.url), "utf8");

    expect(source).toContain("const runId = await enqueueDesktopRun(runQueue, {");
    expect(source).toContain("kickRunQueue(runQueue);");
    expect(source).toContain("return { ok: true, runId, error: null, permission };");
    expect(source).toContain("ipcMain.handle(IPC.cancelRun, (_e, runId: string): boolean => runQueue.cancel(runId));");
    // Live events reach every window: a background drain has no originating sender.
    expect(source).toContain("window.webContents.send(IPC.runLiveEvent, payload);");
    // The old inline pipeline is gone from the handler.
    expect(source).not.toContain("aimStore.finishRun");
  });

  it("routes a consented escalation through claim-by-id and everything else through the floor drain", () => {
    const source = readFileSync(new URL("./ipc.ts", import.meta.url), "utf8");

    // Renderer input is resolved before it is recorded, and a widened grant only ever executes via
    // its own run id — the broad drain stays scoped to the read-only floor.
    expect(source).toContain("const permission = resolveDesktopRunPermission(req.permission);");
    expect(source).toContain("if (isConsentedEscalation(permission)) claimConsentedRun(runQueue, runId);");
    expect(source).toContain("else kickRunQueue(runQueue);");

    const queueSource = readFileSync(new URL("./run-queue.ts", import.meta.url), "utf8");
    expect(queueSource).toContain("queue.drain({ sandbox: DESKTOP_RUN_PERMISSION.sandbox })");
    expect(queueSource).toContain("queue.drain({ runId })");
    // The only two drains the desktop worker performs, and neither can be widened: one is pinned
    // to the floor constant, the other is a single run id.
    expect([...queueSource.matchAll(/\.drain\(\{[^}]*\}\)/g)].map(([call]) => call)).toEqual([
      ".drain({ sandbox: DESKTOP_RUN_PERMISSION.sandbox })",
      ".drain({ runId })",
    ]);
  });

  it("keeps cancellation working for a consented run", async () => {
    const { store, goal, milestone } = await seedAim();
    const workspace = mkdtempSync(join(tmpdir(), "aimcub-desktop-cancel-"));
    const queue = createDesktopRunQueue(store, () => {});
    const runId = await enqueueDesktopRun(queue, {
      goalId: goal.id,
      milestoneId: milestone.id,
      permission: { sandbox: "workspace-write", network: false, workspace },
    });

    // Nothing is executing yet, so there is no controller to abort — cancel says so honestly.
    expect(queue.cancel(runId)).toBe(false);
    await queue.drain({ runId });
    expect((await store.listRuns(goal.id))[0]?.status).toBe("completed");
  });
});
