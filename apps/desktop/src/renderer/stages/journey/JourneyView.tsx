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
 *
 * A station sheet can also be *interactive*: the Run station lists the aim's dispatchable
 * agent work as selectable options gated behind a confirm that calls the existing `runAgent`
 * handler in place (see `JourneyRunSheetBody`). Selection is component-local and reset on
 * every station change; the confirm is membership-gated so a background progress refresh
 * can't dispatch a milestone that dropped out of the option set.
 */
import type { AimProgressReadModel, Goal, Memory, Milestone, RunEvent } from "@core/domain";
import { useEffect, useRef, useState } from "react";

import { useI18n, type StringKey } from "../../i18n";
import type { CockpitStage } from "../../workflow/workspaceNavigation";
import {
  buildJourneyAmbient,
  buildJourneyJournal,
  buildJourneyStationSheet,
  buildJourneyStations,
  buildJourneyTurns,
  buildJourneyYourMove,
  canConfirmInteraction,
  resolveSelectedOption,
  type JourneyActorKind,
  type JourneyChip,
  type JourneyStationId,
  type JourneyStationInteraction,
  type JourneyStationKind,
  type JourneyStationSheetRow,
} from "../../workflow/journey";

const STATION_NAME_KEY: Record<JourneyStationId, StringKey> = {
  aim: "glass.station.aim",
  research: "glass.station.research",
  context: "glass.station.context",
  plan: "glass.station.plan",
  run: "glass.station.run",
  eval: "glass.station.eval",
};

/** Static, data-free descriptor shown under each station-sheet title (mirrors the reference sub). */
const SHEET_SUB_KEY: Record<JourneyStationId, StringKey> = {
  aim: "glass.journey.sheetSub.aim",
  research: "glass.journey.sheetSub.research",
  context: "glass.journey.sheetSub.context",
  plan: "glass.journey.sheetSub.plan",
  run: "glass.journey.sheetSub.run",
  eval: "glass.journey.sheetSub.eval",
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

/** Localized labels for the memory-category `meta` shown on context/research sheet rows. */
const MEMORY_CAT_KEY: Record<string, StringKey> = {
  preference: "glass.memory.cat.preference",
  constraint: "glass.memory.cat.constraint",
  capability: "glass.memory.cat.capability",
  eval_signal: "glass.memory.cat.eval_signal",
  project_fact: "glass.memory.cat.project_fact",
  procedure: "glass.memory.cat.procedure",
};

/**
 * Localized labels for the status-token `meta` on plan/run/eval sheet rows (the milestone/run
 * status literals). Free-text metas — e.g. an eval row's `next_action` — are not in this map and
 * pass through verbatim, so `translate()` is never called with an unknown key.
 */
const STATION_META_KEY: Record<string, StringKey> = {
  done: "glass.station.meta.done",
  blocked: "glass.station.meta.blocked",
  met: "glass.station.meta.met",
  pending: "glass.station.meta.pending",
  in_progress: "glass.station.meta.inProgress",
  completed: "glass.station.meta.completed",
  skipped: "glass.station.meta.skipped",
  queued: "glass.station.meta.queued",
  running: "glass.station.meta.running",
  failed: "glass.station.meta.failed",
  cancelled: "glass.station.meta.cancelled",
};

/** Localizes a status-literal meta (run/milestone status) via `STATION_META_KEY`, else passes it through. */
function statusMetaLabel(meta: string | undefined, tk: (key: string) => string): string {
  if (!meta) return "";
  const key = STATION_META_KEY[meta];
  return key ? tk(key) : meta;
}

function stationGlyphClass(kind: JourneyStationKind): string {
  return `od-journey-dot od-journey-dot-${kind}`;
}

function chipClass(chip: JourneyChip): string {
  return `od-journey-chip od-journey-chip-${chip.split(".")[0]}`;
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

/**
 * The interactive body of the Run station sheet: dispatchable milestones as a single-select
 * radiogroup, the non-dispatchable remainder read-only below, and an enable-gated confirm.
 * Stateless and prop-driven so it renders (and is asserted) in both the un-selected and
 * selected states under `renderToStaticMarkup` — the parent owns the selection state.
 */
export interface JourneyRunSheetBodyProps {
  interaction: JourneyStationInteraction;
  selectedOptionId: string | null;
  disabled: boolean;
  onSelect: (milestoneId: string) => void;
  onConfirm: () => void;
}

export function JourneyRunSheetBody(props: JourneyRunSheetBodyProps) {
  const { interaction, selectedOptionId, disabled, onSelect, onConfirm } = props;
  const { t } = useI18n();
  const tk = (key: string, vars?: Record<string, string | number>) => t(key as StringKey, vars);
  const hasSelection = resolveSelectedOption(interaction.options, selectedOptionId) !== null;
  const canConfirm = canConfirmInteraction(selectedOptionId, interaction.options, disabled);

  return (
    <div className="od-journey-interactive">
      <div className="od-journey-options" role="radiogroup" aria-label={t("glass.station.run")}>
        {interaction.options.map((option) => {
          const selected = option.milestoneId === selectedOptionId;
          return (
            <button
              key={option.milestoneId}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`od-journey-option${selected ? " od-journey-option-open" : ""}`}
              onClick={() => onSelect(option.milestoneId)}
            >
              <span className="od-journey-option-title">{option.text}</span>
              {option.note ? <span className="od-journey-option-note">{statusMetaLabel(option.note, tk)}</span> : null}
            </button>
          );
        })}
      </div>

      {interaction.contextRows.length > 0 ? (
        <div className="od-journey-sheet-rows">
          {interaction.contextRows.map((row, index) => (
            <div className="od-journey-sheet-row" key={`ctx-${row.chip}-${index}`}>
              <span className={chipClass(row.chip)}>{t(CHIP_KEY[row.chip])}</span>
              <span className="od-journey-sheet-text">{row.text}</span>
              {row.meta ? <span className="od-journey-sheet-meta">{statusMetaLabel(row.meta, tk)}</span> : null}
            </div>
          ))}
        </div>
      ) : null}

      <div className="od-journey-sheet-hint">
        <span className="od-journey-sheet-hint-text">{t("glass.journey.interactiveHint")}</span>
        <button className="od-journey-primary" type="button" disabled={!canConfirm} onClick={onConfirm}>
          {hasSelection ? t("glass.journey.confirmRun") : t("glass.journey.confirmPick")}
        </button>
      </div>
    </div>
  );
}

export interface JourneyViewProps {
  goal: Goal;
  progress: AimProgressReadModel | null;
  /** The aim's run-lifecycle event stream (loaded separately from progress). */
  runEvents?: RunEvent[];
  /** Active context/research memories in play for this aim (aim-scoped + global). */
  researchMemories?: Memory[];
  disabled?: boolean;
  /** Count of OTHER aims with a turn waiting on the user, for the header jump chip. */
  elsewhereCount?: number;
  onOpenStage: (stage: CockpitStage) => void;
  onRunAgent: (milestone: Milestone) => void;
  onNewAim: () => void;
  /** Jump to the next aim with a turn waiting elsewhere (header chip). */
  onJumpElsewhere?: () => void;
  /**
   * Secondary "Your move" / ambient affordances. Each renders only when its handler is
   * provided; the routing/scheduling backends land in Stage 6, so App passes none today
   * and these stay hidden (the markup + CSS ship as forward-ready infrastructure).
   */
  onHandToAgent?: () => void;
  onSchedule?: () => void;
  onLater?: () => void;
  onTakeBack?: () => void;
}

export function JourneyView(props: JourneyViewProps) {
  const { t } = useI18n();
  const tk = (key: string, vars?: Record<string, string | number>) => t(key as StringKey, vars);
  // Sheet `meta` is a raw memory-category enum only on context/research rows; localize those,
  // pass other metas (run/eval status, "done"/"blocked") through verbatim.
  const sheetMetaLabel = (row: JourneyStationSheetRow): string => {
    if (!row.meta) return "";
    if (row.chip === "context") {
      const catKey = MEMORY_CAT_KEY[row.meta];
      return catKey ? tk(catKey) : row.meta;
    }
    return statusMetaLabel(row.meta, tk);
  };
  const [openStation, setOpenStation] = useState<JourneyStationId | null>(null);
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const sheetCloseRef = useRef<HTMLButtonElement | null>(null);
  const sheetTriggerRef = useRef<HTMLElement | null>(null);
  const { progress, goal } = props;

  // Modal-sheet focus management: move focus into the dialog on open, close on Escape, and
  // restore focus to the control that opened it on close. `aria-modal` alone does not do this.
  // Also resets any interactive selection whenever the open station changes.
  useEffect(() => {
    setSelectedOptionId(null);
    if (!openStation) return;
    sheetTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusFrame = requestAnimationFrame(() => sheetCloseRef.current?.focus());
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpenStation(null);
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", onKeyDown, true);
      const trigger = sheetTriggerRef.current;
      sheetTriggerRef.current = null;
      if (trigger) requestAnimationFrame(() => trigger.focus());
    };
  }, [openStation]);

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

  const researchMemories = props.researchMemories ?? [];
  const stations = buildJourneyStations(progress, researchMemories);
  const move = buildJourneyYourMove(progress, t);
  const ambient = buildJourneyAmbient(progress);
  const turns = buildJourneyTurns(progress, t, Date.now());
  const journal = buildJourneyJournal(progress, props.runEvents ?? []);
  const sheet = openStation ? buildJourneyStationSheet(openStation, progress, researchMemories) : null;
  const headMeta = `${progress.completed_milestones}/${progress.total_milestones}`;
  const elsewhereCount = props.elsewhereCount ?? 0;
  const showElsewhere = elsewhereCount > 0 && Boolean(props.onJumpElsewhere);
  const hasMoveSecondary = Boolean(props.onHandToAgent || props.onSchedule || props.onLater);

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

  function confirmInteraction(): void {
    if (!progress || !sheet?.interaction) return;
    if (!canConfirmInteraction(selectedOptionId, sheet.interaction.options, Boolean(props.disabled))) return;
    const option = resolveSelectedOption(sheet.interaction.options, selectedOptionId);
    if (!option) return;
    const milestone = progress.milestones.find((row) => row.milestone.id === option.milestoneId)?.milestone;
    if (!milestone) return;
    props.onRunAgent(milestone);
    setOpenStation(null);
  }

  return (
    <section className="od-journey" data-od-id="journey-view">
      <header className="od-journey-head">
        <div className="od-journey-head-main">
          <h1 className="od-journey-title">{goal.title}</h1>
          <p className="od-journey-sub">{t("glass.journey.headerSub")}</p>
        </div>
        <div className="od-journey-head-meta">
          {showElsewhere ? (
            <button
              className="od-journey-elsewhere"
              type="button"
              onClick={props.onJumpElsewhere}
              title={t("glass.journey.headerSub")}
            >
              {elsewhereCount === 1
                ? t("glass.journey.turnsElsewhereOne")
                : tk("glass.journey.turnsElsewhereMany", { n: elsewhereCount })}
            </button>
          ) : null}
          <span className="od-journey-meta" aria-label={t("shell.progress")}>{headMeta}</span>
        </div>
      </header>

      <div className="od-journey-stations" role="group" aria-label={t("cockpit.workflow")}>
        {stations.map((station) => (
          <button
            key={station.id}
            type="button"
            className={`od-journey-station${station.kind === "up" ? " od-journey-station-up" : ""}${openStation === station.id ? " od-journey-station-open" : ""}`}
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
            <span className="od-journey-chip od-journey-chip-you">{t("glass.actor.you")}</span>
          </div>
          <div className="od-journey-move-title">{move.title}</div>
          {move.body ? <p className="od-journey-move-body">{move.body}</p> : null}
          <div className="od-journey-move-actions">
            <button className="od-journey-primary" type="button" disabled={props.disabled} onClick={runMove}>
              {move.primaryLabel}
            </button>
          </div>
          {hasMoveSecondary ? (
            <div className="od-journey-move-secondary">
              {props.onHandToAgent ? (
                <button className="od-journey-secondary" type="button" onClick={props.onHandToAgent}>
                  {t("glass.journey.handToAgent")}
                </button>
              ) : null}
              {props.onSchedule ? (
                <button className="od-journey-secondary" type="button" onClick={props.onSchedule}>
                  {t("glass.journey.schedule")}
                </button>
              ) : null}
              {props.onLater ? (
                <button className="od-journey-later" type="button" onClick={props.onLater}>
                  {t("glass.journey.later")}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="od-journey-ambient" data-od-id="journey-ambient">
          <i className="od-journey-dot od-journey-dot-active" aria-hidden="true" />
          <div className="od-journey-ambient-main">
            <div className="od-journey-ambient-title">{tk(ambient.titleKey)}</div>
            {ambient.body ? <div className="od-journey-ambient-body">{ambient.body}</div> : null}
          </div>
          {props.onTakeBack ? (
            <button className="od-journey-ambient-btn" type="button" onClick={props.onTakeBack}>
              {t("glass.journey.takeBack")}
            </button>
          ) : null}
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
              <span className="od-journey-journal-what">
                {entry.what || (entry.detailKey ? tk(`glass.journal.event.${entry.detailKey}`) : "")}
              </span>
              {entry.stationId ? (
                <button
                  className="od-journey-journal-view"
                  type="button"
                  aria-label={`${t("glass.journey.view")} · ${tk(STATION_NAME_KEY[entry.stationId])}`}
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
              <span className="od-journey-sheet-sub">{t(SHEET_SUB_KEY[sheet.station])}</span>
              <button
                ref={sheetCloseRef}
                className="od-journey-sheet-close"
                type="button"
                aria-label={t("glass.journey.close")}
                onClick={() => setOpenStation(null)}
              >
                ✕
              </button>
            </div>
            {sheet.interaction ? (
              <JourneyRunSheetBody
                interaction={sheet.interaction}
                selectedOptionId={selectedOptionId}
                disabled={Boolean(props.disabled)}
                onSelect={setSelectedOptionId}
                onConfirm={confirmInteraction}
              />
            ) : sheet.rows.length === 0 ? (
              <p className="od-journey-sheet-empty">{t("glass.journey.sheetEmpty")}</p>
            ) : (
              <div className="od-journey-sheet-rows">
                {sheet.rows.map((row, index) => (
                  <div className="od-journey-sheet-row" key={`${row.chip}-${index}`}>
                    <span className={chipClass(row.chip)}>{tk(CHIP_KEY[row.chip])}</span>
                    <span className="od-journey-sheet-text">{row.text}</span>
                    {row.meta ? <span className="od-journey-sheet-meta">{sheetMetaLabel(row)}</span> : null}
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
