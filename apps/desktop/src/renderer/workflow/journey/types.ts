/**
 * Aimcub Glass — Journey view-model types.
 *
 * These are the pure shapes derived from an `AimProgressReadModel` for the Glass
 * "Journey" work surface. Derivation lives in the sibling modules (stationModel,
 * yourMove, turnsRoster, journal, stationSheet); rendering + i18n live in the
 * React components. Keeping these framework- and i18n-free makes them unit-testable.
 */
import type { CockpitStage } from "../workspaceNavigation";

export type JourneyStationId = "aim" | "research" | "context" | "plan" | "run" | "eval";

/** Visual status of a station glyph, mirroring the Glass design's dot states. */
export type JourneyStationKind = "done" | "living" | "active" | "partial" | "up";

export interface JourneyStation {
  id: JourneyStationId;
  kind: JourneyStationKind;
  /** Suffix under the `glass.station.line.*` i18n namespace. */
  lineKey: string;
  lineVars?: Record<string, string | number>;
}

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

export interface JourneyTurn {
  who: JourneyActorKind;
  /** Localized display label (actor display name, or a generic "You"/"Agent"). */
  label: string;
  /** Raw activity text. */
  doing: string;
  /** Relative age: "", "now", "{n}m", or "{n}h". */
  since: string;
}

export interface JourneyJournalEntry {
  id: string;
  /** ISO timestamp used only for ordering; the component formats the clock label. */
  at: string;
  who: JourneyActorKind;
  /** Raw event text; empty for lifecycle events with no summary (fall back to `detailKey`). */
  what: string;
  /** Suffix under the `glass.journal.event.*` namespace, for run-lifecycle rows with no raw summary. */
  detailKey?: string;
  /** Station this entry drills into, if any. */
  stationId?: JourneyStationId;
}

/** Semantic chip token; the component maps it to a localized label + tone. */
export type JourneyChip =
  | "aim"
  | "owner.you"
  | "owner.agent"
  | "status.done"
  | "status.open"
  | "status.blocked"
  | "eval.met"
  | "eval.open"
  | "context";

export interface JourneyStationSheetRow {
  chip: JourneyChip;
  text: string;
  meta?: string;
}

/**
 * Which existing App handler a station sheet's interactive confirm invokes. Only
 * `run_agent` (→ the existing `runAgent` handler) exists in Stage 2; `confirm_milestone`
 * arrives with the evidence form in Stage 5. Kept as a union so the component can switch
 * without a boolean explosion later.
 */
export type JourneySheetActionKind = "run_agent";

/** One selectable, dispatchable option in an interactive station sheet. */
export interface JourneyStationOption {
  /** Milestone the confirm acts on (looked up in `progress.milestones`). */
  milestoneId: string;
  /** Milestone title (already user-authored text, not a translation key). */
  text: string;
  /** Honest secondary label — the raw milestone status. */
  note?: string;
  /** Semantic chip token; the component maps it to a localized label + tone. */
  chip: JourneyChip;
}

/**
 * The interactive payload for a station sheet: a set of dispatchable `options` the user
 * selects among, plus the non-dispatchable `contextRows` (blocked / human / in-flight work)
 * kept read-only so the sheet never hides part of the picture. `options ∪ contextRows`
 * covers the station's full pending set. Pure — the component owns selection state and i18n.
 */
export interface JourneyStationInteraction {
  actionKind: JourneySheetActionKind;
  options: JourneyStationOption[];
  contextRows: JourneyStationSheetRow[];
}

export interface JourneyStationSheet {
  station: JourneyStationId;
  rows: JourneyStationSheetRow[];
  /**
   * The interactive stage this station's footer CTA opens via `openCockpitStage`,
   * or `null` for read-only stations (e.g. the synthetic Research station).
   */
  actionStage: CockpitStage | null;
  /**
   * An in-place interactive affordance (selectable options → enable-gated confirm), or
   * `null`/absent when the station is read-only or has nothing dispatchable. Rendered in
   * addition to — never instead of — the `actionStage` fallback CTA.
   */
  interaction?: JourneyStationInteraction | null;
}
