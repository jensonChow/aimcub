import type { ContextCategory } from "@core/types";

import type { ContextBundleReview, ContextReviewItem } from "../../contextReview";
import { useI18n, type I18n } from "../../i18n";
import { contextCategoryLabel } from "../../labels";

function shortText(value: string | undefined | null, max = 120): string {
  const cleaned = (value ?? "").replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1).trim()}…`;
}

function StageMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="od-stage-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

interface ReviewBucket {
  key: string;
  title: string;
  metric: string;
  items: ContextReviewItem[];
}

interface ContextReviewPanelProps {
  bundle: ContextBundleReview;
  running: boolean;
}

export function ContextReviewPanel({ bundle, running }: ContextReviewPanelProps) {
  const { t } = useI18n();
  const buckets: ReviewBucket[] = [
    {
      key: "used",
      title: t("contextReview.used"),
      metric: t("contextReview.metric.used"),
      items: bundle.usedContext,
    },
    {
      key: "skipped",
      title: t("contextReview.skipped"),
      metric: t("contextReview.metric.skipped"),
      items: bundle.skippedContext,
    },
    {
      key: "permissions",
      title: t("contextReview.permissions"),
      metric: t("contextReview.metric.gaps"),
      items: bundle.permissionGaps,
    },
    {
      key: "risks",
      title: t("contextReview.risks"),
      metric: t("contextReview.risks"),
      items: bundle.decompositionRisks,
    },
  ];
  const visibleBuckets = buckets.filter((bucket) => bucket.items.length > 0);
  const totalItems = visibleBuckets.reduce((sum, bucket) => sum + bucket.items.length, 0);

  return (
    <section className="od-context-review" data-od-id="context-bundle-review" data-empty={totalItems === 0 ? "true" : "false"}>
      <div className="od-stage-panel-head">
        <div>
          <div className="od-stage-kicker">{t("contextReview.eyebrow")}</div>
          <h2>{t("contextReview.title")}</h2>
          <p>{t(totalItems === 0 ? "contextReview.emptyBody" : "contextReview.body")}</p>
        </div>
        {running ? <span className="od-pill blue">{t("debug.pending")}</span> : null}
      </div>

      {visibleBuckets.length > 0 ? (
        <>
          <div className="od-stage-metrics" aria-label={t("contextReview.title")}>
            {visibleBuckets.map((bucket) => (
              <StageMetric key={bucket.key} label={bucket.metric} value={String(bucket.items.length)} />
            ))}
          </div>

          <div className="od-context-review-grid">
            {visibleBuckets.map((bucket) => (
              <ContextReviewBucket key={bucket.key} title={bucket.title} items={bucket.items} />
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}

function ContextReviewBucket({ title, items }: { title: string; items: ContextReviewItem[] }) {
  const { t } = useI18n();
  const visible = items.slice(0, 4);
  const extra = Math.max(0, items.length - visible.length);
  return (
    <section className="od-context-review-bucket">
      <div className="od-card-head">
        <h3>{title}</h3>
        <span className="od-pill">{String(items.length)}</span>
      </div>
      <div className="od-context-review-list">
        {visible.map((item) => (
          <article key={item.id} className={`od-context-review-item ${contextReviewToneClass(item.tone)}`}>
            <div className="od-context-review-item-head">
              <strong>{item.title}</strong>
              {item.category ? <span className="od-pill">{contextReviewCategoryLabel(item.category, t)}</span> : null}
            </div>
            <p>{shortText(item.body, 220)}</p>
            {item.meta.length ? <small>{item.meta.filter(Boolean).slice(0, 3).join(" · ")}</small> : null}
          </article>
        ))}
        {extra > 0 ? <div className="od-context-review-more">{t("contextReview.more", { n: extra })}</div> : null}
      </div>
    </section>
  );
}

function contextReviewCategoryLabel(category: ContextCategory, t: I18n["t"]): string {
  return contextCategoryLabel(category, t);
}

function contextReviewToneClass(tone: ContextReviewItem["tone"]): string {
  if (tone === "success") return "success";
  if (tone === "warn") return "warn";
  if (tone === "danger") return "danger";
  return "";
}
