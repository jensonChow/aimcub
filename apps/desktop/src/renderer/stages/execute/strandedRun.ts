/**
 * A `workspace-write` (or otherwise above-the-floor) run still sitting `queued` that this session
 * did not itself enqueue — the consent that justified it belonged to a window that closed before
 * claiming it (`docs/agent-permissions.md`, "Why a grant cannot leak across surfaces"). The
 * background drain will never pick it up (it stays scoped to the read-only floor), so without this
 * affordance the row sits queued and invisible until someone re-runs the sub-aim from scratch.
 *
 * Pure; no React. `sessionRunIds` is how the caller excludes a run THIS session just queued and is
 * about to claim — without it, the brief window between enqueue and the first live event would
 * flash the run this session just started as "stranded".
 */
import type { Run } from "@aimcub/types";

/** The permission floor every Desktop run starts at; anything else is an explicit grant. */
const BACKGROUND_FLOOR_SANDBOX = "read-only";

export interface StrandedRun {
  runId: string;
  sandbox: string;
  network: boolean;
  workspaceRoot: string | null;
}

/**
 * The stranded run for one sub-aim, if any. When more than one somehow qualifies (should not
 * happen in practice — a milestone rarely has two runs queued at once), the most recently queued
 * one wins, matching the run timeline's own newest-first convention.
 */
export function strandedRunFor(input: {
  runs: readonly Run[];
  milestoneId: string;
  sessionRunIds: ReadonlySet<string>;
}): StrandedRun | null {
  const candidates = input.runs
    .filter((run) => run.milestone_id === input.milestoneId)
    .filter((run) => run.status === "queued")
    .filter((run) => run.sandbox !== null && run.sandbox !== BACKGROUND_FLOOR_SANDBOX)
    .filter((run) => !input.sessionRunIds.has(run.id))
    .sort((a, b) => (a.queued_at ?? "") < (b.queued_at ?? "") ? 1 : -1);

  const run = candidates[0];
  if (!run) return null;
  return {
    runId: run.id,
    sandbox: run.sandbox ?? BACKGROUND_FLOOR_SANDBOX,
    network: run.network_enabled,
    workspaceRoot: run.workspace_root ?? null,
  };
}
