import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../i18n";
import { DraftAimOverviewPanel, type DraftAimOverviewState } from "./DraftAimOverviewPanel";

function renderOverview(state: DraftAimOverviewState) {
  return renderToStaticMarkup(
    <I18nProvider>
      <DraftAimOverviewPanel
        title="Ship the Aim view"
        description="Keep committed aim text in a readable summary."
        child={false}
        state={state}
        disabled={false}
        onEdit={vi.fn()}
        onContinue={vi.fn()}
      />
    </I18nProvider>,
  );
}

describe("DraftAimOverviewPanel", () => {
  it("renders a committed draft as content instead of an input", () => {
    const html = renderOverview("context");

    expect(html).toContain('data-od-id="draft-aim-overview"');
    expect(html).toContain("Ship the Aim view");
    expect(html).toContain("Context in progress");
    expect(html).toContain("Continue context");
    expect(html).toContain("Edit aim");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<textarea");
  });

  it("routes a planned draft toward contract review", () => {
    const html = renderOverview("planReady");

    expect(html).toContain("Plan ready");
    expect(html.match(/Review contracts/g)).toHaveLength(2);
  });

  it("distinguishes blocked plans from ready plans", () => {
    const html = renderOverview("saveBlocked");

    expect(html).toContain("Save blocked");
    expect(html.match(/Repair contracts/g)).toHaveLength(2);
    expect(html).not.toContain("Plan ready");
  });
});
