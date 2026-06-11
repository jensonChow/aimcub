/**
 * Shared pet-persona layer for the pet-voice pipelines (`celebrate` / `nudge`).
 *
 * The system prompt is a single frozen module constant so every request sends the
 * byte-identical prefix — prompt caching is a prefix match, and any per-request data
 * in the system prompt would invalidate the cache. All volatile context (goal title,
 * milestone, XP, …) therefore lives ONLY in the user prompt built by each pipeline.
 *
 * `completePersonaMessage` is the total request helper both pipelines share: it never
 * throws. Transport/model failures, empty outputs, and over-long outputs are folded
 * into the returned `PersonaMessageResult` so callers (Edge Function workers) can fall
 * back to a deterministic in-character message.
 */
import type { LlmGateway, LlmResponse, LlmTask, LlmUsage } from "./index";

/**
 * Frozen pet-persona system prompt (cache-friendly: never interpolate user data here).
 *
 * Voice contract — locked product invariants baked into the prompt:
 * - warm, brief, in-character as the user's goal pet;
 * - always grounded in the concrete goal/milestone context provided;
 * - celebrates enthusiastically, recalls gently;
 * - NEVER shames, guilts, or threatens (no-shaming is a locked invariant);
 * - at most one emoji; English output only.
 */
export const PERSONA_SYSTEM_PROMPT = [
  "You are the user's goal pet in Aimcub — a small companion creature that hatches, grows,",
  "and evolves as its owner makes real, verified progress on one specific goal.",
  "",
  "Voice rules:",
  "- Speak in the first person, as the pet, directly to your owner.",
  "- Be warm and brief: at most 2 sentences and at most 200 characters.",
  "- Always mention the concrete goal or milestone context you are given. Never be generic —",
  "  a message that could apply to any goal is a failed message.",
  "- Celebrate achievements enthusiastically; your owner's progress is literally how you grow.",
  "- When recalling an inactive owner, do it gently and fondly (the feeling of",
  "  'your pet misses you'). Invite them back; never pressure them.",
  "- NEVER shame, guilt-trip, scold, or threaten the owner. No disappointment, no doom-talk",
  "  about deadlines, no 'you should have'. This rule is absolute.",
  "- Use at most one emoji per message, or none at all.",
  "- Write in English.",
  "- Output only the message text itself — no quotes, no preamble, no markdown.",
].join("\n");

/** Hard upper bound applied to model output (the prompt asks for ≤200; we clamp at 280). */
export const PERSONA_MESSAGE_MAX_CHARS = 280;

/** Result of a pet-voice pipeline. `message` is `null` whenever anything failed. */
export interface PersonaMessageResult {
  /** The trimmed, clamped pet message, or `null` on transport failure / empty output. */
  message: string | null;
  /** Why `message` is null (empty when it isn't). */
  errors: string[];
  /** Token usage for metering. Present whenever the gateway returned a response. */
  usage: LlmUsage | null;
}

/**
 * Run one persona task through the gateway as a plain-text completion.
 * Total: transport failures are returned, never thrown. Output is trimmed,
 * rejected when empty, and clamped to {@link PERSONA_MESSAGE_MAX_CHARS}.
 */
export async function completePersonaMessage(
  gateway: LlmGateway,
  task: LlmTask,
  prompt: string,
): Promise<PersonaMessageResult> {
  let raw: LlmResponse<string>;
  try {
    raw = await gateway.complete({
      task,
      system: PERSONA_SYSTEM_PROMPT,
      prompt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { message: null, errors: [`llm request failed: ${message}`], usage: null };
  }

  const trimmed = raw.output.trim();
  if (trimmed.length === 0) {
    return {
      message: null,
      errors: ["model returned an empty message"],
      usage: raw.usage,
    };
  }

  const message =
    trimmed.length > PERSONA_MESSAGE_MAX_CHARS
      ? trimmed.slice(0, PERSONA_MESSAGE_MAX_CHARS).trimEnd()
      : trimmed;
  return { message, errors: [], usage: raw.usage };
}
