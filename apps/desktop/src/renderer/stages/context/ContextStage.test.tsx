import { readFileSync } from "node:fs";

import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ClarifyOutput } from "@core/llm";
import type { ContextSourceStatus } from "../../../shared/ipc";
import type { ContextBundleReview } from "../../contextReview";
import { I18nProvider } from "../../i18n";
import { ContextClarifyPanel } from "./ContextClarifyPanel";
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

const blockingClarify: ClarifyOutput = {
  questions: [
    {
      id: "proof",
      question: "What evidence proves this aim is done?",
      why_high_impact: "This changes the acceptance rule before planning starts.",
      kind: "constraint",
      allow_other: true,
      selection_mode: "single",
      options: [
        { label: "Passing smoke test", tradeoff: "Optimizes for verifiable completion." },
        { label: "Manual review", tradeoff: "Keeps the final decision with the user." },
      ],
    },
  ],
  assumptions: [],
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
  it("makes the blocking question dominant before collapsed source material", () => {
    const html = renderStage({
      clarifyPhase: "intake",
      clarifyPanel: (
        <ContextClarifyPanel
          clarify={blockingClarify}
          phase="intake"
          answers={{}}
          contextNote=""
          conversationEnabled
          questionnaireEnabled
          disabled={false}
          onAnswer={noop}
          onContextNote={noop}
          onRefine={noop}
        />
      ),
      onContinueToPlan: noop,
    });
    const secondarySourceTag = html.match(/<details[^>]*data-od-id="context-secondary-sources"[^>]*>/)?.[0] ?? "";

    expect(html).toContain("Ship context flow");
    expect(html).toContain('data-compact="true"');
    expect(html).toContain('data-od-id="context-blocking-question"');
    expect(html).toContain('data-od-id="context-secondary-sources"');
    expect(html).toContain('data-od-id="context-workbench-sources"');
    expect(html.indexOf("Ship context flow")).toBeLessThan(html.indexOf('data-od-id="context-blocking-question"'));
    expect(html.indexOf('data-od-id="context-blocking-question"')).toBeLessThan(html.indexOf('data-od-id="context-secondary-sources"'));
    expect(html.indexOf('data-od-id="context-secondary-sources"')).toBeLessThan(html.indexOf('data-od-id="context-workbench-sources"'));
    expect(secondarySourceTag).not.toContain("open");
    expect(html).toContain("Add source material");
    expect(html).toContain("Generate plan");
    expect(html).toContain('class="od-ui-button od-context-clarify-action"');
    expect(html).toContain('data-variant="primary"');
    expect(html).toContain('class="od-ui-button od-ui-button-card od-context-choice"');
    expect(html).toContain('class="od-ui-field od-context-other-field"');
    expect(html).not.toContain("Continue to Plan");
    expect(html).not.toContain("Aim text is captured");
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

  it("does not show Continue to Plan while refinement is active", () => {
    const html = renderStage({
      clarifyPhase: "postDraft",
      clarifyPanel: <section data-od-id="context-draft-refinement">Optional refinement</section>,
      onContinueToPlan: noop,
    });

    expect(html).toContain('data-od-id="context-draft-refinement"');
    expect(html).toContain('data-od-id="context-workbench-sources"');
    expect(html).not.toContain("Continue to Plan");
    expect(html).not.toContain('class="od-context-continue"');
  });

  it("keeps context polish on shared primitives instead of inline style helpers", () => {
    const clarifySource = readFileSync(new URL("./ContextClarifyPanel.tsx", import.meta.url), "utf8");
    const sourcesSource = readFileSync(new URL("../../ContextSourcesPanel.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("../../cockpit.css", import.meta.url), "utf8");

    expect(clarifySource).toContain('import { Button, Panel, Pill, TextArea, TextField } from "../../ui";');
    expect(clarifySource).not.toMatch(/primaryButton|secondaryButton|style=\{/);
    expect(sourcesSource).toContain('import { Button, Panel } from "./ui";');
    expect(sourcesSource).not.toMatch(/primaryButton|inputStyle|style=\{/);
    expect(css).toMatch(/\.od-context-clarify\.od-ui-panel\[data-variant="plain"\]\s*{[^}]*gap:\s*12px;/s);
    expect(css).toMatch(/\.od-context-sources-panel\.od-ui-panel:not\(\[data-compact="true"\]\)\s*{[^}]*padding:\s*16px;/s);
  });
});
