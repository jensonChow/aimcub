/**
 * Renderer-side state for the run the cockpit is watching right now.
 *
 * Runs are durable in the store and streamed over `IPC.runLiveEvent`; this reduces that stream to
 * the little the Execute stage shows — which sub-aim, what the agent is doing, and whether it is
 * still going. It is deliberately last-event-wins rather than a transcript: the run journal
 * already holds the full history, read from persisted events.
 */
import type { LocalAgentEvent, RunLiveEvent } from "../../../shared/ipc";

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
  return {
    goalId: live.goalId,
    runId: live.runId,
    milestoneId: live.milestoneId,
    status: isTerminalRunEvent(live.event) ? "finished" : "running",
    summary: summaryFor(live.event, previous?.summary ?? ""),
    toolName: toolFor(live.event, previous?.toolName ?? null),
    at: live.at,
  };
}

/** The live run for one sub-aim, or null when nothing is streaming for it. */
export function liveRunForMilestone(live: LiveRunState | null, milestoneId: string): LiveRunState | null {
  return live && live.milestoneId === milestoneId ? live : null;
}
