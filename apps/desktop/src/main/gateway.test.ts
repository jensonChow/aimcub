import { describe, expect, it, vi } from "vitest";

const gatewayMocks = vi.hoisted(() => ({
  anthropicOptions: [] as Array<Record<string, unknown>>,
  openAiOptions: [] as Array<Record<string, unknown>>,
  failWith: null as Error | null,
}));

vi.mock("@core/llm", () => ({
  AnthropicLlmGateway: class {
    constructor(opts: Record<string, unknown>) {
      gatewayMocks.anthropicOptions.push(opts);
    }

    async completeStructured() {
      if (gatewayMocks.failWith) throw gatewayMocks.failWith;
      return { output: { ok: true }, usage: { model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1 } };
    }
  },
  OpenAiCompatibleLlmGateway: class {
    constructor(opts: Record<string, unknown>) {
      gatewayMocks.openAiOptions.push(opts);
    }

    async completeStructured() {
      if (gatewayMocks.failWith) throw gatewayMocks.failWith;
      const last = gatewayMocks.openAiOptions[gatewayMocks.openAiOptions.length - 1] ?? {};
      return { output: { ok: true }, usage: { model: String(last.model ?? ""), inputTokens: 1, outputTokens: 1 } };
    }
  },
}));

import { testProviderConfig } from "./gateway";

describe("desktop provider connection test", () => {
  it.each([
    ["openai", "gpt-5.4-mini", "https://api.openai.com/v1", "json_schema"],
    ["deepseek", "deepseek-v4-pro", "https://api.deepseek.com", "json_object"],
    ["minimax", "MiniMax-M3", "https://api.minimax.io/v1", "prompt"],
    ["zai", "glm-5.2", "https://api.z.ai/api/paas/v4", "json_object"],
    ["google", "gemini-3.5-flash", "https://generativelanguage.googleapis.com/v1beta/openai", "prompt"],
    ["qwen", "qwen-plus", "https://dashscope.aliyuncs.com/compatible-mode/v1", "prompt"],
  ] as const)("maps %s to its catalog-backed OpenAI-compatible gateway", async (provider, model, baseURL, structuredOutputMode) => {
    gatewayMocks.failWith = null;
    gatewayMocks.openAiOptions.length = 0;

    const result = await testProviderConfig({ provider, apiKey: "sk-test" });

    expect(result.ok).toBe(true);
    expect(result.model).toBe(model);
    expect(result.baseURL).toBe(baseURL);
    expect(gatewayMocks.openAiOptions[0]).toMatchObject({
      apiKey: "sk-test",
      model,
      baseURL,
      structuredOutputMode,
      maxTokens: 16_384,
      requestTimeoutMs: 45_000,
    });
  });

  it("maps Anthropic to the native gateway", async () => {
    gatewayMocks.failWith = null;
    gatewayMocks.anthropicOptions.length = 0;

    const result = await testProviderConfig({ provider: "anthropic", apiKey: "sk-ant" });

    expect(result.ok).toBe(true);
    expect(result.model).toBe("claude-sonnet-5");
    expect(gatewayMocks.anthropicOptions[0]).toMatchObject({
      apiKey: "sk-ant",
      model: "claude-sonnet-5",
    });
  });

  it("maps a built-in provider to catalog defaults before probing", async () => {
    gatewayMocks.failWith = null;
    gatewayMocks.openAiOptions.length = 0;

    const result = await testProviderConfig({ provider: "deepseek", apiKey: "sk-test" });

    expect(result.ok).toBe(true);
    expect(result.model).toBe("deepseek-v4-pro");
    expect(result.baseURL).toBe("https://api.deepseek.com");
    expect(gatewayMocks.openAiOptions[0]).toMatchObject({
      apiKey: "sk-test",
      model: "deepseek-v4-pro",
      baseURL: "https://api.deepseek.com",
      maxTokensParam: "max_tokens",
      structuredOutputMode: "json_object",
      requestBodyDefaults: { thinking: { type: "disabled" } },
      maxTokens: 16_384,
      requestTimeoutMs: 45_000,
    });
  });

  it("lets custom endpoints infer request shaping from the base URL", async () => {
    gatewayMocks.failWith = null;
    gatewayMocks.openAiOptions.length = 0;

    const result = await testProviderConfig({
      provider: "openai-compatible",
      apiKey: "sk-test",
      model: "deepseek-v4-pro",
      baseURL: "https://api.deepseek.com",
    });

    expect(result.ok).toBe(true);
    expect(result.model).toBe("deepseek-v4-pro");
    expect(result.baseURL).toBe("https://api.deepseek.com");
    expect(gatewayMocks.openAiOptions[0]).toMatchObject({
      apiKey: "sk-test",
      model: "deepseek-v4-pro",
      baseURL: "https://api.deepseek.com",
    });
    expect(gatewayMocks.openAiOptions[0]?.maxTokensParam).toBeUndefined();
    expect(gatewayMocks.openAiOptions[0]?.structuredOutputMode).toBeUndefined();
    expect(gatewayMocks.openAiOptions[0]?.requestBodyDefaults).toBeUndefined();
    expect(gatewayMocks.openAiOptions[0]?.maxTokens).toBe(16_384);
    expect(gatewayMocks.openAiOptions[0]?.requestTimeoutMs).toBe(45_000);
  });

  it("reports missing keys without constructing a gateway", async () => {
    gatewayMocks.openAiOptions.length = 0;

    const result = await testProviderConfig({ provider: "qwen", apiKey: "" });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/api key/i);
    expect(gatewayMocks.openAiOptions).toHaveLength(0);
  });

  it("surfaces live provider errors as test failures", async () => {
    gatewayMocks.openAiOptions.length = 0;
    gatewayMocks.failWith = new Error("model not found");

    const result = await testProviderConfig({ provider: "zai", apiKey: "sk-test" });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("model not found");
    expect(gatewayMocks.openAiOptions[0]).toMatchObject({
      model: "glm-5.2",
      structuredOutputMode: "json_object",
      maxTokens: 16_384,
      requestTimeoutMs: 45_000,
    });
    gatewayMocks.failWith = null;
  });
});
