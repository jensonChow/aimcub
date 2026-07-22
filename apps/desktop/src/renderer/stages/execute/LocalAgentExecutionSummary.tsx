import type { ReactNode } from "react";

import { routingOverrideForMilestone } from "@aimcub/core";
import type { AimProgressReadModel, RunStatus } from "@aimcub/types";

import { useI18n, type I18n } from "../../i18n";

type ProgressMilestoneRow = AimProgressReadModel["milestones"][number];
type ProgressActor = AimProgressReadModel["actors"][number];
type ProgressEvidenceReviewItem = ProgressMilestoneRow["evidence"][number];

type ActivityEvent = {
  type: string;
  summary: string;
};

function shortText(value: string | undefined | null, max = 120): string {
  const cleaned = (value ?? "").replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1).trim()}...`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringField(value: unknown, key: string): string | null {
  const raw = asRecord(value)?.[key];
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTrust(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function runStatusTone(status: RunStatus | null | undefined): string {
  if (status === "completed") return "success";
  if (status === "failed" || status === "cancelled") return "danger";
  if (status === "running") return "blue";
  if (status === "queued" || status === "blocked") return "warn";
  return "";
}

function statusLabel(row: ProgressMilestoneRow, t: I18n["t"]): string {
  switch (row.latest_run?.status) {
    case "queued":
      return t("execute.runStatus.queued");
    case "running":
      return t("execute.runStatus.running");
    case "blocked":
      return t("execute.runStatus.blocked");
    case "completed":
      return t("execute.runStatus.completed");
    case "failed":
      return t("execute.runStatus.failed");
    case "cancelled":
      return t("execute.runStatus.cancelled");
    default:
      return t("execute.runStatus.notStarted");
  }
}

function runTiming(row: ProgressMilestoneRow, t: I18n["t"]): string {
  const run = row.latest_run;
  if (!run) return t("execute.runNotStartedDetail");
  if (run.status === "queued") {
    const queued = formatDate(run.queued_at);
    return queued ? t("execute.runQueuedAt", { time: queued }) : t("execute.runTimestampMissing");
  }
  if (run.status === "running" || run.status === "blocked") {
    const started = formatDate(run.started_at);
    return started ? t("execute.runStartedAt", { time: started }) : t("execute.runTimestampMissing");
  }
  const finished = formatDate(run.finished_at);
  if (finished) return t("execute.runFinishedAt", { time: finished });
  const started = formatDate(run.started_at);
  return started ? t("execute.runStartedAt", { time: started }) : t("execute.runTimestampMissing");
}

function latestAgentEvidence(row: ProgressMilestoneRow): ProgressEvidenceReviewItem | null {
  let selected: ProgressEvidenceReviewItem | null = null;
  for (const item of row.evidence) {
    const payload = asRecord(item.evidence.payload);
    if (payload && (Array.isArray(payload.events) || stringField(payload, "agent_id"))) {
      selected = item;
    }
  }
  return selected;
}

// Legacy display fallback for historical evidence rows only. New adapters need
// no entry here: their name flows adapter.name -> LocalAgentDetection.name ->
// routing agent_label. Do not extend this map.
function localAgentName(agentId: string | null): string | null {
  if (!agentId) return null;
  if (agentId === "codex") return "Codex CLI";
  if (agentId === "claude") return "Claude Code";
  return agentId;
}

function selectedAgent(row: ProgressMilestoneRow, actors: readonly ProgressActor[], t: I18n["t"]): string {
  const override = routingOverrideForMilestone(row.milestone);
  if (override?.owner === "human" || row.assignment?.actor_kind === "human") return t("execute.humanRoute");
  const actorId = row.assignment?.actor_id ?? row.latest_run?.actor_id ?? null;
  const actor = actorId ? actors.find((item) => item.id === actorId) : null;
  const agentEvidence = latestAgentEvidence(row);
  const agentId = stringField(agentEvidence?.evidence.payload, "agent_id");
  return override?.agent_label
    ?? localAgentName(override?.agent_id ?? null)
    ?? actor?.display_name
    ?? localAgentName(agentId)
    ?? (row.assignment?.actor_kind === "agent" || row.latest_run?.actor_kind === "agent"
      ? t("execute.agentNotRecorded")
      : t("execute.noLocalAgentSelected"));
}

function routeMeta(row: ProgressMilestoneRow, t: I18n["t"]): string {
  const override = routingOverrideForMilestone(row.milestone);
  if (override?.owner === "human" || row.assignment?.actor_kind === "human") return t("execute.humanRouteMeta");
  if (row.assignment) return [row.assignment.status, row.assignment.source].filter(Boolean).join(" · ");
  return override?.reason || t("execute.noAssignmentMeta");
}

function modelText(row: ProgressMilestoneRow, t: I18n["t"]): string {
  const override = routingOverrideForMilestone(row.milestone);
  const payload = latestAgentEvidence(row)?.evidence.payload;
  return row.latest_run?.model
    ?? (override?.owner === "agent" ? override.model_label || override.model : null)
    ?? stringField(payload, "model")
    ?? t("execute.modelNotRecorded");
}

function hasModelText(row: ProgressMilestoneRow): boolean {
  const override = routingOverrideForMilestone(row.milestone);
  const payload = latestAgentEvidence(row)?.evidence.payload;
  return Boolean(
    row.latest_run?.model
    || (override?.owner === "agent" ? override.model_label || override.model : null)
    || stringField(payload, "model"),
  );
}

function reasoningText(row: ProgressMilestoneRow, t: I18n["t"]): string {
  return row.latest_run?.reasoning || t("execute.reasoningNotRecorded");
}

function workspaceText(row: ProgressMilestoneRow, t: I18n["t"]): string {
  return row.latest_run?.workspace_root || t("execute.workspaceNotRecorded");
}

function permissionText(row: ProgressMilestoneRow, t: I18n["t"]): string {
  const run = row.latest_run;
  if (!run) return t("execute.permissionsNotRecorded");
  const sandbox = run.sandbox ? t("execute.sandboxMode", { mode: run.sandbox }) : null;
  const network = run.network_enabled ? t("execute.networkOn") : t("execute.networkOff");
  return [sandbox, network].filter(Boolean).join(" · ");
}

function evidenceState(row: ProgressMilestoneRow, t: I18n["t"]): { tone: string; title: string; detail: string } {
  const count = Math.max(row.evidence_count, row.evidence.length);
  const lowTrust = row.evidence.filter((item) => item.status === "low_trust").length;
  const matched = row.evidence.filter((item) => item.status === "matched").length;
  if (count === 0) {
    return {
      tone: "",
      title: t("execute.evidenceNoneTitle"),
      detail: row.eval_review.next_action || t("os.evidenceNoDetailsAction"),
    };
  }
  if (lowTrust > 0) {
    return {
      tone: "warn",
      title: t("execute.evidenceLowTrustTitle"),
      detail: t("execute.evidenceLowTrustDetail", { lowTrust, total: count }),
    };
  }
  if (matched > 0) {
    const trust = formatTrust(row.eval_review.trust_score);
    return {
      tone: "success",
      title: t("execute.evidenceMatchedTitle"),
      detail: t("execute.evidenceMatchedDetail", { matched, total: count, trust }),
    };
  }
  return {
    tone: "",
    title: t("execute.evidenceNeedsEvalTitle"),
    detail: t("execute.evidenceNeedsEvalDetail", { total: count }),
  };
}

function activityEvent(raw: unknown): ActivityEvent | null {
  const record = asRecord(raw);
  if (!record) return null;
  const type = typeof record.type === "string" ? record.type : "";
  const summary = typeof record.summary === "string" ? shortText(record.summary, 96) : "";
  if (!type || !summary) return null;
  return { type, summary };
}

function activityLabel(type: string, t: I18n["t"]): string {
  switch (type) {
    case "agent.run.started":
      return t("execute.activity.started");
    case "agent.tool.started":
      return t("execute.activity.toolStarted");
    case "agent.tool.finished":
      return t("execute.activity.toolFinished");
    case "agent.usage.reported":
      return t("execute.activity.usage");
    case "agent.run.completed":
      return t("execute.activity.completed");
    case "agent.run.failed":
      return t("execute.activity.failed");
    case "agent.stderr":
      return t("execute.activity.note");
    default:
      return t("execute.activity.event");
  }
}

function compactActivity(row: ProgressMilestoneRow): ActivityEvent[] {
  const payload = asRecord(latestAgentEvidence(row)?.evidence.payload);
  const rawEvents = Array.isArray(payload?.events) ? payload.events : [];
  const events = rawEvents
    .map(activityEvent)
    .filter((event): event is ActivityEvent => Boolean(event));
  const userFacing = events.filter((event) => event.type !== "agent.raw" && event.type !== "agent.message.delta");
  const deduped: ActivityEvent[] = [];
  for (const event of userFacing) {
    const previous = deduped[deduped.length - 1];
    if (previous?.type === event.type && previous.summary === event.summary) continue;
    deduped.push(event);
  }
  return deduped.length > 4 ? [deduped[0]!, ...deduped.slice(-3)] : deduped;
}

export function LocalAgentExecutionSummary(props: {
  row: ProgressMilestoneRow;
  actors: readonly ProgressActor[];
  task?: ReactNode;
}) {
  const { t } = useI18n();
  const row = props.row;
  const evidence = evidenceState(row, t);
  const activity = compactActivity(row);
  const nextAction = row.eval_review.next_action || row.next_action || t("shell.noNextAction");
  const modelRecorded = hasModelText(row);

  return (
    <section className="od-execution-summary" aria-label={t("execute.summaryLabel")}>
      <div className="od-execution-subaim">
        <div className="od-execution-subaim-head">
          <span>{t("execute.selectedSubAim")}</span>
          <span className={`od-pill ${row.completed ? "success" : row.blocked ? "danger" : ""}`}>
            {row.completed ? t("os.done") : row.milestone.status}
          </span>
        </div>
        <strong>{row.milestone.title}</strong>
        {row.milestone.description ? <p>{shortText(row.milestone.description, 220)}</p> : null}
      </div>

      <div className="od-execution-grid">
        <div className="od-execution-field">
          <span>{t("execute.localAgent")}</span>
          <strong>{selectedAgent(row, props.actors, t)}</strong>
          <small>{routeMeta(row, t)}</small>
        </div>
        <div className="od-execution-field">
          <span>{t("execute.runState")}</span>
          <strong>
            <span className={`od-pill ${runStatusTone(row.latest_run?.status)}`}>{statusLabel(row, t)}</span>
          </strong>
          <small>{runTiming(row, t)}</small>
        </div>
        <div className={`od-execution-evidence${evidence.tone ? ` ${evidence.tone}` : ""}`}>
          <span>{t("execute.producedEvidence")}</span>
          <strong>{evidence.title}</strong>
          <small>{evidence.detail}</small>
        </div>
        <div className="od-execution-next">
          <span>{t("execute.nextHumanEvalAction")}</span>
          <strong>{nextAction}</strong>
        </div>
      </div>

      {props.task ? <div className="od-execute-task">{props.task}</div> : null}

      <details className="od-execution-secondary-details">
        <summary>
          <span>{t("execute.runtimeDetails")} · {t("execute.activityTitle")}</span>
          <small>{activity.length ? t("execute.activityCount", { n: activity.length }) : t("execute.activityEmpty")}</small>
        </summary>
        <div className="od-execution-secondary-body">
          <div className="od-execution-runtime" aria-label={t("execute.runtimeDetails")}>
            <div className="od-execution-field">
              <span>{t("execute.modelReasoning")}</span>
              <strong className={!modelRecorded ? "is-placeholder" : ""}>{modelText(row, t)}</strong>
              <small>{t("execute.reasoningValue", { value: reasoningText(row, t) })}</small>
            </div>
            <div className="od-execution-field">
              <span>{t("execute.workspace")}</span>
              <strong className={!row.latest_run?.workspace_root ? "is-placeholder" : ""}>{workspaceText(row, t)}</strong>
              <small>{permissionText(row, t)}</small>
            </div>
          </div>

          <div className="od-execution-activity">
            <div className="od-execution-activity-head">
              <span>{t("execute.activityTitle")}</span>
              <small>{activity.length ? t("execute.activityCount", { n: activity.length }) : t("execute.activityEmpty")}</small>
            </div>
            {activity.length ? (
              <ol>
                {activity.map((event, index) => (
                  <li key={`${event.type}-${index}`}>
                    <span>{activityLabel(event.type, t)}</span>
                    <strong>{event.summary}</strong>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="od-empty-inline">{row.latest_run?.summary || row.latest_run?.error || t("execute.activityNoEvents")}</div>
            )}
          </div>
        </div>
      </details>
    </section>
  );
}
