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
          onSection={noop}
          aimContext={null}
          onProvider={noop}
          onWeb={noop}
          onContextSources={noop}
          onRefreshAgents={asyncNoop}
        />
      </I18nProvider>,
    );

    expect(html).toContain("Overview");
    expect(html).toContain("Planning status");
    expect(html).toContain("Configure");
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
    expect(html).not.toContain("<h1>Aimcub</h1>");
    expect(html).not.toContain("<p>Workbench</p>");
  });

  it("renders New Aim as a top-left app-level sidebar action", () => {
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

    expect(html).toContain('data-od-id="sidebar-global-actions"');
    expect(html).toContain('aria-label="Workspace actions"');
    expect(html).toContain('data-od-id="sidebar-new-aim-action"');
    expect(html).toContain('class="od-new-aim-icon"');
    expect(html).toContain('class="od-new-aim-label"');
    expect(html).toContain("New aim");
    expect(html).toContain("Cmd N");
    expect(css).toMatch(/\.od-sidebar-global-actions\s*{[^}]*display:\s*grid;[^}]*gap:\s*4px;/s);
    expect(css).toMatch(/\.od-new-aim\s*{[^}]*min-height:\s*40px;[^}]*grid-template-columns:\s*20px minmax\(0, 1fr\) auto;/s);
    expect(css).toMatch(/:root\s*{[^}]*--od-new-aim-bg:\s*#1d1d1f;[^}]*--od-new-aim-fg:\s*#ffffff;/s);
    expect(css).toMatch(/:root:has\(\.od-app\[data-system-appearance="light"\]\)\s*{[^}]*--od-new-aim-bg:\s*#1d1d1f;[^}]*--od-new-aim-fg:\s*#ffffff;/s);
    expect(css).toMatch(/:root:has\(\.od-app\[data-system-appearance="dark"\]\)\s*{[^}]*--od-new-aim-bg:\s*#f5f5f7;[^}]*--od-new-aim-fg:\s*#1d1d1f;/s);
    expect(css).toMatch(/\.od-new-aim\s*{[^}]*background:\s*var\(--od-new-aim-bg\);[^}]*color:\s*var\(--od-new-aim-fg\);/s);
    expect(css).toMatch(/\.od-new-aim-icon\s*{[^}]*width:\s*20px;[^}]*height:\s*20px;/s);
    expect(css).toMatch(/\.od-new-aim kbd\s*{[^}]*min-height:\s*18px;[^}]*background:\s*var\(--od-new-aim-kbd-bg\);/s);
    expect(css).not.toContain('.od-app[data-empty-aim="true"] .od-new-aim');
  });

  it("renders an invisible pinned sidebar resize hot zone with accessible controls", () => {
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

    expect(html).toContain('style="--sidebar-width:280px"');
    expect(html).toContain('id="od-left-aim-sidebar"');
    expect(html).toContain('data-od-id="sidebar-resizer"');
    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-label="Resize left sidebar"');
    expect(html).toContain('aria-controls="od-left-aim-sidebar"');
    expect(html).toContain('aria-orientation="vertical"');
    expect(html).toContain('aria-valuemin="240"');
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
          onNewAim={noop}
          onOpenGoal={noop}
          onStage={noop}
          settingsSidebar={<nav aria-label="Settings sections"><button type="button">Planning model</button></nav>}
          main={<div>Settings detail pane</div>}
        />
      </I18nProvider>,
    );

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
    expect(html).toContain('data-window-fullscreen="false"');
    expect(html).toContain('data-system-appearance="light"');
    expect(html).not.toContain('data-od-id="traffic-light-inactive-dots"');
    expect(html).not.toContain("data-window-focused");
    expect(html).not.toContain("data-window-traffic-lights");
    expect(css).toMatch(/\.od-window-drag-strip\s*{[^}]*app-region:\s*drag;[^}]*-webkit-app-region:\s*drag;/s);
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
    expect(css).toContain("--od-popover-bg: rgba(36, 36, 38, 0.96);");
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
