/**
 * Aimcub Glass — Journey view-model types.
 *
 * These are the pure shapes derived from an `AimProgressReadModel` for the Glass
 * "Journey" work surface. Derivation lives in the sibling modules (yourMove, journal);
 * rendering + i18n live in the React components. Keeping these framework- and
 * i18n-free makes them unit-testable.
 */

export type YourMoveKind = "run_agent" | "submit_proof" | "review_eval" | "blocked";

export interface JourneyYourMove {
  kind: YourMoveKind;
  milestoneId: string;
  /** Full `glass.move.*` i18n key for the eyebrow tag. */
  tagKey: string;
  /** Raw milestone title (already user-authored text, not a translation key). */
  title: string;
  /** Localized detail line (via `executePrimaryAction`) or the raw next action. */
  body: string;
  /** Localized primary CTA label. */
  primaryLabel: string;
}

export interface JourneyAmbient {
  /** Full `glass.ambient.*` i18n key. */
  titleKey: string;
  /** Raw next-action text from the read model (may be empty). */
  body: string;
}

export type JourneyActorKind = "you" | "agent" | "cub";

export interface JourneyJournalEntry {
  id: string;
  /** ISO timestamp used only for ordering; the component formats the clock label. */
  at: string;
  who: JourneyActorKind;
  /** Raw event text; empty for lifecycle events with no summary (fall back to `detailKey`). */
  what: string;
  /** Suffix under the `glass.journal.event.*` namespace, for run-lifecycle rows with no raw summary. */
  detailKey?: string;
  /**
   * Interpolation values for `detailKey`. Receipts that carry counts or the user's own question
   * text need them; raw `what` text stays the escape hatch for anything already user-authored.
   */
  detailVars?: Record<string, string | number>;
}
