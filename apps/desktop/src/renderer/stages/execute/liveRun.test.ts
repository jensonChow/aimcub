import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { LocalAgentEvent, RunLiveEvent } from "../../../shared/ipc";
import { applyRunLiveEvent, isTerminalRunEvent, liveRunForMilestone, type LiveRunState } from "./liveRun";

function live(event: LocalAgentEvent, overrides: Partial<RunLiveEvent> = {}): RunLiveEvent {
  return {
    goalId: "goal-1",
    runId: "run-1",
    milestoneId: "milestone-1",
    at: "2026-07-21T00:00:00.000Z",
    event,
    ...overrides,
  };
}

function fold(events: readonly RunLiveEvent[]): LiveRunState | null {
  return events.reduce<LiveRunState | null>((state, entry) => applyRunLiveEvent(state, entry), null);
}

describe("live run state", () => {
  it("tracks the runtime's current step and settles on a terminal event", () => {
    const running = fold([
      live({ type: "agent.run.started", summary: "Codex started." }),
      live({ type: "agent.tool.started", summary: "shell", toolName: "shell" }),
    ]);
    expect(running).toMatchObject({ runId: "run-1", status: "running", toolName: "shell" });

    const settled = applyRunLiveEvent(running, live({ type: "agent.run.completed", summary: "Local agent run completed." }));
    expect(settled).toMatchObject({ status: "finished", toolName: null, summary: "Local agent run completed." });
  });

  it("keeps the last status line instead of showing answer fragments", () => {
    const state = fold([
      live({ type: "agent.run.started", summary: "Codex started." }),
      live({ type: "agent.message.delta", summary: "I looked at " }),
      live({ type: "agent.message.delta", summary: "the repository." }),
    ]);
    expect(state?.summary).toBe("Codex started.");
    expect(state?.status).toBe("running");
  });

  it("switches wholesale to a newer run rather than blending two", () => {
    const first = fold([live({ type: "agent.tool.started", summary: "shell", toolName: "shell" })]);
    const second = applyRunLiveEvent(first, live({ type: "agent.run.started", summary: "Second run." }, { runId: "run-2" }));

    expect(second).toMatchObject({ runId: "run-2", summary: "Second run.", toolName: null });
  });

  it("shows a live run only against its own sub-aim", () => {
    const state = fold([live({ type: "agent.run.started", summary: "Codex started." })])!;
    expect(liveRunForMilestone(state, "milestone-1")).toBe(state);
    expect(liveRunForMilestone(state, "milestone-2")).toBeNull();
    expect(liveRunForMilestone(null, "milestone-1")).toBeNull();
  });

  it("treats completion and failure as terminal, and nothing else", () => {
    expect(isTerminalRunEvent({ type: "agent.run.completed", summary: "" })).toBe(true);
    expect(isTerminalRunEvent({ type: "agent.run.failed", summary: "" })).toBe(true);
    expect(isTerminalRunEvent({ type: "agent.stderr", summary: "" })).toBe(false);
  });

  it("is wired into the Execute stage and the App run subscription", () => {
    const panel = readFileSync(new URL("./ExecutePanel.tsx", import.meta.url), "utf8");
    const app = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");

    // The stage renders the live line for the selected sub-aim, with a way to stop the run.
    expect(panel).toContain("liveRunForMilestone(props.liveRun ?? null, selectedRow.milestone.id)");
    expect(panel).toContain('t("execute.cancelRun")');
    // The window subscribes once and refreshes derived progress when a run settles.
    expect(app).toContain("window.aimcub.onRunLiveEvent((live) => {");
    expect(app).toContain("setLiveRun((current) => applyRunLiveEvent(current, live));");
    expect(app).toContain("if (isTerminalRunEvent(live.event)) runFinishedRef.current(live.goalId);");
    expect(app).toContain("onCancelRun={(runId) => void window.aimcub.cancelRun(runId)}");
  });
});
