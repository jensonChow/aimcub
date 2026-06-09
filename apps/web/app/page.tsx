import { rarityForEffort, STAGE_THRESHOLDS, stageForXp } from "@core/domain";
import type { EstEffort } from "@core/types";
import { colors, radius, space } from "@ui/tokens";

// Server component: imports @core/domain directly — sharing the exact same pet-growth logic as the MCP side (proving all four surfaces share one core).
export default function Home() {
  const sampleXp = [0, 50, 100, 250, 300, 500];
  const efforts: EstEffort[] = ["xs", "s", "m", "l", "xl"];

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: space.xl }}>
      <h1 style={{ color: colors.primary }}>GoalPet</h1>
      <p style={{ color: colors.textMuted }}>
        Just do your work. Your pet logs every bit of real progress for you, and
        reaches out when you start slipping.
      </p>

      <section style={{ marginTop: space.lg }}>
        <h2 style={{ fontSize: 20 }}>Pet growth (stageForXp · from @core/domain)</h2>
        <ul>
          {sampleXp.map((xp) => (
            <li key={xp}>
              xp={xp} → <strong>{stageForXp(xp)}</strong>
            </li>
          ))}
        </ul>
        <p style={{ color: colors.textMuted }}>
          Stage thresholds: {STAGE_THRESHOLDS.map((t) => `${t.stage}@${t.minXp}`).join(" · ")}
        </p>
      </section>

      <section style={{ marginTop: space.lg }}>
        <h2 style={{ fontSize: 20 }}>Collectible rarity (rarityForEffort · deterministic, not gacha)</h2>
        <div style={{ display: "flex", gap: space.sm, flexWrap: "wrap" }}>
          {efforts.map((e) => (
            <span
              key={e}
              style={{
                padding: `${space.xs}px ${space.sm}px`,
                borderRadius: radius.pill,
                background: colors.surface,
                border: `1px solid ${colors.primary}`,
              }}
            >
              {e} → {rarityForEffort(e)}
            </span>
          ))}
        </div>
      </section>

      <p style={{ marginTop: space.xl, color: colors.textMuted, fontSize: 12 }}>
        v0 foundation: the Web and MCP surfaces share the same <code>@core/domain</code>. Next up (v1a): set a goal → break it down → evidence automatically lights up milestones.
      </p>
    </main>
  );
}
