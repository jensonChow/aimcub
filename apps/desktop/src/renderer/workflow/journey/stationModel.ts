/**
 * Derives the 6-station Journey strip (Aim · Research · Context · Plan · Run · Eval)
 * from an `AimProgressReadModel`. Pure — no i18n, no React.
 *
 * Honest-data notes:
 * - Aim is "done" whenever a saved goal exists (the strip only renders for goals).
 * - Research is derived from a real `@aimcub/core` signal (`summarizeAimResearch`) over the
 *   aim's gathered context memories + pending candidates, not a synthetic plan proxy.
 * - The remaining stations are derived from real milestone/run counts.
 */
import { summarizeAimResearch, type AimProgressReadModel, type Memory } from "@aimcub/core";

import type { JourneyStation, JourneyStationKind } from "./types";

export function buildJourneyStations(
  progress: AimProgressReadModel,
  researchMemories: readonly Memory[] = [],
): JourneyStation[] {
  const total = progress.total_milestones || progress.milestones.length;
  const completed = progress.completed_milestones;
  const planExists = total > 0;
  const allComplete = Boolean(progress.completion_recap?.complete) || (planExists && completed >= total);
  const runningCount = progress.runs.filter((run) => run.status === "running").length;

  const aim: JourneyStation = { id: "aim", kind: "done", lineKey: "set" };

  const researchSignal = summarizeAimResearch({
    planExists,
    memories: researchMemories,
    contextCandidates: progress.context_candidates,
  });
  let research: JourneyStation;
  if (researchSignal.status === "none") {
    research = { id: "research", kind: "up", lineKey: "notStarted" };
  } else if (researchSignal.status === "gathering") {
    research = {
      id: "research",
      kind: "living",
      lineKey: "researchGathering",
      lineVars: { n: researchSignal.memoryCount + researchSignal.pendingCount },
    };
  } else if (researchSignal.memoryCount > 0) {
    research = { id: "research", kind: "done", lineKey: "researchReady", lineVars: { n: researchSignal.memoryCount } };
  } else {
    research = { id: "research", kind: "done", lineKey: "researchFolded" };
  }

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
