/**
 * Derives the Glass "Journal" — a time-ordered ledger of receipts — from an
 * `AimProgressReadModel`. Pure, no i18n.
 *
 * This is the *evidence-only* journal: it merges appended evidence with run
 * lifecycle summaries and sorts newest-first. The richer run-event/attribution
 * timeline (`RunEvent` / `EvidenceAttribution`) is net-new store/IPC surface and
 * lands in Stage D; until then those rows are simply absent, not fabricated.
 */
import type { AimProgressReadModel, EvidenceKind } from "@core/domain";

import type { JourneyActorKind, JourneyJournalEntry } from "./types";

function whoForEvidenceKind(kind: EvidenceKind): JourneyActorKind {
  if (kind === "manual_check") return "you";
  if (kind === "mcp_report") return "agent";
  return "cub";
}

/** Newest-first ledger. Entries with no timestamp are dropped (cannot be placed). */
export function buildJourneyJournal(progress: AimProgressReadModel): JourneyJournalEntry[] {
  const entries: JourneyJournalEntry[] = [];

  for (const row of progress.milestones) {
    for (const item of row.evidence) {
      const evidence = item.evidence;
      entries.push({
        id: `ev:${evidence.id}`,
        at: evidence.occurred_at || evidence.created_at || "",
        who: whoForEvidenceKind(evidence.kind),
        what: evidence.summary || row.milestone.title,
        stationId: "eval",
      });
    }
  }

  for (const run of progress.runs) {
    if (!run.summary) continue;
    entries.push({
      id: `run:${run.id}`,
      at: run.finished_at || run.started_at || run.created_at || "",
      who: run.actor_kind === "human" ? "you" : "agent",
      what: run.summary,
      stationId: "run",
    });
  }

  return entries
    .filter((entry) => entry.at)
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}
