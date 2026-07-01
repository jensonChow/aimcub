/**
 * Builds the LLM gateway in the Electron MAIN process (Node) — the API key never reaches
 * the renderer. The provider config (which endpoint, which key, which model) is held in
 * memory and persisted to settings.json. Anthropic keeps its native gateway; built-in
 * providers use catalog-backed endpoints/model defaults; custom endpoints go through the
 * OpenAI-compatible gateway. There is no offline/template path — no config ⇒ no gateway.
 */
import { AnthropicLlmGateway, OpenAiCompatibleLlmGateway, type LlmGateway } from "@core/llm";
import { getDefaultBaseURL, getDefaultModel, getLlmProviderDefinition } from "@core/llm/providers";

import { LOCAL_OWNER, loadSettings, saveSettings } from "./store";
import type { ProviderConfig, ProviderStatus } from "../shared/ipc";

const noopMeter = { async record(): Promise<void> {} };

/** In-memory current config. Seeded from disk on startup via {@link loadProviderConfig}. */
let current: ProviderConfig | null = null;

/** Load the persisted config into memory (call once on app startup). */
export function loadProviderConfig(): void {
  current = loadSettings();
}

/** A config is usable when it has a key and a selected/default model where needed. */
function isConfigured(c: ProviderConfig | null): c is ProviderConfig {
  if (!c || !c.apiKey.trim()) return false;
  const def = getLlmProviderDefinition(c.provider);
  if (!def) return false;
  if (def.protocol === "openai-compatible") return Boolean((c.model ?? def.defaultModel).trim());
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
  const def = getLlmProviderDefinition(input.provider);
  const model = input.model?.trim() || def?.defaultModel || undefined;
  const baseURL = input.baseURL?.trim() || getDefaultBaseURL(input.provider) || undefined;
  const merged: ProviderConfig = {
    provider: input.provider,
    apiKey,
    baseURL: def?.protocol === "openai-compatible" ? baseURL : undefined,
    model: model?.trim() ? model.trim() : undefined,
  };
  current = merged;
  saveSettings(merged);
  return getProviderStatus();
}

/** Build a gateway from the current config, or null when nothing usable is configured. */
export function buildGateway(): LlmGateway | null {
  if (!isConfigured(current)) return null;
  const def = getLlmProviderDefinition(current.provider);
  if (!def) return null;
  if (current.provider === "anthropic") {
    return new AnthropicLlmGateway({
      meter: noopMeter,
      ownerId: LOCAL_OWNER,
      apiKey: current.apiKey,
      model: current.model || getDefaultModel("anthropic"),
    });
  }
  return new OpenAiCompatibleLlmGateway({
    meter: noopMeter,
    ownerId: LOCAL_OWNER,
    apiKey: current.apiKey,
    model: current.model || def.defaultModel,
    baseURL: current.baseURL || def.baseURL,
    maxTokensParam: def.maxTokensParam,
    structuredOutputMode: def.structuredOutputMode,
  });
}
