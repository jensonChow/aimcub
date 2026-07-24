import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { PlanningAgentDetection } from "../shared/ipc";
import { I18nProvider } from "./i18n";
import { SettingsPlanningBrainPane } from "./SettingsPlanningBrainPane";

const noop = () => {};

function detection(overrides: Partial<PlanningAgentDetection> = {}): PlanningAgentDetection {
  return {
    id: "codex",
    name: "Codex CLI",
    runMode: "local_cli",
    available: true,
    path: "/bin/codex",
    version: "0.145.0",
    authStatus: "ok",
    authMessage: null,
    models: [
      { id: "default", label: "Default" },
      { id: "gpt-5.6-sol", label: "gpt-5.6-sol" },
      { id: "gpt-5.5", label: "gpt-5.5" },
    ],
    modelsSource: "live",
    reasoningOptions: [],
    diagnostics: [],
    planningCapable: true,
    ...overrides,
  };
}

function renderPane(
  agents: PlanningAgentDetection[],
  planningBrain: string | null = null,
  planningModel: { agentId: string; model: string } | null = null,
): string {
  return renderToStaticMarkup(
    <I18nProvider>
      <SettingsPlanningBrainPane
        localAgents={agents}
        planningBrain={planningBrain}
        planningModel={planningModel}
        onSelectBrain={noop}
        onSelectModel={noop}
      />
    </I18nProvider>,
  );
}

describe("SettingsPlanningBrainPane", () => {
  it("lists Auto plus every planning-capable runtime with readiness states", () => {
    const html = renderPane([
      detection({ id: "claude", name: "Claude Code", authStatus: "missing", authMessage: "Please run /login", models: [], modelsSource: "fallback" }),
      detection(),
    ]);
    expect(html).toContain("Embedded planning brain");
    expect(html).toContain("Auto (recommended)");
    expect(html).toContain("Currently Codex CLI");
    expect(html).toContain("Claude Code");
    expect(html).toContain("Please run /login");
    expect(html).toContain("Codex CLI");
    expect(html).toContain("Ready");
    // Auto is the checked radio by default.
    expect(html).toMatch(/aria-checked="true"[^>]*>[\s\S]{0,200}Auto \(recommended\)/);
  });

  it("offers the effective brain's live models with the Auto option named", () => {
    const html = renderPane([detection()]);
    expect(html).toContain("Auto — gpt-5.6-sol");
    expect(html).toContain('value="gpt-5.6-sol"');
    expect(html).toContain('value="gpt-5.5"');
  });

  it("marks an explicit pick as selected", () => {
    const html = renderPane([detection()], "codex", { agentId: "codex", model: "gpt-5.5" });
    expect(html).toMatch(/aria-checked="true"[^>]*>[\s\S]{0,240}Codex CLI/);
    expect(html).toContain('selected=""');
  });

  it("explains itself when no planning-capable runtime exists", () => {
    const html = renderPane([detection({ planningCapable: false })]);
    expect(html).toContain("No planning-capable local agent detected");
  });

  it("hints instead of listing models when the runtime has no live list", () => {
    const html = renderPane([detection({ modelsSource: "fallback" })]);
    expect(html).toContain("Models appear once the selected runtime is signed in");
  });
});
