import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "../../i18n";
import { NewAimComposer, type NewAimComposerProps } from "./NewAimComposer";

const noop = () => {};

function render(overrides: Partial<NewAimComposerProps> = {}): string {
  const props: NewAimComposerProps = {
    title: "",
    description: "",
    memoryCount: 0,
    onTitle: noop,
    onDescription: noop,
    onSubmit: noop,
    ...overrides,
  };
  return renderToStaticMarkup(
    <I18nProvider>
      <NewAimComposer {...props} />
    </I18nProvider>,
  );
}

describe("NewAimComposer", () => {
  it("renders the NEW AIM eyebrow, headline input, and helper", () => {
    const html = render();
    expect(html).toContain("new-aim-composer");
    expect(html).toContain("NEW AIM");
    expect(html).toContain("od-newaim-headline");
    expect(html).toContain("Name the outcome you want");
  });

  it("hides the submit button and details toggle while the title is empty, and shows sparks", () => {
    const html = render({ title: "" });
    expect(html).not.toContain("od-newaim-submit");
    expect(html).not.toContain("od-newaim-details-toggle");
    expect(html).toContain("od-newaim-spark");
    expect(html).toContain("Plan a trip");
    expect(html).toContain("Learn a skill");
  });

  it("shows the submit button and details toggle once the title has content, and hides sparks", () => {
    const html = render({ title: "Two weeks in Japan" });
    expect(html).toContain("od-newaim-submit");
    expect(html).toContain("od-newaim-details-toggle");
    expect(html).toContain("Add details");
    expect(html).not.toContain("od-newaim-spark");
  });

  it("shows first-run footer copy when nothing is known yet", () => {
    const html = render({ memoryCount: 0 });
    expect(html).toContain("Your first aim starts Aimcub");
  });

  it("shows the memory-aware footer with the count when Aimcub knows things", () => {
    const html = render({ memoryCount: 7 });
    expect(html).toContain("Aimcub already knows 7 things about you");
  });

  it("opens the details textarea when a description is already present", () => {
    const html = render({ title: "Ship a CLI", description: "By June, budget $0" });
    expect(html).toContain("od-newaim-details");
    expect(html).toContain("By June, budget $0");
  });

  it("renders the runtime guidance node when passed", () => {
    const html = render({ title: "Ship a CLI", guidance: <div className="od-first-run-helper">guidance</div> });
    expect(html).toContain("od-first-run-helper");
  });

  it("never emits the legacy od-aim-composer class", () => {
    expect(render()).not.toContain("od-aim-composer");
    expect(render({ title: "x" })).not.toContain("od-aim-composer");
  });
});
