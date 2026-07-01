/**
 * Shared provider/model catalog.
 *
 * This file is intentionally dependency-free: renderer code can import it without pulling
 * SDK clients into the browser bundle, while main/CLI code can use the same defaults when
 * building gateways.
 */

export type BuiltInLlmProvider = "anthropic" | "openai" | "deepseek" | "minimax" | "zai" | "google" | "qwen";
export type LlmProvider = BuiltInLlmProvider | "openai-compatible";
export type LlmProtocol = "anthropic" | "openai-compatible";

export type MaxTokensParam = "max_completion_tokens" | "max_tokens";
export type StructuredOutputMode = "json_schema" | "json_object" | "prompt";

export interface LlmModelOption {
  id: string;
  label: string;
  description?: string;
}

export interface LlmProviderDefinition {
  id: LlmProvider;
  label: string;
  shortLabel: string;
  protocol: LlmProtocol;
  description: string;
  apiKeyPlaceholder: string;
  defaultModel: string;
  models: readonly LlmModelOption[];
  baseURL?: string;
  baseURLHint?: string;
  maxTokensParam?: MaxTokensParam;
  structuredOutputMode?: StructuredOutputMode;
}

export const LLM_PROVIDER_CATALOG = [
  {
    id: "anthropic",
    label: "Anthropic",
    shortLabel: "Anthropic",
    protocol: "anthropic",
    description: "Native Claude Messages API.",
    apiKeyPlaceholder: "sk-ant-...",
    defaultModel: "claude-sonnet-5",
    models: [
      { id: "claude-sonnet-5", label: "Claude Sonnet 5", description: "Balanced planning and agent work." },
      { id: "claude-opus-4-8", label: "Claude Opus 4.8", description: "Higher-capability long-horizon reasoning." },
      { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", description: "Fast, lower-cost classification and extraction." },
      { id: "claude-fable-5", label: "Claude Fable 5", description: "Highest-capability widely released Claude model." },
    ],
  },
  {
    id: "openai",
    label: "OpenAI",
    shortLabel: "OpenAI",
    protocol: "openai-compatible",
    description: "OpenAI Chat Completions API.",
    apiKeyPlaceholder: "sk-...",
    baseURL: "https://api.openai.com/v1",
    baseURLHint: "OpenAI API root.",
    defaultModel: "gpt-5.4-mini",
    maxTokensParam: "max_completion_tokens",
    structuredOutputMode: "json_schema",
    models: [
      { id: "gpt-5.5", label: "GPT-5.5", description: "Frontier reasoning and coding." },
      { id: "gpt-5.4", label: "GPT-5.4", description: "Strong coding and professional work." },
      { id: "gpt-5.4-mini", label: "GPT-5.4 mini", description: "Balanced cost and latency." },
      { id: "gpt-5.4-nano", label: "GPT-5.4 nano", description: "Lowest-latency option." },
    ],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    shortLabel: "DeepSeek",
    protocol: "openai-compatible",
    description: "DeepSeek OpenAI-compatible API.",
    apiKeyPlaceholder: "sk-...",
    baseURL: "https://api.deepseek.com",
    baseURLHint: "DeepSeek OpenAI-compatible root.",
    defaultModel: "deepseek-v4-pro",
    maxTokensParam: "max_tokens",
    structuredOutputMode: "json_object",
    models: [
      { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", description: "Reasoning-oriented default." },
      { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash", description: "Lower-latency option." },
    ],
  },
  {
    id: "minimax",
    label: "MiniMax",
    shortLabel: "MiniMax",
    protocol: "openai-compatible",
    description: "MiniMax M-series OpenAI-compatible API.",
    apiKeyPlaceholder: "sk-...",
    baseURL: "https://api.minimax.io/v1",
    baseURLHint: "Use https://api.minimaxi.com/v1 for mainland China accounts if needed.",
    defaultModel: "MiniMax-M3",
    maxTokensParam: "max_tokens",
    structuredOutputMode: "prompt",
    models: [
      { id: "MiniMax-M3", label: "MiniMax M3", description: "Agentic coding model with 1M context." },
      { id: "MiniMax-M2.7", label: "MiniMax M2.7", description: "Long-context M-series model." },
      { id: "MiniMax-M2.7-highspeed", label: "MiniMax M2.7 Highspeed", description: "Faster M2.7 variant." },
      { id: "MiniMax-M2.5", label: "MiniMax M2.5", description: "Value-oriented long-context model." },
      { id: "MiniMax-M2", label: "MiniMax M2", description: "Agentic reasoning baseline." },
    ],
  },
  {
    id: "zai",
    label: "Z.ai",
    shortLabel: "Z.ai",
    protocol: "openai-compatible",
    description: "Z.ai GLM OpenAI SDK-compatible API.",
    apiKeyPlaceholder: "sk-...",
    baseURL: "https://api.z.ai/api/paas/v4",
    baseURLHint: "Z.ai OpenAI-compatible root.",
    defaultModel: "glm-5.2",
    maxTokensParam: "max_tokens",
    structuredOutputMode: "json_object",
    models: [
      { id: "glm-5.2", label: "GLM-5.2", description: "Current coding and long-context model." },
      { id: "glm-5.1", label: "GLM-5.1", description: "Long-horizon task model." },
      { id: "glm-5", label: "GLM-5", description: "General GLM-5 model." },
      { id: "glm-5-turbo", label: "GLM-5 Turbo", description: "Fast GLM-5 variant." },
      { id: "glm-4.7", label: "GLM-4.7", description: "Coding-oriented GLM 4.x model." },
      { id: "glm-4.6", label: "GLM-4.6", description: "Agentic reasoning and coding." },
    ],
  },
  {
    id: "google",
    label: "Google Gemini",
    shortLabel: "Gemini",
    protocol: "openai-compatible",
    description: "Gemini API through Google's OpenAI compatibility layer.",
    apiKeyPlaceholder: "AIza...",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    baseURLHint: "Google Gemini OpenAI compatibility root.",
    defaultModel: "gemini-3.5-flash",
    maxTokensParam: "max_tokens",
    structuredOutputMode: "json_schema",
    models: [
      { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash", description: "Fast Gemini model." },
      { id: "gemini-3.5-pro", label: "Gemini 3.5 Pro", description: "Higher-capability Gemini model." },
      { id: "gemini-3.1-pro", label: "Gemini 3.1 Pro", description: "Reasoning-capable model." },
      { id: "gemini-3-flash", label: "Gemini 3 Flash", description: "Fast Gemini 3 model." },
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", description: "Previous-generation pro model." },
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", description: "Previous-generation flash model." },
    ],
  },
  {
    id: "qwen",
    label: "Qwen / DashScope",
    shortLabel: "Qwen",
    protocol: "openai-compatible",
    description: "Alibaba Cloud Model Studio OpenAI-compatible API.",
    apiKeyPlaceholder: "sk-...",
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    baseURLHint: "Workspace-specific Model Studio domains can be pasted here.",
    defaultModel: "qwen-plus",
    maxTokensParam: "max_tokens",
    structuredOutputMode: "prompt",
    models: [
      { id: "qwen-plus", label: "Qwen Plus", description: "Balanced general-purpose model." },
      { id: "qwen-max", label: "Qwen Max", description: "Higher-capability Qwen model." },
      { id: "qwen-turbo", label: "Qwen Turbo", description: "Fast, lower-cost Qwen model." },
      { id: "qwen3-coder-plus", label: "Qwen3 Coder Plus", description: "Coding-oriented Qwen model." },
      { id: "qwen3-max", label: "Qwen3 Max", description: "Flagship Qwen3 family model." },
    ],
  },
  {
    id: "openai-compatible",
    label: "Custom endpoint",
    shortLabel: "Custom",
    protocol: "openai-compatible",
    description: "Any OpenAI chat-completions compatible endpoint.",
    apiKeyPlaceholder: "sk-...",
    baseURL: "https://api.openai.com/v1",
    baseURLHint: "Paste an OpenAI-compatible /v1 root.",
    defaultModel: "",
    maxTokensParam: "max_completion_tokens",
    structuredOutputMode: "json_schema",
    models: [],
  },
] as const satisfies readonly LlmProviderDefinition[];

export const LLM_PROVIDER_IDS = LLM_PROVIDER_CATALOG.map((provider) => provider.id) as readonly LlmProvider[];

export function isLlmProvider(value: string | null | undefined): value is LlmProvider {
  return Boolean(value && LLM_PROVIDER_IDS.includes(value as LlmProvider));
}

export function getLlmProviderDefinition(provider: LlmProvider | string | null | undefined): LlmProviderDefinition | null {
  return LLM_PROVIDER_CATALOG.find((item) => item.id === provider) ?? null;
}

export function getDefaultModel(provider: LlmProvider): string {
  return getLlmProviderDefinition(provider)?.defaultModel ?? "";
}

export function getDefaultBaseURL(provider: LlmProvider): string | undefined {
  return getLlmProviderDefinition(provider)?.baseURL;
}

export function modelBelongsToProvider(provider: LlmProvider, model: string): boolean {
  const def = getLlmProviderDefinition(provider);
  return Boolean(def?.models.some((item) => item.id === model));
}
