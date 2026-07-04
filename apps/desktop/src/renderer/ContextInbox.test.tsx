import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Memory } from "@core/types";

import {
  buildContextCandidateAcceptRequest,
  canAcceptContextCandidateContent,
  ContextInbox,
} from "./ContextInbox";
import { I18nProvider } from "./i18n";

const noop = () => {};

function candidate(overrides: Partial<Memory> = {}): Memory {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    owner_id: "22222222-2222-4222-8222-222222222222",
    goal_id: "33333333-3333-4333-8333-333333333333",
    kind: "semantic",
    category: "eval_signal",
    content: "Eval signal: Done means tests pass and the user can inspect the result.",
    confidence: 0.82,
    source: "evidence_derived",
    status: "pending",
    superseded_by: null,
    created_at: "2026-07-04T08:00:00.000Z",
    ...overrides,
  };
}

function renderInbox(memory: Memory): string {
  return renderToStaticMarkup(
    <I18nProvider>
      <ContextInbox
        candidates={[memory]}
        currentAimTitle="Ship Aimcub"
        onAccept={noop}
        onReject={noop}
      />
    </I18nProvider>,
  );
}

describe("ContextInbox", () => {
  it("renders candidate provenance and future-reuse copy", () => {
    const html = renderInbox(candidate());

    expect(html).toContain("Context inbox");
    expect(html).toContain("Accepted global context is reused when Aimcub plans future aims.");
    expect(html).toContain("From aim: Ship Aimcub");
    expect(html).toContain("Eval signal");
    expect(html).toContain("Evidence derived");
    expect(html).toContain("82% confidence");
    expect(html).toContain("Candidate 11111111");
    expect(html).toContain("Done means tests pass");
    expect(html).toContain("Accept");
    expect(html).toContain("Reject");
  });

  it("requires prompt-like candidates to be edited before acceptance", () => {
    const prompt = 'Eval signal: For "Context aim", pending answer needed: Ask what genuinely complete means.';

    expect(canAcceptContextCandidateContent(prompt)).toBe(false);
    expect(canAcceptContextCandidateContent("Eval signal: Done means the acceptance tests pass.")).toBe(true);
    expect(renderInbox(candidate({ content: prompt }))).toContain("Edit this prompt into an actual answer");
  });

  it("builds the existing accept IPC request with edited content and scope", () => {
    expect(buildContextCandidateAcceptRequest(
      candidate(),
      "Eval signal: Done means build, test, typecheck, and lint pass.",
      "global",
    )).toEqual({
      id: "11111111-1111-4111-8111-111111111111",
      content: "Eval signal: Done means build, test, typecheck, and lint pass.",
      scope: "global",
    });
  });
});
