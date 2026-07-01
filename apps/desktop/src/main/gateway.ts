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
import type { ProviderConfig, ProviderStatus, ProviderTestResult } from "../shared/ipc";

const noopMeter = { async record(): Promise<void> {} };
const DESKTOP_LLM_REQUEST_TIMEOUT_MS = 45_000;
const DESKTOP_LLM_MAX_TOKENS = 16_384;

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

function mergeProviderConfig(input: ProviderConfig, existing: ProviderConfig | null = current): ProviderConfig {
  // Carry the stored key forward only when the provider is unchanged — otherwise switching
  // providers with a blank key would ship the previous provider's key to the new endpoint.
  const keepKey = existing && existing.provider === input.provider ? existing.apiKey : "";
  const apiKey = input.apiKey.trim() || keepKey;
  const def = getLlmProviderDefinition(input.provider);
  const model = input.model?.trim() || def?.defaultModel || undefined;
  const baseURL = input.baseURL?.trim() || getDefaultBaseURL(input.provider) || undefined;
  return {
    provider: input.provider,
    apiKey,
    baseURL: def?.protocol === "openai-compatible" ? baseURL : undefined,
    model: model?.trim() ? model.trim() : undefined,
  };
}

function buildGatewayFromConfig(config: ProviderConfig): LlmGateway | null {
  if (!isConfigured(config)) return null;
  const def = getLlmProviderDefinition(config.provider);
  if (!def) return null;
  if (config.provider === "anthropic") {
    return new AnthropicLlmGateway({
      meter: noopMeter,
      ownerId: LOCAL_OWNER,
      apiKey: config.apiKey,
      model: config.model || getDefaultModel("anthropic"),
    });
  }
  return new OpenAiCompatibleLlmGateway({
    meter: noopMeter,
    ownerId: LOCAL_OWNER,
    apiKey: config.apiKey,
    model: config.model || def.defaultModel,
    baseURL: config.baseURL || def.baseURL,
    maxTokensParam: def.maxTokensParam,
    structuredOutputMode: def.structuredOutputMode,
    requestBodyDefaults: def.requestBodyDefaults,
    maxTokens: DESKTOP_LLM_MAX_TOKENS,
    requestTimeoutMs: DESKTOP_LLM_REQUEST_TIMEOUT_MS,
  });
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
  const merged = mergeProviderConfig(input);
  current = merged;
  saveSettings(merged);
  return getProviderStatus();
}

/** Probe a config against the live provider without persisting it. */
export async function testProviderConfig(input: ProviderConfig): Promise<ProviderTestResult> {
  const startedAt = Date.now();
  const merged = mergeProviderConfig(input);
  const gateway = buildGatewayFromConfig(merged);
  const base: Omit<ProviderTestResult, "ok" | "error"> = {
    provider: merged.provider,
    model: merged.model ?? null,
    baseURL: merged.baseURL ?? null,
    latencyMs: 0,
  };
  if (!gateway) {
    return {
      ...base,
      ok: false,
      error: merged.apiKey.trim() ? "Provider config is missing a model or endpoint." : "API key is required.",
      latencyMs: Date.now() - startedAt,
    };
  }
  try {
    const result = await gateway.completeStructured<{ ok?: boolean }>({
      task: "classify",
      system: "You are an Aimcub provider connection test. Return only JSON.",
      prompt: "Return this exact JSON object: {\"ok\":true}",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: { ok: { type: "boolean" } },
        required: ["ok"],
      },
    });
    return {
      ...base,
      model: result.usage.model || base.model,
      ok: result.output.ok === true,
      error: result.output.ok === true ? null : "Provider responded, but did not return the expected structured JSON.",
      latencyMs: Date.now() - startedAt,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ...base,
      ok: false,
      error: message,
      latencyMs: Date.now() - startedAt,
    };
  }
}

/** Build a gateway from the current config, or null when nothing usable is configured. */
export function buildGateway(): LlmGateway | null {
  return current ? buildGatewayFromConfig(current) : null;
}
