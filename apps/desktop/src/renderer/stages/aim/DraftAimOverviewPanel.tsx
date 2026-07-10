import { useEffect, useRef } from "react";

import { useI18n } from "../../i18n";
import { shortText } from "../../workflow/text";

export type DraftAimOverviewState = "context" | "planReady" | "needsRepair" | "saveBlocked";

interface DraftAimOverviewPanelProps {
  title: string;
  description: string | undefined | null;
  child: boolean;
  state: DraftAimOverviewState;
  disabled: boolean;
  focusEditAction?: boolean;
  onEditFocusRestored?: () => void;
  onEdit: () => void;
  onContinue: () => void;
}

export function DraftAimOverviewPanel({
  title,
  description,
  child,
  state,
  disabled,
  focusEditAction = false,
  onEditFocusRestored,
  onEdit,
  onContinue,
}: DraftAimOverviewPanelProps) {
  const { t } = useI18n();
  const editButtonRef = useRef<HTMLButtonElement | null>(null);
  const summary = description?.trim()
    ? shortText(description, 260)
    : t("aimDraft.overview.noDescription");
  const stateLabel = state === "saveBlocked"
    ? t("aimDraft.overview.saveBlocked")
    : state === "needsRepair"
      ? t("aimDraft.overview.needsRepair")
      : state === "planReady"
        ? t("aimDraft.overview.planReady")
        : t("aimDraft.overview.contextInProgress");
  const nextAction = state === "context"
    ? t("aimDraft.overview.continueContext")
    : state === "planReady"
      ? t("aimDraft.overview.reviewContracts")
      : t("aimDraft.overview.repairContracts");
  const nextHint = state === "context"
    ? t("aimDraft.overview.contextHint")
    : state === "planReady"
      ? t("aimDraft.overview.contractsHint")
      : t("aimDraft.overview.repairHint");

  useEffect(() => {
    if (!focusEditAction) return;
    editButtonRef.current?.focus();
    onEditFocusRestored?.();
  }, [focusEditAction, onEditFocusRestored]);

  return (
    <section className="od-aim-overview od-draft-aim-overview" data-od-id="draft-aim-overview">
      <div className="od-aim-intake-head">
        <div>
          <div className="od-aim-kicker">
            {t(child ? "aimDraft.overview.childKicker" : "aimDraft.overview.kicker")}
          </div>
          <h1>{title}</h1>
          <p>{summary}</p>
        </div>
      </div>

      <div className="od-aim-overview-strip">
        <div>
          <span>{t("aimDraft.overview.state")}</span>
          <strong>{stateLabel}</strong>
          <small>{t("aimDraft.overview.localDraft")}</small>
        </div>
        <div>
          <span>{t("aimDraft.overview.next")}</span>
          <strong>{nextAction}</strong>
          <small>{nextHint}</small>
        </div>
      </div>

      <div className="od-aim-intake-footer">
        <p>{t("aimDraft.overview.hint")}</p>
        <div className="od-aim-intake-actions">
          <button ref={editButtonRef} className="od-aim-secondary" type="button" disabled={disabled} onClick={onEdit}>
            {t("aimDraft.overview.edit")}
          </button>
          <button className="od-aim-primary" type="button" disabled={disabled} onClick={onContinue}>
            {nextAction}
          </button>
        </div>
      </div>
    </section>
  );
}
