import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ContextBundleReview } from "../../contextReview";
import { I18nProvider } from "../../i18n";
import { ContextReviewPanel } from "./ContextReviewPanel";

const emptyReview: ContextBundleReview = {
  usedContext: [],
  skippedContext: [],
  permissionGaps: [],
  decompositionRisks: [],
  sourceCount: 0,
};

describe("ContextReviewPanel", () => {
  it("does not render empty buckets as a debug-style table", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <ContextReviewPanel bundle={emptyReview} running={false} />
      </I18nProvider>,
    );

    expect(html).toContain('data-empty="true"');
    expect(html).toContain("Review context before planning");
    expect(html).not.toContain("Used context");
    expect(html).not.toContain("Skipped or unread");
    expect(html).not.toContain("Permission gaps");
    expect(html).not.toContain("Decomposition risks");
  });

  it("shows only relevant skipped, permission, and risk buckets", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <ContextReviewPanel
          running={false}
          bundle={{
            ...emptyReview,
            permissionGaps: [{
              id: "gap",
              title: "Connector or access needed",
              body: "Product roadmap",
              meta: ["notion"],
              tone: "warn",
            }],
            decompositionRisks: [{
              id: "risk",
              title: "Unanswered intake question",
              body: "What would change decomposition?",
              meta: ["high"],
              tone: "danger",
            }],
          }}
        />
      </I18nProvider>,
    );

    expect(html).toContain("Permission gaps");
    expect(html).toContain("Decomposition risks");
    expect(html).toContain("Connector or access needed");
    expect(html).not.toContain("Used context");
    expect(html).not.toContain("Skipped or unread");
  });
});
