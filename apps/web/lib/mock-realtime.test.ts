import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockRealtime } from "./mock-realtime";
import { materialize } from "./mock-repo";
import { localDecompose } from "./decompose";
import type { MilestoneCompletedEvent } from "./realtime-port";

const GOAL = "40000000-0000-4000-8000-000000000001";
const OWNER = "00000000-0000-4000-8000-000000000001";

function snapshot() {
  return materialize(localDecompose({ title: "Demo goal" }), GOAL, OWNER);
}

describe("MockRealtime — demo cascade", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("flips milestones in order through the cascade", () => {
    const port = new MockRealtime({ firstDelayMs: 10, intervalMs: 10 });
    const completed: MilestoneCompletedEvent[] = [];
    const milestones = snapshot();

    const msSub = port.subscribeMilestones(GOAL, milestones, (e) => completed.push(e));

    vi.advanceTimersByTime(10); // first flip
    expect(completed).toHaveLength(1);
    expect(completed[0]?.milestoneId).toBe(milestones[0]?.id);
    expect(completed[0]?.awardedXp).toBe(milestones[0]?.xp_reward);

    vi.advanceTimersByTime(10 * milestones.length); // run the rest of the cascade
    expect(completed).toHaveLength(milestones.length);

    msSub.unsubscribe();
  });

  it("stops emitting after unsubscribe", () => {
    const port = new MockRealtime({ firstDelayMs: 10, intervalMs: 10 });
    const completed: MilestoneCompletedEvent[] = [];

    const msSub = port.subscribeMilestones(GOAL, snapshot(), (e) => completed.push(e));
    vi.advanceTimersByTime(10);
    expect(completed).toHaveLength(1);

    msSub.unsubscribe();
    vi.advanceTimersByTime(100);
    expect(completed).toHaveLength(1);
  });
});
