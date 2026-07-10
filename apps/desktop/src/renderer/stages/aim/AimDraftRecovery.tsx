import type { AimDraft, AimDraftStatus } from "@core/types";
import { useRef, useState } from "react";

import { useI18n, type I18n } from "../../i18n";
import { ActionMenu, ActionMenuItem } from "../../ui/ActionMenu";
import { aimNavigationLabels, type AimNavigationLabels } from "../../workflow/aimNavigationTitle";

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

export function aimDraftDisplayTitle(
  draft: Pick<AimDraft, "title" | "draft_plan" | "final_plan">,
  fallback: string,
): string {
  return aimDraftNavigationLabels(draft, fallback).label;
}

function aimDraftNavigationLabels(
  draft: Pick<AimDraft, "title" | "draft_plan" | "final_plan">,
  fallback: string,
): AimNavigationLabels {
  return aimNavigationLabels({
    title: draft.title,
    plan: draft.final_plan ?? draft.draft_plan,
    fallback,
  });
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
        {props.drafts.map((draft) => {
          const navigationTitle = aimDraftNavigationLabels(draft, t("aimDraft.untitled"));
          return (
            <div className="od-content-entry od-draft-recovery-row" key={draft.id}>
              <button
                className="od-content-entry-main"
                type="button"
                aria-label={navigationTitle.fullLabel}
                title={navigationTitle.fullLabel}
                onClick={() => props.onResume(draft)}
              >
                <span className="od-content-entry-copy">
                  <strong>{navigationTitle.label}</strong>
                  <span>{t(aimDraftStatusKey(draft.status))}</span>
                </span>
              </button>
              <DraftActionMenu draft={draft} title={navigationTitle.fullLabel} onResume={props.onResume} onDiscard={props.onDiscard} />
            </div>
          );
        })}
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
        {props.drafts.map((draft) => {
          const selected = props.activeDraftId === draft.id;
          const navigationTitle = aimDraftNavigationLabels(draft, t("aimDraft.untitled"));
          return (
            <div className="od-content-entry od-draft-card" data-selected={selected ? "true" : undefined} key={draft.id}>
              <button
                className="od-content-entry-main od-draft-card-main"
                type="button"
                aria-current={selected ? "page" : undefined}
                aria-label={navigationTitle.fullLabel}
                title={navigationTitle.fullLabel}
                onClick={() => props.onResume(draft)}
              >
                <span className="od-content-entry-copy od-aim-row-main">
                  <strong>{navigationTitle.label}</strong>
                </span>
              </button>
              <DraftActionMenu draft={draft} title={navigationTitle.fullLabel} onResume={props.onResume} onDiscard={props.onDiscard} />
            </div>
          );
        })}
      </div>
    </>
  );
}

function DraftActionMenu(props: {
  draft: AimDraft;
  title: string;
  onResume: (draft: AimDraft) => void;
  onDiscard: (draft: AimDraft) => void;
}) {
  const { t } = useI18n();
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  function confirmDiscard() {
    setConfirmingDiscard(true);
    window.requestAnimationFrame(() => cancelRef.current?.focus());
  }

  return (
    <ActionMenu
      className="od-content-entry-more"
      label={t("aimDraft.moreActionsFor", { title: props.title })}
      title={t("aimDraft.moreActions")}
      onOpenChange={(open) => {
        if (!open) setConfirmingDiscard(false);
      }}
    >
      {({ closeMenu }) => confirmingDiscard ? (
        <div className="od-action-menu-confirm" role="presentation">
          <strong>{t("aimDraft.discardConfirmTitle")}</strong>
          <p>{t("aimDraft.discardConfirm")}</p>
          <div className="od-action-menu-confirm-actions">
            <ActionMenuItem ref={cancelRef} onClick={() => closeMenu(true)}>
              {t("common.cancel")}
            </ActionMenuItem>
            <ActionMenuItem
              danger
              onClick={() => {
                closeMenu();
                props.onDiscard(props.draft);
              }}
            >
              {t("aimDraft.discardDraft")}
            </ActionMenuItem>
          </div>
        </div>
      ) : (
        <>
          <ActionMenuItem
            onClick={() => {
              closeMenu();
              props.onResume(props.draft);
            }}
          >
            {t("aimDraft.resumeDraft")}
          </ActionMenuItem>
          <ActionMenuItem danger onClick={confirmDiscard}>
            {t("aimDraft.discardDraftMenu")}
          </ActionMenuItem>
        </>
      )}
    </ActionMenu>
  );
}
