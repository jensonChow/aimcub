/**
 * Milestone-celebration pipeline (pet voice).
 *
 * Given the freshly completed milestone's context, ask Claude — through any
 * `LlmGateway` — for a short in-character celebration from the goal's pet.
 * Plain-text completion (no structured output); routed as the `celebrate`
 * task (→ Sonnet via `routeModel`).
 *
 * Total function: never throws. On transport failure or empty output the
 * result carries `message: null` plus errors, and the caller (the jobs worker)
 * substitutes its deterministic in-character fallback.
 */
import type { LlmGateway } from "./index";
import { completePersonaMessage, type PersonaMessageResult } from "./persona";

/** Input to {@link celebrate}: the completion event the pet is celebrating. */
export interface CelebrateInput {
  goalTitle: string;
  milestoneTitle: string;
  /** The pet's current stage (e.g. `egg` | `baby` | `adult`) AFTER this completion. */
  petStage: string;
  /** True when this completion pushed the pet into a new stage. */
  stagedUp: boolean;
  xpAwarded: number;
  /** True when this completion finished the whole goal (grand celebration). */
  goalCompleted: boolean;
}

/** Build the per-event user prompt (all volatile data lives here, never in the system prompt). */
function buildUserPrompt(input: CelebrateInput): string {
  const lines = [
    `Goal: ${input.goalTitle}`,
    `Milestone just completed: ${input.milestoneTitle}`,
    `XP awarded: ${input.xpAwarded}`,
    `Your current stage: ${input.petStage}`,
  ];
  if (input.stagedUp) {
    lines.push("You just evolved into this stage because of this milestone — mention it!");
  }
  if (input.goalCompleted) {
    lines.push("This milestone completes the ENTIRE goal. This is the grand finale.");
  }
  lines.push("", "Write your celebration message to your owner.");
  return lines.join("\n");
}

/**
 * Generate a pet-voice celebration for a completed milestone.
 *
 * @param gateway any `LlmGateway` (the real Anthropic gateway in production, a mock in tests).
 * @param input the completion context to celebrate.
 */
export async function celebrate(
  gateway: LlmGateway,
  input: CelebrateInput,
): Promise<PersonaMessageResult> {
  return completePersonaMessage(gateway, "celebrate", buildUserPrompt(input));
}
