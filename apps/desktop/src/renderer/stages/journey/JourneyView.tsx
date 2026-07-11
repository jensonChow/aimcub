/**
 * Aimcub Glass — the "Journey" work surface.
 *
 * Replaces the goal landing panel (AimOverviewPanel). It renders the 6-station strip,
 * a single "Your move" card (or an "Ambient" card when nothing is waiting on the user),
 * a "Turns" roster, and a "Journal" receipt timeline — all derived from the existing
 * AimProgressReadModel via the pure helpers in ../../workflow/journey.
 *
 * The station "sheet" is component-local overlay state, keyed by goal id at the mount
 * site, so it never touches the App's workspace/surface navigation epochs and is cleared
 * automatically on any real navigation (stage change unmounts this view; goal change
 * remounts it). Actual mutations route through the existing epoch-safe App handlers.
 */
import type { AimProgressReadModel, Goal, Milestone } from "@core/domain";
import { useState } from "react";

import { useI18n, type StringKey } from "../../i18n";
import type { CockpitStage } from "../../workflow/workspaceNavigation";
import {
  buildJourneyAmbient,
  buildJourneyJournal,
  buildJourneyStationSheet,
  buildJourneyStations,
  buildJourneyTurns,
  buildJourneyYourMove,
  type JourneyActorKind,
  type JourneyChip,
  type JourneyStationId,
  type JourneyStationKind,
} from "../../workflow/journey";

const STATION_NAME_KEY: Record<JourneyStationId, StringKey> = {
  aim: "glass.station.aim",
  research: "glass.station.research",
  context: "glass.station.context",
  plan: "glass.station.plan",
  run: "glass.station.run",
  eval: "glass.station.eval",
};

const CHIP_KEY: Record<JourneyChip, StringKey> = {
  "aim": "glass.chip.aim",
  "owner.you": "glass.chip.you",
  "owner.agent": "glass.chip.agent",
  "status.done": "glass.chip.met",
  "status.open": "glass.chip.open",
  "status.blocked": "glass.chip.blocked",
  "eval.met": "glass.chip.met",
  "eval.open": "glass.chip.open",
  "context": "glass.chip.context",
};

const ACTOR_KEY: Record<JourneyActorKind, StringKey> = {
  you: "glass.actor.you",
  agent: "glass.actor.agent",
  cub: "glass.actor.cub",
};

function stationGlyphClass(kind: JourneyStationKind): string {
  return `od-journey-dot od-journey-dot-${kind}`;
}

function formatClock(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  try {
    return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export interface JourneyViewProps {
  goal: Goal;
  progress: AimProgressReadModel | null;
  disabled?: boolean;
  onOpenStage: (stage: CockpitStage) => void;
  onRunAgent: (milestone: Milestone) => void;
  onNewAim: () => void;
}

export function JourneyView(props: JourneyViewProps) {
  const { t } = useI18n();
  const tk = (key: string, vars?: Record<string, string | number>) => t(key as StringKey, vars);
  const [openStation, setOpenStation] = useState<JourneyStationId | null>(null);
  const { progress, goal } = props;

  if (!progress) {
    return (
      <section className="od-journey" data-od-id="journey-view">
        <header className="od-journey-head">
          <div className="od-journey-head-main">
            <h1 className="od-journey-title">{goal.title}</h1>
            <p className="od-journey-sub">{t("glass.journey.noPlan")}</p>
          </div>
        </header>
        <button className="od-journey-primary" type="button" onClick={() => props.onOpenStage("context")}>
          {t("glass.journey.noPlanCta")}
        </button>
      </section>
    );
  }

  const stations = buildJourneyStations(progress);
  const move = buildJourneyYourMove(progress, t);
  const ambient = buildJourneyAmbient(progress);
  const turns = buildJourneyTurns(progress, t, Date.now());
  const journal = buildJourneyJournal(progress);
  const sheet = openStation ? buildJourneyStationSheet(openStation, progress) : null;
  const headMeta = `${progress.completed_milestones}/${progress.total_milestones}`;

  const moveMilestone = move
    ? progress.milestones.find((row) => row.milestone.id === move.milestoneId)?.milestone ?? null
    : null;

  function runMove(): void {
    if (!move) return;
    if (move.kind === "run_agent" && moveMilestone) {
      props.onRunAgent(moveMilestone);
      return;
    }
    props.onOpenStage(move.kind === "review_eval" ? "eval" : "run");
  }

  return (
    <section className="od-journey" data-od-id="journey-view">
      <header className="od-journey-head">
        <div className="od-journey-head-main">
          <h1 className="od-journey-title">{goal.title}</h1>
          <p className="od-journey-sub">{t("glass.journey.headerSub")}</p>
        </div>
        <span className="od-journey-meta" aria-label={t("shell.progress")}>{headMeta}</span>
      </header>

      <div className="od-journey-stations" role="list" aria-label={t("cockpit.workflow")}>
        {stations.map((station) => (
          <button
            key={station.id}
            type="button"
            role="listitem"
            className={`od-journey-station${openStation === station.id ? " od-journey-station-open" : ""}`}
            onClick={() => setOpenStation(station.id)}
          >
            <span className="od-journey-station-name">
              <i className={stationGlyphClass(station.kind)} aria-hidden="true" />
              {tk(STATION_NAME_KEY[station.id])}
            </span>
            <span className="od-journey-station-line">
              {tk(`glass.station.line.${station.lineKey}`, station.lineVars)}
            </span>
          </button>
        ))}
      </div>

      {move ? (
        <div className="od-journey-move" data-od-id="journey-move">
          <div className="od-journey-move-head">
            <span className="od-journey-move-tag">{tk(move.tagKey)}</span>
          </div>
          <div className="od-journey-move-title">{move.title}</div>
          {move.body ? <p className="od-journey-move-body">{move.body}</p> : null}
          <div className="od-journey-move-actions">
            <button className="od-journey-primary" type="button" disabled={props.disabled} onClick={runMove}>
              {move.primaryLabel}
            </button>
          </div>
        </div>
      ) : (
        <div className="od-journey-ambient" data-od-id="journey-ambient">
          <i className="od-journey-dot od-journey-dot-active" aria-hidden="true" />
          <div className="od-journey-ambient-main">
            <div className="od-journey-ambient-title">{tk(ambient.titleKey)}</div>
            {ambient.body ? <div className="od-journey-ambient-body">{ambient.body}</div> : null}
          </div>
        </div>
      )}

      {turns.length > 0 ? (
        <div className="od-journey-turns">
          <div className="od-journey-eyebrow">{t("glass.journey.turnsTitle")}</div>
          {turns.map((turn, index) => (
            <div className="od-journey-turn" key={`${turn.who}-${index}`}>
              <span className={`od-journey-chip od-journey-chip-${turn.who}`}>{turn.label}</span>
              <span className="od-journey-turn-doing">{turn.doing}</span>
              {turn.since ? <span className="od-journey-turn-since">{turn.since}</span> : null}
            </div>
          ))}
        </div>
      ) : null}

      <div className="od-journey-journal">
        <div className="od-journey-journal-head">
          <span className="od-journey-eyebrow">{t("glass.journey.journalTitle")}</span>
          <span className="od-journey-journal-hint">{t("glass.journey.journalHint")}</span>
        </div>
        {journal.length === 0 ? (
          <div className="od-journey-journal-empty">{t("glass.journal.empty")}</div>
        ) : (
          journal.map((entry) => (
            <div className="od-journey-journal-row" key={entry.id}>
              <span className="od-journey-journal-time">{formatClock(entry.at)}</span>
              <span className={`od-journey-chip od-journey-chip-${entry.who}`}>{tk(ACTOR_KEY[entry.who])}</span>
              <span className="od-journey-journal-what">{entry.what}</span>
              {entry.stationId ? (
                <button
                  className="od-journey-journal-view"
                  type="button"
                  onClick={() => setOpenStation(entry.stationId ?? null)}
                >
                  {t("glass.journey.view")}
                </button>
              ) : null}
            </div>
          ))
        )}
      </div>

      {sheet ? (
        <div
          className="od-journey-sheet-scrim"
          role="presentation"
          onClick={() => setOpenStation(null)}
        >
          <div
            className="od-journey-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={tk(STATION_NAME_KEY[sheet.station])}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="od-journey-sheet-head">
              <span className="od-journey-sheet-title">{tk(STATION_NAME_KEY[sheet.station])}</span>
              <button
                className="od-journey-sheet-close"
                type="button"
                aria-label={t("glass.journey.close")}
                onClick={() => setOpenStation(null)}
              >
                ✕
              </button>
            </div>
            {sheet.rows.length === 0 ? (
              <p className="od-journey-sheet-empty">{t("glass.journey.sheetEmpty")}</p>
            ) : (
              <div className="od-journey-sheet-rows">
                {sheet.rows.map((row, index) => (
                  <div className="od-journey-sheet-row" key={`${row.chip}-${index}`}>
                    <span className={`od-journey-chip od-journey-chip-${row.chip.split(".")[0]}`}>{tk(CHIP_KEY[row.chip])}</span>
                    <span className="od-journey-sheet-text">{row.text}</span>
                    {row.meta ? <span className="od-journey-sheet-meta">{row.meta}</span> : null}
                  </div>
                ))}
              </div>
            )}
            {sheet.actionStage ? (
              <div className="od-journey-sheet-foot">
                <button
                  className="od-journey-secondary"
                  type="button"
                  onClick={() => {
                    const stage = sheet.actionStage;
                    setOpenStation(null);
                    if (stage) props.onOpenStage(stage);
                  }}
                >
                  {t("glass.journey.continue")}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
