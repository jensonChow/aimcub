import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Run, RunEvent } from "@aimcub/types";

import type { RunLiveEvent } from "../../../shared/ipc";
import { I18nProvider } from "../../i18n";
import { RunTimelinePanel } from "./RunTimelinePanel";
import {
  buildRunTimeline,
  isSettledRunStatus,
  runTimelineKind,
  runTimelineRowFromLiveEvent,
} from "./runTimeline";
import {
  DEFAULT_RUN_PERMISSION_DRAFT,
  isRunPermissionEscalated,
  isRunPermissionReady,
  runPermissionBlockedReason,
  runPermissionRequest,
  RUN_SANDBOX_OPTIONS,
  shortWorkspacePath,
} from "./runPermissions";

const OWNER = "00000000-0000-4000-8000-000000000001";
const GOAL = "00000000-0000-4000-8000-000000000010";
const MILESTONE = "00000000-0000-4000-8000-000000000020";
const OTHER_MILESTONE = "00000000-0000-4000-8000-000000000021";

function run(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    owner_id: OWNER,
    goal_id: GOAL,
    milestone_id: MILESTONE,
    assignment_id: null,
    actor_kind: "agent",
    actor_id: null,
    kind: "agent",
    status: "completed",
    attempt: 1,
    workspace_root: null,
    sandbox: "read-only",
    network_enabled: false,
    model: "fake-model",
    reasoning: null,
    summary: "",
    error: null,
    queued_at: "2026-07-22T10:00:00.000Z",
    started_at: "2026-07-22T10:00:01.000Z",
    finished_at: "2026-07-22T10:00:09.000Z",
    created_at: "2026-07-22T10:00:00.000Z",
    ...overrides,
  } as Run;
}

function event(overrides: Partial<RunEvent> & { id: string; type: string; created_at: string }): RunEvent {
  return {
    owner_id: OWNER,
    run_id: "run-1",
    summary: "",
    payload: {},
    ...overrides,
  } as RunEvent;
}

/**
 * A persisted stream that deliberately contains an event type this build has no label for. The
 * parallel artifact work adds new types; the timeline must render them, not drop or crash on them.
 */
const PERSISTED: RunEvent[] = [
  event({ id: "e1", type: "run.queued", summary: "Fake Runtime queued: Inspect the repo.", created_at: "2026-07-22T10:00:00.000Z" }),
  event({ id: "e2", type: "run.started", summary: "Fake Runtime started.", created_at: "2026-07-22T10:00:01.000Z" }),
  event({
    id: "e3",
    type: "tool.started",
    summary: "read",
    payload: { tool_name: "read" },
    created_at: "2026-07-22T10:00:02.000Z",
  }),
  event({
    id: "e4",
    type: "tool.finished",
    summary: "read",
    payload: { tool_name: "read" },
    created_at: "2026-07-22T10:00:04.500Z",
  }),
  event({ id: "e5", type: "run.log", summary: "Thinking about the repo.", created_at: "2026-07-22T10:00:05.000Z" }),
  event({
    id: "e6",
    type: "artifact.created" as RunEvent["type"],
    summary: "report.md",
    created_at: "2026-07-22T10:00:06.000Z",
  }),
  event({
    // Not in this build's table at all — the forward-compatibility case.
    id: "e7",
    type: "sandbox.escaped.hypothetically" as RunEvent["type"],
    summary: "Something new happened.",
    created_at: "2026-07-22T10:00:07.000Z",
  }),
  event({ id: "e8", type: "run.completed", summary: "Local agent run completed.", created_at: "2026-07-22T10:00:09.000Z" }),
];

describe("run timeline", () => {
  it("groups a sub-aim's persisted events into one run entry, in order", () => {
    const [entry, ...rest] = buildRunTimeline({ runEvents: PERSISTED, runs: [run()], milestoneId: MILESTONE });

    expect(rest).toHaveLength(0);
    expect(entry).toMatchObject({ runId: "run-1", status: "completed", sandbox: "read-only", network: false });
    expect(entry?.rows.map((row) => row.type)).toEqual([
      "run.queued",
      "run.started",
      "tool.started",
      "tool.finished",
      "run.log",
      "artifact.created",
      "sandbox.escaped.hypothetically",
      "run.completed",
    ]);
  });

  it("renders an unknown event type generically instead of dropping it", () => {
    const entry = buildRunTimeline({ runEvents: PERSISTED, runs: [run()], milestoneId: MILESTONE })[0]!;
    const unknown = entry.rows.find((row) => row.type === "sandbox.escaped.hypothetically");

    expect(unknown).toMatchObject({ kind: "other", summary: "Something new happened.", at: "2026-07-22T10:00:07.000Z" });
    // Known-but-new types still get their own family rather than falling into `other`.
    expect(runTimelineKind("artifact.created")).toBe("artifact");
    expect(runTimelineKind("evidence.reported")).toBe("evidence");
    expect(runTimelineKind("something.nobody.has.written.yet")).toBe("other");
  });

  it("pairs tool start/finish and leaves an unfinished tool pending", () => {
    const entry = buildRunTimeline({ runEvents: PERSISTED, runs: [run()], milestoneId: MILESTONE })[0]!;
    expect(entry.rows.find((row) => row.type === "tool.started")).toMatchObject({
      toolName: "read",
      durationMs: 2500,
      pending: false,
    });

    const cancelled = buildRunTimeline({
      runEvents: PERSISTED.slice(0, 3),
      runs: [run({ status: "cancelled" })],
      milestoneId: MILESTONE,
    })[0]!;
    expect(cancelled.rows.find((row) => row.type === "tool.started")?.pending).toBe(true);
  });

  it("shows the retry linkage the queue writes on a retried attempt", () => {
    const retry = event({
      id: "r1",
      type: "run.log",
      run_id: "run-2",
      summary: "Retry 1 of 1 after a retryable failure: timeout",
      payload: { retry_of: "run-1", attempt: 2, failure_code: "timeout" },
      created_at: "2026-07-22T10:01:00.000Z",
    });
    const entries = buildRunTimeline({
      runEvents: [...PERSISTED, retry],
      runs: [run(), run({ id: "run-2", attempt: 2, queued_at: "2026-07-22T10:01:00.000Z", status: "completed" })],
      milestoneId: MILESTONE,
    });

    // Newest first.
    expect(entries.map((entry) => entry.runId)).toEqual(["run-2", "run-1"]);
    expect(entries[0]).toMatchObject({ attempt: 2, retryOf: "run-1" });
    expect(entries[0]?.rows[0]?.kind).toBe("retry");
  });

  it("carries the enqueuing surface from the queued event onto the run entry", () => {
    const withSurface = [
      event({ id: "s1", type: "run.queued", summary: "Fake Runtime queued.", payload: { surface: "cli" }, created_at: "2026-07-22T10:00:00.000Z" }),
      event({ id: "s2", type: "run.completed", summary: "Local agent run completed.", created_at: "2026-07-22T10:00:09.000Z" }),
    ];
    const entry = buildRunTimeline({ runEvents: withSurface, runs: [run()], milestoneId: MILESTONE })[0]!;
    expect(entry.surface).toBe("cli");
  });

  it("reads a run queued before the surface field existed as unknown provenance, not an error", () => {
    const entry = buildRunTimeline({ runEvents: PERSISTED, runs: [run()], milestoneId: MILESTONE })[0]!;
    expect(entry.surface).toBeNull();
  });

  it("ignores runs belonging to a different sub-aim", () => {
    const entries = buildRunTimeline({
      runEvents: PERSISTED,
      runs: [run({ milestone_id: OTHER_MILESTONE })],
      milestoneId: MILESTONE,
    });
    expect(entries).toEqual([]);
  });

  it("appends only the not-yet-persisted tail of the live stream", () => {
    const liveEvents: RunLiveEvent[] = [
      { goalId: GOAL, runId: "run-1", milestoneId: MILESTONE, at: "2026-07-22T10:00:01.000Z", event: { type: "agent.run.started", summary: "Fake Runtime started." } },
      { goalId: GOAL, runId: "run-1", milestoneId: MILESTONE, at: "2026-07-22T10:00:02.000Z", event: { type: "agent.tool.started", summary: "read", toolName: "read" } },
      { goalId: GOAL, runId: "run-1", milestoneId: MILESTONE, at: "2026-07-22T10:00:03.000Z", event: { type: "agent.raw", summary: "Not flushed yet." } },
    ];
    // Two events are already on disk; only the third should be appended.
    const entry = buildRunTimeline({
      runEvents: PERSISTED.slice(0, 2),
      runs: [run({ status: "running" })],
      milestoneId: MILESTONE,
      liveEvents,
      liveRunId: "run-1",
    })[0]!;

    expect(entry.live).toBe(true);
    expect(entry.rows).toHaveLength(3);
    expect(entry.rows[2]).toMatchObject({ type: "run.log", summary: "Not flushed yet.", live: true });
  });

  it("keeps the live tail aligned when the buffer's cap dropped its head", () => {
    const liveEvents: RunLiveEvent[] = [
      { goalId: GOAL, runId: "run-1", milestoneId: MILESTONE, at: "2026-07-22T10:00:03.000Z", event: { type: "agent.raw", summary: "Not flushed yet." } },
    ];
    // Two events persisted, two dropped off the buffer's front: the one live row is still new.
    const entry = buildRunTimeline({
      runEvents: PERSISTED.slice(0, 2),
      runs: [run({ status: "running" })],
      milestoneId: MILESTONE,
      liveEvents,
      liveRunId: "run-1",
      liveEventsDropped: 2,
    })[0]!;

    expect(entry.rows).toHaveLength(3);
    expect(entry.rows[2]?.summary).toBe("Not flushed yet.");
  });

  it("shows a run that exists only as a live stream", () => {
    const entry = buildRunTimeline({
      runEvents: [],
      runs: [run({ id: "run-9", status: "queued" })],
      milestoneId: MILESTONE,
      liveEvents: [{
        goalId: GOAL,
        runId: "run-9",
        milestoneId: MILESTONE,
        at: "2026-07-22T10:00:00.000Z",
        event: { type: "agent.run.started", summary: "Just started." },
      }],
      liveRunId: "run-9",
    })[0]!;

    expect(entry.rows).toHaveLength(1);
    expect(entry.live).toBe(true);
  });

  it("mirrors the orchestrator's normalization for live rows", () => {
    const base = { goalId: GOAL, runId: "run-1", milestoneId: MILESTONE, at: "2026-07-22T10:00:00.000Z" };
    expect(runTimelineRowFromLiveEvent({ ...base, event: { type: "agent.tool.started", summary: "read", toolName: "read" } }, 0))
      .toMatchObject({ type: "tool.started", toolName: "read", pending: true });
    expect(runTimelineRowFromLiveEvent({ ...base, event: { type: "agent.stderr", summary: "warn" } }, 1))
      .toMatchObject({ type: "run.log", kind: "log" });
    // Answer fragments are not status, exactly as the orchestrator records them.
    expect(runTimelineRowFromLiveEvent({ ...base, event: { type: "agent.message.delta", summary: "half a sen" } }, 2).summary)
      .toBe("Agent response updated.");
  });

  it("treats only recorded end states as settled", () => {
    expect(isSettledRunStatus("completed")).toBe(true);
    expect(isSettledRunStatus("failed")).toBe(true);
    expect(isSettledRunStatus("cancelled")).toBe(true);
    expect(isSettledRunStatus("running")).toBe(false);
    expect(isSettledRunStatus("something-new")).toBe(false);
  });

  it("renders the whole fixture, unknown event type included, without throwing", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <RunTimelinePanel milestoneId={MILESTONE} runEvents={PERSISTED} runs={[run()]} />
      </I18nProvider>,
    );

    expect(html).toContain('data-od-id="run-timeline"');
    expect(html).toContain("Run 1");
    expect(html).toContain("Local agent run completed.");
    // The unknown type is labeled generically and its raw type is shown so the row stays readable.
    expect(html).toContain("Something new happened.");
    expect(html).toContain("sandbox.escaped.hypothetically");
    expect(html).toContain("Sandbox read-only");
  });

  it("shows which surface queued the run in the timeline meta line", () => {
    const withSurface = [
      event({ id: "s1", type: "run.queued", summary: "Fake Runtime queued.", payload: { surface: "cli" }, created_at: "2026-07-22T10:00:00.000Z" }),
      event({ id: "s2", type: "run.completed", summary: "Local agent run completed.", created_at: "2026-07-22T10:00:09.000Z" }),
    ];
    const html = renderToStaticMarkup(
      <I18nProvider>
        <RunTimelinePanel milestoneId={MILESTONE} runEvents={withSurface} runs={[run()]} />
      </I18nProvider>,
    );
    expect(html).toContain("Queued by CLI");
  });

  it("renders an honest empty state when a sub-aim has never run", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <RunTimelinePanel milestoneId={MILESTONE} runEvents={[]} runs={[]} />
      </I18nProvider>,
    );
    expect(html).toContain("No runs recorded for this sub-aim yet.");
  });
});

describe("run permission consent", () => {
  it("defaults to look-don't-touch with no network", () => {
    expect(DEFAULT_RUN_PERMISSION_DRAFT).toEqual({ sandbox: "read-only", network: false, workspace: null });
    expect(isRunPermissionEscalated(DEFAULT_RUN_PERMISSION_DRAFT)).toBe(false);
    expect(isRunPermissionReady(DEFAULT_RUN_PERMISSION_DRAFT)).toBe(true);
    expect(runPermissionRequest(DEFAULT_RUN_PERMISSION_DRAFT)).toEqual({
      sandbox: "read-only",
      network: false,
      workspace: null,
    });
  });

  it("never offers danger-full-access", () => {
    expect(RUN_SANDBOX_OPTIONS).toEqual(["read-only", "workspace-write"]);
  });

  it("blocks a workspace-write grant until a folder is chosen", () => {
    const draft = { sandbox: "workspace-write" as const, network: false, workspace: null };
    expect(runPermissionBlockedReason(draft)).toBe("workspace_required");
    expect(isRunPermissionReady(draft)).toBe(false);
    expect(isRunPermissionReady({ ...draft, workspace: "/tmp/repo" })).toBe(true);
  });

  it("drops a workspace from a read-only request even when one was picked earlier", () => {
    expect(runPermissionRequest({ sandbox: "read-only", network: true, workspace: "/tmp/repo" })).toEqual({
      sandbox: "read-only",
      network: true,
      workspace: null,
    });
  });

  it("shortens a long folder path from the front, keeping the leaf visible", () => {
    expect(shortWorkspacePath("/tmp/repo")).toBe("/tmp/repo");
    const long = shortWorkspacePath("/Users/someone/very/deeply/nested/projects/aimcub-workspace", 24);
    expect(long).toHaveLength(24);
    expect(long.endsWith("aimcub-workspace")).toBe(true);
  });
});
