import type { AimProgressReadModel } from "@aimcub/core";

import { useI18n, type I18n } from "../../i18n";

export type EvalStageMilestoneRow = AimProgressReadModel["milestones"][number];
type EvalState = "passed" | "failed" | "needs_human" | "unsupported" | "error" | "pending";

function shortText(value: string | undefined | null, max = 120): string {
  const cleaned = (value ?? "").replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1).trim()}...`;
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

function EvalStageMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="od-stage-metric">
      <span>{label}</span>
      <strong>{value}</strong>
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
