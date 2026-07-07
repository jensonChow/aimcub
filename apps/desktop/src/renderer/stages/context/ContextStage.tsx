import type { ReactNode } from "react";

import type { ContextSourceStatus } from "../../../shared/ipc";
import { ContextSourcesPanel } from "../../ContextSourcesPanel";
import type { ContextBundleReview } from "../../contextReview";
import { useI18n } from "../../i18n";
import { primaryButton } from "../../styles";
import { ContextAimSummaryPanel } from "./ContextAimSummaryPanel";
import { ContextReviewPanel } from "./ContextReviewPanel";
import type { ClarifyPhase } from "./types";

interface ContextStageProps {
  parentComposer: ReactNode | null;
  title: string;
  description: string | undefined | null;
  saved: boolean;
  disabled: boolean;
  clarifyPhase: ClarifyPhase;
  clarifyPanel: ReactNode;
  contextSources: ContextSourceStatus | null;
  review: ContextBundleReview;
  showReview: boolean;
  reviewRunning: boolean;
  onEditAim?: () => void;
  onOpenSettings: () => void;
  onContextSources: (status: ContextSourceStatus) => void;
  onContinueToPlan?: () => void;
}

export function ContextStage({
  parentComposer,
  title,
  description,
  saved,
  disabled,
  clarifyPhase,
  clarifyPanel,
  contextSources,
  review,
  showReview,
  reviewRunning,
  onEditAim,
  onOpenSettings,
  onContextSources,
  onContinueToPlan,
}: ContextStageProps) {
  const { t } = useI18n();
  const hasBlockingQuestion = clarifyPhase === "intake";
  const hasClarifyPanel = Boolean(clarifyPanel);
  const showContinue = !hasBlockingQuestion && !hasClarifyPanel && Boolean(onContinueToPlan);

  return (
    <>
      {parentComposer ?? (
        <ContextAimSummaryPanel
          title={title}
          description={description}
          saved={saved}
          onEdit={onEditAim}
        />
      )}
      {hasBlockingQuestion ? clarifyPanel : null}
      <ContextSourcesPanel
        status={contextSources}
        disabled={disabled}
        variant="workbench"
        onOpenSettings={onOpenSettings}
        onSaved={onContextSources}
      />
      {showReview ? <ContextReviewPanel bundle={review} running={reviewRunning} /> : null}
      {!hasBlockingQuestion ? clarifyPanel : null}
      {showContinue ? (
        <div className="od-context-continue">
          <button type="button" disabled={disabled} onClick={onContinueToPlan} style={{ ...primaryButton(disabled), marginTop: 0 }}>
            {t("context.stage.continue")}
          </button>
        </div>
      ) : null}
    </>
  );
}
