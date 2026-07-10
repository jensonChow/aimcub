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
  it("does not render when the review has no items", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <ContextReviewPanel bundle={emptyReview} running={false} />
      </I18nProvider>,
    );

    expect(html).toBe("");
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

  it("renders Contracts context as a counted disclosure that is closed by default", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <ContextReviewPanel
          compact
          running={false}
          bundle={{
            ...emptyReview,
            usedContext: [{
              id: "used",
              title: "Aim brief",
              body: "The brief shaped the plan.",
              meta: ["local"],
              tone: "success",
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

    expect(html).toContain('<details class="od-context-review-disclosure" data-od-id="context-bundle-review">');
    expect(html).not.toContain('<details class="od-context-review-disclosure" data-od-id="context-bundle-review" open');
    expect(html).toContain("Context behind these contracts");
    expect(html).toContain('aria-label="2 context items">2</span>');
    expect(html).toContain("Aim brief");
    expect(html).toContain("Unanswered intake question");
  });
});
