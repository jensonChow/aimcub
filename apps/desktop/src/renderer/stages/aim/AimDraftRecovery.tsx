import type { AimDraft, AimDraftStatus } from "@core/types";

import { useI18n, type I18n } from "../../i18n";

function shortText(value: string | undefined | null, max = 80): string {
  const cleaned = (value ?? "").replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1).trim()}...`;
}

export function aimDraftStatusKey(status: AimDraftStatus): Parameters<I18n["t"]>[0] {
  switch (status) {
    case "context_needed":
      return "aimDraft.status.contextNeeded";
    case "plan_ready":
      return "aimDraft.status.planReady";
    case "save_blocked":
      return "aimDraft.status.saveBlocked";
    case "draft":
      return "aimDraft.status.draft";
  }
}

export function aimDraftDisplayTitle(draft: Pick<AimDraft, "title">, fallback: string): string {
  return draft.title.trim() || fallback;
}

export function AimDraftHomeSection(props: {
  drafts: AimDraft[];
  onResume: (draft: AimDraft) => void;
  onDiscard: (draft: AimDraft) => void;
}) {
  const { t } = useI18n();
  if (props.drafts.length === 0) return null;
  return (
    <section className="od-draft-recovery" aria-label={t("aimDraft.recoveryLabel")}>
      <div className="od-draft-recovery-head">
        <div>
          <h2>{t("aimDraft.recoveryTitle")}</h2>
          <p>{t("aimDraft.recoveryBody")}</p>
        </div>
      </div>
      <div className="od-draft-recovery-list">
        {props.drafts.slice(0, 4).map((draft) => (
          <div className="od-draft-recovery-row" key={draft.id}>
            <button type="button" onClick={() => props.onResume(draft)}>
              <strong>{shortText(aimDraftDisplayTitle(draft, t("aimDraft.untitled")), 96)}</strong>
              <span>{t(aimDraftStatusKey(draft.status))}</span>
              <span className="od-draft-recovery-action">{t("aimDraft.resume")}</span>
            </button>
            <button className="od-draft-discard" type="button" onClick={() => props.onDiscard(draft)}>
              {t("aimDraft.discard")}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

export function AimDraftSidebarRows(props: {
  drafts: AimDraft[];
  activeDraftId: string | null;
  onResume: (draft: AimDraft) => void;
  onDiscard: (draft: AimDraft) => void;
}) {
  const { t } = useI18n();
  if (props.drafts.length === 0) return null;
  return (
    <>
      <div className="od-section-label od-draft-section-label" data-od-id="sidebar-drafts-label">
        <span>{t("aimDraft.sidebarLabel")}</span>
      </div>
      <div className="od-draft-list">
        {props.drafts.slice(0, 6).map((draft) => {
          const selected = props.activeDraftId === draft.id;
          return (
            <div className={`od-draft-card${selected ? " selected" : ""}`} key={draft.id}>
              <button
                className="od-draft-card-main"
                type="button"
                aria-current={selected ? "page" : undefined}
                onClick={() => props.onResume(draft)}
              >
                <span className="od-aim-row-main">
                  <strong>{shortText(aimDraftDisplayTitle(draft, t("aimDraft.untitled")), 58)}</strong>
                  <span>{t(aimDraftStatusKey(draft.status))}</span>
                </span>
              </button>
              <button
                className="od-draft-row-discard"
                type="button"
                aria-label={t("aimDraft.discardLabel", { title: aimDraftDisplayTitle(draft, t("aimDraft.untitled")) })}
                title={t("aimDraft.discard")}
                onClick={(event) => {
                  event.stopPropagation();
                  props.onDiscard(draft);
                }}
              >
                {t("aimDraft.discardShort")}
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}
