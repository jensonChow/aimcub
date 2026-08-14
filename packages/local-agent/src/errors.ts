/**
 * Typed selection failures.
 *
 * Nothing here is a run failure: these all mean "this run never started", because the aim, the
 * plan or the local environment says it cannot. They are config errors a person fixes (install a
 * runtime, log in, pick another sub-aim), so a surface should render the message as-is rather than
 * as a crash — the CLI maps them onto its user-error path, and a draining caller can tell them
 * apart by `code` instead of matching message text.
 *
 * Messages are the product copy. They are asserted by tests and shown verbatim to users; change
 * the classification freely, the wording deliberately.
 */

export type MilestoneSelectionErrorCode =
  | "no_ready_milestone"
  | "milestone_not_found"
  | "milestone_already_done"
  | "milestone_human_owned"
  | "milestone_dependency_pending"
  | "milestone_active_run";

export type AgentSelectionErrorCode =
  | "no_ready_agent"
  | "unknown_agent"
  | "agent_not_installed"
  | "agent_not_authenticated";

export type RunSelectionErrorCode = MilestoneSelectionErrorCode | AgentSelectionErrorCode;

/** Base class for every "this run cannot start" failure. One `instanceof` covers them all. */
export class RunSelectionError extends Error {
  readonly code: RunSelectionErrorCode;

  constructor(code: RunSelectionErrorCode, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

/** No sub-aim qualifies: none is ready, or the requested one cannot be run. */
export class MilestoneSelectionError extends RunSelectionError {
  /** The resolved sub-aim, when the refusal is about one — how a caller acts on the SAME row. */
  readonly milestoneId: string | null;

  constructor(code: MilestoneSelectionErrorCode, message: string, milestoneId: string | null = null) {
    super(code, message);
    this.milestoneId = milestoneId;
  }
}

/**
 * Thrown when no sub-aim qualifies for an automatic pick. Kept as its own class because a
 * draining caller treats it as "stop calmly" (the aim is done or waiting on a human) rather than
 * as a failure to surface.
 */
export class NoRunnableMilestoneError extends MilestoneSelectionError {
  constructor(message = "No dependency-ready, agent-owned, incomplete sub-aim is available.") {
    super("no_ready_milestone", message);
  }
}

/** No runtime can execute the run: none authenticated, or the requested one is unusable. */
export class AgentSelectionError extends RunSelectionError {
  /** The runtime the caller (or the plan) asked for, when one was named. */
  readonly agentId: string | null;

  constructor(code: AgentSelectionErrorCode, message: string, agentId: string | null = null) {
    super(code, message);
    this.agentId = agentId;
  }
}
