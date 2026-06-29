/**
 * Small shared style helpers built on @ui/tokens. Cross-platform consistency comes from
 * the shared tokens, not component reuse (web = DOM, iOS = RN), so these stay web-local.
 */
import { colors, radius, type Tokens } from "@ui/tokens";
import type { CSSProperties } from "react";
import type { MilestoneStatus } from "@core/types";

export { colors, radius } from "@ui/tokens";
export type { Tokens };

export const card: CSSProperties = {
  background: colors.surface,
  borderRadius: radius.lg,
  border: `1px solid #232733`,
  padding: 16,
};

export function statusColor(status: MilestoneStatus): string {
  switch (status) {
    case "completed":
      return colors.success;
    case "in_progress":
      return colors.primary;
    case "blocked":
      return colors.danger;
    case "skipped":
      return colors.textMuted;
    case "pending":
      return colors.textMuted;
  }
}
