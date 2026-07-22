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
import { statSync } from "node:fs";
import { isAbsolute } from "node:path";

import { routingOverrideForMilestone } from "@aimcub/core";
import type { AimStore } from "@aimcub/store";
import { createRunQueue, queuedRunRequest, type EnqueueMilestoneRunInput, type RunQueue } from "@aimcub/local-agent";

import type { RunLiveEvent, RunPermissionConsent } from "../shared/ipc";
import { listLocalAgents, runLocalAgent } from "./local-agents";

/**
 * The permission floor of the *background* drain: the cockpit is an observation surface, so a run
 * nobody consented to in this session may only look, never touch, and never reach the network.
 * A user who has not granted a workspace must not get one implicitly.
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
  /** The consent this run carries. Omitted ⇒ the read-only, network-off floor. */
  permission?: RunPermissionConsent;
}

/** A permission that only the enqueuing session may execute, because only it holds the consent. */
export function isConsentedEscalation(permission: RunPermissionConsent): boolean {
  return permission.sandbox !== DESKTOP_RUN_PERMISSION.sandbox
    || permission.network !== DESKTOP_RUN_PERMISSION.network;
}

/**
 * Turn the renderer's (untrusted) consent into a permission the main process is willing to record.
 * Throws a user-facing reason rather than silently narrowing: a run that does less than the user
 * was told it would do is its own kind of lie.
 *
 * `danger-full-access` is rejected here as well as being absent from the UI — the renderer is not
 * the security boundary.
 */
export function resolveDesktopRunPermission(input: RunPermissionConsent | undefined): RunPermissionConsent {
  if (!input) return { ...DESKTOP_RUN_PERMISSION, workspace: null };
  const network = input.network === true;
  if (input.sandbox === "read-only") return { sandbox: "read-only", network, workspace: null };
  if (input.sandbox !== "workspace-write") {
    throw new Error(`Aimcub does not grant the "${String(input.sandbox)}" sandbox from the desktop app.`);
  }

  const workspace = input.workspace?.trim() ?? "";
  if (!workspace) throw new Error("Choose the folder this run may write in before starting it.");
  if (!isAbsolute(workspace)) throw new Error("A run workspace must be an absolute folder path.");
  let isDirectory: boolean;
  try {
    isDirectory = statSync(workspace).isDirectory();
  } catch {
    isDirectory = false;
  }
  if (!isDirectory) throw new Error(`That run workspace is not a folder on this machine: ${workspace}`);
  return { sandbox: "workspace-write", network, workspace };
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
  const permission = resolveDesktopRunPermission(input.permission);
  const enqueued = await queue.enqueue({
    goalId: input.goalId,
    milestoneRef: input.milestoneId,
    workspace: permission.workspace ?? null,
    sandbox: permission.sandbox,
    network: permission.network,
    surface: "desktop",
    ...(input.agentId ? { agentId: input.agentId } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.instruction ? { instruction: input.instruction } : {}),
  });
  return enqueued.run.id;
}

/**
 * Nudge the background worker. Deliberately not awaited by callers: the IPC handler returns as soon
 * as the run is durably queued, and the drain reports through the live channel and the store. A
 * drain-level throw is a broken store or a misconfigured runtime, not a failed run (those finish as
 * `failed` rows), so nothing above can act on it — record it and let the next kick try.
 */
export function kickRunQueue(queue: RunQueue<AimStore>): void {
  // Scoped to the desktop permission floor: this worker will pick up a run left queued by a
  // previous session, but never a `workspace-write` run the CLI queued against a real workspace,
  // and never one a previous desktop session queued under a consent that died with that session.
  void queue.drain({ sandbox: DESKTOP_RUN_PERMISSION.sandbox }).catch((error: unknown) => {
    console.error("[aimcub] run queue drain failed:", error);
  });
}

/**
 * Execute exactly the run this session just enqueued, by id — the only way a run above the
 * background floor ever runs here. Claiming by id (the same move the CLI makes for its own
 * `--workspace` run) keeps the grant tied to the consent that produced it: the broad drain stays
 * read-only-scoped, so nothing else can promote a `workspace-write` row into execution.
 *
 * Also the re-grant path for a run a previous session left queued (`docs/agent-permissions.md`):
 * the renderer re-shows that row's already-recorded permission and requires a fresh click before
 * calling this, so nothing here widens what was already on the row — it only executes it.
 */
export function claimConsentedRun(queue: RunQueue<AimStore>, runId: string): void {
  void queue.drain({ runId }).catch((error: unknown) => {
    console.error("[aimcub] consented run drain failed:", error);
  });
}

/**
 * Cancel a run that was never claimed — e.g. a `workspace-write` run stranded by a session that
 * closed before running it. `RunQueue.cancel` only aborts a run actively executing in this
 * process; a merely-queued run has no controller to abort, so this settles the row directly.
 *
 * `claimNextQueuedRun` is the same atomic, lock-protected gate the drain itself claims through: it
 * only succeeds while the row is still exactly `queued`, so a run a real drain claims in the same
 * instant is left alone (this then reports false) rather than being cancelled out from under it.
 */
export async function cancelQueuedRun(store: AimStore, runId: string): Promise<boolean> {
  const claimed = await store.claimNextQueuedRun({ runId });
  if (!claimed) return false;
  await store.finishRun({
    runId,
    status: "cancelled",
    summary: "Cancelled before it ran.",
  });
  return true;
}

/**
 * Diagnostic only: report every run still queued above the background floor, with the surface
 * that queued it when the row is new enough to carry one. This changes no claim decision — the
 * background drain's `{ sandbox: DESKTOP_RUN_PERMISSION.sandbox }` filter in {@link kickRunQueue}
 * remains the only enforcement — it just says out loud, once at launch, why those rows are not
 * moving: same reason the Execute stage's stranded-run notice gives the user.
 */
export async function logStrandedQueuedRuns(store: AimStore): Promise<void> {
  const runs = await store.listRuns();
  const stranded = runs.filter((run) => run.status === "queued" && run.sandbox !== DESKTOP_RUN_PERMISSION.sandbox);
  for (const run of stranded) {
    const request = await queuedRunRequest(store, run);
    console.log(
      `[aimcub] run ${run.id} stays queued (sandbox: ${run.sandbox ?? "unknown"}` +
      `${request.surface ? `, queued by ${request.surface}` : ""}) — ` +
      "the background drain only claims the read-only floor; it needs same-session consent to execute.",
    );
  }
}
