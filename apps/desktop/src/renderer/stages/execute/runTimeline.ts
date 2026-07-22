/**
 * The per-run timeline the Execute stage shows: what a run actually did, read back from the
 * persisted `RunEvent` stream (the same rows the CLI and the journal read) plus whatever is still
 * streaming live for the run in flight.
 *
 * Forward-compatibility is a hard requirement here. Event types are looked up in a table and
 * NEVER switched on exhaustively: a type this build has never heard of — an `artifact.created`
 * emitted by a newer writer, anything a future adapter adds — still renders as type + summary +
 * time instead of disappearing or crashing the stage. Pure; no i18n, no React.
 */
import type { RunSurface } from "@aimcub/local-agent";
import type { Run, RunEvent } from "@aimcub/types";

import type { LocalAgentEvent, RunLiveEvent } from "../../../shared/ipc";

/** Row families the timeline styles and labels differently. Everything else is `other`. */
export type RunTimelineKind =
  | "queued"
  | "started"
  | "tool"
  | "log"
  | "retry"
  | "artifact"
  | "evidence"
  | "terminal"
  | "other";

export interface RunTimelineRow {
  id: string;
  /** The raw event type, kept verbatim so an unrecognized one can still be shown honestly. */
  type: string;
  kind: RunTimelineKind;
  at: string;
  summary: string;
  toolName: string | null;
  /** Wall time between a tool's start and its finish, when both landed. */
  durationMs: number | null;
  /** A tool that started and has not finished (yet, or ever). */
  pending: boolean;
  /** The run this attempt replaces, on the retry-linkage row the queue writes. */
  retryOf: string | null;
  /** The surface that queued this run, when the enqueue-time row named one. */
  surface: RunSurface | null;
  /** True until the row has been persisted — i.e. it arrived on the live channel. */
  live: boolean;
}

export interface RunTimelineEntry {
  runId: string;
  /** The store's run status when the run row is loaded; `running` for a live-only run. */
  status: string;
  attempt: number;
  /** What the run was allowed to do: the permission recorded at enqueue. */
  sandbox: string;
  network: boolean;
  workspaceRoot: string | null;
  /** Ordering key — the first timestamp the run has, newest run first in the list. */
  at: string;
  /** The earlier attempt this run replaces, when the queue linked one. */
  retryOf: string | null;
  /** Which surface queued this run — provenance only; null for a run queued before this existed. */
  surface: RunSurface | null;
  /** True while events for this run are still arriving on the live channel. */
  live: boolean;
  rows: RunTimelineRow[];
}

const KIND_BY_TYPE: Record<string, RunTimelineKind> = {
  "run.queued": "queued",
  "run.started": "started",
  "tool.started": "tool",
  "tool.finished": "tool",
  "run.log": "log",
  "artifact.created": "artifact",
  "evidence.reported": "evidence",
  "run.completed": "terminal",
  "run.failed": "terminal",
  "run.cancelled": "terminal",
};

/** Table lookup, never an exhaustive switch — an unknown type is a row, not a gap. */
export function runTimelineKind(type: string): RunTimelineKind {
  return KIND_BY_TYPE[type] ?? "other";
}

function readString(payload: Record<string, unknown> | undefined, key: string): string | null {
  const value = payload?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Only ever set on the enqueue-time event's payload; every other row reads null, honestly. */
function readSurface(payload: Record<string, unknown> | undefined): RunSurface | null {
  const value = payload?.["surface"];
  return value === "desktop" || value === "cli" ? value : null;
}

function rowFromEvent(event: RunEvent, index: number): RunTimelineRow {
  const payload = event.payload as Record<string, unknown> | undefined;
  const retryOf = readString(payload, "retry_of");
  const type = String(event.type);
  return {
    id: event.id || `${event.run_id}:${index}`,
    type,
    kind: retryOf ? "retry" : runTimelineKind(type),
    at: event.created_at ?? "",
    summary: event.summary ?? "",
    toolName: readString(payload, "tool_name"),
    durationMs: null,
    pending: type === "tool.started",
    retryOf,
    surface: readSurface(payload),
    live: false,
  };
}

/**
 * The renderer mirror of the orchestrator's normalization (`agent.tool.*` → `tool.*`, everything
 * else → `run.log`), so a live row looks exactly like the persisted row it is about to become and
 * the timeline does not visibly re-sort itself when the run finishes.
 */
export function runTimelineRowFromLiveEvent(live: RunLiveEvent, index: number): RunTimelineRow {
  const event: LocalAgentEvent = live.event;
  const toolName = "toolName" in event && typeof event.toolName === "string" ? event.toolName : null;
  const type = event.type === "agent.tool.started"
    ? "tool.started"
    : event.type === "agent.tool.finished"
      ? "tool.finished"
      : "run.log";
  return {
    id: `live:${live.runId}:${index}`,
    type,
    kind: runTimelineKind(type),
    at: live.at,
    summary: event.type === "agent.message.delta" ? "Agent response updated." : event.summary,
    toolName,
    durationMs: null,
    pending: type === "tool.started",
    retryOf: null,
    surface: null,
    live: true,
  };
}

function parseMs(at: string): number | null {
  const ms = Date.parse(at);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Close each `tool.started` against the next `tool.finished` for the same tool. Unnamed tools pair
 * positionally (a runtime that reports no tool name still produces a readable pair); a start with
 * no finish stays `pending`, which is the honest reading of a run that was cancelled or crashed.
 */
function pairToolRows(rows: RunTimelineRow[]): RunTimelineRow[] {
  const openByTool = new Map<string, number[]>();
  const paired = rows.map((row) => ({ ...row }));
  for (let index = 0; index < paired.length; index += 1) {
    const row = paired[index]!;
    if (row.type === "tool.started") {
      const key = row.toolName ?? "";
      const open = openByTool.get(key) ?? [];
      open.push(index);
      openByTool.set(key, open);
      continue;
    }
    if (row.type !== "tool.finished") continue;
    const key = row.toolName ?? "";
    const open = openByTool.get(key) ?? [];
    const startIndex = open.pop();
    if (startIndex === undefined) continue;
    openByTool.set(key, open);
    const start = paired[startIndex]!;
    start.pending = false;
    const startMs = parseMs(start.at);
    const finishMs = parseMs(row.at);
    if (startMs !== null && finishMs !== null && finishMs >= startMs) {
      start.durationMs = finishMs - startMs;
    }
  }
  return paired;
}

/**
 * Persisted rows first, then the part of the live stream not yet on disk.
 *
 * Persistence is batched and ordered, so the first N events of a run are exactly the N already
 * written. `dropped` is how many the live buffer's cap discarded off the front, so the buffer's
 * element `i` is really event `i + dropped` — without it a long run would show its tail twice.
 */
function mergeLiveRows(persisted: RunTimelineRow[], live: RunTimelineRow[], dropped: number): RunTimelineRow[] {
  if (live.length === 0) return persisted;
  const tail = live.slice(Math.max(0, persisted.length - dropped));
  return [...persisted, ...tail];
}

export interface BuildRunTimelineInput {
  /** The aim's full persisted run-event stream (the `getAimJournal` read). */
  runEvents: readonly RunEvent[];
  /** The aim's run rows, for status and the permission each run was granted. */
  runs: readonly Run[];
  /** Only runs for this sub-aim are shown. */
  milestoneId: string;
  /** Events still streaming for the run the cockpit is watching, oldest first. */
  liveEvents?: readonly RunLiveEvent[];
  /** The run those live events belong to. */
  liveRunId?: string | null;
  /** Events the live buffer's cap dropped off the front, so the merge stays aligned. */
  liveEventsDropped?: number;
}

/**
 * One entry per run of this sub-aim, newest first, each carrying its ordered rows. Runs that exist
 * only as a live stream (enqueued a moment ago, progress not refreshed yet) still get an entry, so
 * the timeline never looks empty while a run is visibly happening.
 */
export function buildRunTimeline(input: BuildRunTimelineInput): RunTimelineEntry[] {
  const runsById = new Map(input.runs.map((run) => [run.id, run]));
  const mine = new Set(
    input.runs.filter((run) => run.milestone_id === input.milestoneId).map((run) => run.id),
  );

  const rowsByRun = new Map<string, RunTimelineRow[]>();
  input.runEvents.forEach((event, index) => {
    if (!mine.has(event.run_id)) return;
    const rows = rowsByRun.get(event.run_id) ?? [];
    rows.push(rowFromEvent(event, index));
    rowsByRun.set(event.run_id, rows);
  });

  const liveRunId = input.liveRunId ?? null;
  const liveRows = liveRunId
    ? (input.liveEvents ?? [])
        .filter((live) => live.runId === liveRunId && live.milestoneId === input.milestoneId)
        .map((live, index) => runTimelineRowFromLiveEvent(live, index))
    : [];
  if (liveRunId && liveRows.length > 0 && !rowsByRun.has(liveRunId)) rowsByRun.set(liveRunId, []);

  const entries: RunTimelineEntry[] = [];
  for (const [runId, rows] of rowsByRun) {
    const run = runsById.get(runId) ?? null;
    const merged = pairToolRows(
      runId === liveRunId ? mergeLiveRows(rows, liveRows, Math.max(0, input.liveEventsDropped ?? 0)) : rows,
    );
    const retryRow = merged.find((row) => row.retryOf);
    const surfaceRow = merged.find((row) => row.surface);
    entries.push({
      runId,
      status: run?.status ?? "running",
      attempt: run?.attempt ?? 1,
      sandbox: run?.sandbox ?? "read-only",
      network: run?.network_enabled ?? false,
      workspaceRoot: run?.workspace_root ?? null,
      at: run?.queued_at || run?.created_at || merged[0]?.at || "",
      retryOf: retryRow?.retryOf ?? null,
      surface: surfaceRow?.surface ?? null,
      live: runId === liveRunId,
      rows: merged,
    });
  }

  return entries.sort((left, right) => (left.at < right.at ? 1 : left.at > right.at ? -1 : 0));
}

/** A run is settled once the store says so — an unknown status reads as still going. */
export function isSettledRunStatus(status: string): boolean {
  return status === "completed" || status === "failed" || status === "cancelled" || status === "blocked";
}
