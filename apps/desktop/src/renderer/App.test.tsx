import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Goal, Milestone } from "@core/types";
import type { ContextSourceStatus, ProviderStatus, WebResearchStatus } from "../shared/ipc";

import { App, buildSettingsModel, EvidenceSubmissionForm, SettingsPanel } from "./App";
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

const savedGoal: Goal = {
  id: GOAL,
  owner_id: OWNER,
  title: "Ship a sidebar pass",
  description: "Refine the desktop sidebar.",
  domain: "software",
  status: "active",
  target_date: null,
  plan_json: null,
  metadata: {},
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

describe("App first-run workspace", () => {
  it("keeps the initial main workspace free of the aim composer", () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain('class="od-initial-workspace"');
    expect(html).toContain("Workspace ready");
    expect(html).toContain("Create a new aim when you are ready to start.");
    expect(html).not.toContain('class="od-aim-composer"');
    expect(html).not.toContain('id="aim-title"');
    expect(html).not.toContain('id="aim-context"');
    expect(html).not.toContain(">Continue</button>");
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
          onSection={noop}
          aimContext={null}
          onProvider={noop}
          onWeb={noop}
          onContextSources={noop}
          onRefreshAgents={asyncNoop}
        />
      </I18nProvider>,
    );
    const css = readFileSync(new URL("./cockpit.css", import.meta.url), "utf8");

    expect(html).toContain("Overview");
    expect(html).toContain("Planning status");
    expect(html).toContain("Configure");
    expect(html).not.toContain("Settings sections");
    expect(html).not.toContain("API key");
    expect(html).not.toContain("Rescan");
    expect(css).toMatch(/\.od-settings-row-list\s*{[^}]*border:\s*1px solid var\(--od-border-soft\);[^}]*border-radius:\s*var\(--od-radius-md\);[^}]*background:\s*var\(--od-surface-warm\);/s);
    expect(css).toMatch(/\.od-settings-row,\s*\.od-settings-current-aim\s*{[^}]*padding:\s*14px 16px;/s);
    expect(css).toMatch(/\.od-settings-row:last-child\s*{[^}]*border-bottom:\s*0;/s);
    expect(css).toMatch(/\.od-settings-status-pill\s*{[^}]*gap:\s*6px;[^}]*background:\s*transparent;[^}]*color:\s*var\(--od-muted\);/s);
    expect(css).toMatch(/\.od-settings-status-pill::before\s*{[^}]*width:\s*6px;[^}]*height:\s*6px;[^}]*background:\s*var\(--od-meta\);/s);
    expect(css).toMatch(/\.od-settings-status-pill\.warn\s*{[^}]*color:\s*var\(--od-muted\);/s);
    expect(css).toMatch(/\.od-settings-row-button\s*{[^}]*min-height:\s*28px;[^}]*border:\s*1px solid transparent;[^}]*background:\s*var\(--od-surface\);/s);
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
          activeSidebarAction={null}
          onHome={noop}
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
    expect(html).not.toContain("<h1>Aimcub</h1>");
    expect(html).not.toContain("<p>Workbench</p>");
  });

  it("renders Home Panel and New Aim as top-left app-level sidebar actions", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <CockpitShell
          goals={[]}
          selected={null}
          activeStage="aim"
          activeSidebarAction="home"
          onHome={noop}
          onNewAim={noop}
          onOpenGoal={noop}
          onStage={noop}
          main={<div>New aim</div>}
        />
      </I18nProvider>,
    );
    const css = readFileSync(new URL("./cockpit.css", import.meta.url), "utf8");

    expect(html).toContain('data-od-id="sidebar-global-actions"');
    expect(html).toContain('aria-label="Workspace actions"');
    expect(html).toContain('data-od-id="sidebar-home-panel-action"');
    expect(html).toContain('data-od-id="sidebar-new-aim-action"');
    expect(html).toContain('<button class="od-sidebar-action od-home-panel" type="button" aria-current="page" data-od-id="sidebar-home-panel-action"');
    expect(html).toContain('<button class="od-sidebar-action od-new-aim" type="button" data-od-id="sidebar-new-aim-action"');
    expect(html).toContain("od-home-panel");
    expect(html).toContain("od-new-aim");
    expect(html).toContain("od-sidebar-action-icon");
    expect(html).toContain("od-sidebar-action-label");
    expect(html).toContain("Home panel");
    expect(html).toContain("New aim");
    expect(html).toContain('aria-label="Command 0"');
    expect(html).toContain('aria-label="Command N"');
    expect(html).toContain("⌘");
    expect(html).not.toContain("Cmd N</kbd>");
    expect(css).toContain("--sidebar-horizontal-inset: 12px;");
    expect(css).toContain("--sidebar-row-padding-x: 8px;");
    expect(css).toContain("--sidebar-icon-column: 28px;");
    expect(css).toContain("--sidebar-action-icon-slot: 18px;");
    expect(css).toContain("--sidebar-action-label-gap: 6px;");
    expect(css).toContain("--sidebar-action-icon-offset-x: -2px;");
    expect(css).toContain("--sidebar-content-width: calc(var(--sidebar-width) - (var(--sidebar-horizontal-inset) * 2) - 1px);");
    expect(css).toContain("--od-type-meta: 12px;");
    expect(css).toContain("--od-type-body: 13px;");
    expect(css).toContain("--od-type-title: 16px;");
    expect(css).toContain("--od-font-weight-medium: 400;");
    expect(css).toContain("--od-font-weight-semibold: 450;");
    expect(css).toContain("--od-icon-stroke: 1.55;");
    expect(css).toContain("--od-interaction-hover-bg: color-mix(in oklab, var(--od-fg), transparent 96%);");
    expect(css).toContain("--od-selection-bg: color-mix(in oklab, var(--od-fg), transparent 91%);");
    expect(css).toContain("--od-selection-border: color-mix(in oklab, var(--od-fg), transparent 82%);");
    expect(css).toContain("--od-interaction-hover-shadow: var(--od-shadow-sidebar-action);");
    expect(css).toContain("--od-interaction-focus-shadow: var(--od-focus), var(--od-shadow-sidebar-action);");
    expect(css).toMatch(/\.od-sidebar\s*{[^}]*padding:\s*56px var\(--sidebar-horizontal-inset\) 16px;[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;/s);
    expect(css).toMatch(/\.od-sidebar-global-actions\s*{[^}]*width:\s*var\(--sidebar-content-width\);[^}]*display:\s*grid;[^}]*justify-self:\s*center;[^}]*gap:\s*3px;/s);
    expect(css).toMatch(/\.od-sidebar-action\s*{[^}]*min-height:\s*34px;[^}]*grid-template-columns:\s*var\(--sidebar-action-icon-slot\) minmax\(0, 1fr\) auto;[^}]*column-gap:\s*var\(--sidebar-action-label-gap\);[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/s);
    expect(css).toMatch(/\.od-sidebar-action\s*{[^}]*padding:\s*0 var\(--sidebar-row-padding-x\);/s);
    expect(css).toMatch(/\.od-sidebar-action:hover,\s*\.od-sidebar-action:focus-visible\s*{[^}]*background:\s*var\(--od-interaction-hover-bg\);[^}]*box-shadow:\s*var\(--od-interaction-hover-shadow\);[^}]*color:\s*var\(--od-fg\);/s);
    expect(css).toMatch(/\.od-sidebar-action\[aria-current="page"\]\s*{[^}]*background:\s*var\(--od-selection-bg\);[^}]*border-color:\s*transparent;[^}]*box-shadow:\s*none;[^}]*color:\s*var\(--od-fg\);/s);
    expect(css).toMatch(/\.od-sidebar-action:focus-visible\s*{[^}]*box-shadow:\s*var\(--od-interaction-focus-shadow\);/s);
    expect(css).toMatch(/\.od-sidebar-action\[aria-current="page"\]:focus-visible\s*{[^}]*background:\s*var\(--od-selection-hover-bg\);[^}]*border-color:\s*transparent;[^}]*box-shadow:\s*var\(--od-focus\);/s);
    expect(css).toMatch(/\.od-sidebar-action-icon\s*{[^}]*width:\s*var\(--sidebar-action-icon-slot\);[^}]*height:\s*20px;[^}]*justify-items:\s*start;[^}]*transform:\s*translateX\(var\(--sidebar-action-icon-offset-x\)\);/s);
    expect(css).toMatch(/\.od-sidebar-action-icon svg\s*{[^}]*width:\s*18px;[^}]*height:\s*18px;[^}]*stroke-width:\s*var\(--od-icon-stroke\);/s);
    expect(css).toMatch(/\.od-sidebar-action-label\s*{[^}]*font-weight:\s*var\(--od-font-weight-medium\);[^}]*line-height:\s*16px;/s);
    expect(css).toMatch(/\.od-sidebar-action kbd\s*{[^}]*display:\s*inline-flex;[^}]*align-items:\s*center;[^}]*gap:\s*2px;[^}]*min-height:\s*16px;[^}]*color:\s*var\(--od-meta\);[^}]*font-weight:\s*var\(--od-font-weight-medium\);[^}]*opacity:\s*0;[^}]*transform:\s*translateX\(2px\);/s);
    expect(css).toMatch(/\.od-sidebar-action kbd span\[aria-hidden="true"\]\s*{[^}]*font-size:\s*var\(--od-type-meta\);[^}]*font-weight:\s*var\(--od-font-weight-semibold\);/s);
    expect(css).toMatch(/\.od-sidebar-action:hover kbd,\s*\.od-sidebar-action:focus-visible kbd\s*{[^}]*opacity:\s*1;[^}]*transform:\s*translateX\(0\);/s);
    expect(css).not.toContain("--od-new-aim-bg");
    expect(css).not.toContain(".od-sidebar-action[data-current");
    expect(css).not.toContain(".od-sidebar-action[data-current=\"true\"] kbd");
    expect(css).not.toContain('.od-app[data-empty-aim="true"] .od-new-aim');
  });

  it("marks New Aim as current while a new aim is open", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <CockpitShell
          goals={[]}
          selected={null}
          activeStage="aim"
          activeSidebarAction="newAim"
          onHome={noop}
          onNewAim={noop}
          onOpenGoal={noop}
          onStage={noop}
          main={<div>New aim</div>}
        />
      </I18nProvider>,
    );

    expect(html).toContain('<button class="od-sidebar-action od-home-panel" type="button" data-od-id="sidebar-home-panel-action"');
    expect(html).toContain('<button class="od-sidebar-action od-new-aim" type="button" aria-current="page" data-od-id="sidebar-new-aim-action"');
  });

  it("keeps Desktop typography on three sizes and light shared weights", () => {
    const css = readFileSync(new URL("./cockpit.css", import.meta.url), "utf8");

    expect(css).toMatch(/font-size:\s*var\(--od-type-(meta|body|title)\);/);
    expect(css).not.toMatch(/font-size:\s*(9|10|11|12|13|14|15|16|18|20|22|28|32)px;/);
    expect(css).not.toMatch(/font-weight:\s*(600|650|700|750|800);/);
    expect(css).toContain("--od-font-weight-strong: 500;");
    expect(css).toContain("--od-font-weight-heavy: var(--od-font-weight-strong);");
  });

  it("uses the New Aim quiet hover treatment for secondary desktop controls", () => {
    const css = readFileSync(new URL("./cockpit.css", import.meta.url), "utf8");

    expect(css).toMatch(/\.od-aim-composer\s*{[^}]*border:\s*1px solid transparent;[^}]*transition:\s*border-color 160ms ease, box-shadow 160ms ease, background 160ms ease;/s);
    expect(css).toMatch(/\.od-aim-composer:hover\s*{[^}]*border-color:\s*color-mix\(in oklab, var\(--od-fg\), transparent 86%\);/s);
    expect(css).toMatch(/\.od-aim-composer:has\(\.od-aim-title-input:focus-visible,\s*\.od-aim-context-input:focus-visible\)\s*{[^}]*border-color:\s*color-mix\(in oklab, var\(--od-fg\), transparent 86%\);[^}]*box-shadow:\s*var\(--od-shadow-composer-focus\);/s);
    expect(css).toMatch(/\.od-aim-composer \.od-aim-title-input\s*{[^}]*padding:\s*8px 18px 0;/s);
    expect(css).toMatch(/\.od-sidebar-toggle:hover,\s*\.od-sidebar-toggle\[data-state="peek"\]\s*{[^}]*background:\s*var\(--od-interaction-hover-bg\);[^}]*border-color:\s*transparent;[^}]*box-shadow:\s*var\(--od-interaction-hover-shadow\);/s);
    expect(css).toMatch(/\.od-sidebar-toggle:focus-visible\s*{[^}]*background:\s*var\(--od-interaction-hover-bg\);[^}]*border-color:\s*transparent;[^}]*box-shadow:\s*var\(--od-interaction-focus-shadow\);/s);
    expect(css).toMatch(/\.od-user-menu-trigger:hover,\s*\.od-user-menu-trigger\[aria-expanded="true"\]\s*{[^}]*border-color:\s*transparent;[^}]*background:\s*var\(--od-interaction-hover-bg\);[^}]*box-shadow:\s*var\(--od-interaction-hover-shadow\);/s);
    expect(css).toMatch(/\.od-user-menu-trigger:focus-visible\s*{[^}]*border-color:\s*transparent;[^}]*background:\s*var\(--od-interaction-hover-bg\);[^}]*box-shadow:\s*var\(--od-interaction-focus-shadow\);/s);
    expect(css).toMatch(/\.od-settings-button:hover\s*{[^}]*border-color:\s*transparent;[^}]*background:\s*var\(--od-interaction-hover-bg\);[^}]*box-shadow:\s*var\(--od-interaction-hover-shadow\);/s);
    expect(css).toMatch(/\.od-aim-secondary:hover\s*{[^}]*border-color:\s*transparent;[^}]*background:\s*var\(--od-interaction-hover-bg\);[^}]*box-shadow:\s*var\(--od-interaction-hover-shadow\);/s);
    expect(css).toMatch(/\.od-command-row:hover,\s*\.od-command-row\[data-active="true"\]\s*{[^}]*border-color:\s*transparent;[^}]*background:\s*var\(--od-interaction-hover-bg\);[^}]*box-shadow:\s*var\(--od-interaction-hover-shadow\);/s);
    expect(css).toMatch(/\.od-routing-owner button:hover:not\(:disabled\)\s*{[^}]*background:\s*var\(--od-interaction-hover-bg\);[^}]*box-shadow:\s*var\(--od-interaction-hover-shadow\);/s);
    expect(css).toMatch(/\.od-scope-button:hover:not\(:disabled\)\s*{[^}]*border-color:\s*transparent;[^}]*background:\s*var\(--od-interaction-hover-bg\);[^}]*box-shadow:\s*var\(--od-interaction-hover-shadow\);/s);
  });

  it("keeps the normal aim sidebar left aligned without a recent-count zero", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <CockpitShell
          goals={[]}
          selected={null}
          activeStage="aim"
          activeSidebarAction={null}
          onHome={noop}
          onNewAim={noop}
          onOpenGoal={noop}
          onStage={noop}
          main={<div>New aim</div>}
        />
      </I18nProvider>,
    );
    const css = readFileSync(new URL("./cockpit.css", import.meta.url), "utf8");

    expect(html).toContain('<div class="od-section-label" data-od-id="sidebar-recent-aims-label"><span>Recent aims</span></div>');
    expect(html).not.toContain('<span>Recent aims</span><span>0</span>');
    expect(css).toMatch(/\.od-aim-browser\s*{[^}]*width:\s*var\(--sidebar-content-width\);[^}]*justify-self:\s*center;[^}]*padding-right:\s*0;/s);
    expect(css).toMatch(/\.od-section-label\s*{[^}]*justify-content:\s*flex-start;[^}]*padding:\s*0 var\(--sidebar-row-padding-x\);/s);
    expect(css).toMatch(/\.od-sidebar-empty\s*{[^}]*padding:\s*7px var\(--sidebar-row-padding-x\);/s);
    expect(css).toMatch(/\.od-aim-card\s*{[^}]*padding:\s*8px 10px 8px var\(--sidebar-row-padding-x\);/s);
    expect(css).toMatch(/\.od-aim-card\.selected,\s*\.od-aim-card\.current\s*{[^}]*background:\s*var\(--od-selection-bg\);[^}]*box-shadow:\s*var\(--od-selection-shadow\);[^}]*color:\s*var\(--od-fg\);/s);
    expect(css).toMatch(/\.od-aim-card\.selected:focus-visible,\s*\.od-aim-card\.current:focus-visible\s*{[^}]*background:\s*var\(--od-selection-hover-bg\);[^}]*box-shadow:\s*var\(--od-focus\), var\(--od-selection-shadow\);/s);
    expect(css).toMatch(/\.od-sidebar-search\s*{[^}]*padding:\s*0 var\(--sidebar-row-padding-x\);/s);
    expect(css).toMatch(/\.od-filter-row\s*{[^}]*padding:\s*0 var\(--sidebar-row-padding-x\) 2px;/s);
    expect(css).toMatch(/\.od-user-menu-anchor\s*{[^}]*width:\s*var\(--sidebar-content-width\);[^}]*justify-self:\s*center;/s);
    expect(css).toMatch(/\.od-user-menu-trigger\s*{[^}]*grid-template-columns:\s*var\(--sidebar-icon-column\) minmax\(0, 1fr\) 18px;[^}]*padding:\s*6px var\(--sidebar-row-padding-x\);/s);
    expect(css).toMatch(/\.od-user-menu-popover\s*{[^}]*display:\s*grid;[^}]*gap:\s*2px;[^}]*overflow:\s*visible;[^}]*padding:\s*6px;/s);
    expect(css).toMatch(/\.od-user-menu-header\s*{[^}]*grid-template-columns:\s*26px minmax\(0, 1fr\);[^}]*padding:\s*4px 6px 6px;/s);
    expect(css).toMatch(/\.od-user-menu-item\s*{[^}]*min-height:\s*32px;[^}]*grid-template-columns:\s*18px minmax\(0, 1fr\) auto;[^}]*padding:\s*0 6px;/s);
    expect(css).toMatch(/\.od-user-menu-item span\s*{[^}]*font-size:\s*var\(--od-type-meta\);[^}]*line-height:\s*var\(--od-line-meta\);/s);
    expect(css).toMatch(/\.od-user-menu-item kbd\s*{[^}]*min-height:\s*18px;[^}]*font-size:\s*var\(--od-type-meta\);[^}]*font-weight:\s*var\(--od-font-weight-medium\);/s);
    expect(css).toMatch(/\.od-user-menu-submenu-anchor\s*{[^}]*position:\s*relative;[^}]*display:\s*grid;/s);
    expect(css).toMatch(/\.od-user-menu-submenu-anchor::after\s*{[^}]*left:\s*100%;[^}]*width:\s*10px;/s);
    expect(css).toMatch(/\.od-user-language-menu\s*{[^}]*position:\s*absolute;[^}]*top:\s*-4px;[^}]*left:\s*calc\(100% \+ 8px\);[^}]*width:\s*180px;/s);
  });

  it("marks the saved aim row as current when a saved aim is open", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <CockpitShell
          goals={[savedGoal]}
          selected={savedGoal}
          activeStage="aim"
          activeSidebarAction={null}
          onHome={noop}
          onNewAim={noop}
          onOpenGoal={noop}
          onStage={noop}
          main={<div>Saved aim</div>}
        />
      </I18nProvider>,
    );

    expect(html).toContain('data-od-id="sidebar-new-aim-action"');
    expect(html).toContain('<button class="od-sidebar-action od-new-aim" type="button" data-od-id="sidebar-new-aim-action"');
    expect(html).toContain('<button class="od-aim-card selected" type="button" aria-current="page"');
    expect(html).not.toContain('data-current=');
  });

  it("renders an invisible pinned sidebar resize hot zone with accessible controls", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <CockpitShell
          goals={[]}
          selected={null}
          activeStage="aim"
          activeSidebarAction={null}
          onHome={noop}
          onNewAim={noop}
          onOpenGoal={noop}
          onStage={noop}
          main={<div>New aim</div>}
        />
      </I18nProvider>,
    );
    const css = readFileSync(new URL("./cockpit.css", import.meta.url), "utf8");

    expect(html).toContain('style="--sidebar-width:280px"');
    expect(html).toContain('id="od-left-aim-sidebar"');
    expect(html).toContain('data-od-id="sidebar-resizer"');
    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-label="Resize left sidebar"');
    expect(html).toContain('aria-controls="od-left-aim-sidebar"');
    expect(html).toContain('aria-orientation="vertical"');
    expect(html).toContain('aria-valuemin="216"');
    expect(html).toContain('aria-valuemax="360"');
    expect(html).toContain('aria-valuenow="280"');
    expect(css).toMatch(/\.od-sidebar-resizer\s*{[^}]*cursor:\s*col-resize;[^}]*touch-action:\s*none;/s);
    expect(css).toMatch(/\.od-sidebar-resizer\s*{[^}]*background:\s*transparent;/s);
    expect(css).not.toContain(".od-sidebar-resizer::before");
  });

  it("uses compact default window bounds instead of a large desktop footprint", () => {
    const main = readFileSync(new URL("../main/index.ts", import.meta.url), "utf8");

    expect(main).toContain("const DEFAULT_WINDOW_WIDTH = 960;");
    expect(main).toContain("const DEFAULT_WINDOW_HEIGHT = 680;");
    expect(main).toContain("const MIN_WINDOW_WIDTH = 640;");
    expect(main).toContain("const MIN_WINDOW_HEIGHT = 520;");
    expect(main).toContain("width: DEFAULT_WINDOW_WIDTH");
    expect(main).toContain("height: DEFAULT_WINDOW_HEIGHT");
    expect(main).toContain("minWidth: MIN_WINDOW_WIDTH");
    expect(main).toContain("minHeight: MIN_WINDOW_HEIGHT");
  });

  it("replaces the primary left sidebar with settings navigation on settings stage", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <CockpitShell
          goals={[]}
          selected={null}
          activeStage="settings"
          activeSidebarAction={null}
          onHome={noop}
          onNewAim={noop}
          onOpenGoal={noop}
          onStage={noop}
          settingsSidebar={<nav aria-label="Settings sections"><button type="button">Planning model</button></nav>}
          main={<div>Settings detail pane</div>}
        />
      </I18nProvider>,
    );
    const css = readFileSync(new URL("./cockpit.css", import.meta.url), "utf8");

    expect(html).toContain('data-od-id="left-settings-sidebar"');
    expect(html).not.toContain('data-od-id="sidebar-toggle"');
    expect(html).not.toContain('data-od-id="sidebar-peek-trigger"');
    expect(html).toContain('data-sidebar-state="pinned"');
    expect(html).not.toContain('data-od-id="mac-titlebar"');
    expect(html).not.toContain("<h1>Aimcub</h1>");
    expect(html).not.toContain("<p>Workbench</p>");
    expect(html).toContain("Settings sections");
    expect(html).toContain("Planning model");
    expect(html).toContain("Settings detail pane");
    expect(html).toContain('data-od-id="sidebar-user-menu-trigger"');
    expect(html).not.toContain("Search aims");
    expect(html).not.toContain("Aim OS workflow");
    expect(css).toMatch(/\.od-workspace-settings\s*{[^}]*width:\s*min\(100%, 1080px\);/s);
    expect(css).toMatch(/\.od-settings-sidebar-content\s*{[^}]*width:\s*var\(--sidebar-content-width\);[^}]*justify-self:\s*center;/s);
    expect(css).toMatch(/\.od-settings-back\s*{[^}]*width:\s*100%;[^}]*grid-template-columns:\s*var\(--sidebar-action-icon-slot\) minmax\(0, 1fr\);[^}]*padding:\s*0 var\(--sidebar-row-padding-x\);/s);
    expect(css).toMatch(/\.od-settings-search\s*{[^}]*width:\s*100%;/s);
    expect(css).toMatch(/\.od-settings-search input\s*{[^}]*min-height:\s*36px;[^}]*border-radius:\s*var\(--od-radius-md\);[^}]*padding:\s*0 11px 0 calc\(var\(--sidebar-row-padding-x\) \+ var\(--sidebar-action-icon-slot\) \+ var\(--sidebar-action-label-gap\)\);/s);
    expect(css).toMatch(/\.od-settings-search-icon\s*{[^}]*left:\s*var\(--sidebar-row-padding-x\);[^}]*width:\s*18px;[^}]*transform:\s*translate\(var\(--sidebar-action-icon-offset-x\), -50%\);/s);
    expect(css).toMatch(/\.od-settings-nav\s*{[^}]*padding-right:\s*0;[^}]*scrollbar-gutter:\s*auto;/s);
    expect(css).toMatch(/\.od-settings-nav-section\s*{[^}]*padding:\s*8px var\(--sidebar-row-padding-x\) 4px;/s);
    expect(css).toMatch(/\.od-settings-nav-empty\s*{[^}]*padding:\s*8px var\(--sidebar-row-padding-x\);/s);
    expect(css).toMatch(/\.od-settings-nav-item\s*{[^}]*grid-template-columns:\s*var\(--sidebar-action-icon-slot\) minmax\(0, 1fr\) auto;[^}]*column-gap:\s*var\(--sidebar-action-label-gap\);[^}]*padding:\s*0 var\(--sidebar-row-padding-x\);/s);
    expect(css).toMatch(/\.od-settings-nav-item\[data-active="true"\]\s*{[^}]*background:\s*var\(--od-selection-bg\);[^}]*border-color:\s*transparent;/s);
    expect(css).not.toContain(".od-settings-nav-item[data-active=\"true\"]::before");
    expect(css).toMatch(/\.od-settings-nav-icon\s*{[^}]*justify-self:\s*start;[^}]*transform:\s*translateX\(var\(--sidebar-action-icon-offset-x\)\);/s);
    expect(css).toMatch(/\.od-settings-nav-item\[data-active="true"\] \.od-settings-nav-icon\s*{[^}]*color:\s*currentColor;/s);
  });

  it("keeps a stable top drag strip outside the dynamic sidebar layers", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <CockpitShell
          goals={[]}
          selected={null}
          activeStage="aim"
          activeSidebarAction={null}
          onHome={noop}
          onNewAim={noop}
          onOpenGoal={noop}
          onStage={noop}
          main={<div>New aim</div>}
        />
      </I18nProvider>,
    );
    const css = readFileSync(new URL("./cockpit.css", import.meta.url), "utf8");

    expect(html).toContain('data-od-id="window-drag-strip"');
    expect(html).toContain('data-window-fullscreen="false"');
    expect(html).toContain('data-system-appearance="light"');
    expect(html).not.toContain('data-od-id="traffic-light-inactive-dots"');
    expect(html).not.toContain("data-window-focused");
    expect(html).not.toContain("data-window-traffic-lights");
    expect(css).toMatch(/\.od-window-drag-strip\s*{[^}]*app-region:\s*drag;[^}]*-webkit-app-region:\s*drag;/s);
    expect(css).toContain("--window-drag-strip-height: 36px;");
    expect(css).toMatch(
      /\.od-window-drag-strip\s*{[^}]*left:\s*calc\(var\(--titlebar-toggle-left\) \+ var\(--titlebar-toggle-size\) \+ 8px\);[^}]*height:\s*var\(--window-drag-strip-height\);/s,
    );
    expect(css).toMatch(/\.od-sidebar-toggle\s*{[^}]*app-region:\s*no-drag;[^}]*-webkit-app-region:\s*no-drag;/s);
    expect(css).toMatch(/\.od-user-menu-anchor,\s*\.od-user-menu-anchor \*\s*{[^}]*app-region:\s*no-drag;[^}]*-webkit-app-region:\s*no-drag;/s);
  });

  it("leaves macOS traffic lights to native window chrome", () => {
    const css = readFileSync(new URL("./cockpit.css", import.meta.url), "utf8");
    const main = readFileSync(new URL("../main/index.ts", import.meta.url), "utf8");

    expect(main).toContain('titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default"');
    expect(main).toContain('trafficLightPosition: process.platform === "darwin" ? nativeTrafficLightPosition() : undefined');
    expect(main).toContain("win.setWindowButtonVisibility(true)");
    expect(main).not.toContain("win.setWindowButtonVisibility(!win.isFullScreen())");
    expect(main).toContain("win.setWindowButtonPosition(nativeTrafficLightPosition(win.webContents.getZoomFactor()))");
    expect(main).toContain('win.webContents.on("zoom-changed", () => scheduleNativeMacWindowChrome(win))');
    expect(css).not.toContain("od-traffic-light-inactive-dots");
    expect(css).not.toContain("--traffic-light-size");
  });

  it("follows the native system appearance for dark mode", () => {
    const css = readFileSync(new URL("./cockpit.css", import.meta.url), "utf8");
    const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
    const main = readFileSync(new URL("../main/index.ts", import.meta.url), "utf8");
    const ipc = readFileSync(new URL("../main/ipc.ts", import.meta.url), "utf8");

    expect(main).toContain('nativeTheme.themeSource = "system"');
    expect(main).toContain('const DARK_WINDOW_BACKGROUND = "#1c1c1e"');
    expect(main).toContain("win.setBackgroundColor(nativeWindowBackgroundColor())");
    expect(main).toContain('nativeTheme.on("updated"');
    expect(main).toContain("colorScheme: systemColorScheme()");
    expect(ipc).toContain('colorScheme: nativeTheme.shouldUseDarkColors ? "dark" : "light"');
    expect(css).toContain("@media (prefers-color-scheme: dark)");
    expect(css).toContain(':root:has(.od-app[data-system-appearance="dark"])');
    expect(css).toContain("color-scheme: dark;");
    expect(css).toContain("--od-bg: #1c1c1e;");
    expect(css).toContain("--od-fg: #e8e8ed;");
    expect(css).toContain("--od-fg-2: #c9c9cf;");
    expect(css).toContain("--od-muted: #a8a8af;");
    expect(css).toContain("--od-meta: #8f8f99;");
    expect(css).toContain("--od-popover-bg: rgba(36, 36, 38, 0.96);");
    expect(css).toContain("--od-selection-bg: color-mix(in oklab, var(--od-fg), transparent 84%);");
    expect(css).toContain("--od-selection-border: color-mix(in oklab, var(--od-fg), transparent 72%);");
    expect(html).toContain("color-scheme: light dark;");
    expect(html).toContain("@media (prefers-color-scheme: dark)");
    expect(html).not.toContain("background: #fafafa;");
  });

  it("moves the sidebar toggle left in fullscreen without hiding native titlebar traffic lights", () => {
    const css = readFileSync(new URL("./cockpit.css", import.meta.url), "utf8");
    const main = readFileSync(new URL("../main/index.ts", import.meta.url), "utf8");

    expect(css).toMatch(
      /\.od-app\s*{[^}]*--titlebar-toggle-left:\s*calc\(var\(--traffic-light-left\) \+ var\(--traffic-light-cluster-width\) \+ var\(--titlebar-control-gap\)\);/s,
    );
    expect(css).toMatch(
      /\.od-app\[data-window-fullscreen="true"\]\s*{[^}]*--titlebar-toggle-left:\s*var\(--fullscreen-titlebar-toggle-left\);/s,
    );
    expect(css).toContain("--traffic-light-row-height: 46px;");
    expect(css).toContain("--traffic-light-button-size: 14px;");
    expect(css).toContain("--titlebar-toggle-top: calc((var(--traffic-light-row-height) - var(--titlebar-toggle-size)) / 2);");
    expect(main).toContain("win.setWindowButtonVisibility(true)");
  });

  it("groups transient sidebar hover controls without changing grid layout", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <CockpitShell
          goals={[]}
          selected={null}
          activeStage="aim"
          activeSidebarAction={null}
          onHome={noop}
          onNewAim={noop}
          onOpenGoal={noop}
          onStage={noop}
          main={<div>New aim</div>}
        />
      </I18nProvider>,
    );
    const css = readFileSync(new URL("./cockpit.css", import.meta.url), "utf8");

    expect(html).toContain('data-od-id="sidebar-hover-zone"');
    expect(html).toContain('data-od-id="sidebar-toggle"');
    expect(html).toContain('data-od-id="sidebar-peek-trigger"');
    expect(css).toMatch(/\.od-sidebar-hover-zone\s*{[^}]*display:\s*contents;/s);
  });

  it("keeps manual pinned sidebar in layout while only collapsed and peek states free workspace width", () => {
    const css = readFileSync(new URL("./cockpit.css", import.meta.url), "utf8");

    expect(css).toContain("@media (max-width: 1040px)");
    expect(css).toContain(".od-app:not(.od-app-stage-settings)[data-sidebar-state=\"collapsed\"]");
    expect(css).toContain(".od-app:not(.od-app-stage-settings)[data-sidebar-state=\"peek\"]");
    expect(css).toContain("grid-template-columns: 0 minmax(0, 1fr);");
    expect(css).toContain(".od-app:not(.od-app-stage-settings)[data-sidebar-state=\"peek\"] .od-sidebar");
    expect(css).not.toContain(".od-app:not(.od-app-stage-settings)[data-sidebar-state=\"pinned\"] .od-sidebar");
    expect(css).toContain("flex-wrap: wrap;");
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
