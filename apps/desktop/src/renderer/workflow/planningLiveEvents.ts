import type { PlanningLiveEvent } from "../../shared/ipc";

export function createPlanningRunId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `renderer:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

export function latestLiveValue<T>(
  events: readonly PlanningLiveEvent[],
  pick: (event: PlanningLiveEvent) => T | null | undefined,
): T | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const value = pick(events[index]!);
    if (value !== null && value !== undefined) return value;
  }
  return null;
}
