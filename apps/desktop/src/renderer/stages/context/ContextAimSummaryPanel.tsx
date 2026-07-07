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
  onEdit?: () => void;
}

export function ContextAimSummaryPanel({
  title,
  description,
  saved,
  onEdit,
}: ContextAimSummaryPanelProps) {
  const { t } = useI18n();
  const descriptionText = description?.trim();
  return (
    <section className="od-aim-context-summary">
      <div>
        <div className="od-aim-kicker">{saved ? t("shell.savedAim") : t("os.stepContext")}</div>
        <h2>{title}</h2>
        <p>{descriptionText ? shortText(descriptionText, 220) : t("aimContext.noDescription")}</p>
      </div>
      <div className="od-aim-context-actions">
        <span>{t(saved ? "aimContext.savedBody" : "aimContext.body")}</span>
        {onEdit ? (
          <button className="od-aim-secondary" type="button" onClick={onEdit}>
            {t("aimContext.edit")}
          </button>
        ) : null}
      </div>
    </section>
  );
}
