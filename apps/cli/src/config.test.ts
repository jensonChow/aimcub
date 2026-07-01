import { describe, expect, it } from "vitest";

import type { ProviderSettings } from "@core/store";

import { resolveProvider, redactKey, formatConfig, buildSettingsFromInput } from "./config";

describe("resolveProvider", () => {
  it("defaults to anthropic and reads ANTHROPIC_API_KEY", () => {
    const r = resolveProvider({ ANTHROPIC_API_KEY: "sk-ant-123456" }, null);
    expect(r.provider).toBe("anthropic");
    expect(r.providerSource).toBe("default");
    expect(r.apiKey).toBe("sk-ant-123456");
    expect(r.keySource).toBe("env:ANTHROPIC_API_KEY");
  });

  it("prefers AIMCUB_API_KEY over the provider-specific var", () => {
    const r = resolveProvider({ AIMCUB_API_KEY: "winner", ANTHROPIC_API_KEY: "loser" }, null);
    expect(r.apiKey).toBe("winner");
    expect(r.keySource).toBe("env:AIMCUB_API_KEY");
  });

  it("normalizes the direct OpenAI provider and reads model + base url", () => {
    const r = resolveProvider(
      {
        AIMCUB_PROVIDER: "openai",
        OPENAI_API_KEY: "sk-oai",
        AIMCUB_MODEL: "gpt-5.4-mini",
        AIMCUB_BASE_URL: "https://openrouter.ai/api/v1",
      },
      null,
    );
    expect(r.provider).toBe("openai");
    expect(r.model).toBe("gpt-5.4-mini");
    expect(r.baseURL).toBe("https://openrouter.ai/api/v1");
    expect(r.keySource).toBe("env:OPENAI_API_KEY");
  });

  it("flags an unrecognized provider as null but keeps the label", () => {
    const r = resolveProvider({ AIMCUB_PROVIDER: "bogus-ai" }, null);
    expect(r.provider).toBeNull();
    expect(r.providerLabel).toBe("bogus-ai");
    expect(r.apiKey).toBe(""); // no key vars consulted for an unknown provider
  });

  it("recognizes built-in provider-specific key variables and defaults", () => {
    const r = resolveProvider({ AIMCUB_PROVIDER: "deepseek", DEEPSEEK_API_KEY: "sk-ds" }, null);
    expect(r.provider).toBe("deepseek");
    expect(r.apiKey).toBe("sk-ds");
    expect(r.keySource).toBe("env:DEEPSEEK_API_KEY");
    expect(r.model).toBe("deepseek-v4-pro");
    expect(r.modelSource).toBe("default");
    expect(r.baseURL).toBe("https://api.deepseek.com");
  });

  describe("settings.json fallback (env wins)", () => {
    const settings: ProviderSettings = {
      provider: "openai-compatible",
      apiKey: "sk-file",
      model: "gpt-4o-mini",
      baseURL: "https://api.openai.com/v1",
    };

    it("falls back to settings when no env is set, tracking the source", () => {
      const r = resolveProvider({}, settings);
      expect(r.provider).toBe("openai-compatible");
      expect(r.providerSource).toBe("settings.json");
      expect(r.apiKey).toBe("sk-file");
      expect(r.keySource).toBe("settings.json");
      expect(r.model).toBe("gpt-4o-mini");
      expect(r.modelSource).toBe("settings.json");
    });

    it("lets an env key override the settings key", () => {
      const r = resolveProvider({ AIMCUB_API_KEY: "sk-env" }, settings);
      expect(r.apiKey).toBe("sk-env");
      expect(r.keySource).toBe("env:AIMCUB_API_KEY");
      // provider still comes from settings (no AIMCUB_PROVIDER set)
      expect(r.providerSource).toBe("settings.json");
    });

    it("lets env provider/model override settings", () => {
      const r = resolveProvider({ AIMCUB_PROVIDER: "anthropic", AIMCUB_MODEL: "claude-x" }, settings);
      expect(r.provider).toBe("anthropic");
      expect(r.providerSource).toBe("env");
      expect(r.model).toBe("claude-x");
      expect(r.modelSource).toBe("env");
    });

    it("does NOT borrow the settings key/model when env selects a DIFFERENT provider", () => {
      // settings.json holds an ANTHROPIC key; env forces openai-compatible with no env key.
      const anthropicFile: ProviderSettings = { provider: "anthropic", apiKey: "sk-ant-FILE", model: "claude-3-7" };
      const r = resolveProvider({ AIMCUB_PROVIDER: "openai-compatible" }, anthropicFile);
      expect(r.provider).toBe("openai-compatible");
      expect(r.apiKey).toBe(""); // the anthropic key must NOT leak to the openai endpoint
      expect(r.keySource).toBeNull();
      expect(r.model).toBeNull(); // nor the anthropic model
    });

    it("still does not borrow the settings model on a provider mismatch even when an env key is set", () => {
      const anthropicFile: ProviderSettings = { provider: "anthropic", apiKey: "sk-ant-FILE", model: "claude-3-7" };
      const r = resolveProvider({ AIMCUB_PROVIDER: "openai-compatible", AIMCUB_API_KEY: "sk-env" }, anthropicFile);
      expect(r.apiKey).toBe("sk-env");
      expect(r.model).toBeNull();
    });
  });
});

describe("redactKey", () => {
  it("masks the middle of a key and never reveals it whole", () => {
    expect(redactKey("sk-ant-abcdef")).toBe("sk-…ef");
    expect(redactKey("short")).toBe("set");
    expect(redactKey("")).toBe("(not set)");
  });
});

describe("formatConfig", () => {
  it("renders a redacted view with provenance and never prints the raw key", () => {
    const r = resolveProvider({ ANTHROPIC_API_KEY: "sk-ant-secretkey" }, null);
    const text = formatConfig(r, "/home/me/.aimcub", "1.2.3", "/home/me/.aimcub/settings.json");
    expect(text).toContain("aimcub 1.2.3");
    expect(text).toContain("anthropic");
    expect(text).toContain("from env:ANTHROPIC_API_KEY");
    expect(text).toContain("/home/me/.aimcub/settings.json");
    expect(text).not.toContain("sk-ant-secretkey");
  });

  it("nudges the user to run `aimcub setup` when no key resolves", () => {
    const r = resolveProvider({}, null);
    expect(formatConfig(r, "/d", "1.0.0", "/d/settings.json")).toContain("aimcub setup");
  });
});

describe("buildSettingsFromInput", () => {
  it("builds anthropic settings from a fresh key", () => {
    const { settings, errors } = buildSettingsFromInput({ provider: "anthropic", apiKey: "sk-ant-new" }, null);
    expect(errors).toEqual([]);
    expect(settings).toEqual({ provider: "anthropic", apiKey: "sk-ant-new", model: "claude-sonnet-5", baseURL: undefined });
  });

  it("requires a model for openai-compatible", () => {
    const { settings, errors } = buildSettingsFromInput({ provider: "openai-compatible", apiKey: "sk" }, null);
    expect(settings).toBeUndefined();
    expect(errors.join(" ")).toMatch(/model is required/i);
  });

  it("keeps the existing key on a blank key when the provider is unchanged", () => {
    const current: ProviderSettings = { provider: "anthropic", apiKey: "sk-kept" };
    const { settings } = buildSettingsFromInput({ provider: "anthropic", apiKey: "" }, current);
    expect(settings?.apiKey).toBe("sk-kept");
  });

  it("does NOT carry a key across a provider switch", () => {
    const current: ProviderSettings = { provider: "anthropic", apiKey: "sk-ant" };
    const { settings, errors } = buildSettingsFromInput({ provider: "openai-compatible", apiKey: "", model: "m" }, current);
    expect(settings).toBeUndefined();
    expect(errors.join(" ")).toMatch(/api key is required/i);
  });

  it("rejects an unknown provider", () => {
    const { settings, errors } = buildSettingsFromInput({ provider: "bogus-ai", apiKey: "k" }, null);
    expect(settings).toBeUndefined();
    expect(errors.join(" ")).toMatch(/unknown provider/i);
  });

  it("never persists a baseURL for anthropic (the gateway ignores it)", () => {
    const { settings } = buildSettingsFromInput(
      { provider: "anthropic", apiKey: "sk-ant", baseURL: "https://nope.example" },
      null,
    );
    expect(settings?.baseURL).toBeUndefined();
  });

  it("fills default model and endpoint for a built-in OpenAI-compatible provider", () => {
    const { settings, errors } = buildSettingsFromInput({ provider: "deepseek", apiKey: "sk" }, null);
    expect(errors).toEqual([]);
    expect(settings).toEqual({
      provider: "deepseek",
      apiKey: "sk",
      model: "deepseek-v4-pro",
      baseURL: "https://api.deepseek.com",
    });
  });

  it("keeps the baseURL for openai-compatible", () => {
    const { settings } = buildSettingsFromInput(
      { provider: "openai-compatible", apiKey: "sk", model: "m", baseURL: "https://openrouter.ai/api/v1" },
      null,
    );
    expect(settings?.baseURL).toBe("https://openrouter.ai/api/v1");
  });
});
