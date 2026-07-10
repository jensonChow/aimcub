import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "./i18n";
import { WebResearchForm } from "./WebResearchForm";

describe("WebResearchForm", () => {
  it("presents the fixed search provider as a value instead of a fake button", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <WebResearchForm status={null} onSaved={vi.fn()} />
      </I18nProvider>,
    );

    expect(html).toContain('<output class="od-static-config-value" aria-label="Search provider">Brave Search</output>');
    expect(html).not.toMatch(/<button[^>]*>Brave Search<\/button>/);
  });
});
