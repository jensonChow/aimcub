/**
 * Builds the read-only drill-in content for a Journey station "sheet" and the
 * interactive stage its footer CTA opens. Pure, no i18n (chips are semantic tokens
 * the component localizes). The sheet is an overlay: opening it must never touch the
 * workspace/surface navigation epochs.
 */
import type { AimProgressReadModel, Memory } from "@core/domain";

import { isHumanExecuteRoute } from "../../stages/execute/executePrimaryAction";
import type { CockpitStage } from "../workspaceNavigation";
import type { JourneyStationId, JourneyStationSheet, JourneyStationSheetRow } from "./types";

const ACTION_STAGE: Record<JourneyStationId, CockpitStage | null> = {
  aim: "aim",
  // Research is a read-only receipt of what the aim has gathered; the actionable
  // context surface is the Context station, so this stays CTA-less to avoid two
  // stations pointing at the same stage.
  research: null,
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

function memoryRows(memories: readonly Memory[]): JourneyStationSheetRow[] {
  return memories.map((memory) => ({
    chip: "context",
    text: memory.content,
    meta: memory.category,
  }));
}

export function buildJourneyStationSheet(
  station: JourneyStationId,
  progress: AimProgressReadModel,
  researchMemories: readonly Memory[] = [],
): JourneyStationSheet {
  let rows: JourneyStationSheetRow[];
  switch (station) {
    case "aim":
      rows = [{ chip: "aim", text: progress.goal.title, meta: undefined }];
      if (progress.goal.description) rows.push({ chip: "aim", text: progress.goal.description });
      break;
    case "research":
      // The real gathered context in play for this aim (aim-scoped + global memories).
      rows = memoryRows(researchMemories);
      break;
    case "context":
      rows = memoryRows(progress.context_candidates);
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
    default:
      rows = [];
      break;
  }
  return { station, rows, actionStage: ACTION_STAGE[station] };
}
