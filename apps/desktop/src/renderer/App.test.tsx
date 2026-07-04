import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Milestone } from "@core/types";

import { EvidenceSubmissionForm } from "./App";
import { I18nProvider } from "./i18n";

const OWNER = "00000000-0000-4000-8000-000000000001";
const GOAL = "00000000-0000-4000-8000-000000000010";
const MILESTONE = "00000000-0000-4000-8000-000000000020";

const milestone: Milestone = {
  id: MILESTONE,
  goal_id: GOAL,
  owner_id: OWNER,
  title: "Approve release",
  description: "Human approval is required.",
  status: "pending",
  order_index: 0,
  depends_on_id: null,
  acceptance_rule: {
    logic: "all",
    threshold: 1,
    completion_mode: "manual",
    clauses: [{ evaluator: "manual_confirm", auto_verifiable: false, match: {} }],
  },
  xp_reward: 10,
  completed_at: null,
  metadata: {
    decomposition_contract: {
      why: "The user owns approval.",
      definition_of_done: "The user approves the release.",
      required_evidence: ["Approval note."],
      likely_owner: "human",
      context_gaps: [],
      eval_signal: "Done means the user confirms approval.",
    },
  },
};

const noop = () => {};

describe("EvidenceSubmissionForm", () => {
  it("renders proof note, URL, file, and required evidence controls", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <EvidenceSubmissionForm
          milestone={milestone}
          draft={{
            proofNote: "",
            url: "",
            filePaths: [],
            requiredEvidence: [{ text: "Approval note.", satisfied: false }],
          }}
          disabled={false}
          pickingFiles={false}
          onChange={noop}
          onPickFiles={noop}
          onCancel={noop}
          onSubmit={noop}
        />
      </I18nProvider>,
    );

    expect(html).toContain("Submit evidence");
    expect(html).toContain("Proof note");
    expect(html).toContain("URL");
    expect(html).toContain("Local file references");
    expect(html).toContain("Approval note.");
    expect(html).toContain("Submit proof");
  });
});
