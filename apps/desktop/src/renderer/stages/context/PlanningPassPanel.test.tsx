/**
 * The paused surface's one non-negotiable: nothing on it may claim to be happening.
 *
 * It borrows the live card's shape and its whole voice layer, which is exactly how a
 * present-tense line can leak in — the same row that reads "Tightening the draft" under a
 * pulsing dot is a lie under a static one (founder, 2026-07-26: a finished job should be
 * "read", not "reading").
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "../../i18n";
import { PlanningPassPanel } from "./PlanningPassPanel";
import type { PlanningPassStateView } from "../../../shared/ipc";

const noop = () => undefined;

function pass(overrides: Partial<PlanningPassStateView> = {}): PlanningPassStateView {
  return {
    goalId: "00000000-0000-4000-8000-000000000010",
    agentId: "codex",
    model: "gpt-5.6-sol",
    phase: "researching",
    stoppedReason: "app_quit",
    resumedCount: 0,
    startedAt: "2026-07-25T14:03:09.714Z",
    updatedAt: "2026-07-25T14:31:00.000Z",
    truncated: false,
    questionsAsked: 1,
    researchFindingCount: 2,
    researchGapCount: 1,
    transcript: [],
    landing: null,
    ...overrides,
  };
}

function renderPass(view: PlanningPassStateView) {
  return renderToStaticMarkup(
    <I18nProvider>
      <PlanningPassPanel pass={view} disabled={false} onResume={noop} onReview={noop} onStartOver={noop} />
    </I18nProvider>,
  );
}

describe("PlanningPassPanel · a stopped pass has no present tense", () => {
  it("reads its last step as history, not as work still under way", () => {
    const html = renderPass(pass({
      transcript: [
        { at: "2026-07-25T14:04:00.000Z", kind: "research", findings: [{ summary: "a" }], gaps: [] },
        { at: "2026-07-25T14:26:00.000Z", kind: "plan_attempt", accepted: false, attempt: 2, errors: ["schema"] },
      ],
    }));
    const trace = html.match(/<ol class="od-planning-session-trace"[\s\S]*?<\/ol>/)?.[0] ?? "";
    expect(trace).toContain("Recorded 1 research findings");
    expect(trace).toContain("Tightened the draft (pass 2)");
    expect(trace).not.toContain("Tightening the draft");
    // The live card marks its last row current; a pass at rest marks none.
    expect(trace).not.toContain("data-current");
  });

  it("never freezes a working verb mid-action", () => {
    // Transcripts carry no tool rows today, but the voice layer they share does — the paused
    // trace must drop a dangling "Searching the web" rather than display it as a final step.
    const html = renderPass(pass({
      transcript: [
        { at: "2026-07-25T14:04:00.000Z", kind: "research", findings: [{ summary: "a" }], gaps: [] },
        { at: "2026-07-25T14:20:00.000Z", kind: "tool", tool: "web.search" },
      ],
    }));
    expect(html).not.toContain("Searching the web");
    expect(html).not.toContain("Researching…");
  });
});
