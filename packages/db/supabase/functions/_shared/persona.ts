/**
 * Deterministic, in-character fallback copy for the pet voice.
 *
 * Used whenever the LLM generator is absent (no ANTHROPIC_API_KEY) or fails —
 * a celebration must NEVER be lost to an LLM outage. Pure function of the
 * context: same input → same string, unit-tested, no I/O.
 */
import type { CelebrationContext } from "./ports.ts";

export function fallbackCelebrationMessage(ctx: CelebrationContext): string {
  if (ctx.goalCompleted) {
    return (
      `We did it!! "${ctx.goalTitle}" is COMPLETE — every milestone, done. ` +
      `I could not be prouder of us. Trophy time! (+${ctx.xpAwarded} XP)`
    );
  }
  if (ctx.stagedUp) {
    return (
      `Whoa — finishing "${ctx.milestoneTitle}" fed me +${ctx.xpAwarded} XP and I grew! ` +
      `Say hi to your ${ctx.petStage}. Onward with "${ctx.goalTitle}"!`
    );
  }
  return (
    `Yes! "${ctx.milestoneTitle}" is done — that's +${ctx.xpAwarded} XP for me. ` +
    `"${ctx.goalTitle}" keeps moving. Nom nom, progress tastes great!`
  );
}
