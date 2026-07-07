import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ContextSourceStatus } from "../../../shared/ipc";
import type { ContextBundleReview } from "../../contextReview";
import { I18nProvider } from "../../i18n";
import { ContextStage } from "./ContextStage";

const noop = () => {};

const contextSources: ContextSourceStatus = {
  version: 1,
  local: {
    enabled: true,
    workspaceRoot: "/Users/jenson/Desktop/Aimcub",
    filePaths: [],
    configured: true,
    source: "settings",
    resolvedWorkspaceRoot: "/Users/jenson/Desktop/Aimcub",
    resolvedFilePaths: [],
  },
  online: {
    enabled: false,
    sources: [],
    configuredCount: 0,
    enabledCount: 0,
  },
  research: {
    webEnabled: true,
    deepResearch: true,
  },
  userSession: {
    enabled: true,
  },
  questionnaire: {
    enabled: true,
  },
};

const emptyReview: ContextBundleReview = {
  usedContext: [],
  skippedContext: [],
  permissionGaps: [],
  decompositionRisks: [],
  sourceCount: 0,
};

function renderStage(options: {
  clarifyPhase: "intake" | "postDraft" | null;
  clarifyPanel?: ReactNode;
  showReview?: boolean;
  onContinueToPlan?: () => void;
}): string {
  return renderToStaticMarkup(
    <I18nProvider>
      <ContextStage
        parentComposer={null}
        title="Ship context flow"
        description="Make the Context stage stepwise."
        saved={false}
        disabled={false}
        clarifyPhase={options.clarifyPhase}
        clarifyPanel={options.clarifyPanel ?? null}
        contextSources={contextSources}
        review={emptyReview}
        showReview={options.showReview ?? false}
        reviewRunning={false}
        onEditAim={noop}
        onOpenSettings={noop}
        onContextSources={noop}
        onContinueToPlan={options.onContinueToPlan}
      />
    </I18nProvider>,
  );
}

describe("ContextStage", () => {
  it("orders the compact aim summary before one blocking question and aim-local sources", () => {
    const html = renderStage({
      clarifyPhase: "intake",
      clarifyPanel: <section data-od-id="context-blocking-question">Blocking question</section>,
      onContinueToPlan: noop,
    });

    expect(html).toContain("Ship context flow");
    expect(html).toContain('data-od-id="context-blocking-question"');
    expect(html).toContain('data-od-id="context-workbench-sources"');
    expect(html.indexOf("Ship context flow")).toBeLessThan(html.indexOf('data-od-id="context-blocking-question"'));
    expect(html.indexOf('data-od-id="context-blocking-question"')).toBeLessThan(html.indexOf('data-od-id="context-workbench-sources"'));
    expect(html).not.toContain("Continue to Plan</button>");
  });

  it("shows a single Continue to Plan action when no question or refinement panel is active", () => {
    const html = renderStage({
      clarifyPhase: null,
      onContinueToPlan: noop,
    });

    expect(html).toContain("Continue to Plan");
    expect(html.match(/Continue to Plan/g)).toHaveLength(1);
    expect(html).toContain('data-od-id="context-workbench-sources"');
    expect(html).not.toContain('data-od-id="context-blocking-question"');
    expect(html).not.toContain('data-od-id="context-bundle-review"');
    expect(html).not.toContain("Review context before planning");
  });
});
