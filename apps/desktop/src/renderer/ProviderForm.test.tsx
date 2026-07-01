import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LLM_PROVIDER_CATALOG, type LlmProvider } from "@core/llm/providers";
import type { ProviderStatus } from "../shared/ipc";

import { I18nProvider } from "./i18n";
import {
  ProviderForm,
  providerConfigForFormState,
  providerFormStateForProvider,
} from "./ProviderForm";

const noop = () => {};

function renderProviderForm(status: ProviderStatus | null = null): string {
  return renderToStaticMarkup(
    <I18nProvider>
      <ProviderForm status={status} onSaved={noop} onClose={noop} />
    </I18nProvider>,
  );
}

function htmlText(value: string): string {
  return value.replace(/'/g, "&#x27;");
}

function status(provider: LlmProvider, model: string | null = null, baseURL: string | null = null): ProviderStatus {
  return {
    configured: true,
    provider,
    model,
    baseURL,
    hasApiKey: true,
  };
}

describe("ProviderForm", () => {
  it("renders every catalog provider in the desktop picker", () => {
    const html = renderProviderForm();

    for (const provider of LLM_PROVIDER_CATALOG) {
      expect(html).toContain(provider.label);
      expect(html).toContain(htmlText(provider.description));
    }
  });

  it.each([
    ["anthropic", "Claude Sonnet 5", null],
    ["openai", "GPT-5.4 mini", "https://api.openai.com/v1"],
    ["deepseek", "DeepSeek V4 Pro", "https://api.deepseek.com"],
    ["minimax", "MiniMax M3", "https://api.minimax.io/v1"],
    ["zai", "GLM-5.2", "https://api.z.ai/api/paas/v4"],
    ["google", "Gemini 3.5 Flash", "https://generativelanguage.googleapis.com/v1beta/openai"],
    ["qwen", "Qwen Plus", "https://dashscope.aliyuncs.com/compatible-mode/v1"],
  ] as const)("renders %s with its default model and endpoint", (provider, modelLabel, baseURL) => {
    const html = renderProviderForm(status(provider));

    expect(html).toContain(modelLabel);
    expect(html).toContain("Model ID:");
    if (baseURL) {
      expect(html).toContain("Endpoint");
      expect(html).toContain(baseURL);
    } else {
      expect(html).not.toContain("Endpoint");
    }
  });

  it("renders the custom endpoint escape hatch with custom model/base URL fields", () => {
    const html = renderProviderForm(status("openai-compatible", "custom-chat-model", "http://localhost:11434/v1"));

    expect(html).toContain("Custom endpoint");
    expect(html).toContain("e.g. deepseek-v4-pro");
    expect(html).toContain("custom-chat-model");
    expect(html).toContain("http://localhost:11434/v1");
  });

  it.each([
    ["deepseek", "deepseek-v4-pro", "https://api.deepseek.com"],
    ["minimax", "MiniMax-M3", "https://api.minimax.io/v1"],
    ["zai", "glm-5.2", "https://api.z.ai/api/paas/v4"],
    ["google", "gemini-3.5-flash", "https://generativelanguage.googleapis.com/v1beta/openai"],
    ["qwen", "qwen-plus", "https://dashscope.aliyuncs.com/compatible-mode/v1"],
  ] as const)("resets provider selection state for %s", (provider, model, baseURL) => {
    expect(providerFormStateForProvider(provider)).toEqual({
      providerKind: provider,
      model,
      baseURL,
    });
  });

  it("builds a trimmed OpenAI-compatible config from form state", () => {
    expect(providerConfigForFormState({
      providerKind: "deepseek",
      apiKey: "  sk-test  ",
      model: "deepseek-v4-flash",
      baseURL: "  https://api.deepseek.com  ",
    })).toEqual({
      provider: "deepseek",
      apiKey: "sk-test",
      model: "deepseek-v4-flash",
      baseURL: "https://api.deepseek.com",
    });
  });

  it("omits endpoints for the native Anthropic gateway config", () => {
    expect(providerConfigForFormState({
      providerKind: "anthropic",
      apiKey: "sk-ant",
      model: "claude-opus-4-8",
      baseURL: "https://example.invalid",
    })).toEqual({
      provider: "anthropic",
      apiKey: "sk-ant",
      model: "claude-opus-4-8",
      baseURL: undefined,
    });
  });

  it("keeps arbitrary custom endpoint model ids", () => {
    expect(providerConfigForFormState({
      providerKind: "openai-compatible",
      apiKey: "sk-local",
      model: "custom-chat-model",
      baseURL: "http://localhost:11434/v1",
    })).toEqual({
      provider: "openai-compatible",
      apiKey: "sk-local",
      model: "custom-chat-model",
      baseURL: "http://localhost:11434/v1",
    });
  });
});
