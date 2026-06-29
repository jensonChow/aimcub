import { describe, expect, it } from "vitest";

import { resolveProvider, redactKey, formatConfig } from "./config";

describe("resolveProvider", () => {
  it("defaults to anthropic and reads ANTHROPIC_API_KEY", () => {
    const r = resolveProvider({ ANTHROPIC_API_KEY: "sk-ant-123456" });
    expect(r.provider).toBe("anthropic");
    expect(r.apiKey).toBe("sk-ant-123456");
    expect(r.keySource).toBe("ANTHROPIC_API_KEY");
  });

  it("prefers AIMCUB_API_KEY over the provider-specific var", () => {
    const r = resolveProvider({ AIMCUB_API_KEY: "winner", ANTHROPIC_API_KEY: "loser" });
    expect(r.apiKey).toBe("winner");
    expect(r.keySource).toBe("AIMCUB_API_KEY");
  });

  it("normalizes the 'openai' alias and reads model + base url", () => {
    const r = resolveProvider({
      AIMCUB_PROVIDER: "openai",
      OPENAI_API_KEY: "sk-oai",
      AIMCUB_MODEL: "deepseek/deepseek-chat",
      AIMCUB_BASE_URL: "https://openrouter.ai/api/v1",
    });
    expect(r.provider).toBe("openai-compatible");
    expect(r.model).toBe("deepseek/deepseek-chat");
    expect(r.baseURL).toBe("https://openrouter.ai/api/v1");
    expect(r.keySource).toBe("OPENAI_API_KEY");
  });

  it("flags an unrecognized provider as null but keeps the raw value", () => {
    const r = resolveProvider({ AIMCUB_PROVIDER: "gemini" });
    expect(r.provider).toBeNull();
    expect(r.providerRaw).toBe("gemini");
    expect(r.apiKey).toBe(""); // no key vars consulted for an unknown provider
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
  it("renders a redacted view and never prints the raw key", () => {
    const r = resolveProvider({ ANTHROPIC_API_KEY: "sk-ant-secretkey" });
    const text = formatConfig(r, "/home/me/.aimcub", "1.2.3");
    expect(text).toContain("aim 1.2.3");
    expect(text).toContain("anthropic");
    expect(text).toContain("/home/me/.aimcub");
    expect(text).not.toContain("sk-ant-secretkey");
  });
});
