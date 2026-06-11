import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockRealtime } from "./mock-realtime";
import { materialize } from "./mock-repo";
import { localDecompose } from "./decompose";
import type { MilestoneCompletedEvent, PetChangeEvent } from "./realtime-port";

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

  it("flips milestones in order and grows the pet in lockstep", () => {
    const port = new MockRealtime({ firstDelayMs: 10, intervalMs: 10 });
    const completed: MilestoneCompletedEvent[] = [];
    const growth: PetChangeEvent[] = [];
    const milestones = snapshot();

    const petSub = port.subscribePet(GOAL, (e) => growth.push(e));
    const msSub = port.subscribeMilestones(GOAL, milestones, (e) => completed.push(e));

    vi.advanceTimersByTime(10); // first flip
    expect(completed).toHaveLength(1);
    expect(completed[0]?.milestoneId).toBe(milestones[0]?.id);
    expect(growth).toHaveLength(1);
    // Pet xp mirrors the sum of completed milestones' xp_reward (grow_pet recompute).
    expect(growth[0]?.xp).toBe(milestones[0]?.xp_reward);
    expect(growth[0]?.stage).toBe("egg");

    vi.advanceTimersByTime(10 * milestones.length); // run the rest of the cascade
    expect(completed).toHaveLength(milestones.length);
    const totalXp = milestones.reduce((sum, m) => sum + m.xp_reward, 0);
    const last = growth.at(-1);
    expect(last?.xp).toBe(totalXp);
    // The local plan totals 110 XP, so the demo crosses the 100 XP hatch threshold.
    expect(last?.stage).toBe("baby");

    petSub.unsubscribe();
    msSub.unsubscribe();
  });

  it("stops emitting after unsubscribe", () => {
    const port = new MockRealtime({ firstDelayMs: 10, intervalMs: 10 });
    const completed: MilestoneCompletedEvent[] = [];
    const growth: PetChangeEvent[] = [];

    const petSub = port.subscribePet(GOAL, (e) => growth.push(e));
    const msSub = port.subscribeMilestones(GOAL, snapshot(), (e) => completed.push(e));
    vi.advanceTimersByTime(10);
    expect(completed).toHaveLength(1);

    petSub.unsubscribe();
    msSub.unsubscribe();
    vi.advanceTimersByTime(100);
    expect(completed).toHaveLength(1);
    expect(growth).toHaveLength(1);
  });
});
