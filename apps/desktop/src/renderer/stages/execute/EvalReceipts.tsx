/**
 * The row's eval receipts, folded to human size: ONE shared verdict line, then one hairline row
 * per evidence item and per evaluator. The old rendering stacked two disclosures of bordered
 * cards that each repeated the sub-aim title, the machine kind, and the same two explainer
 * sentences per card (founder, 2026-08-14: "还是有太多乱七八糟的东西") — the verdict belongs to
 * the review, not to every card, and the title belongs to the row header alone.
 */
import type { AimProgressReadModel } from "@aimcub/types";

import { useI18n, type I18n } from "../../i18n";
import { shortText } from "../../workflow/text";

type ReceiptRow = AimProgressReadModel["milestones"][number];
type ReceiptEvidenceItem = ReceiptRow["evidence"][number];

function formatReceiptTime(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** The stored summary repeats the sub-aim title ("Codex CLI failed on: <title>") — drop it. */
function evidenceLine(item: ReceiptEvidenceItem, milestoneTitle: string): string {
  const summary = (item.evidence.summary ?? "").trim();
  const stripped = summary.endsWith(`: ${milestoneTitle}`)
    ? summary.slice(0, -(milestoneTitle.length + 2))
    : summary;
  return stripped || summary || item.evidence.kind;
}

function evidenceStatus(item: ReceiptEvidenceItem, t: I18n["t"]): { label: string; tone: string } {
  switch (item.status) {
    case "matched":
      return { label: t("os.evidenceStatus.matched"), tone: "success" };
    case "low_trust":
      return { label: t("os.evidenceStatus.lowTrust"), tone: "warn" };
    case "unmatched":
      return { label: t("os.evidenceStatus.unmatched"), tone: "" };
  }
}

function evaluatorTone(status: string): string {
  if (status === "passed") return "success";
  if (status === "failed") return "danger";
  return "";
}

export function EvalReceipts({ row }: { row: ReceiptRow }) {
  const { t } = useI18n();
  // The one verdict sentence for the whole set — per-card repetition is what buried the row.
  const verdict = row.eval_review.reason || row.eval_review.next_action || "";

  return (
    <div className="od-eval-receipts">
      {verdict ? <p className="od-eval-receipts-verdict">{shortText(verdict, 180)}</p> : null}

      <ul className="od-eval-receipts-list">
        {row.evidence.map((item) => {
          const status = evidenceStatus(item, t);
          return (
            <li key={item.evidence.id}>
              <span className="od-eval-receipts-main">{shortText(evidenceLine(item, row.milestone.title), 96)}</span>
              <small>{formatReceiptTime(item.evidence.occurred_at)}</small>
              <span className={`od-pill ${status.tone}`}>{status.label}</span>
            </li>
          );
        })}
        {row.evaluator_results.map((result, index) => (
          <li key={`evaluator-${result.evaluator}-${index}`}>
            <span className="od-eval-receipts-main">
              {result.evaluator}
              {result.explanation || result.failure_reason
                ? ` — ${shortText(result.explanation || result.failure_reason || "", 110)}`
                : ""}
            </span>
            <span className={`od-pill ${evaluatorTone(result.status)}`}>
              {result.status === "passed"
                ? t("os.evalStatus.passed")
                : result.status === "failed"
                  ? t("os.evalStatus.failed")
                  : result.status === "needs_human"
                    ? t("os.evalStatus.needsHuman")
                    : result.status}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
