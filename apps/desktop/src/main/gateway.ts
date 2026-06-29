/**
 * Builds the LLM gateway in the Electron MAIN process (Node) — the API key never reaches
 * the renderer. The provider config (which endpoint, which key, which model) is held in
 * memory and persisted to settings.json. Anthropic keeps its native gateway; everything
 * else (OpenAI, OpenRouter, DeepSeek, local Ollama/vLLM, …) goes through the
 * OpenAI-compatible gateway. There is no offline/template path — no config ⇒ no gateway.
 */
import { AnthropicLlmGateway, OpenAiCompatibleLlmGateway, type LlmGateway } from "@core/llm";

import { LOCAL_OWNER, loadSettings, saveSettings } from "./store";
import type { ProviderConfig, ProviderStatus } from "../shared/ipc";

const noopMeter = { async record(): Promise<void> {} };

/** In-memory current config. Seeded from disk on startup via {@link loadProviderConfig}. */
let current: ProviderConfig | null = null;

/** Load the persisted config into memory (call once on app startup). */
export function loadProviderConfig(): void {
  current = loadSettings();
}

/** A config is usable when it has a key (+ a model for openai-compatible). */
function isConfigured(c: ProviderConfig | null): c is ProviderConfig {
  if (!c || !c.apiKey.trim()) return false;
  if (c.provider === "openai-compatible") return Boolean(c.model && c.model.trim());
  return true;
}

/** The renderer-safe view of the current config (never leaks the key itself). */
export function getProviderStatus(): ProviderStatus {
  return {
    configured: isConfigured(current),
    provider: current?.provider ?? null,
    baseURL: current?.baseURL ?? null,
    model: current?.model ?? null,
    hasApiKey: Boolean(current?.apiKey.trim()),
  };
}

/**
 * Apply + persist a new config. A blank `apiKey` keeps the already-stored key (so the user
 * can change the model/baseURL without re-pasting the secret). Returns the new status.
 */
export function setProviderConfig(input: ProviderConfig): ProviderStatus {
  // Carry the stored key forward only when the provider is unchanged — otherwise switching
  // providers with a blank key would ship the previous provider's key to the new endpoint.
  const keepKey = current && current.provider === input.provider ? current.apiKey : "";
  const apiKey = input.apiKey.trim() || keepKey;
  const merged: ProviderConfig = {
    provider: input.provider,
    apiKey,
    baseURL: input.baseURL?.trim() ? input.baseURL.trim() : undefined,
    model: input.model?.trim() ? input.model.trim() : undefined,
  };
  current = merged;
  saveSettings(merged);
  return getProviderStatus();
}

/** Build a gateway from the current config, or null when nothing usable is configured. */
export function buildGateway(): LlmGateway | null {
  if (!isConfigured(current)) return null;
  if (current.provider === "anthropic") {
    return new AnthropicLlmGateway({ meter: noopMeter, ownerId: LOCAL_OWNER, apiKey: current.apiKey });
  }
  return new OpenAiCompatibleLlmGateway({
    meter: noopMeter,
    ownerId: LOCAL_OWNER,
    apiKey: current.apiKey,
    model: current.model!,
    baseURL: current.baseURL,
  });
}
