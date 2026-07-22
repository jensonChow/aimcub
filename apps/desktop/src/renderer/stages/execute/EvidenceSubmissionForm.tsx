import type { Milestone } from "@aimcub/types";

import { useI18n } from "../../i18n";
import {
  proofUrlsFromDraft,
  type EvidenceSubmissionDraft,
} from "../../workflow/evidenceSubmission";
import { shortText } from "../../workflow/text";

export function EvidenceSubmissionForm(props: {
  milestone: Milestone;
  draft: EvidenceSubmissionDraft;
  disabled: boolean;
  pickingFiles: boolean;
  onChange: (draft: EvidenceSubmissionDraft) => void;
  onPickFiles: () => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const { t } = useI18n();
  const hasProof = props.draft.proofNote.trim().length > 0
    || proofUrlsFromDraft(props.draft.url).length > 0
    || props.draft.filePaths.length > 0;
  const requiredOk = props.draft.requiredEvidence.length === 0
    || props.draft.requiredEvidence.some((item) => item.satisfied);
  const canSubmit = hasProof && requiredOk;

  function setRequiredEvidence(text: string, satisfied: boolean): void {
    props.onChange({
      ...props.draft,
      requiredEvidence: props.draft.requiredEvidence.map((item) =>
        item.text === text ? { ...item, satisfied } : item,
      ),
    });
  }

  function removeFile(path: string): void {
    props.onChange({
      ...props.draft,
      filePaths: props.draft.filePaths.filter((item) => item !== path),
    });
  }

  return (
    <form
      className="od-proof-form"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSubmit();
      }}
    >
      <div className="od-proof-head">
        <div>
          <strong>{t("os.proofHeading")}</strong>
          <span>{t("os.proofBody")}</span>
        </div>
        <span className="od-pill">{shortText(props.milestone.title, 48)}</span>
      </div>

      <label className="od-proof-field">
        <span>{t("os.proofNote")}</span>
        <textarea
          autoFocus
          value={props.draft.proofNote}
          disabled={props.disabled}
          rows={3}
          placeholder={t("os.proofNotePlaceholder")}
          onChange={(event) => props.onChange({ ...props.draft, proofNote: event.currentTarget.value })}
        />
      </label>

      <label className="od-proof-field">
        <span>{t("os.proofUrl")}</span>
        <textarea
          value={props.draft.url}
          disabled={props.disabled}
          rows={2}
          placeholder={t("os.proofUrlPlaceholder")}
          onChange={(event) => props.onChange({ ...props.draft, url: event.currentTarget.value })}
        />
      </label>

      <div className="od-proof-field">
        <span>{t("os.proofFiles")}</span>
        <div className="od-proof-file-actions">
          <button
            className="od-aim-secondary"
            type="button"
            disabled={props.disabled || props.pickingFiles}
            onClick={props.onPickFiles}
          >
            {props.pickingFiles ? t("os.proofPickingFiles") : t("os.proofAddFiles")}
          </button>
          <small>{t("os.proofFilesHint")}</small>
        </div>
        {props.draft.filePaths.length === 0 ? (
          <div className="od-empty-inline">{t("os.proofNoFiles")}</div>
        ) : (
          <div className="od-proof-file-list">
            {props.draft.filePaths.map((path) => (
              <div key={path} className="od-proof-file-row">
                <span>{path}</span>
                <button
                  type="button"
                  disabled={props.disabled}
                  aria-label={`${t("os.proofRemoveFile")}: ${path}`}
                  onClick={() => removeFile(path)}
                >
                  {t("os.proofRemoveFile")}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <fieldset className="od-proof-required">
        <legend>{t("os.proofRequiredEvidence")}</legend>
        {props.draft.requiredEvidence.length === 0 ? (
          <div className="od-empty-inline">{t("os.proofNoRequiredEvidence")}</div>
        ) : (
          <div className="od-proof-required-list">
            {props.draft.requiredEvidence.map((item) => (
              <label key={item.text} className="od-proof-check-row">
                <input
                  type="checkbox"
                  checked={item.satisfied}
                  disabled={props.disabled}
                  onChange={(event) => setRequiredEvidence(item.text, event.currentTarget.checked)}
                />
                <span>{item.text}</span>
              </label>
            ))}
          </div>
        )}
      </fieldset>

      {!canSubmit ? (
        <div className="od-proof-validation">
          {!hasProof ? t("os.proofNeedsDetail") : t("os.proofNeedsRequired")}
        </div>
      ) : null}

      <div className="od-proof-actions">
        <button className="od-aim-secondary" type="button" disabled={props.disabled} onClick={props.onCancel}>
          {t("common.cancel")}
        </button>
        <button className="od-aim-primary" type="submit" disabled={props.disabled || !canSubmit}>
          {t("os.submitProof")}
        </button>
      </div>
    </form>
  );
}
