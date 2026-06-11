/**
 * Proactive-nudge pipeline (pet voice).
 *
 * Given a stale-goal or approaching-deadline trigger, ask Claude — through any
 * `LlmGateway` — for a short, gentle in-character recall from the goal's pet.
 * Plain-text completion (no structured output); routed as the high-frequency
 * `nudge` task (→ Haiku via `routeModel`).
 *
 * Total function: never throws. On transport failure or empty output the
 * result carries `message: null` plus errors, and the caller (the jobs worker)
 * substitutes its deterministic in-character fallback. The no-shaming invariant
 * lives in the shared persona system prompt.
 */
import type { LlmGateway } from "./index";
import { completePersonaMessage, type PersonaMessageResult } from "./persona";

/** Input to {@link nudge}: why the pet is reaching out. */
export interface NudgeInput {
  trigger: "stale" | "deadline_near";
  goalTitle: string;
  /** For `stale`: how long the goal has seen no progress. */
  daysInactive?: number;
  /** For `deadline_near`: the goal's due date (ISO 8601). */
  dueAt?: string;
  /** The next pending milestone, when known — gives the pet something concrete to point at. */
  pendingMilestoneTitle?: string;
}

/** Build the per-trigger user prompt (all volatile data lives here, never in the system prompt). */
function buildUserPrompt(input: NudgeInput): string {
  const lines = [`Goal: ${input.goalTitle}`];
  if (input.trigger === "stale") {
    lines.push(
      input.daysInactive !== undefined
        ? `There has been no progress for ${input.daysInactive} days, and you miss your owner.`
        : "There has been no progress for a while, and you miss your owner.",
    );
  } else {
    lines.push(
      input.dueAt !== undefined
        ? `The goal's deadline is getting close (due ${input.dueAt}).`
        : "The goal's deadline is getting close.",
    );
  }
  if (input.pendingMilestoneTitle !== undefined) {
    lines.push(`The next milestone waiting is: ${input.pendingMilestoneTitle}`);
  }
  lines.push("", "Write your gentle nudge to your owner (invite, never pressure).");
  return lines.join("\n");
}

/**
 * Generate a pet-voice nudge for a stale or deadline-near goal.
 *
 * @param gateway any `LlmGateway` (the real Anthropic gateway in production, a mock in tests).
 * @param input the trigger context for the nudge.
 */
export async function nudge(
  gateway: LlmGateway,
  input: NudgeInput,
): Promise<PersonaMessageResult> {
  return completePersonaMessage(gateway, "nudge", buildUserPrompt(input));
}
