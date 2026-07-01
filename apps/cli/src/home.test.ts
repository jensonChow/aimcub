import { describe, expect, it } from "vitest";

import { resolveProvider } from "./config";
import {
  formatFirstRun,
  formatHome,
  formatPostSetupNextSteps,
  providerSetupComplete,
  providerSetupProblems,
} from "./home";

describe("providerSetupProblems", () => {
  it("requires an API key on first run", () => {
    const provider = resolveProvider({}, null);
    expect(providerSetupComplete(provider)).toBe(false);
    expect(providerSetupProblems(provider)).toEqual(["missing_api_key"]);
  });

  it("requires a model for openai-compatible", () => {
    const provider = resolveProvider({ AIMCUB_PROVIDER: "openai-compatible", AIMCUB_API_KEY: "sk" }, null);
    expect(providerSetupProblems(provider)).toEqual(["missing_model"]);
  });

  it("accepts a configured anthropic provider", () => {
    const provider = resolveProvider({ ANTHROPIC_API_KEY: "sk-ant" }, null);
    expect(providerSetupComplete(provider)).toBe(true);
  });
});

describe("formatFirstRun", () => {
  it("renders an interactive setup prelude instead of a command wall", () => {
    const text = formatFirstRun({
      version: "0.0.0",
      provider: resolveProvider({}, null),
      dataDir: "/tmp/aimcub",
      settingsFile: "/tmp/aimcub/settings.json",
      interactive: true,
    });
    expect(text).toContain("First run setup");
    expect(text).toContain("Starting setup");
    expect(text).toContain("typed hidden");
    expect(text).not.toContain("Planning (prints, stores nothing)");
  });

  it("renders a non-interactive setup path for scripts", () => {
    const text = formatFirstRun({
      version: "0.0.0",
      provider: resolveProvider({}, null),
      dataDir: "/tmp/aimcub",
      settingsFile: "/tmp/aimcub/settings.json",
      interactive: false,
    });
    expect(text).toContain("Run\n  aimcub setup");
    expect(text).toContain("--api-key -");
    expect(text).toContain('aimcub new "Ship the CLI"');
  });
});

describe("formatHome", () => {
  it("renders a compact cockpit for configured users", () => {
    const text = formatHome({
      version: "0.0.0",
      provider: resolveProvider({ ANTHROPIC_API_KEY: "sk-ant", AIMCUB_MODEL: "claude" }, null),
      dataDir: "/tmp/aimcub",
      goalCount: 2,
      pendingContextCount: 1,
    });
    expect(text).toContain("Aim cockpit");
    expect(text).toContain("provider: anthropic / claude");
    expect(text).toContain("aims:     2 aims");
    expect(text).toContain("context:  1 pending item");
    expect(text.split("\n").length).toBeLessThanOrEqual(20);
  });
});

describe("formatPostSetupNextSteps", () => {
  it("points new users at aim creation after setup", () => {
    expect(formatPostSetupNextSteps()).toContain('aimcub new "Ship the CLI"');
  });
});
