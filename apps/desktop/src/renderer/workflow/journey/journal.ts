/**
 * Derives the Glass "Journal" — a time-ordered ledger of receipts — from an
 * `AimProgressReadModel` plus the aim's run-lifecycle `RunEvent` stream. Pure, no i18n.
 *
 * Two sources are merged newest-first:
 *  - Appended evidence — the trust-bearing receipts.
 *  - Run-lifecycle events — start/finish/artifact receipts. Only the
 *    product-facing lifecycle types are kept; raw `run.log` / `tool.*` traces and the
 *    redundant `run.queued` / `evidence.reported` events are filtered out (evidence rows
 *    already cover reported evidence, and internal traces belong in a developer surface).
 *
 * `who` for a run event is resolved from the owning run in `progress.runs`; events whose
 * run is not (yet) in the read model fall back to the neutral "cub" actor. Lifecycle
 * events with no summary carry a `detailKey` the component localizes.
 */
import type { AimProgressReadModel, EvidenceKind, RunEvent, RunEventType } from "@aimcub/core";

import type { JourneyActorKind, JourneyJournalEntry } from "./types";

function whoForEvidenceKind(kind: EvidenceKind): JourneyActorKind {
  if (kind === "manual_check") return "you";
  if (kind === "mcp_report") return "agent";
  return "cub";
}

/** Run-lifecycle event types that read as a product receipt, mapped to their label suffix. */
const LIFECYCLE_EVENT_KEY: Partial<Record<RunEventType, string>> = {
  "run.started": "started",
  "run.completed": "completed",
  "run.failed": "failed",
  "run.cancelled": "cancelled",
  "artifact.created": "artifact",
};

/**
 * Newest-first ledger. Entries with no timestamp are dropped (cannot be placed).
 *
 * `extra` merges in receipts from sources outside the run/evidence streams — today the planning
 * pass, which is not a run and so had no receipt at all despite the Journal's own promise that
 * every pass leaves one.
 */
export function buildJourneyJournal(
  progress: AimProgressReadModel,
  runEvents: readonly RunEvent[] = [],
  extra: readonly JourneyJournalEntry[] = [],
): JourneyJournalEntry[] {
  const entries: JourneyJournalEntry[] = [...extra];

  for (const row of progress.milestones) {
    for (const item of row.evidence) {
      const evidence = item.evidence;
      entries.push({
        id: `ev:${evidence.id}`,
        at: evidence.occurred_at || evidence.created_at || "",
        who: whoForEvidenceKind(evidence.kind),
        what: evidence.summary || row.milestone.title,
      });
    }
  }

  const runById = new Map(progress.runs.map((run) => [run.id, run]));
  for (const event of runEvents) {
    const detailKey = LIFECYCLE_EVENT_KEY[event.type];
    if (!detailKey) continue;
    const run = runById.get(event.run_id);
    const who: JourneyActorKind = run
      ? run.actor_kind === "human"
        ? "you"
        : "agent"
      : "cub";
    entries.push({
      id: `rev:${event.id}`,
      at: event.created_at || "",
      who,
      what: event.summary || "",
      detailKey,
    });
  }

  return entries
    .filter((entry) => entry.at)
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}
