/**
 * Aimcub Glass — pure view helpers for the batch per-aim progress summary
 * (`AimProgressSummary`, derived in `@core`). Used by the sidebar aim rows and the
 * Home aim cards to render a real status dot + progress fraction. No React, no i18n.
 */
import type { AimProgressSummary, AimProgressSummaryStatus } from "@core/types";

import type { StringKey } from "../i18n";

/** Completed / total, clamped to 0..1; 0 when the aim has no plan yet. */
export function progressRatio(summary: AimProgressSummary): number {
  if (summary.total <= 0) return 0;
  return Math.max(0, Math.min(1, summary.completed / summary.total));
}

/** Accessible-name i18n key for a status dot. */
export const PROGRESS_STATUS_KEY: Record<AimProgressSummaryStatus, StringKey> = {
  planning: "glass.progress.planning",
  needs_you: "glass.progress.needsYou",
  running: "glass.progress.running",
  blocked: "glass.progress.blocked",
  complete: "glass.progress.complete",
};
