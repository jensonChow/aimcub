/**
 * Builds the read-only drill-in content for a Journey station "sheet" and the
 * interactive stage its footer CTA opens. Pure, no i18n (chips are semantic tokens
 * the component localizes). The sheet is an overlay: opening it must never touch the
 * workspace/surface navigation epochs.
 */
import type { AimProgressReadModel } from "@core/domain";

import { isHumanExecuteRoute } from "../../stages/execute/executePrimaryAction";
import type { CockpitStage } from "../workspaceNavigation";
import type { JourneyStationId, JourneyStationSheet, JourneyStationSheetRow } from "./types";

const ACTION_STAGE: Record<JourneyStationId, CockpitStage | null> = {
  aim: "aim",
  research: null, // synthetic station — read-only until Stage D
  context: "context",
  plan: "contracts",
  run: "run",
  eval: "eval",
};

function planRows(progress: AimProgressReadModel): JourneyStationSheetRow[] {
  return progress.milestones.map((row) => ({
    chip: isHumanExecuteRoute(row) ? "owner.you" : "owner.agent",
    text: row.milestone.title,
    meta: row.completed ? "done" : row.blocked ? "blocked" : row.milestone.status,
  }));
}

function runRows(progress: AimProgressReadModel): JourneyStationSheetRow[] {
  return progress.milestones
    .filter((row) => !row.completed && row.milestone.status !== "skipped")
    .map((row) => ({
      chip: row.blocked ? "status.blocked" : isHumanExecuteRoute(row) ? "owner.you" : "owner.agent",
      text: row.milestone.title,
      meta: row.latest_run?.status ?? undefined,
    }));
}

function evalRows(progress: AimProgressReadModel): JourneyStationSheetRow[] {
  return progress.milestones.map((row) => ({
    chip: row.eval_review.passed ? "eval.met" : "eval.open",
    text: row.milestone.title,
    meta: row.eval_review.passed ? "met" : row.next_action || undefined,
  }));
}

function contextRows(progress: AimProgressReadModel): JourneyStationSheetRow[] {
  return progress.context_candidates.map((memory) => ({
    chip: "context",
    text: memory.content,
    meta: memory.category,
  }));
}

export function buildJourneyStationSheet(
  station: JourneyStationId,
  progress: AimProgressReadModel,
): JourneyStationSheet {
  let rows: JourneyStationSheetRow[];
  switch (station) {
    case "aim":
      rows = [{ chip: "aim", text: progress.goal.title, meta: undefined }];
      if (progress.goal.description) rows.push({ chip: "aim", text: progress.goal.description });
      break;
    case "context":
      rows = contextRows(progress);
      break;
    case "plan":
      rows = planRows(progress);
      break;
    case "run":
      rows = runRows(progress);
      break;
    case "eval":
      rows = evalRows(progress);
      break;
    case "research":
    default:
      rows = [];
      break;
  }
  return { station, rows, actionStage: ACTION_STAGE[station] };
}
