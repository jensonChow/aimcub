/**
 * The durable run queue. There is no separate queue collection: a queued run IS the queue entry,
 * so enqueue/claim/finish all move through the same `runs` rows the journal already reads. A
 * worker drains by claiming — one atomic store mutation — which is why two processes can drain the
 * same store without a daemon, a lease table, or a heartbeat.
 *
 * There is deliberately no background daemon. The desktop main process drains while the app is
 * open; the CLI drains during one invocation. Anything still queued when both stop simply waits on
 * disk for the next worker.
 */
import {
  enqueueMilestoneRun,
  executeQueuedRun,
  type EnqueueMilestoneRunInput,
  type EnqueuedRun,
  type ExecutedRun,
  type OrchestratorRun,
  type RunOrchestratorDependencies,
  type RunOrchestratorStore,
  type StoreRun,
} from "./orchestrator";
import type { LocalAgentEvent } from "./types";

/** First try plus one retry. Only a runtime failure classified `retryable` ever gets the retry. */
export const DEFAULT_MAX_ATTEMPTS = 2;

/**
 * How many claimed runs may execute at once in one worker.
 *
 * Independent sub-aims are the whole reason a plan is a graph rather than a chain, so the drain
 * must not serialize them (founder, 2026-08-09: "产品只会 1by1"). The cap is deliberately small:
 * every run spawns a real local agent process with its own CPU, memory, and model quota, and
 * they all persist through one store lock — unbounded fan-out would trade a queue for thrash.
 * Runs that depend on each other are never both claimable, so this only ever widens work the
 * plan already said could proceed together.
 */
export const DEFAULT_MAX_CONCURRENT_RUNS = 3;

export interface RunQueueLiveEvent {
  goalId: string;
  runId: string;
  milestoneId: string;
  event: LocalAgentEvent;
}

export interface RunQueueOptions {
  /** Every normalized event of every worker-executed run, live — before persistence, not after. */
  onEvent?: (event: RunQueueLiveEvent) => void;
  /** Total attempts allowed per sub-aim, including the first. Defaults to {@link DEFAULT_MAX_ATTEMPTS}. */
  maxAttempts?: number;
  /**
   * How many runs may execute at once. Defaults to {@link DEFAULT_MAX_CONCURRENT_RUNS};
   * values below 1 are clamped to 1 (a queue that drains nothing is not a valid setting).
   */
  maxConcurrentRuns?: number;
}

export interface RunQueueDrainFilter {
  goalId?: string | null;
  runId?: string;
  /**
   * Only claim runs recorded at this sandbox level. A surface that promised the user a read-only
   * run must not pick up a `workspace-write` run another surface queued — the queue is shared, the
   * permission the user granted is not.
   */
  sandbox?: string | null;
}

export interface DrainedRun<TStore extends RunOrchestratorStore> {
  executed: ExecutedRun<TStore>;
  /** The run id this attempt was retried into, when the failure was retryable. */
  retriedInto: string | null;
}

export interface RunQueue<TStore extends RunOrchestratorStore> {
  enqueue(input: EnqueueMilestoneRunInput): Promise<EnqueuedRun<TStore>>;
  /**
   * Claim and execute matching queued runs until none is left, following retries. Concurrent
   * callers share one drain pass rather than racing each other for claims.
   */
  drain(filter?: RunQueueDrainFilter): Promise<DrainedRun<TStore>[]>;
  /** Abort an executing run. The engine settles it with failure code "canceled"; no retry follows. */
  cancel(runId: string): boolean;
  /** Run ids currently executing in this process. */
  activeRunIds(): string[];
}

export function createRunQueue<TStore extends RunOrchestratorStore>(
  store: TStore,
  dependencies: RunOrchestratorDependencies,
  options: RunQueueOptions = {},
): RunQueue<TStore> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const maxConcurrentRuns = Math.max(1, Math.floor(options.maxConcurrentRuns ?? DEFAULT_MAX_CONCURRENT_RUNS));
  const active = new Map<string, AbortController>();
  const drainsInFlight = new Map<string, Promise<DrainedRun<TStore>[]>>();

  async function executeOne(claimed: StoreRun<TStore>): Promise<DrainedRun<TStore>> {
    const run = claimed as unknown as OrchestratorRun;
    const controller = new AbortController();
    active.set(run.id, controller);
    let executed: ExecutedRun<TStore>;
    try {
      executed = await executeQueuedRun(store, claimed, {
        signal: controller.signal,
        ...(options.onEvent
          ? {
              onEvent: (event: LocalAgentEvent) => {
                options.onEvent?.({ goalId: run.goal_id, runId: run.id, milestoneId: run.milestone_id, event });
              },
            }
          : {}),
      }, dependencies);
    } finally {
      active.delete(run.id);
    }

    const retriedInto = await maybeRetry(executed);
    return { executed, retriedInto };
  }

  /**
   * Runs are immutable history, so a retry is a NEW queued run for the same sub-aim rather than a
   * mutated old one; a `run.log` event on the retry links it back to the attempt it replaces.
   * The attempt counter travels on the queue request, so it counts this retry chain rather than
   * every run the sub-aim ever had.
   */
  async function maybeRetry(executed: ExecutedRun<TStore>): Promise<string | null> {
    const failure = executed.result.failure;
    if (!failure?.retryable) return null;
    const attempt = executed.request.attempt ?? 1;
    if (attempt >= maxAttempts) return null;
    const previous = executed.run as unknown as OrchestratorRun;
    const nextAttempt = attempt + 1;
    const retry = await enqueueMilestoneRun(store, {
      goalId: previous.goal_id,
      milestoneRef: previous.milestone_id,
      workspace: previous.workspace_root,
      sandbox: (previous.sandbox ?? "read-only") as EnqueueMilestoneRunInput["sandbox"],
      network: previous.network_enabled,
      ...(executed.request.agent_id ? { agentId: executed.request.agent_id } : {}),
      ...(previous.model ? { model: previous.model } : {}),
      ...(previous.reasoning ? { reasoning: previous.reasoning } : {}),
      ...(executed.request.instruction ? { instruction: executed.request.instruction } : {}),
      ...(executed.request.surface ? { surface: executed.request.surface } : {}),
      attempt: nextAttempt,
      retryOf: previous.id,
    }, dependencies);
    const retryRun = retry.run as unknown as OrchestratorRun;
    await store.appendRunEvents([{
      runId: retryRun.id,
      type: "run.log",
      summary: `Retry ${nextAttempt - 1} of ${maxAttempts - 1} after a retryable failure: ${failure.message}`,
      payload: { retry_of: previous.id, attempt: nextAttempt, failure_code: failure.code },
    }]);
    return retryRun.id;
  }

  async function drainPass(filter: RunQueueDrainFilter): Promise<DrainedRun<TStore>[]> {
    const drained: DrainedRun<TStore>[] = [];
    // Retries are followed by id so a `{ runId }` drain still completes its own retry chain.
    const followUps: string[] = [];

    /**
     * One worker: claim → execute → repeat until nothing is claimable. Claiming is a single
     * atomic store mutation, so N of these race safely and exactly one wins each run — the same
     * property that already let the desktop and the CLI drain the same store.
     *
     * Each worker follows its OWN retry immediately (it pushes then shifts), so no retry chain
     * can be stranded by another worker finishing first. Workers keep claiming until the queue
     * answers empty rather than stopping at a first miss, so a run enqueued mid-pass is still
     * picked up — the serial loop behaved the same way.
     */
    async function worker(): Promise<void> {
      for (;;) {
        const next = followUps.shift();
        const claimed = next
          ? await store.claimNextQueuedRun({ runId: next })
          : await store.claimNextQueuedRun(filter);
        if (!claimed) return;
        const outcome = await executeOne(claimed as StoreRun<TStore>);
        drained.push(outcome);
        if (outcome.retriedInto) followUps.push(outcome.retriedInto);
      }
    }

    await Promise.all(Array.from({ length: maxConcurrentRuns }, () => worker()));
    return drained;
  }

  return {
    enqueue(input) {
      return enqueueMilestoneRun(store, input, dependencies);
    },

    drain(filter = {}) {
      // One pass per filter at a time: a second kick for the same scope joins the pass in flight
      // instead of racing it for claims.
      const key = `${filter.runId ?? ""}|${filter.goalId ?? ""}|${filter.sandbox ?? ""}`;
      const existing = drainsInFlight.get(key);
      if (existing) return existing;
      const pass = drainPass(filter).finally(() => drainsInFlight.delete(key));
      drainsInFlight.set(key, pass);
      return pass;
    },

    cancel(runId) {
      const controller = active.get(runId);
      if (!controller) return false;
      controller.abort();
      return true;
    },

    activeRunIds() {
      return [...active.keys()];
    },
  };
}
