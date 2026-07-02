import { describe, expect, it } from "vitest";

import { AnthropicLlmGateway } from "../src/anthropic-gateway";
import { OpenAiCompatibleLlmGateway } from "../src/openai-gateway";
import { LLM_PROVIDER_CATALOG, getLlmProviderDefinition, type BuiltInLlmProvider, type LlmProviderDefinition } from "../src/providers";
import type { LlmGateway } from "../src";

type LiveProviderCase = {
  provider: BuiltInLlmProvider;
  keyVars: readonly string[];
};

const LIVE_PROVIDERS: readonly LiveProviderCase[] = [
  { provider: "anthropic", keyVars: ["ANTHROPIC_API_KEY"] },
  { provider: "openai", keyVars: ["OPENAI_API_KEY"] },
  { provider: "deepseek", keyVars: ["DEEPSEEK_API_KEY"] },
  { provider: "minimax", keyVars: ["MINIMAX_API_KEY"] },
  { provider: "zai", keyVars: ["ZAI_API_KEY", "ZHIPUAI_API_KEY"] },
  { provider: "google", keyVars: ["GEMINI_API_KEY", "GOOGLE_API_KEY"] },
  { provider: "qwen", keyVars: ["DASHSCOPE_API_KEY", "QWEN_API_KEY"] },
];

const noopMeter = { async record(): Promise<void> {} };

function env(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

function selectedProviders(): Set<BuiltInLlmProvider> {
  const raw = env("AIMCUB_LIVE_PROVIDERS");
  if (!raw) return new Set(LIVE_PROVIDERS.map((item) => item.provider));
  const selected = raw.split(",").map((item) => item.trim()).filter(Boolean);
  return new Set(selected as BuiltInLlmProvider[]);
}

function envName(provider: BuiltInLlmProvider, suffix: "MODEL" | "BASE_URL"): string {
  return `AIMCUB_LIVE_${provider.toUpperCase()}_${suffix}`;
}

function apiKeyFor(testCase: LiveProviderCase): string | null {
  for (const keyVar of testCase.keyVars) {
    const value = env(keyVar);
    if (value) return value;
  }
  return null;
}

function modelFor(provider: BuiltInLlmProvider, def: LlmProviderDefinition): string {
  return env(envName(provider, "MODEL")) || def.defaultModel;
}

function baseURLFor(provider: BuiltInLlmProvider, def: LlmProviderDefinition): string | undefined {
  return env(envName(provider, "BASE_URL")) || def.baseURL;
}

function gatewayFor(provider: BuiltInLlmProvider, apiKey: string): LlmGateway {
  const def = getLlmProviderDefinition(provider);
  if (!def) throw new Error(`Unknown provider ${provider}`);
  const model = modelFor(provider, def);
  if (provider === "anthropic") {
    return new AnthropicLlmGateway({
      meter: noopMeter,
      ownerId: "live-provider-smoke",
      apiKey,
      model,
      maxTokens: 256,
      requestTimeoutMs: 60_000,
    });
  }
  return new OpenAiCompatibleLlmGateway({
    meter: noopMeter,
    ownerId: "live-provider-smoke",
    apiKey,
    model,
    baseURL: baseURLFor(provider, def),
    maxTokens: 256,
    requestTimeoutMs: 60_000,
    maxTokensParam: def.maxTokensParam,
    structuredOutputMode: def.structuredOutputMode,
  });
}

describe("live provider smoke", () => {
  const selected = selectedProviders();
  const cases = LIVE_PROVIDERS.filter((item) => selected.has(item.provider));

  it("selects at least one built-in provider", () => {
    expect(cases.map((item) => item.provider)).not.toEqual([]);
    for (const provider of selected) {
      expect(LLM_PROVIDER_CATALOG.some((item) => item.id === provider && item.id !== "openai-compatible")).toBe(true);
    }
  });

  it.each(cases)("$provider returns structured JSON", async (testCase) => {
    const apiKey = apiKeyFor(testCase);
    if (!apiKey) {
      throw new Error(
        `Missing API key for ${testCase.provider}. Set one of: ${testCase.keyVars.join(", ")}. ` +
        "Use AIMCUB_LIVE_PROVIDERS=deepseek,qwen to test a subset.",
      );
    }

    const gateway = gatewayFor(testCase.provider, apiKey);
    const result = await gateway.completeStructured<{ ok?: boolean }>({
      task: "classify",
      system: "You are an Aimcub provider smoke test. Return only JSON.",
      prompt: "Return this exact JSON object: {\"ok\":true}",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: { ok: { type: "boolean" } },
        required: ["ok"],
      },
    });

    expect(result.output.ok).toBe(true);
    expect(result.usage.model).toBeTruthy();
  }, 75_000);
});
