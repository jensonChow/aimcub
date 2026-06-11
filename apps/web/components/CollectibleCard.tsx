import { colors, radius, space } from "@ui/tokens";
import type { Collectible } from "@core/types";
import { rarityColor } from "./styles";

/** Safe string read from the collectible's metadata snapshot (jsonb → Record<string, unknown>). */
function metaString(metadata: Record<string, unknown>, key: string): string | null {
  const v = metadata[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * One minted badge/trophy: rarity pill, shiny indicator, and the goal/milestone snapshot
 * taken at mint time (so the card stays truthful even if the goal is later renamed).
 */
export function CollectibleCard({ collectible }: { collectible: Collectible }) {
  const milestoneTitle = metaString(collectible.metadata, "milestone_title");
  const goalTitle = metaString(collectible.metadata, "goal_title");
  const shiny = collectible.metadata["shiny"] === true;
  const rc = rarityColor(collectible.rarity);
  const minted = collectible.minted_at?.slice(0, 10) ?? null;

  return (
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${shiny ? colors.warning : "#232733"}`,
        borderRadius: radius.md,
        padding: space.md,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: space.sm,
          flexWrap: "wrap",
          marginBottom: space.sm,
        }}
      >
        <span
          style={{
            fontSize: 12,
            padding: "2px 8px",
            borderRadius: radius.pill,
            color: rc,
            border: `1px solid ${rc}`,
          }}
        >
          {collectible.rarity}
        </span>
        {shiny ? (
          <span
            style={{
              fontSize: 12,
              padding: "2px 8px",
              borderRadius: radius.pill,
              color: colors.warning,
              border: `1px solid ${colors.warning}`,
            }}
          >
            ✦ shiny
          </span>
        ) : null}
        <span style={{ marginLeft: "auto", color: colors.textMuted, fontSize: 12 }}>
          {collectible.kind === "goal_trophy" ? "trophy" : "badge"}
        </span>
      </div>

      <strong style={{ fontSize: 14, display: "block" }}>
        {milestoneTitle ?? goalTitle ?? "Milestone badge"}
      </strong>
      {goalTitle && milestoneTitle ? (
        <p style={{ margin: "4px 0 0", color: colors.textMuted, fontSize: 12 }}>{goalTitle}</p>
      ) : null}
      {minted ? (
        <p style={{ margin: "4px 0 0", color: colors.textMuted, fontSize: 12 }}>minted {minted}</p>
      ) : null}
    </div>
  );
}
