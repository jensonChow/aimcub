import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Milestone } from "@core/types";
import type { ContextSourceStatus, ProviderStatus, WebResearchStatus } from "../shared/ipc";

import { EvidenceSubmissionForm, SettingsPanel } from "./App";
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
const asyncNoop = async () => {};

const providerStatus: ProviderStatus = {
  configured: false,
  provider: null,
  model: null,
  baseURL: null,
  hasApiKey: false,
};

const webResearchStatus: WebResearchStatus = {
  configured: false,
  provider: "brave",
  enabled: false,
  fetchPages: true,
  hasApiKey: false,
  keySource: null,
};

const contextSourceStatus: ContextSourceStatus = {
  version: 1,
  local: {
    enabled: false,
    filePaths: [],
    configured: false,
    source: null,
    resolvedWorkspaceRoot: null,
    resolvedFilePaths: [],
  },
  online: {
    enabled: false,
    sources: [],
    configuredCount: 0,
    enabledCount: 0,
  },
  research: {
    webEnabled: true,
    deepResearch: true,
  },
  userSession: {
    enabled: true,
  },
  questionnaire: {
    enabled: true,
  },
};

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

describe("SettingsPanel", () => {
  it("renders settings as split navigation with one detail pane", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <SettingsPanel
          provider={providerStatus}
          webResearch={webResearchStatus}
          contextSources={contextSourceStatus}
          localAgents={[]}
          aimContext={null}
          onProvider={noop}
          onWeb={noop}
          onContextSources={noop}
          onRefreshAgents={asyncNoop}
        />
      </I18nProvider>,
    );

    expect(html).toContain("od-settings-split");
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("Settings sections");
    expect(html).toContain("Overview");
    expect(html).toContain("Planning model");
    expect(html).toContain("Local CLI agents");
    expect(html).toContain("Web research");
    expect(html).toContain("Context sources");
    expect(html).toContain("Helper readiness");
    expect(html).not.toContain("API key");
    expect(html).not.toContain("Rescan");
  });
});
