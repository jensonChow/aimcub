/**
 * The CLI's face on the shared run queue. Selection, execution, event persistence, evidence and
 * completion all live in `@aimcub/local-agent`'s orchestrator — this module only translates CLI
 * input into a queue request and the queue's outcome back into the CLI's result shape.
 */
import type { AimStore } from "@aimcub/store";
import type {
  AimProgressReadModel,
  Evidence,
  Milestone,
  MilestoneCompletion,
  Run,
} from "@aimcub/types";
import { routingOverrideForMilestone } from "@aimcub/core";
import {
  createRunQueue,
  listLocalAgents,
  NoRunnableMilestoneError,
  runLocalAgent,
  type DrainedRun,
  type LocalAgentDetection,
  type LocalAgentEvent,
  type LocalAgentId,
  type LocalAgentRunOptions,
  type LocalAgentRunResult,
  type RunOrchestratorDependencies,
  type RunQueue,
} from "@aimcub/local-agent";

export interface AimAgentRunInput {
  goalId: string;
  milestoneRef?: string;
  workspace: string;
  agentId?: LocalAgentId;
  model?: string;
  reasoning?: string;
  network?: boolean;
  readOnly?: boolean;
  onEvent?: (event: LocalAgentEvent) => void | Promise<void>;
}

export interface AimAgentRunResult {
  goalId: string;
  milestone: Milestone;
  agent: LocalAgentDetection;
  model: string;
  orchestrationRun: Run;
  run: LocalAgentRunResult;
  evidence: Evidence;
  completions: MilestoneCompletion[];
  progress: AimProgressReadModel | null;
}

export interface AimAgentRunDependencies {
  listLocalAgents: typeof listLocalAgents;
  runLocalAgent: (
    request: Parameters<typeof runLocalAgent>[0],
    options?: LocalAgentRunOptions,
  ) => Promise<LocalAgentRunResult>;
}

const defaultDependencies: AimAgentRunDependencies = {
  listLocalAgents,
  runLocalAgent,
};

/** Why an `--until-blocked` sweep stopped. */
export type AimAgentSweepStopReason = "no_ready_sub_aim" | "run_failed";

export interface AimAgentSweepResult {
  goalId: string;
  runs: AimAgentRunResult[];
  stopReason: AimAgentSweepStopReason;
  stopDetail: string;
}

function orchestratorDependencies(dependencies: AimAgentRunDependencies): RunOrchestratorDependencies {
  return { ...dependencies, routingOverrideForMilestone };
}

function toRunResult(goalId: string, drained: DrainedRun<AimStore>): AimAgentRunResult {
  const { executed } = drained;
  return {
    goalId,
    milestone: executed.row.milestone,
    agent: executed.agent,
    model: executed.model,
    orchestrationRun: executed.run,
    run: executed.result,
    evidence: executed.evidence,
    completions: executed.completions,
    progress: executed.progress,
  };
}

/**
 * Enqueue one sub-aim and drain it here and now (following its retry, if the failure was
 * classified retryable). The CLI has no daemon: a run only makes progress while the invocation
 * that queued it is alive.
 */
async function enqueueAndDrain(
  input: AimAgentRunInput,
  queue: RunQueue<AimStore>,
  excludeMilestoneIds: readonly string[] = [],
): Promise<AimAgentRunResult> {
  const enqueued = await queue.enqueue({
    goalId: input.goalId,
    ...(input.milestoneRef ? { milestoneRef: input.milestoneRef } : {}),
    ...(excludeMilestoneIds.length > 0 ? { excludeMilestoneIds } : {}),
    workspace: input.workspace,
    sandbox: input.readOnly ? "read-only" : "workspace-write",
    network: Boolean(input.network),
    ...(input.agentId ? { agentId: input.agentId } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.reasoning ? { reasoning: input.reasoning } : {}),
  });
  const drained = await queue.drain({ runId: enqueued.run.id });
  const last = drained[drained.length - 1];
  if (!last) throw new Error("Another Aimcub process claimed this queued run before it could start.");
  return toRunResult(input.goalId, last);
}

/** Run exactly one dependency-ready agent-owned sub-aim. */
export async function runAimAgent(
  store: AimStore,
  input: AimAgentRunInput,
  dependencies: AimAgentRunDependencies = defaultDependencies,
): Promise<AimAgentRunResult> {
  const queue = createRunQueue(store, orchestratorDependencies(dependencies), {
    ...(input.onEvent ? { onEvent: (live) => void input.onEvent?.(live.event) } : {}),
  });
  return enqueueAndDrain(input, queue);
}

/**
 * Keep running the next dependency-ready agent-owned sub-aim until none remains ready or a run
 * fails terminally (after the retry policy). Human-owned and dependency-blocked sub-aims end the
 * sweep rather than being skipped — the sweep never routes around a person.
 *
 * Each sub-aim gets at most one attempt per sweep. A finished run does not complete a sub-aim
 * (only `evaluate()` does), so without that rule the sweep would re-run the same sub-aim forever.
 */
export async function runAimAgentUntilBlocked(
  store: AimStore,
  input: AimAgentRunInput & { onRunComplete?: (result: AimAgentRunResult) => void | Promise<void> },
  dependencies: AimAgentRunDependencies = defaultDependencies,
): Promise<AimAgentSweepResult> {
  const queue = createRunQueue(store, orchestratorDependencies(dependencies), {
    ...(input.onEvent ? { onEvent: (live) => void input.onEvent?.(live.event) } : {}),
  });
  const runs: AimAgentRunResult[] = [];
  const attempted: string[] = [];
  for (;;) {
    let result: AimAgentRunResult;
    try {
      result = await enqueueAndDrain({ ...input, milestoneRef: undefined }, queue, attempted);
    } catch (error) {
      if (error instanceof NoRunnableMilestoneError) {
        return {
          goalId: input.goalId,
          runs,
          stopReason: "no_ready_sub_aim",
          stopDetail: error.message,
        };
      }
      throw error;
    }
    runs.push(result);
    attempted.push(result.milestone.id);
    await input.onRunComplete?.(result);
    if (!result.run.ok) {
      return {
        goalId: input.goalId,
        runs,
        stopReason: "run_failed",
        stopDetail: result.run.error ?? "Local agent run failed.",
      };
    }
  }
}
