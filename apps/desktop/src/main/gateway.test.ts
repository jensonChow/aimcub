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
    });
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
    });
    gatewayMocks.failWith = null;
  });
});
