/**
 * The run timeline: one collapsible block per run of the selected sub-aim, built from the persisted
 * run-event stream plus whatever is still streaming live.
 *
 * Rows are labeled from a lookup, never an exhaustive switch, so an event type this build does not
 * know still renders honestly (its type, its summary, its time) instead of vanishing.
 */
import type { Run, RunEvent } from "@aimcub/types";

import { useI18n, type StringKey } from "../../i18n";
import { shortText } from "../../workflow/text";
import type { RunLiveEvent } from "../../../shared/ipc";
import {
  buildRunTimeline,
  isSettledRunStatus,
  type RunTimelineEntry,
  type RunTimelineKind,
  type RunTimelineRow,
} from "./runTimeline";

const KIND_LABEL_KEY: Record<RunTimelineKind, StringKey> = {
  queued: "runTimeline.kind.queued",
  started: "runTimeline.kind.started",
  tool: "runTimeline.kind.tool",
  log: "runTimeline.kind.log",
  retry: "runTimeline.kind.retry",
  artifact: "runTimeline.kind.artifact",
  evidence: "runTimeline.kind.evidence",
  terminal: "runTimeline.kind.terminal",
  other: "runTimeline.kind.other",
};

const STATUS_LABEL_KEY: Record<string, StringKey> = {
  queued: "runTimeline.status.queued",
  running: "runTimeline.status.running",
  completed: "runTimeline.status.completed",
  failed: "runTimeline.status.failed",
  cancelled: "runTimeline.status.cancelled",
  blocked: "runTimeline.status.blocked",
};

function clockTime(at: string): string {
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function RunTimelinePanel(props: {
  milestoneId: string;
  runEvents: readonly RunEvent[];
  runs: readonly Run[];
  liveEvents?: readonly RunLiveEvent[];
  liveRunId?: string | null;
  liveEventsDropped?: number;
}) {
  const { t } = useI18n();
  const entries = buildRunTimeline({
    runEvents: props.runEvents,
    runs: props.runs,
    milestoneId: props.milestoneId,
    ...(props.liveEvents ? { liveEvents: props.liveEvents } : {}),
    ...(props.liveRunId ? { liveRunId: props.liveRunId } : {}),
    ...(props.liveEventsDropped ? { liveEventsDropped: props.liveEventsDropped } : {}),
  });

  return (
    <section className="od-run-timeline" aria-label={t("runTimeline.title")} data-od-id="run-timeline">
      <div className="od-run-timeline-head">
        <strong>{t("runTimeline.title")}</strong>
      </div>
      {entries.length === 0 ? (
        <p className="od-run-timeline-empty">{t("runTimeline.empty")}</p>
      ) : (
        entries.map((entry, index) => (
          <RunTimelineBlock
            key={entry.runId}
            entry={entry}
            // Newest first, so the newest run carries the highest ordinal and is open by default.
            label={t("runTimeline.runLabel", { n: entries.length - index })}
            open={index === 0 && (entry.live || !isSettledRunStatus(entry.status))}
          />
        ))
      )}
    </section>
  );
}

function RunTimelineBlock(props: { entry: RunTimelineEntry; label: string; open: boolean }) {
  const { t } = useI18n();
  const { entry } = props;
  const statusKey = STATUS_LABEL_KEY[entry.status];
  const meta = [
    t("execute.sandboxMode", { mode: entry.sandbox }),
    t(entry.network ? "execute.networkOn" : "execute.networkOff"),
    t("runTimeline.stepCount", { n: entry.rows.length }),
  ];
  if (entry.attempt > 1) meta.push(t("runTimeline.attempt", { n: entry.attempt }));
  // Provenance only — a run queued before this field existed just omits the tag, honestly.
  if (entry.surface) meta.push(t(entry.surface === "cli" ? "runTimeline.surface.cli" : "runTimeline.surface.desktop"));

  return (
    <details className="od-run-timeline-run" open={props.open}>
      <summary>
        <span className="od-run-timeline-run-copy">
          <strong>{props.label}</strong>
          <small>{meta.join(" · ")}</small>
        </span>
        <span className="od-run-timeline-run-meta">
          {entry.live ? <span className="od-pill blue">{t("runTimeline.live")}</span> : null}
          <span className="od-pill">{statusKey ? t(statusKey) : entry.status}</span>
        </span>
      </summary>
      <ol className="od-run-timeline-rows">
        {entry.retryOf ? (
          <li className="od-run-timeline-row" data-kind="retry">
            <span className="od-run-timeline-row-kind">{t("runTimeline.kind.retry")}</span>
            <span className="od-run-timeline-row-main">{t("runTimeline.retryOf")}</span>
          </li>
        ) : null}
        {entry.rows.map((row) => <RunTimelineRowItem key={row.id} row={row} />)}
      </ol>
      {entry.workspaceRoot ? (
        <p className="od-run-timeline-workspace">
          {t("execute.workspace")} · <code>{entry.workspaceRoot}</code>
        </p>
      ) : null}
    </details>
  );
}

function RunTimelineRowItem({ row }: { row: RunTimelineRow }) {
  const { t } = useI18n();
  const detail: string[] = [];
  if (row.toolName) detail.push(row.toolName);
  if (row.durationMs !== null) detail.push(t("runTimeline.duration", { ms: row.durationMs }));
  else if (row.pending) detail.push(t("runTimeline.pending"));
  // An unrecognized type is shown verbatim: the reader learns what happened even when this build
  // has no label for it.
  if (row.kind === "other") detail.push(row.type);
  const time = clockTime(row.at);

  return (
    <li className="od-run-timeline-row" data-kind={row.kind} data-live={row.live ? "true" : "false"}>
      <span className="od-run-timeline-row-kind">{t(KIND_LABEL_KEY[row.kind])}</span>
      <span className="od-run-timeline-row-main">
        {row.summary ? shortText(row.summary, 220) : row.type}
        {detail.length ? <small>{detail.join(" · ")}</small> : null}
      </span>
      {time ? <time className="od-run-timeline-row-time" dateTime={row.at}>{time}</time> : null}
    </li>
  );
}
