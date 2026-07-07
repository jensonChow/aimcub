import type { ReactNode } from "react";

import type { ContextSourceStatus } from "../../../shared/ipc";
import { ContextSourcesPanel } from "../../ContextSourcesPanel";
import type { ContextBundleReview } from "../../contextReview";
import { useI18n } from "../../i18n";
import { Button } from "../../ui";
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
  const showContextReview = !hasBlockingQuestion && showReview;
  const sourceWorkbench = (
    <ContextSourcesPanel
      status={contextSources}
      disabled={disabled}
      variant="workbench"
      onOpenSettings={onOpenSettings}
      onSaved={onContextSources}
    />
  );

  return (
    <>
      {parentComposer ?? (
        <ContextAimSummaryPanel
          title={title}
          description={description}
          saved={saved}
          compact={hasBlockingQuestion}
          onEdit={onEditAim}
        />
      )}
      {hasBlockingQuestion ? clarifyPanel : null}
      {hasBlockingQuestion ? (
        <details className="od-context-secondary-sources" data-od-id="context-secondary-sources">
          <summary>
            <span>
              <strong>{t("context.workbench.secondarySummary")}</strong>
              <small>{t("context.workbench.secondaryBody")}</small>
            </span>
          </summary>
          <div className="od-context-secondary-body">
            {sourceWorkbench}
          </div>
        </details>
      ) : sourceWorkbench}
      {showContextReview ? <ContextReviewPanel bundle={review} running={reviewRunning} /> : null}
      {!hasBlockingQuestion ? clarifyPanel : null}
      {showContinue ? (
        <div className="od-context-continue">
          <Button variant="primary" size="lg" disabled={disabled} onClick={onContinueToPlan}>
            {t("context.stage.continue")}
          </Button>
        </div>
      ) : null}
    </>
  );
}
