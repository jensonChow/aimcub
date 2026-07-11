/**
 * Derives the 6-station Journey strip (Aim · Research · Context · Plan · Run · Eval)
 * from an `AimProgressReadModel`. Pure — no i18n, no React.
 *
 * Honest-data notes:
 * - Aim is "done" whenever a saved goal exists (the strip only renders for goals).
 * - Research has no distinct milestone/stage concept today (it is folded into
 *   planning/context), so it is a *synthetic* station keyed off whether a plan exists.
 *   Stage D may promote it to a real concept.
 * - The remaining stations are derived from real milestone/run counts.
 */
import type { AimProgressReadModel } from "@core/domain";

import type { JourneyStation, JourneyStationKind } from "./types";

export function buildJourneyStations(progress: AimProgressReadModel): JourneyStation[] {
  const total = progress.total_milestones || progress.milestones.length;
  const completed = progress.completed_milestones;
  const planExists = total > 0;
  const allComplete = Boolean(progress.completion_recap?.complete) || (planExists && completed >= total);
  const runningCount = progress.runs.filter((run) => run.status === "running").length;

  const aim: JourneyStation = { id: "aim", kind: "done", lineKey: "set" };

  const research: JourneyStation = planExists
    ? { id: "research", kind: "done", lineKey: "researchFolded" }
    : { id: "research", kind: "up", lineKey: "notStarted" };

  const context: JourneyStation = planExists
    ? { id: "context", kind: "living", lineKey: "contextLiving" }
    : { id: "context", kind: "up", lineKey: "notStarted" };

  const plan: JourneyStation = planExists
    ? { id: "plan", kind: "done", lineKey: "planSummary", lineVars: { n: total } }
    : { id: "plan", kind: "active", lineKey: "planPending" };

  let runKind: JourneyStationKind;
  let runLineKey: string;
  let runVars: Record<string, number> | undefined;
  if (!planExists) {
    runKind = "up";
    runLineKey = "notStarted";
  } else if (allComplete) {
    runKind = "done";
    runLineKey = "runDone";
  } else if (runningCount > 0) {
    runKind = "active";
    runLineKey = "runActive";
    runVars = { n: runningCount };
  } else {
    runKind = "active";
    runLineKey = "runReady";
  }
  const run: JourneyStation = { id: "run", kind: runKind, lineKey: runLineKey, lineVars: runVars };

  let evalKind: JourneyStationKind;
  if (allComplete) evalKind = "done";
  else if (completed > 0) evalKind = "partial";
  else evalKind = "up";
  const evalStation: JourneyStation = {
    id: "eval",
    kind: evalKind,
    lineKey: "evalChecks",
    lineVars: { done: completed, total },
  };

  return [aim, research, context, plan, run, evalStation];
}
