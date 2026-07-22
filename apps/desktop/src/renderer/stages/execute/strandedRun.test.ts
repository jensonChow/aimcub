import { describe, expect, it } from "vitest";

import type { Run } from "@core/types";

import { strandedRunFor } from "./strandedRun";

function run(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    owner_id: "owner-1",
    goal_id: "goal-1",
    milestone_id: "milestone-1",
    assignment_id: null,
    actor_kind: "agent",
    actor_id: null,
    kind: "agent",
    status: "queued",
    attempt: 1,
    workspace_root: "/Users/jenson/repo",
    sandbox: "workspace-write",
    network_enabled: false,
    model: null,
    reasoning: null,
    summary: "",
    error: null,
    queued_at: "2026-07-20T00:00:00.000Z",
    started_at: null,
    finished_at: null,
    created_at: "2026-07-20T00:00:00.000Z",
    ...overrides,
  } as Run;
}

describe("strandedRunFor", () => {
  it("surfaces a queued workspace-write run this session did not enqueue", () => {
    const stranded = strandedRunFor({
      runs: [run()],
      milestoneId: "milestone-1",
      sessionRunIds: new Set(),
    });

    expect(stranded).toEqual({
      runId: "run-1",
      sandbox: "workspace-write",
      network: false,
      workspaceRoot: "/Users/jenson/repo",
    });
  });

  it("ignores a run this session itself queued, so a freshly granted run never flashes as stranded", () => {
    const stranded = strandedRunFor({
      runs: [run()],
      milestoneId: "milestone-1",
      sessionRunIds: new Set(["run-1"]),
    });

    expect(stranded).toBeNull();
  });

  it("ignores runs at the read-only floor — the background drain already covers those", () => {
    const stranded = strandedRunFor({
      runs: [run({ sandbox: "read-only" })],
      milestoneId: "milestone-1",
      sessionRunIds: new Set(),
    });

    expect(stranded).toBeNull();
  });

  it("ignores a run that is not queued (already running, completed, or cancelled)", () => {
    for (const status of ["running", "completed", "failed", "cancelled", "blocked"] as const) {
      expect(strandedRunFor({
        runs: [run({ status })],
        milestoneId: "milestone-1",
        sessionRunIds: new Set(),
      })).toBeNull();
    }
  });

  it("ignores runs queued for a different sub-aim", () => {
    const stranded = strandedRunFor({
      runs: [run({ milestone_id: "milestone-2" })],
      milestoneId: "milestone-1",
      sessionRunIds: new Set(),
    });

    expect(stranded).toBeNull();
  });

  it("picks the most recently queued candidate when more than one qualifies", () => {
    const stranded = strandedRunFor({
      runs: [
        run({ id: "run-old", queued_at: "2026-07-19T00:00:00.000Z" }),
        run({ id: "run-new", queued_at: "2026-07-21T00:00:00.000Z" }),
      ],
      milestoneId: "milestone-1",
      sessionRunIds: new Set(),
    });

    expect(stranded?.runId).toBe("run-new");
  });

  it("carries the network grant and a null workspace root through honestly", () => {
    const stranded = strandedRunFor({
      runs: [run({ network_enabled: true, workspace_root: null })],
      milestoneId: "milestone-1",
      sessionRunIds: new Set(),
    });

    expect(stranded).toEqual({
      runId: "run-1",
      sandbox: "workspace-write",
      network: true,
      workspaceRoot: null,
    });
  });
});
