/**
 * Wake-time reconciliation for runs whose worker process died mid-execution.
 *
 * A `running` run is a claim of process ownership (`worker_pid`), and the owner is mortal:
 * force-quit, crash, and ordinary quit all kill it between claim and settle, leaving a row that
 * says work is happening when nothing is. There is deliberately no daemon, lease, or heartbeat,
 * so the recovery moment is when a worker WAKES: Desktop launch and each CLI run invocation call
 * this before claiming anything. Every orphan is settled as failed (`interrupted`) and — because
 * quitting is a pause, not a cancellation — re-queued as a continuation run carrying the same
 * recorded permission, runtime, instruction, and attempt. The ordinary drain then picks the
 * continuation up at its own permission scope: Desktop's background drain claims only the
 * read-only floor, so an interrupted `workspace-write` run waits for an explicit re-grant,
 * exactly like any other stranded queued row.
 *
 * Only queue-managed rows are touched. A `running` row without a `run.queued` event (demo seeds
 * create such rows directly) was never the queue's to settle, let alone to continue.
 */
import { MilestoneSelectionError, AgentSelectionError } from "./errors";
import {
  enqueueMilestoneRun,
  queuedRunRequest,
  type EnqueueMilestoneRunInput,
  type OrchestratorRun,
  type OrchestratorRunEvent,
  type RunOrchestratorDependencies,
  type RunOrchestratorStore,
} from "./orchestrator";

/** What {@link reconcileInterruptedRuns} needs beyond the orchestrator's enqueue surface. */
export interface InterruptedRunStore extends RunOrchestratorStore {
  listRuns(goalId?: string | null): Promise<readonly OrchestratorRun[]>;
  /**
   * Atomically settle a still-`running` row as failed, or return `null` when it no longer is —
   * the claim gate's mirror, so two waking processes can both try and exactly one continues.
   */
  settleInterruptedRun(input: {
    runId: string;
    summary?: string;
    error?: string | null;
  }): Promise<OrchestratorRun | null>;
}

export interface ReconcileInterruptedRunsOptions {
  /** Injectable for tests; defaults to a `kill(pid, 0)` probe. */
  isProcessAlive?: (pid: number) => boolean;
}

export interface InterruptedRunReconciliation {
  runId: string;
  goalId: string;
  milestoneId: string;
  /** The continuation run now queued, or `null` when `disposition` says why none was possible. */
  continuationRunId: string | null;
  disposition: "continued" | "milestone_no_longer_runnable" | "no_runtime_available";
}

export const INTERRUPTED_RUN_ERROR = "interrupted";
export const INTERRUPTED_RUN_SUMMARY = "Interrupted: the app quit while this run was executing.";

/**
 * Whether a pid names a live process. EPERM means it exists but belongs to another user — alive;
 * ESRCH (and anything else) means it is gone. The same tail risk the store lock's dead-pid
 * reclaim already accepts applies here: a pid recycled onto an unrelated long-lived process reads
 * as alive, and that run waits for a wake that outlives the impostor.
 */
export function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Settle every orphaned `running` run and queue its continuation. Call at wake, BEFORE this
 * process claims anything — that ordering is what makes "its pid is mine" proof of a previous
 * incarnation (pid recycled onto us) rather than of our own work.
 */
export async function reconcileInterruptedRuns<TStore extends InterruptedRunStore>(
  store: TStore,
  dependencies: RunOrchestratorDependencies,
  options: ReconcileInterruptedRunsOptions = {},
): Promise<InterruptedRunReconciliation[]> {
  const isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;
  const runs = await store.listRuns();
  const running = runs.filter((run) => run.status === "running");
  if (running.length === 0) return [];

  const eventsByGoal = new Map<string, readonly OrchestratorRunEvent[]>();
  async function goalEvents(goalId: string): Promise<readonly OrchestratorRunEvent[]> {
    const cached = eventsByGoal.get(goalId);
    if (cached) return cached;
    const events = await store.listRunEvents(goalId);
    eventsByGoal.set(goalId, events);
    return events;
  }

  const orphans: OrchestratorRun[] = [];
  for (const run of running) {
    const pid = run.worker_pid ?? null;
    // A missing pid is a pre-worker-identity row: nothing can vouch for it, so it is an orphan.
    const alive = pid !== null && pid !== process.pid && isProcessAlive(pid);
    if (alive) continue;
    const events = await goalEvents(run.goal_id);
    const queueManaged = events.some((event) => event.run_id === run.id && event.type === "run.queued");
    if (!queueManaged) continue;
    orphans.push(run);
  }

  // Settle every orphan before queueing any continuation: enqueue refuses a milestone with an
  // active run, so two orphans on one milestone net exactly one continuation.
  const settled: OrchestratorRun[] = [];
  for (const orphan of orphans) {
    const row = await store.settleInterruptedRun({
      runId: orphan.id,
      summary: INTERRUPTED_RUN_SUMMARY,
      error: INTERRUPTED_RUN_ERROR,
    });
    // null = another waking process settled it first; the continuation is theirs to queue.
    if (row) settled.push(orphan);
  }

  const outcomes: InterruptedRunReconciliation[] = [];
  for (const orphan of settled) {
    const request = await queuedRunRequest(store, orphan);
    let continuationRunId: string | null = null;
    let disposition: InterruptedRunReconciliation["disposition"] = "continued";
    try {
      const continued = await enqueueMilestoneRun(store, {
        goalId: orphan.goal_id,
        milestoneRef: orphan.milestone_id,
        workspace: orphan.workspace_root,
        sandbox: (orphan.sandbox ?? "read-only") as EnqueueMilestoneRunInput["sandbox"],
        network: orphan.network_enabled,
        ...(request.agent_id ? { agentId: request.agent_id } : {}),
        ...(orphan.model ? { model: orphan.model } : {}),
        ...(orphan.reasoning ? { reasoning: orphan.reasoning } : {}),
        ...(request.instruction ? { instruction: request.instruction } : {}),
        // An interruption is not a consumed attempt: the retry budget is for work that failed.
        attempt: request.attempt ?? 1,
        ...(request.retry_of ? { retryOf: request.retry_of } : {}),
        ...(request.surface ? { surface: request.surface } : {}),
        resumedFrom: orphan.id,
      }, dependencies);
      const continuation = continued.run as unknown as OrchestratorRun;
      continuationRunId = continuation.id;
      await store.appendRunEvents([{
        runId: continuation.id,
        type: "run.log",
        summary: "Continues a run interrupted when the app quit before it could finish.",
        payload: { resumed_from: orphan.id, attempt: request.attempt ?? 1 },
      }]);
    } catch (error) {
      // The settle stands either way: a milestone that got completed, re-routed to a human, or
      // re-queued in the meantime needs no continuation, and a machine with no runtime left gets
      // an honest blocked row instead of a phantom queue entry.
      if (error instanceof MilestoneSelectionError) disposition = "milestone_no_longer_runnable";
      else if (error instanceof AgentSelectionError) disposition = "no_runtime_available";
      else throw error;
    }
    outcomes.push({
      runId: orphan.id,
      goalId: orphan.goal_id,
      milestoneId: orphan.milestone_id,
      continuationRunId,
      disposition,
    });
  }
  return outcomes;
}
