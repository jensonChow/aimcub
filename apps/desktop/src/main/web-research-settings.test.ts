import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  getWebResearchStatus,
  loadWebResearchConfig,
  resolveWebResearchConfig,
  setWebResearchConfig,
  webResearchDisabledBySettings,
} from "./web-research-settings";

const ORIGINAL_ENV = { ...process.env };

function freshHome(): string {
  return mkdtempSync(join(tmpdir(), "aimcub-desktop-web-"));
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  loadWebResearchConfig();
});

describe("desktop web research settings", () => {
  it("defaults provider-independent page fetching on without requiring a Brave key", () => {
    process.env = { ...ORIGINAL_ENV, AIMCUB_HOME: freshHome() };
    loadWebResearchConfig();

    expect(resolveWebResearchConfig()).toMatchObject({
      apiKey: "",
      enabled: false,
      fetchPages: true,
      keySource: null,
    });
  });

  it("saves and resolves a Brave web research config", () => {
    process.env = { ...ORIGINAL_ENV, AIMCUB_HOME: freshHome() };
    loadWebResearchConfig();

    const status = setWebResearchConfig({
      provider: "brave",
      apiKey: "brave-file-key",
      enabled: true,
      fetchPages: true,
    });

    expect(status).toMatchObject({
      configured: true,
      enabled: true,
      fetchPages: true,
      hasApiKey: true,
      keySource: "settings",
    });
    expect(resolveWebResearchConfig()).toMatchObject({
      apiKey: "brave-file-key",
      enabled: true,
      fetchPages: true,
      keySource: "settings",
    });
  });

  it("lets environment keys override saved keys", () => {
    process.env = { ...ORIGINAL_ENV, AIMCUB_HOME: freshHome(), AIMCUB_BRAVE_SEARCH_API_KEY: "brave-env-key" };
    loadWebResearchConfig();
    setWebResearchConfig({
      provider: "brave",
      apiKey: "brave-file-key",
      enabled: true,
      fetchPages: true,
    });

    expect(resolveWebResearchConfig()).toMatchObject({
      apiKey: "brave-env-key",
      keySource: "env",
    });
    expect(getWebResearchStatus()).toMatchObject({
      configured: true,
      keySource: "env",
    });
  });

  it("tracks an explicit disabled setting", () => {
    process.env = { ...ORIGINAL_ENV, AIMCUB_HOME: freshHome() };
    loadWebResearchConfig();
    setWebResearchConfig({
      provider: "brave",
      apiKey: "brave-file-key",
      enabled: false,
      fetchPages: true,
    });

    expect(webResearchDisabledBySettings()).toBe(true);
    expect(getWebResearchStatus()).toMatchObject({
      configured: false,
      enabled: false,
      hasApiKey: true,
    });
  });
});
