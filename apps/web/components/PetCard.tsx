import { colors, radius, space } from "@ui/tokens";
import type { PetStage } from "@core/types";
import { petStageProgress } from "../lib/pet-view";
import { stageColor } from "./styles";

/**
 * The goal's pet: inline SVG placeholder art (no binary assets) with three distinct
 * stages, plus XP and a progress bar toward the next stage threshold. Pure presentational
 * — the parent owns the pet state and the realtime subscription. `justStagedUp` plays the
 * same celebration glow as a freshly lit milestone.
 */
export function PetCard({ xp, justStagedUp = false }: { xp: number; justStagedUp?: boolean }) {
  const view = petStageProgress(xp);
  const sc = stageColor(view.stage);

  return (
    <div
      style={{
        width: 200,
        flex: "0 0 auto",
        padding: space.md,
        background: colors.surface,
        borderRadius: radius.lg,
        border: `1px solid ${justStagedUp ? colors.success : "#232733"}`,
        boxShadow: justStagedUp ? `0 0 0 2px ${colors.success}55` : "none",
        transition: "box-shadow 600ms ease, border-color 600ms ease",
        textAlign: "center",
      }}
    >
      <PetArt stage={view.stage} />

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginTop: space.sm,
        }}
      >
        <strong style={{ fontSize: 15 }}>{view.label}</strong>
        <span style={{ color: colors.warning, fontWeight: 700, fontSize: 13 }}>{xp} XP</span>
      </div>

      {justStagedUp ? (
        <p style={{ margin: `${space.xs}px 0 0`, color: colors.success, fontSize: 12, fontWeight: 700 }}>
          Stage up!
        </p>
      ) : null}

      <div
        role="progressbar"
        aria-valuenow={view.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Progress to the next stage"
        style={{
          height: 8,
          marginTop: space.sm,
          background: "#232733",
          borderRadius: radius.pill,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${view.percent}%`,
            height: "100%",
            background: sc,
            borderRadius: radius.pill,
            transition: "width 600ms ease",
          }}
        />
      </div>
      <p style={{ margin: `6px 0 0`, color: colors.textMuted, fontSize: 12 }}>
        {view.nextStageXp === null
          ? "Fully grown"
          : `${view.nextStageXp - xp} XP to ${view.nextStageLabel}`}
      </p>
    </div>
  );
}

/** Inline SVG placeholder art — one charming blob per stage, colored by stage tokens. */
function PetArt({ stage }: { stage: PetStage }) {
  switch (stage) {
    case "egg":
      return (
        <svg width={120} height={120} viewBox="0 0 120 120" role="img" aria-label="Egg — keep completing milestones to hatch it">
          <ellipse cx="60" cy="106" rx="28" ry="5" fill="#232733" />
          <ellipse cx="60" cy="66" rx="32" ry="40" fill={colors.stageEgg} />
          {/* crack lines */}
          <polyline
            points="44,56 52,62 47,70 56,76"
            stroke={colors.bg}
            strokeWidth="2.5"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <polyline
            points="72,42 67,50 75,55"
            stroke={colors.bg}
            strokeWidth="2.5"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "baby":
      return (
        <svg width={120} height={120} viewBox="0 0 120 120" role="img" aria-label="Baby cub">
          <ellipse cx="60" cy="106" rx="28" ry="5" fill="#232733" />
          {/* ears */}
          <circle cx="42" cy="52" r="9" fill={colors.stageBaby} />
          <circle cx="78" cy="52" r="9" fill={colors.stageBaby} />
          {/* body */}
          <circle cx="60" cy="74" r="28" fill={colors.stageBaby} />
          {/* eyes */}
          <circle cx="51" cy="70" r="3.5" fill={colors.bg} />
          <circle cx="69" cy="70" r="3.5" fill={colors.bg} />
          {/* smile */}
          <path d="M52 82 Q60 88 68 82" stroke={colors.bg} strokeWidth="2.5" fill="none" strokeLinecap="round" />
        </svg>
      );
    default:
      // adult (and any future stages until they get their own art)
      return (
        <svg width={120} height={120} viewBox="0 0 120 120" role="img" aria-label="Adult cub">
          <ellipse cx="60" cy="110" rx="34" ry="5" fill="#232733" />
          {/* tail */}
          <path d="M92 86 Q106 80 100 66" stroke={colors.stageAdult} strokeWidth="8" fill="none" strokeLinecap="round" />
          {/* ears + inner ears */}
          <circle cx="38" cy="44" r="11" fill={colors.stageAdult} />
          <circle cx="82" cy="44" r="11" fill={colors.stageAdult} />
          <circle cx="38" cy="44" r="5" fill={colors.bg} opacity="0.35" />
          <circle cx="82" cy="44" r="5" fill={colors.bg} opacity="0.35" />
          {/* body */}
          <ellipse cx="60" cy="78" rx="34" ry="32" fill={colors.stageAdult} />
          {/* belly */}
          <ellipse cx="60" cy="90" rx="16" ry="13" fill={colors.bg} opacity="0.25" />
          {/* eyes */}
          <circle cx="48" cy="66" r="4" fill={colors.bg} />
          <circle cx="72" cy="66" r="4" fill={colors.bg} />
          {/* smile */}
          <path d="M50 76 Q60 84 70 76" stroke={colors.bg} strokeWidth="3" fill="none" strokeLinecap="round" />
          {/* paws */}
          <circle cx="44" cy="106" r="6" fill={colors.stageAdult} />
          <circle cx="76" cy="106" r="6" fill={colors.stageAdult} />
        </svg>
      );
  }
}
