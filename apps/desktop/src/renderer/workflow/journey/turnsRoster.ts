/**
 * Derives the Glass "Turns" roster — who (you / which agent) is doing what right now —
 * from an `AimProgressReadModel`. Pure except for the injected `t` and a `now` clock
 * (passed in for deterministic tests).
 */
import type { AimProgressReadModel } from "@core/domain";

import type { I18n } from "../../i18n";
import { isHumanExecuteRoute } from "../../stages/execute/executePrimaryAction";
import type { JourneyTurn } from "./types";

function relativeSince(iso: string | null | undefined, now: number, t: I18n["t"]): string {
  if (!iso) return "";
  const started = Date.parse(iso);
  if (Number.isNaN(started)) return "";
  const minutes = Math.floor((now - started) / 60000);
  if (minutes < 1) return t("glass.turns.now");
  if (minutes < 60) return t("glass.turns.minutes", { n: minutes });
  return t("glass.turns.hours", { n: Math.floor(minutes / 60) });
}

function actorLabel(progress: AimProgressReadModel, actorId: string | null, fallback: string): string {
  if (!actorId) return fallback;
  const actor = progress.actors.find((row) => row.id === actorId);
  const name = actor?.display_name?.trim();
  return name ? name : fallback;
}

function milestoneTitle(progress: AimProgressReadModel, milestoneId: string): string {
  return progress.milestones.find((row) => row.milestone.id === milestoneId)?.milestone.title ?? "";
}

export function buildJourneyTurns(progress: AimProgressReadModel, t: I18n["t"], now: number): JourneyTurn[] {
  const turns: JourneyTurn[] = [];

  const humanWaiting = progress.milestones.filter(
    (row) =>
      !row.completed &&
      row.milestone.status !== "skipped" &&
      isHumanExecuteRoute(row) &&
      row.latest_run?.status !== "running",
  ).length;

  turns.push({
    who: "you",
    label: t("glass.actor.you"),
    doing: humanWaiting > 0 ? t("glass.turns.waiting", { n: humanWaiting }) : t("glass.turns.idle"),
    since: "",
  });

  for (const run of progress.runs) {
    if (run.status !== "running") continue;
    const isHuman = run.actor_kind === "human";
    turns.push({
      who: isHuman ? "you" : "agent",
      label: actorLabel(progress, run.actor_id, t(isHuman ? "glass.actor.you" : "glass.actor.agent")),
      doing: run.summary || milestoneTitle(progress, run.milestone_id),
      since: relativeSince(run.started_at ?? run.created_at, now, t),
    });
  }

  return turns;
}
