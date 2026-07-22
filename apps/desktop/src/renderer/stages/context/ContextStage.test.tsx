import { readFileSync } from "node:fs";

import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ClarifyOutput } from "@core/llm";
import type { ContextSourceStatus } from "../../../shared/ipc";
import type { ContextBundleReview } from "../../contextReview";
import { DeveloperModeProvider } from "../../developerMode";
import { I18nProvider } from "../../i18n";
import {
  ContextClarifyPanel,
  nextRadioIndex,
  selectContextChoice,
  setContextOtherAnswer,
} from "./ContextClarifyPanel";
import { buildContextLoopModel, type ContextLoopModel } from "./contextLoop";
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
      selection_mode: "multiple",
      selection_mode_reason: "compatible_options",
      options: [
        { label: "Passing smoke test", tradeoff: "Optimizes for verifiable completion." },
        { label: "Manual review", tradeoff: "Keeps the final decision with the user." },
      ],
    },
  ],
  assumptions: [],
};

const debugPanelSentinel = <div data-od-id="context-debug-panel">DEBUG PANEL</div>;

function renderStage(options: {
  clarifyPhase: "intake" | "postDraft" | null;
  clarifyPanel?: ReactNode;
  loop?: ContextLoopModel;
  showReview?: boolean;
  disabled?: boolean;
  onContinueToPlan?: () => void;
  debugPanel?: ReactNode;
  developerMode?: boolean;
}): string {
  const stage = (
    <ContextStage
      title="Ship context flow"
      description="Make the Context stage stepwise."
      saved={false}
      disabled={options.disabled ?? false}
      clarifyPhase={options.clarifyPhase}
      clarifyPanel={options.clarifyPanel ?? null}
      contextSources={contextSources}
      review={emptyReview}
      loop={options.loop ?? buildContextLoopModel({ contextSources, review: emptyReview })}
      showReview={options.showReview ?? false}
      reviewRunning={false}
      onEditAim={noop}
      onOpenSettings={noop}
      onContextSources={noop}
      onContinueToPlan={options.onContinueToPlan}
      debugPanel={options.debugPanel ?? debugPanelSentinel}
    />
  );
  return renderToStaticMarkup(
    <I18nProvider>
      {options.developerMode !== undefined ? (
        <DeveloperModeProvider enabled={options.developerMode}>{stage}</DeveloperModeProvider>
      ) : stage}
    </I18nProvider>,
  );
}

describe("ContextStage", () => {
  it("treats a custom single-choice answer as an alternative, while multi-select can supplement", () => {
    const answer = { labels: ["Passing smoke test"], other: "" };

    expect(setContextOtherAnswer(answer, "A signed acceptance note", "single")).toEqual({
      labels: [],
      other: "A signed acceptance note",
    });
    expect(selectContextChoice({ labels: [], other: "A signed acceptance note" }, "Manual review", "single")).toEqual({
      labels: ["Manual review"],
      other: "",
    });
    expect(setContextOtherAnswer(answer, "A signed acceptance note", "multiple")).toEqual({
      labels: ["Passing smoke test"],
      other: "A signed acceptance note",
    });
  });

  it("provides wrapped arrow-key navigation for single-choice cards", () => {
    expect(nextRadioIndex(0, "ArrowRight", 3)).toBe(1);
    expect(nextRadioIndex(2, "ArrowRight", 3)).toBe(0);
    expect(nextRadioIndex(0, "ArrowLeft", 3)).toBe(2);
    expect(nextRadioIndex(2, "Home", 3)).toBe(0);
    expect(nextRadioIndex(0, "End", 3)).toBe(2);
    expect(nextRadioIndex(0, "Enter", 3)).toBeNull();
  });

  it("renders only the current blocking question while intake needs an answer", () => {
    const loop = buildContextLoopModel({
      contextSources,
      review: emptyReview,
      running: true,
      liveEvents: [{
        runId: "run-1",
        type: "context.started",
        stage: "planning",
        at: "2026-07-09T00:00:00.000Z",
        modelRun: {
          id: "model-1",
          stage: "draft",
          task: "decompose",
          status: "running",
          structured: true,
          hasSchema: true,
          startedAt: "2026-07-09T00:00:00.000Z",
          promptChars: 200,
          systemChars: 100,
          promptPreview: "RAW PROMPT SHOULD STAY HIDDEN",
          systemPreview: "RAW SYSTEM SHOULD STAY HIDDEN",
          model: "test-model",
        },
      }],
    });
    const html = renderStage({
      clarifyPhase: "intake",
      loop,
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
    expect(html).toContain('data-od-id="context-focus"');
    expect(html).toContain('data-od-id="context-blocking-question"');
    expect(html).toContain('data-od-id="context-user-reply"');
    expect(html).toContain("What evidence proves this aim is done?");
    expect(html).toContain("Question 1/1");
    expect(html).toContain('tabindex="-1"');
    const clarifySource = readFileSync(new URL("./ContextClarifyPanel.tsx", import.meta.url), "utf8");
    expect(clarifySource).toMatch(/useEffect\(\(\) => \{[\s\S]*?if \(!activeQuestion\) return;[\s\S]*?questionHeadingRef\.current\?\.focus\(\);[\s\S]*?\}, \[activeQuestion\?\.id\]\);/);
    expect(html).toContain("Generate plan");
    expect(html).toContain('class="od-ui-button od-context-clarify-action"');
    expect(html).toContain('data-variant="primary"');
    expect(html).toContain('class="od-ui-button od-ui-button-card od-context-choice"');
    expect(html).toContain('class="od-ui-field od-context-other-field"');
    expect(html.indexOf("What evidence proves this aim is done?")).toBeLessThan(html.indexOf("Generate plan"));
    expect(html).not.toContain("Ship context flow");
    expect(html).not.toContain('data-od-id="context-activity-surface"');
    expect(html).not.toContain('data-od-id="context-secondary-sources"');
    expect(html).not.toContain('data-od-id="context-workbench-sources"');
    expect(html).not.toContain("Add source material");
    expect(html).not.toContain("Paste constraints");
    expect(html).not.toContain("Continue to Plan");
    expect(html).not.toContain("Aim text is captured");
    expect(html).not.toContain("RAW PROMPT SHOULD STAY HIDDEN");
    expect(html).not.toContain("RAW SYSTEM SHOULD STAY HIDDEN");
  });

  it("keeps choice answers selectable in the focused reply", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <ContextClarifyPanel
          clarify={blockingClarify}
          phase="postDraft"
          answers={{ proof: { labels: ["Passing smoke test"], other: "" } }}
          contextNote=""
          conversationEnabled
          questionnaireEnabled
          disabled={false}
          onAnswer={noop}
          onContextNote={noop}
          onRefine={noop}
        />
      </I18nProvider>,
    );

    expect(html).toContain('data-od-id="context-draft-refinement"');
    expect(html).toContain("Passing smoke test");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('data-selected="true"');
    expect(html).toContain("multi");
  });

  it("exposes single-choice cards as one radio group", () => {
    const singleClarify: ClarifyOutput = {
      questions: [{
        ...blockingClarify.questions[0]!,
        id: "release_access",
        question: "Should the first release be public or invitation-only?",
        selection_mode: "single",
        selection_mode_reason: "mutually_exclusive",
        options: [
          { label: "Public", tradeoff: "Anyone can discover and use the release." },
          { label: "Invitation-only", tradeoff: "Access stays controlled during validation." },
        ],
      }],
      assumptions: [],
    };
    const html = renderToStaticMarkup(
      <I18nProvider>
        <ContextClarifyPanel
          clarify={singleClarify}
          phase="postDraft"
          answers={{ release_access: { labels: ["Public"], other: "" } }}
          contextNote=""
          conversationEnabled
          questionnaireEnabled
          disabled={false}
          onAnswer={noop}
          onContextNote={noop}
          onRefine={noop}
        />
      </I18nProvider>,
    );

    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('role="radio"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('tabindex="-1"');
    expect(html).not.toContain('aria-pressed="true"');
  });

  it("renders a legacy compatible-route question as multi-select even when it says single", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <ContextClarifyPanel
          clarify={{
            questions: [{
              ...blockingClarify.questions[0]!,
              id: "routes",
              question: "\u4f60\u7684\u2018\u540d\u5782\u9752\u53f2\u2019\u5177\u4f53\u60f3\u901a\u8fc7\u54ea\u6761\u8def\u5f84\u5b9e\u73b0\uff1f",
              selection_mode: "single",
              selection_mode_reason: undefined,
              options: [
                { label: "\u6587\u5b66\u521b\u4f5c", tradeoff: "\u957f\u671f\u5199\u4f5c\u4e0e\u51fa\u7248\u3002" },
                { label: "\u79d1\u5b66\u7a81\u7834", tradeoff: "\u4e13\u4e1a\u7814\u7a76\u4e0e\u540c\u884c\u8ba4\u53ef\u3002" },
                { label: "\u521b\u4e1a\u521b\u65b0", tradeoff: "\u4ea7\u54c1\u4e0e\u5e02\u573a\u9a8c\u8bc1\u3002" },
                { label: "\u793e\u4f1a\u5f71\u54cd", tradeoff: "\u7ec4\u7ec7\u884c\u52a8\u4e0e\u516c\u5171\u6210\u679c\u3002" },
              ],
            }],
            assumptions: [],
          }}
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
      </I18nProvider>,
    );

    expect(html).toContain("multi");
    const clarifySource = readFileSync(new URL("./ContextClarifyPanel.tsx", import.meta.url), "utf8");
    expect(clarifySource).toContain("selectContextChoice(activeAnswer, option.label, activeSelectionMode)");
  });

  it("resumes a multi-step flow at the first unanswered question", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <ContextClarifyPanel
          clarify={{
            ...blockingClarify,
            questions: [
              ...blockingClarify.questions,
              {
                ...blockingClarify.questions[0]!,
                id: "scope",
                question: "Which scope should the first plan cover?",
              },
            ],
          }}
          phase="intake"
          answers={{ proof: { labels: ["Passing smoke test"], other: "" } }}
          contextNote=""
          conversationEnabled
          questionnaireEnabled
          disabled={false}
          onAnswer={noop}
          onContextNote={noop}
          onRefine={noop}
        />
      </I18nProvider>,
    );

    expect(html).not.toContain("What evidence proves this aim is done?");
    expect(html).toContain("Which scope should the first plan cover?");
    expect(html).toContain("Question 2/2");
    expect(html).not.toContain("Next question");
    expect(html).toContain("Generate plan");
  });

  it("disables every answer and navigation control while planning is busy", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <ContextClarifyPanel
          clarify={blockingClarify}
          phase="intake"
          answers={{}}
          contextNote=""
          conversationEnabled
          questionnaireEnabled
          disabled
          onAnswer={noop}
          onContextNote={noop}
          onRefine={noop}
        />
      </I18nProvider>,
    );

    expect(html.match(/disabled=""/g)?.length).toBe(4);
    expect(html).toContain("Passing smoke test");
    expect(html).toContain("Add a custom answer");
    expect(html).toContain("Generate plan");
  });

  it("shows one settings recovery action when both intake paths are paused", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <ContextClarifyPanel
          clarify={blockingClarify}
          phase="intake"
          answers={{}}
          contextNote=""
          conversationEnabled={false}
          questionnaireEnabled={false}
          disabled={false}
          onAnswer={noop}
          onContextNote={noop}
          onRefine={noop}
          onOpenSettings={noop}
        />
      </I18nProvider>,
    );

    expect(html).toContain("Turn on a context input");
    expect(html).toContain("Open settings");
    expect(html).not.toContain("Passing smoke test");
    expect(html).not.toContain('class="od-ui-textarea"');
  });

  it("shows a single Continue to Plan action when no question or refinement panel is active", () => {
    const html = renderStage({
      clarifyPhase: null,
      onContinueToPlan: noop,
    });

    expect(html).toContain("Continue to Plan");
    expect(html.match(/Continue to Plan/g)).toHaveLength(1);
    expect(html).toContain('data-od-id="context-activity-surface"');
    expect(html).toContain('data-od-id="context-workbench-sources"');
    expect(html).not.toContain('data-od-id="context-blocking-question"');
    expect(html).not.toContain('data-od-id="context-bundle-review"');
    expect(html).not.toContain("Review context before planning");
  });

  it("hides Aim editing while the Context workspace is busy", () => {
    const html = renderStage({ clarifyPhase: null, disabled: true });

    expect(html).not.toContain("Edit aim");
  });

  it("does not show Continue to Plan while refinement is active", () => {
    const html = renderStage({
      clarifyPhase: "postDraft",
      clarifyPanel: <section data-od-id="context-draft-refinement">Optional refinement</section>,
      onContinueToPlan: noop,
    });

    expect(html).toContain('data-od-id="context-focus"');
    expect(html).toContain('data-od-id="context-draft-refinement"');
    expect(html).not.toContain('data-od-id="context-activity-surface"');
    expect(html).not.toContain('data-od-id="context-workbench-sources"');
    expect(html).not.toContain("Continue to Plan");
    expect(html).not.toContain('class="od-context-continue"');
  });

  it("hides the raw debug panel by default and in the focused-question view", () => {
    const idleHtml = renderStage({ clarifyPhase: null, onContinueToPlan: noop });
    expect(idleHtml).not.toContain('data-od-id="context-debug-panel"');

    const offHtml = renderStage({ clarifyPhase: null, onContinueToPlan: noop, developerMode: false });
    expect(offHtml).not.toContain('data-od-id="context-debug-panel"');

    const focusedHtml = renderStage({
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
    });
    expect(focusedHtml).not.toContain('data-od-id="context-debug-panel"');
  });

  it("shows the raw debug panel only once developer mode is on", () => {
    const html = renderStage({ clarifyPhase: null, onContinueToPlan: noop, developerMode: true });
    expect(html).toContain('data-od-id="context-debug-panel"');

    const focusedHtml = renderStage({
      clarifyPhase: "intake",
      developerMode: true,
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
    });
    expect(focusedHtml).toContain('data-od-id="context-focus"');
    expect(focusedHtml).toContain('data-od-id="context-debug-panel"');
  });

  it("keeps context polish on shared primitives instead of inline style helpers", () => {
    const clarifySource = readFileSync(new URL("./ContextClarifyPanel.tsx", import.meta.url), "utf8");
    const sourcesSource = readFileSync(new URL("../../ContextSourcesPanel.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("../../cockpit.css", import.meta.url), "utf8");

    expect(clarifySource).toContain('import { Button, Panel, Pill, TextArea, TextField } from "../../ui";');
    expect(clarifySource).not.toMatch(/primaryButton|secondaryButton|style=\{/);
    expect(sourcesSource).toContain('import { Button, Panel } from "./ui";');
    expect(sourcesSource).not.toMatch(/primaryButton|inputStyle|style=\{/);
    expect(css).toMatch(/\.od-context-clarify\.od-ui-panel\[data-variant="plain"\]\s*{[^}]*gap:\s*16px;/s);
    expect(css).toMatch(/\.od-context-sources-panel\.od-ui-panel:not\(\[data-compact="true"\]\)\s*{[^}]*padding:\s*16px;/s);
  });
});
