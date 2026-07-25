/**
 * The two planning surfaces the founder drives most (2026-07-25 feedback: "screen 1
 * could be simpler", "elements are not integrated"): the live card must read as one
 * integrated composer, and a lone free-text question must not dress up as a form.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "../../i18n";
import { PlanningSessionPanel } from "./PlanningSessionPanel";
import type { PlanningSessionStateView } from "../../../shared/ipc";

const noop = () => undefined;

function liveView(overrides: Partial<PlanningSessionStateView> = {}): PlanningSessionStateView {
  return {
    goalId: "00000000-0000-4000-8000-000000000010",
    agentId: "codex",
    model: "gpt-5.6-sol",
    active: true,
    phase: "researching",
    pendingQuestion: null,
    questionsAsked: 0,
    researchFindingCount: 0,
    researchGapCount: 0,
    activity: [],
    landing: null,
    failure: null,
    ...overrides,
  };
}

function renderPanel(view: PlanningSessionStateView, chatDraft = "") {
  return renderToStaticMarkup(
    <I18nProvider>
      <PlanningSessionPanel
        view={view}
        answers={{}}
        chatDraft={chatDraft}
        disabled={false}
        onAnswer={noop}
        onSubmitAnswer={noop}
        onChatDraft={noop}
        onChatSend={noop}
        onFinishNow={noop}
        onCancel={noop}
        onFallback={noop}
        onReview={noop}
      />
    </I18nProvider>,
  );
}

describe("PlanningSessionPanel · live card", () => {
  it("renders one integrated composer: quiet send inside the chat container, no primary pill", () => {
    const html = renderPanel(liveView());
    const chat = html.match(/<div class="od-planning-session-chat">[\s\S]*?<\/button><\/div>/)?.[0] ?? "";
    expect(chat).toContain("od-planning-session-chat-send");
    expect(chat).toContain("<textarea");
    expect(chat).not.toContain('data-variant="primary"');
  });

  it("never shows the junk tool line: unknown runtime tools read as the generic researching line", () => {
    const html = renderPanel(liveView({
      activity: [{ at: "2026-07-25T10:00:00.000Z", kind: "tool", label: "", tool: "tool" }],
    }));
    expect(html).toContain("Researching…");
    expect(html).not.toContain("Using tool");
  });
});

describe("PlanningSessionPanel · blocking question", () => {
  const freeTextQuestion = {
    id: "q-1",
    question: "你计划在什么日期或季节出发？",
    kind: "constraint" as const,
    why_high_impact: "日期直接影响价格与行程密度。",
    allow_other: true as const,
    selection_mode: "multiple" as const,
    selection_mode_reason: "unclear_defaults_multiple" as const,
    capture_scope: "current_aim" as const,
    options: [],
  };

  it("a lone free-text question shows no 1/1 counter, no mode pill, and an honest answer label", () => {
    const html = renderPanel(liveView({ phase: "waiting_user", pendingQuestion: freeTextQuestion }));
    expect(html).not.toContain("Question 1/1");
    expect(html).not.toContain(">multi<");
    expect(html).toContain("Your answer");
    expect(html).toContain("Answer in your own words…");
    expect(html).not.toContain("Add a custom answer");
  });

  it("answering promises what it does: Send answer, never the funnel's Generate plan", () => {
    const html = renderPanel(liveView({ phase: "waiting_user", pendingQuestion: freeTextQuestion }));
    expect(html).toContain("Send answer");
    expect(html).not.toContain("Generate plan");
  });

  it("a question WITH options keeps the mode pill and the custom-answer framing", () => {
    const withOptions = {
      ...freeTextQuestion,
      options: [
        { label: "3-5 days", tradeoff: "tight but cheap" },
        { label: "A full week", tradeoff: "relaxed pace" },
      ],
    };
    const html = renderPanel(liveView({ phase: "waiting_user", pendingQuestion: withOptions }));
    expect(html).toContain(">multi<");
    expect(html).toContain("Add a custom answer");
    expect(html).not.toContain(">Your answer<");
  });
});
