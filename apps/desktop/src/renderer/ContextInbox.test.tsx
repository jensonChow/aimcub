import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Memory } from "@aimcub/types";

import {
  buildContextCandidateAcceptRequest,
  canAcceptContextCandidateContent,
  ContextInbox,
  VISIBLE_CANDIDATE_LIMIT,
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
    content: "Done means tests pass and the user can inspect the result.",
    confidence: 0.82,
    source: "evidence_derived",
    status: "pending",
    superseded_by: null,
    created_at: "2026-07-04T08:00:00.000Z",
    ...overrides,
  };
}

function renderInbox(memories: Memory | Memory[]): string {
  return renderToStaticMarkup(
    <I18nProvider>
      <ContextInbox
        candidates={Array.isArray(memories) ? memories : [memories]}
        onAccept={noop}
        onReject={noop}
      />
    </I18nProvider>,
  );
}

describe("ContextInbox", () => {
  it("renders a quiet review row: statement, one provenance line, decision verbs", () => {
    const html = renderInbox(candidate());

    expect(html).toContain("Context to review");
    expect(html).toContain("What you keep guides its planning");
    expect(html).toContain("Done means tests pass");
    // ONE provenance line in product words — not a chip per machine field.
    expect(html).toContain("Eval signal · From work evidence · 2026-07-04");
    expect(html).toContain(">Keep<");
    expect(html).toContain(">Discard<");
    expect(html).toContain(">Edit<");
    // The machine fields stay structured, never rendered raw (founder, 2026-08-09).
    expect(html).not.toContain("Candidate 11111111");
    expect(html).not.toContain("% confidence");
    expect(html).not.toContain("Agent inferred");
    expect(html).not.toContain("From aim:");
    // The statement rests as readable text — no standing editor on a review row.
    expect(html).not.toContain("<textarea");
  });

  it("strips the legacy machine-composed prefix for display", () => {
    const html = renderInbox(candidate({
      category: "project_fact",
      source: "agent_inferred",
      content: 'Project fact: Planning assumption for "我想要研究coding agent related router": 核心研究对象 (优先 Cursor Router)',
    }));

    expect(html).toContain("核心研究对象 (优先 Cursor Router)");
    expect(html).not.toContain("Planning assumption for");
    expect(html).toContain("Project fact · Noted by Aimcub");
  });

  it("keeps question-shaped candidates in the edit field until they carry an answer", () => {
    const prompt = 'Eval signal: For "Context aim", pending answer needed: Ask what genuinely complete means.';

    expect(canAcceptContextCandidateContent(prompt)).toBe(false);
    expect(canAcceptContextCandidateContent("Done means the acceptance tests pass.")).toBe(true);
    const html = renderInbox(candidate({ content: prompt }));
    expect(html).toContain("<textarea");
    expect(html).toContain("This is still a question");
  });

  it("caps the band and offers the rest behind one control", () => {
    const many = Array.from({ length: VISIBLE_CANDIDATE_LIMIT + 3 }, (_, index) => candidate({
      id: `11111111-1111-4111-8111-1111111111${String(index + 10)}`,
      content: `Assumption ${index + 1}.`,
    }));
    const html = renderInbox(many);

    expect(html).toContain(`Assumption ${VISIBLE_CANDIDATE_LIMIT}.`);
    expect(html).not.toContain(`Assumption ${VISIBLE_CANDIDATE_LIMIT + 1}.`);
    expect(html).toContain(`Show all ${VISIBLE_CANDIDATE_LIMIT + 3}`);
  });

  it("builds the existing accept IPC request with edited content and scope", () => {
    expect(buildContextCandidateAcceptRequest(
      candidate(),
      "Done means build, test, typecheck, and lint pass.",
      "global",
    )).toEqual({
      id: "11111111-1111-4111-8111-111111111111",
      content: "Done means build, test, typecheck, and lint pass.",
      scope: "global",
    });
  });
});
