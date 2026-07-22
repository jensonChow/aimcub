/**
 * Renderer-side state for the run the cockpit is watching right now.
 *
 * Runs are durable in the store and streamed over `IPC.runLiveEvent`. The headline (which sub-aim,
 * what the agent is doing, whether it is still going) is last-event-wins; alongside it a BOUNDED
 * tail of the raw stream is kept so the run timeline can grow while the run happens, before the
 * batched writer has put those events on disk. The store stays the full history — this buffer is
 * only the part that is not persisted yet, and it is safe to lose on navigation.
 */
import type { LocalAgentEvent, RunLiveEvent } from "../../../shared/ipc";

/** Long enough to cover a chatty run's un-flushed tail; short enough to never grow unbounded. */
export const LIVE_RUN_EVENT_LIMIT = 400;

export interface LiveRunState {
  goalId: string;
  runId: string;
  milestoneId: string;
  status: "running" | "finished";
  /** The latest human-readable line from the runtime. */
  summary: string;
  /** The tool the runtime is inside, when it is inside one. */
  toolName: string | null;
  at: string;
  /** The streamed events of this run so far, oldest first, capped at {@link LIVE_RUN_EVENT_LIMIT}. */
  events: readonly RunLiveEvent[];
  /** Every event ever streamed for this run, including any the cap dropped off the front. */
  eventCount: number;
}

/** A run has settled once the engine reports completion or failure. */
export function isTerminalRunEvent(event: LocalAgentEvent): boolean {
  return event.type === "agent.run.completed" || event.type === "agent.run.failed";
}

function summaryFor(event: LocalAgentEvent, previous: string): string {
  // Message deltas are fragments of an answer, not status: keep the last real status line.
  if (event.type === "agent.message.delta") return previous;
  const summary = event.summary.trim();
  return summary || previous;
}

function toolFor(event: LocalAgentEvent, previous: string | null): string | null {
  if (event.type === "agent.tool.started") return event.toolName ?? (event.summary.trim() || previous);
  if (event.type === "agent.tool.finished" || isTerminalRunEvent(event)) return null;
  return previous;
}

/**
 * Fold one streamed event into the watched-run state. An event for a different run replaces the
 * state outright — the cockpit watches one run at a time, and the newest one wins.
 */
export function applyRunLiveEvent(current: LiveRunState | null, live: RunLiveEvent): LiveRunState {
  const previous = current?.runId === live.runId ? current : null;
  const events = [...(previous?.events ?? []), live];
  return {
    goalId: live.goalId,
    runId: live.runId,
    milestoneId: live.milestoneId,
    status: isTerminalRunEvent(live.event) ? "finished" : "running",
    summary: summaryFor(live.event, previous?.summary ?? ""),
    toolName: toolFor(live.event, previous?.toolName ?? null),
    at: live.at,
    events: events.length > LIVE_RUN_EVENT_LIMIT ? events.slice(-LIVE_RUN_EVENT_LIMIT) : events,
    eventCount: (previous?.eventCount ?? 0) + 1,
  };
}

/** The live run for one sub-aim, or null when nothing is streaming for it. */
export function liveRunForMilestone(live: LiveRunState | null, milestoneId: string): LiveRunState | null {
  return live && live.milestoneId === milestoneId ? live : null;
}
