import type { ReactNode } from "react";

import type { ContextSourceStatus } from "../../../shared/ipc";
import { ContextSourcesPanel } from "../../ContextSourcesPanel";
import type { ContextBundleReview } from "../../contextReview";
import { useDeveloperMode } from "../../developerMode";
import { useI18n } from "../../i18n";
import { Button } from "../../ui";
import { ContextAimSummaryPanel } from "./ContextAimSummaryPanel";
import { ContextActivityPanel } from "./ContextActivityPanel";
import { ContextReviewPanel } from "./ContextReviewPanel";
import type { ContextLoopModel } from "./contextLoop";
import type { ClarifyPhase } from "./types";

interface ContextStageProps {
  title: string;
  description: string | undefined | null;
  saved: boolean;
  disabled: boolean;
  clarifyPhase: ClarifyPhase;
  clarifyPanel: ReactNode;
  contextSources: ContextSourceStatus | null;
  review: ContextBundleReview;
  loop: ContextLoopModel;
  showReview: boolean;
  reviewRunning: boolean;
  onEditAim?: () => void;
  onOpenSettings: () => void;
  onContextSources: (status: ContextSourceStatus) => void;
  onContinueToPlan?: () => void;
  /** Raw trace view; only shown in developer mode ("product-first, debug-second"). */
  debugPanel: ReactNode;
}

export function ContextStage({
  title,
  description,
  saved,
  disabled,
  clarifyPhase,
  clarifyPanel,
  contextSources,
  review,
  loop,
  showReview,
  reviewRunning,
  onEditAim,
  onOpenSettings,
  onContextSources,
  onContinueToPlan,
  debugPanel,
}: ContextStageProps) {
  const { t } = useI18n();
  const developerMode = useDeveloperMode();
  const hasBlockingQuestion = clarifyPhase === "intake";
  const hasClarifyPanel = Boolean(clarifyPanel);
  const hasFocusedQuestion = hasClarifyPanel
    && (clarifyPhase === "intake" || clarifyPhase === "postDraft");
  const showContinue = !hasBlockingQuestion && !hasClarifyPanel && Boolean(onContinueToPlan);
  const showContextReview = !hasBlockingQuestion && showReview;

  if (hasFocusedQuestion) {
    return (
      <section className="od-context-focus" data-od-id="context-focus">
        {clarifyPanel}
        {developerMode ? debugPanel : null}
      </section>
    );
  }

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
      <ContextAimSummaryPanel
        title={title}
        description={description}
        saved={saved}
        compact={hasBlockingQuestion}
        onEdit={disabled ? undefined : onEditAim}
      />
      <ContextActivityPanel model={loop} />
      {sourceWorkbench}
      {showContextReview ? <ContextReviewPanel bundle={review} running={reviewRunning} /> : null}
      {clarifyPanel}
      {showContinue ? (
        <div className="od-context-continue">
          <Button variant="primary" size="lg" disabled={disabled} onClick={onContinueToPlan}>
            {t("context.stage.continue")}
          </Button>
        </div>
      ) : null}
      {developerMode ? debugPanel : null}
    </>
  );
}
