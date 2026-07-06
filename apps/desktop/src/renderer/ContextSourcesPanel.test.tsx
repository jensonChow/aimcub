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

function renderWorkbenchPanel(sourceStatus: ContextSourceStatus): string {
  return renderToStaticMarkup(
    <I18nProvider>
      <ContextSourcesPanel status={sourceStatus} variant="workbench" onOpenSettings={noop} onSaved={noop} />
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

  it("keeps the workbench source step focused on local material and settings handoff", () => {
    const html = renderWorkbenchPanel(status());

    expect(html).toContain('data-od-id="context-workbench-sources"');
    expect(html).toContain("Add only what changes this plan");
    expect(html).toContain("Attach local material");
    expect(html).toContain("Open settings");
    expect(html).not.toContain('data-od-id="context-source-gates"');
    expect(html).not.toContain("Online folders and databases");
    expect(html).not.toContain("Research controls");
  });
});
