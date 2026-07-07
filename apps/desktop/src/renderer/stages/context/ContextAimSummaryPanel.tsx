import { useI18n } from "../../i18n";

function shortText(value: string | undefined | null, max = 120): string {
  const cleaned = (value ?? "").replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1).trim()}…`;
}

interface ContextAimSummaryPanelProps {
  title: string;
  description: string | undefined | null;
  saved: boolean;
  compact?: boolean;
  onEdit?: () => void;
}

export function ContextAimSummaryPanel({
  title,
  description,
  saved,
  compact = false,
  onEdit,
}: ContextAimSummaryPanelProps) {
  const { t } = useI18n();
  const descriptionText = description?.trim();
  const descriptionPreview = descriptionText
    ? shortText(descriptionText, compact ? 120 : 220)
    : compact
      ? ""
      : t("aimContext.noDescription");
  const showActions = !compact || Boolean(onEdit);
  return (
    <section className="od-aim-context-summary" data-compact={compact ? "true" : undefined}>
      <div>
        <div className="od-aim-kicker">{saved ? t("shell.savedAim") : t("os.stepContext")}</div>
        <h2>{title}</h2>
        {descriptionPreview ? <p>{descriptionPreview}</p> : null}
      </div>
      {showActions ? (
        <div className="od-aim-context-actions">
          {compact ? null : <span>{t(saved ? "aimContext.savedBody" : "aimContext.body")}</span>}
          {onEdit ? (
            <button className="od-aim-secondary" type="button" onClick={onEdit}>
              {t("aimContext.edit")}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
