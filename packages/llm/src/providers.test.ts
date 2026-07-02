import { describe, expect, it } from "vitest";

import { LLM_PROVIDER_CATALOG, getLlmProviderDefinition, isLlmProvider } from "./providers";

describe("LLM provider catalog", () => {
  it("includes the built-in providers requested by the desktop model picker", () => {
    expect(LLM_PROVIDER_CATALOG.map((provider) => provider.id)).toEqual([
      "anthropic",
      "openai",
      "deepseek",
      "minimax",
      "zai",
      "google",
      "qwen",
      "openai-compatible",
    ]);
  });

  it("marks direct providers with gateway defaults", () => {
    expect(getLlmProviderDefinition("anthropic")).toMatchObject({
      protocol: "anthropic",
      defaultModel: "claude-sonnet-5",
    });
    expect(getLlmProviderDefinition("deepseek")).toMatchObject({
      protocol: "openai-compatible",
      baseURL: "https://api.deepseek.com",
      defaultModel: "deepseek-v4-pro",
      maxTokensParam: "max_tokens",
      structuredOutputMode: "json_object",
      requestBodyDefaults: { thinking: { type: "disabled" } },
    });
    expect(getLlmProviderDefinition("minimax")).toMatchObject({
      protocol: "openai-compatible",
      structuredOutputMode: "prompt",
    });
    expect(getLlmProviderDefinition("google")).toMatchObject({
      protocol: "openai-compatible",
      structuredOutputMode: "prompt",
    });
  });

  it("leaves custom endpoint request shaping to URL inference", () => {
    expect(getLlmProviderDefinition("openai-compatible")).toMatchObject({
      protocol: "openai-compatible",
      baseURL: "https://api.openai.com/v1",
    });
    expect(getLlmProviderDefinition("openai-compatible")?.maxTokensParam).toBeUndefined();
    expect(getLlmProviderDefinition("openai-compatible")?.structuredOutputMode).toBeUndefined();
  });

  it("recognizes only supported provider ids", () => {
    expect(isLlmProvider("zai")).toBe(true);
    expect(isLlmProvider("gemini")).toBe(false);
  });
});
