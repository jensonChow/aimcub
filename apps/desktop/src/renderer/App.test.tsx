import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Milestone } from "@core/types";
import type { ContextSourceStatus, ProviderStatus, WebResearchStatus } from "../shared/ipc";

import { buildSettingsModel, EvidenceSubmissionForm, SettingsPanel } from "./App";
import { CockpitShell } from "./CockpitShell";
import { I18nProvider, translate, type I18n } from "./i18n";

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
const testT: I18n["t"] = (key, vars) => translate("en", key, vars);

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
  it("renders only the selected settings detail pane", () => {
    const model = buildSettingsModel({
      provider: providerStatus,
      webResearch: webResearchStatus,
      contextSources: contextSourceStatus,
      localAgents: [],
    }, testT);
    const html = renderToStaticMarkup(
      <I18nProvider>
        <SettingsPanel
          provider={providerStatus}
          webResearch={webResearchStatus}
          contextSources={contextSourceStatus}
          localAgents={[]}
          model={model}
          activeSection="overview"
          aimContext={null}
          onProvider={noop}
          onWeb={noop}
          onContextSources={noop}
          onRefreshAgents={asyncNoop}
        />
      </I18nProvider>,
    );

    expect(html).toContain("Overview");
    expect(html).toContain("Helper readiness");
    expect(html).not.toContain("Settings sections");
    expect(html).not.toContain("API key");
    expect(html).not.toContain("Rescan");
  });
});

describe("CockpitShell", () => {
  it("renders a sidebar footer user menu trigger", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <CockpitShell
          goals={[]}
          selected={null}
          activeStage="aim"
          onNewAim={noop}
          onOpenGoal={noop}
          onStage={noop}
          main={<div>New aim</div>}
        />
      </I18nProvider>,
    );

    expect(html).toContain('data-od-id="sidebar-user-menu-trigger"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Local user");
    expect(html).toContain("Aimcub workspace");
  });

  it("replaces the primary left sidebar with settings navigation on settings stage", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <CockpitShell
          goals={[]}
          selected={null}
          activeStage="settings"
          onNewAim={noop}
          onOpenGoal={noop}
          onStage={noop}
          settingsSidebar={<nav aria-label="Settings sections"><button type="button">Planning model</button></nav>}
          main={<div>Settings detail pane</div>}
        />
      </I18nProvider>,
    );

    expect(html).toContain('data-od-id="left-settings-sidebar"');
    expect(html).toContain('data-od-id="sidebar-toggle"');
    expect(html).toContain('data-od-id="sidebar-peek-trigger"');
    expect(html).toContain('data-sidebar-state="pinned"');
    expect(html).toContain('aria-label="Collapse sidebar"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).not.toContain('data-od-id="mac-titlebar"');
    expect(html).toContain("Settings sections");
    expect(html).toContain("Planning model");
    expect(html).toContain("Settings detail pane");
    expect(html).toContain('data-od-id="sidebar-user-menu-trigger"');
    expect(html).not.toContain("Search aims");
    expect(html).not.toContain("Aim OS workflow");
  });

  it("keeps a stable top drag strip outside the dynamic sidebar layers", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <CockpitShell
          goals={[]}
          selected={null}
          activeStage="aim"
          onNewAim={noop}
          onOpenGoal={noop}
          onStage={noop}
          main={<div>New aim</div>}
        />
      </I18nProvider>,
    );
    const css = readFileSync(new URL("./cockpit.css", import.meta.url), "utf8");

    expect(html).toContain('data-od-id="window-drag-strip"');
    expect(css).toMatch(/\.od-window-drag-strip\s*{[^}]*app-region:\s*drag;[^}]*-webkit-app-region:\s*drag;/s);
    expect(css).toMatch(/\.od-sidebar-toggle\s*{[^}]*app-region:\s*no-drag;[^}]*-webkit-app-region:\s*no-drag;/s);
    expect(css).toMatch(/\.od-user-menu-anchor,\s*\.od-user-menu-anchor \*\s*{[^}]*app-region:\s*no-drag;[^}]*-webkit-app-region:\s*no-drag;/s);
  });

  it("keeps the peek sidebar visible until its collapse animation finishes", () => {
    const css = readFileSync(new URL("./cockpit.css", import.meta.url), "utf8");

    expect(css).toMatch(
      /\.od-sidebar\s*{[^}]*transition:\s*transform 180ms ease, opacity 160ms ease, box-shadow 180ms ease, visibility 0s linear 180ms;/s,
    );
    expect(css).toMatch(
      /\.od-app\[data-sidebar-state="pinned"\] \.od-sidebar,\s*\.od-app\[data-sidebar-state="peek"\] \.od-sidebar\s*{[^}]*transition-delay:\s*0s, 0s, 0s, 0s;/s,
    );
    expect(css).toMatch(
      /\.od-app\[data-sidebar-state="collapsed"\] \.od-sidebar\s*{[^}]*visibility:\s*hidden;[^}]*transform:\s*translateX/s,
    );
  });
});
