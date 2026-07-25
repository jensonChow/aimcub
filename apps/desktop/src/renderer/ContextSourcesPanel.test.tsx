import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ContextSourceStatus } from "../shared/ipc";

import { ContextSourcesPanel } from "./ContextSourcesPanel";
import { I18nProvider } from "./i18n";

const noop = () => {};

function status(overrides: Partial<ContextSourceStatus> = {}): ContextSourceStatus {
  return {
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
    ...overrides,
  };
}

function renderPanel(sourceStatus: ContextSourceStatus): string {
  return renderToStaticMarkup(
    <I18nProvider>
      <ContextSourcesPanel status={sourceStatus} onSaved={noop} />
    </I18nProvider>,
  );
}

describe("ContextSourcesPanel", () => {
  it("renders planning gate rows from the preserved context-source flow", () => {
    const html = renderPanel(status());

    expect(html).toContain('data-od-id="context-source-gates"');
    expect(html).toContain("context.bundle");
    expect(html).toContain("research.fusion");
    expect(html).toContain("gap.queue");
    expect(html).toContain("scope.guard");
    expect(html).toContain("Sub-aim gate");
    expect(html).toContain("Sub-aim contracts stay locked until enough context exists to avoid fake certainty.");
  });

  it("keeps the focused-question layout CSS for the clarify panel (its one live consumer)", () => {
    const css = readFileSync(new URL("./cockpit.css", import.meta.url), "utf8");

    expect(css).toMatch(/\.od-context-clarify:has\(> \.od-context-question-focus\)\s*{[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\) auto;/s);
    expect(css).toMatch(/\.od-context-choice-list\s*{[^}]*grid-template-columns:\s*repeat\(auto-fit, minmax\(260px, 1fr\)\);/s);
  });
});
