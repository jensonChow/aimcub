import {
  getDefaultBaseURL,
  getDefaultModel,
  getLlmProviderDefinition,
  modelBelongsToProvider,
  type LlmProvider,
  type LlmProviderDefinition,
} from "@aimcub/llm/providers";

import type { ProviderConfig, ProviderStatus } from "../shared/ipc";

export const CUSTOM_MODEL = "__custom__";

export interface ProviderFormState {
  providerKind: LlmProvider;
  apiKey: string;
  baseURL: string;
  model: string;
}

export function providerOrDefault(provider: ProviderStatus["provider"] | null | undefined): LlmProvider {
  return provider && getLlmProviderDefinition(provider) ? provider : "anthropic";
}

export function modelOrDefault(provider: LlmProvider, model: string | null | undefined): string {
  return model?.trim() || getDefaultModel(provider);
}

export function baseURLOrDefault(provider: LlmProvider, baseURL: string | null | undefined): string {
  return baseURL?.trim() || getDefaultBaseURL(provider) || "";
}

export function modelSelectValue(def: LlmProviderDefinition, model: string): string {
  if (def.models.length === 0) return CUSTOM_MODEL;
  return modelBelongsToProvider(def.id, model) ? model : CUSTOM_MODEL;
}

export function providerFormStateForProvider(provider: LlmProvider): Pick<ProviderFormState, "providerKind" | "baseURL" | "model"> {
  return {
    providerKind: provider,
    baseURL: baseURLOrDefault(provider, null),
    model: modelOrDefault(provider, null),
  };
}

export function providerConfigForFormState(state: ProviderFormState): ProviderConfig {
  const def = getLlmProviderDefinition(state.providerKind);
  const selectedModel = def ? modelSelectValue(def, state.model) : CUSTOM_MODEL;
  const finalModel = selectedModel === CUSTOM_MODEL ? state.model.trim() : state.model.trim() || def?.defaultModel;
  return {
    provider: state.providerKind,
    apiKey: state.apiKey.trim(),
    baseURL: def?.protocol === "openai-compatible" ? state.baseURL.trim() || undefined : undefined,
    model: finalModel || undefined,
  };
}
