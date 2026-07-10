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

  it("shows the keyless local-agent research path when a CLI runtime is ready", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <WebResearchForm
          status={{
            configured: false,
            provider: "brave",
            enabled: true,
            fetchPages: true,
            hasApiKey: false,
            keySource: null,
          }}
          localAgentReady
          onSaved={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(html).toContain("Local agent CLI");
    expect(html).toContain("without a separate Brave key");
    expect(html).toMatch(/<button(?![^>]*disabled)[^>]*>Save web research<\/button>/);
  });
});
