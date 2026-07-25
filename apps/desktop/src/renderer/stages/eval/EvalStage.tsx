import type { AimProgressReadModel } from "@aimcub/core";
import type { Evidence } from "@aimcub/types";

import { useI18n, type I18n } from "../../i18n";

export type EvalStageMilestoneRow = AimProgressReadModel["milestones"][number];
type EvalEvidenceReviewItem = EvalStageMilestoneRow["evidence"][number];
type EvalState = "passed" | "failed" | "needs_human" | "unsupported" | "error" | "pending";

function shortText(value: string | undefined | null, max = 120): string {
  const cleaned = (value ?? "").replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1).trim()}...`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function manualPayloadField(evidence: Evidence, key: string): unknown {
  return asRecord(evidence.payload)?.[key];
}

function evidenceReferenceMeta(evidence: Evidence): string {
  const urls = stringArray(manualPayloadField(evidence, "urls"));
  const files = stringArray(manualPayloadField(evidence, "file_paths"));
  const required = Array.isArray(manualPayloadField(evidence, "required_evidence"))
    ? (manualPayloadField(evidence, "required_evidence") as unknown[])
      .map(asRecord)
      .filter((item): item is Record<string, unknown> => Boolean(item))
    : [];
  const checked = required.filter((item) => item.satisfied === true).length;
  return [
    evidence.kind,
    urls.length ? `${urls.length} URL${urls.length === 1 ? "" : "s"}` : "",
    files.length ? `${files.length} file${files.length === 1 ? "" : "s"}` : "",
    required.length ? `${checked}/${required.length} required` : "",
  ].filter(Boolean).join(" | ");
}

function evidenceDisplaySummary(evidence: Evidence): string {
  const proofNote = manualPayloadField(evidence, "proof_note");
  return typeof proofNote === "string" && proofNote.trim() ? proofNote : evidence.summary;
}

function evalToneClass(state: EvalState): string {
  if (state === "passed") return "success";
  if (state === "failed" || state === "error") return "danger";
  if (state === "needs_human" || state === "unsupported") return "warn";
  return "";
}

function evalLabel(t: I18n["t"], state: EvalState): string {
  switch (state) {
    case "passed":
      return t("os.evalStatus.passed");
    case "failed":
      return t("os.evalStatus.failed");
    case "needs_human":
      return t("os.evalStatus.needsHuman");
    case "unsupported":
      return t("os.evalStatus.unsupported");
    case "error":
      return t("os.evalStatus.error");
    case "pending":
      return t("os.evalStatus.pending");
  }
}

function shortId(value: string): string {
  return value.length <= 8 ? value : value.slice(0, 8);
}

function formatTrust(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatEvidenceKind(kind: string): string {
  return kind.replace(/_/g, " ");
}

function formatEvidenceTime(value: string | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function evidencePayloadText(item: EvalEvidenceReviewItem): string {
  const payload = item.evidence.payload;
  const parts: string[] = [];
  const proofNote = manualPayloadField(item.evidence, "proof_note");
  const message = typeof payload.message === "string" ? payload.message.trim() : "";
  const branch = typeof payload.branch === "string" ? payload.branch.trim() : "";
  const workflow = typeof payload.workflow === "string" ? payload.workflow.trim() : "";
  const conclusion = typeof payload.conclusion === "string" ? payload.conclusion.trim() : "";
  const files = Array.isArray(payload.files) ? payload.files.filter((file): file is string => typeof file === "string") : [];
  if (typeof proofNote === "string" && proofNote.trim()) parts.push(proofNote.trim());
  if (message) parts.push(message);
  if (workflow || conclusion) parts.push([workflow, conclusion].filter(Boolean).join(" "));
  if (branch) parts.push(`branch ${branch}`);
  if (files.length > 0) parts.push(`${files.length} file${files.length === 1 ? "" : "s"}: ${files.slice(0, 3).join(", ")}`);
  const referenceMeta = evidenceReferenceMeta(item.evidence);
  if (referenceMeta && referenceMeta !== item.evidence.kind) parts.push(referenceMeta);
  return parts.join(" | ");
}

function evidenceTitle(item: EvalEvidenceReviewItem): string {
  const summary = evidenceDisplaySummary(item.evidence).trim();
  return summary || evidencePayloadText(item) || formatEvidenceKind(item.evidence.kind);
}

function evidenceStatusTone(item: EvalEvidenceReviewItem): string {
  if (item.status === "matched") return "success";
  if (item.status === "low_trust") return "warn";
  return "";
}

function matchedRuleText(item: EvalEvidenceReviewItem): string {
  return item.rule_matches.map((match) => `#${match.clause_index + 1} ${match.evaluator}`).join(", ");
}

function matchedEvidenceText(row: EvalStageMilestoneRow, evidenceIds: readonly string[]): string {
  const ids = new Set(evidenceIds);
  return row.evidence
    .filter((item) => ids.has(item.evidence.id))
    .map((item) => shortText(evidenceTitle(item), 64))
    .join(", ");
}

function EvalStageMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="od-stage-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function EvidenceReviewList(props: {
  row: EvalStageMilestoneRow;
  limit?: number;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const items = props.limit ? props.row.evidence.slice(0, props.limit) : props.row.evidence;
  const hiddenCount = Math.max(0, props.row.evidence.length - items.length);

  function statusLabel(item: EvalEvidenceReviewItem): string {
    switch (item.status) {
      case "matched":
        return t("os.evidenceStatus.matched");
      case "low_trust":
        return t("os.evidenceStatus.lowTrust");
      case "unmatched":
        return t("os.evidenceStatus.unmatched");
    }
  }

  return (
    <div className={`od-evidence-review${props.compact ? " is-compact" : ""}`}>
      <div className="od-evidence-review-head">
        <span>{t("os.evidenceDetails")}</span>
        <span>{t("os.evidenceCount", { n: props.row.evidence_count })}</span>
      </div>

      {items.length === 0 ? (
        <div className="od-empty-inline od-evidence-empty">
          <strong>{t("os.evidenceNoDetails")}</strong>
          <span>{props.row.eval_review.next_action || t("os.evidenceNoDetailsAction")}</span>
        </div>
      ) : (
        <div className="od-evidence-list">
          {items.map((item) => {
            const ruleMatches = matchedRuleText(item);
            const payloadText = evidencePayloadText(item);
            const occurred = formatEvidenceTime(item.evidence.occurred_at);
            return (
              <div key={item.evidence.id} className={`od-evidence-row ${item.status}`}>
                <div className="od-evidence-row-head">
                  <strong>{shortText(evidenceTitle(item), props.compact ? 96 : 150)}</strong>
                  <span className={`od-pill ${evidenceStatusTone(item)}`}>{statusLabel(item)}</span>
                </div>
                {payloadText ? <p>{shortText(payloadText, props.compact ? 110 : 220)}</p> : null}
                <small>
                  {[formatEvidenceKind(item.evidence.kind), occurred, t("os.evidenceTrust", { n: formatTrust(item.evidence.trust_score) })]
                    .filter(Boolean)
                    .join(" | ")}
                </small>
                <small>
                  {ruleMatches ? t("os.evidenceRules", { rules: ruleMatches }) : t("os.evidenceNoRules")}
                </small>
                {item.review_note ? <small>{item.review_note}</small> : null}
              </div>
            );
          })}
          {hiddenCount > 0 ? (
            <div className="od-evidence-more">{t("os.evidenceMore", { n: hiddenCount })}</div>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function EvaluatorMatchList({ row }: { row: EvalStageMilestoneRow }) {
  const { t } = useI18n();

  return (
    <div className="od-evaluator-list">
      {row.evaluator_results.length === 0 ? (
        <div className="od-empty-inline">{t("os.evalNoResults")}</div>
      ) : row.evaluator_results.map((result, index) => {
        const matchedEvidence = matchedEvidenceText(row, result.matched_evidence_ids);
        return (
          <div key={`${result.evaluator}-${index}`} className="od-evaluator-row">
            <div className="od-evaluator-head">
              <strong>{`#${index + 1} ${result.evaluator}`}</strong>
              <span className={`od-pill ${evalToneClass(result.status)}`}>{evalLabel(t, result.status)}</span>
            </div>
            <p>{result.explanation || result.failure_reason || t("os.noEval")}</p>
            <small>
              {t("os.evalTrust", { n: formatTrust(result.trust_score) })}
              {" | "}
              {t("os.evalMatchedCount", { n: result.matched_evidence_ids.length })}
              {result.requires_human_confirmation ? ` | ${t("os.evalHumanConfirmation")}` : ""}
            </small>
            <small>{matchedEvidence ? t("os.evalMatchedEvidenceDetail", { evidence: matchedEvidence }) : t("os.evalNoMatchedEvidence")}</small>
          </div>
        );
      })}
    </div>
  );
}

export function CompletionRecapPanel(props: {
  progress: AimProgressReadModel;
}) {
  const { t } = useI18n();
  const recap = props.progress.completion_recap;
  if (!recap) return null;
  const completedCount = recap.completed_sub_aims.length;
  const evidenceCount = recap.passing_evidence.length;
  const contextCount = recap.learned_context.length;
  const futureReuse = contextCount > 0
    ? t("completion.futureReuseBody")
    : t("completion.futureReuseEmptyBody");

  return (
    <section className="od-stage-panel od-completion-recap">
      <div className="od-stage-panel-head">
        <div>
          <div className="od-stage-kicker">{t("completion.eyebrow")}</div>
          <h2>{t("completion.heading")}</h2>
          <p>{recap.final_outcome}</p>
        </div>
      </div>

      <div className="od-stage-metrics" aria-label={t("completion.heading")}>
        <EvalStageMetric label={t("completion.metricSubAims")} value={String(completedCount)} />
        <EvalStageMetric label={t("completion.metricEvidence")} value={String(evidenceCount)} />
        <EvalStageMetric label={t("completion.metricContext")} value={String(contextCount)} />
      </div>

      <div className="od-recap-section">
        <div className="od-card-head">
          <h3>{t("completion.subAimsTitle")}</h3>
          <span className="od-pill success">{t("completion.complete")}</span>
        </div>
        <div className="od-work-list">
          {recap.completed_sub_aims.map((item) => (
            <article key={item.milestone_id} className="od-work-card od-recap-subaim is-complete">
              <div className="od-work-card-main">
                <div className="od-work-title">
                  <strong>{item.title}</strong>
                  <span className="od-pill success">{item.eval_status ? evalLabel(t, item.eval_status) : t("completion.complete")}</span>
                  {item.decided_by ? <span className="od-pill">{item.decided_by}</span> : null}
                </div>
                <p>{shortText(item.outcome, 220)}</p>
                <div className="od-work-note">
                  <strong>{t("completion.evidenceIds")}</strong>
                  <span>{item.evidence_ids.length ? item.evidence_ids.map(shortId).join(", ") : t("completion.noEvidenceIds")}</span>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>

      <div className="od-recap-grid">
        <div className="od-recap-section">
          <div className="od-card-head">
            <h3>{t("completion.evidenceTitle")}</h3>
            <span className="od-pill">{String(evidenceCount)}</span>
          </div>
          {recap.passing_evidence.length === 0 ? (
            <div className="od-empty-inline">{recap.evidence_empty_reason}</div>
          ) : (
            <div className="od-recap-list">
              {recap.passing_evidence.map((item) => (
                <div key={item.id} className="od-recap-row">
                  <div>
                    <strong>{shortText(item.summary || item.kind, 130)}</strong>
                    <span>{[item.kind, shortId(item.id), t("os.evalTrust", { n: formatTrust(item.trust_score) })].join(" | ")}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="od-recap-section">
          <div className="od-card-head">
            <h3>{t("completion.evalTitle")}</h3>
            <span className="od-pill">{String(recap.eval_results.length)}</span>
          </div>
          {recap.eval_results.length === 0 ? (
            <div className="od-empty-inline">{t("completion.noEvalResults")}</div>
          ) : (
            <div className="od-recap-list">
              {recap.eval_results.map((result, index) => (
                <div key={`${result.milestone_id}-${result.evaluator}-${index}`} className="od-recap-row">
                  <div>
                    <strong>{result.evaluator}</strong>
                    <span>
                      {[
                        evalLabel(t, result.status),
                        t("os.evalMatchedCount", { n: result.matched_evidence_ids.length }),
                        t("os.evalTrust", { n: formatTrust(result.trust_score) }),
                      ].join(" | ")}
                    </span>
                  </div>
                  <p>{result.explanation}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="od-recap-section">
        <div className="od-card-head">
          <h3>{t("completion.contextTitle")}</h3>
          <span className="od-pill">{String(contextCount)}</span>
        </div>
        {recap.learned_context.length === 0 ? (
          <div className="od-empty-inline">{recap.context_empty_reason}</div>
        ) : (
          <div className="od-recap-list">
            {recap.learned_context.map((item) => (
              <div key={item.id} className="od-recap-row">
                <div>
                  <strong>{shortText(item.content, 150)}</strong>
                  <span>
                    {[
                      item.status === "pending" ? t("completion.contextPending") : t("completion.contextAccepted"),
                      item.scope,
                      item.category,
                      formatTrust(item.confidence),
                    ].join(" | ")}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="od-recap-reuse">
        <span>{t("completion.futureReuseTitle")}</span>
        <strong>{futureReuse}</strong>
      </div>
    </section>
  );
}
