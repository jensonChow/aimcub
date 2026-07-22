/**
 * The desktop main process's worker over the shared run queue.
 *
 * Desktop enqueues and returns; the worker drains in the background and pushes every normalized
 * event to the renderer on `IPC.runLiveEvent`. There is no daemon — draining happens only while
 * the app is open — but because the queue IS the `runs` table, anything still queued when the app
 * closes is picked up on the next launch instead of being lost.
 *
 * Deliberately free of Electron imports: the transport is injected, so this module is testable
 * against a real store with no window in sight.
 */
import { routingOverrideForMilestone } from "@core/domain";
import type { AimStore } from "@core/store";
import { createRunQueue, type EnqueueMilestoneRunInput, type RunQueue } from "@core/local-agent";

import type { RunLiveEvent } from "../shared/ipc";
import { listLocalAgents, runLocalAgent } from "./local-agents";

/**
 * Desktop runs are read-only with no network: the cockpit is an observation surface, and a user
 * who has not granted a workspace must not get one implicitly. The CLI, which takes an explicit
 * `--workspace`, is where a writing run is opted into.
 */
export const DESKTOP_RUN_PERMISSION = {
  sandbox: "read-only",
  network: false,
} as const satisfies Pick<EnqueueMilestoneRunInput, "sandbox" | "network">;

export interface EnqueueDesktopRunInput {
  goalId: string;
  milestoneId: string;
  agentId?: string;
  model?: string;
  instruction?: string;
}

export function createDesktopRunQueue(
  store: AimStore,
  emit: (event: RunLiveEvent) => void,
): RunQueue<AimStore> {
  return createRunQueue(store, {
    listLocalAgents,
    runLocalAgent,
    routingOverrideForMilestone,
  }, {
    onEvent: (live) => {
      emit({
        goalId: live.goalId,
        runId: live.runId,
        milestoneId: live.milestoneId,
        at: new Date().toISOString(),
        event: live.event,
      });
    },
  });
}

/** Queue one sub-aim. Throws with a user-facing reason when it is not runnable right now. */
export async function enqueueDesktopRun(
  queue: RunQueue<AimStore>,
  input: EnqueueDesktopRunInput,
): Promise<string> {
  const enqueued = await queue.enqueue({
    goalId: input.goalId,
    milestoneRef: input.milestoneId,
    workspace: null,
    ...DESKTOP_RUN_PERMISSION,
    ...(input.agentId ? { agentId: input.agentId } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.instruction ? { instruction: input.instruction } : {}),
  });
  return enqueued.run.id;
}

/**
 * Nudge the worker. Deliberately not awaited by callers: the IPC handler returns as soon as the
 * run is durably queued, and the drain reports through the live channel and the store. A
 * drain-level throw is a broken store or a misconfigured runtime, not a failed run (those finish
 * as `failed` rows), so nothing above can act on it — record it and let the next kick try.
 */
export function kickRunQueue(queue: RunQueue<AimStore>): void {
  // Scoped to the desktop permission floor: this worker will pick up a run left queued by a
  // previous session, but never a `workspace-write` run the CLI queued against a real workspace.
  void queue.drain({ sandbox: DESKTOP_RUN_PERMISSION.sandbox }).catch((error: unknown) => {
    console.error("[aimcub] run queue drain failed:", error);
  });
}
