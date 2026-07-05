/**
 * `OpenAiCompatibleLlmGateway` — an `LlmGateway` backed by any OpenAI-compatible
 * `/chat/completions` endpoint (the "option A" / Hermes-style multi-provider path).
 *
 * Why this exists: Anthropic's Messages API is NOT OpenAI-shaped, so it keeps its own
 * native gateway. Everything else — OpenAI, OpenRouter (50+ models, the easy default),
 * DeepSeek/Qwen/Kimi/GLM/MiniMax, local Ollama/vLLM — speaks the OpenAI chat-completions
 * dialect. A configurable `baseURL` means a user brings their own key (BYO-key) and points
 * at whichever endpoint they like, including domestic ones, with no provider lock-in.
 *
 * Routing note: `routeModel(task)` returns Anthropic model ids only, so it does NOT apply
 * here. An OpenAI-compatible deployment uses the single configured `model` for every task.
 *
 * Structured output prefers `response_format: { type: "json_schema", strict: true }`.
 * Providers that only support JSON mode receive the schema as prompt text plus
 * `response_format: { type: "json_object" }`; weaker compatible servers can use prompt-only
 * JSON. The callers (`decompose`/`clarify`) are total + zod/validate-guarded, so a weak model
 * yields an invalid plan that is reported as `{ ok:false }`, never a crash.
 */
import type {
  LlmGateway,
  LlmRequest,
  LlmResponse,
  LlmUsage,
  UsageMeter,
} from "./index";
import type { MaxTokensParam, StructuredOutputMode } from "./providers";

// The llm package tsconfig sets `types: []` (mirroring @core purity), so neither
// @types/node nor the DOM lib is pulled in. Declare the one global we use — `fetch` —
// narrowly, the same way `anthropic-gateway.ts` declares `process`. The platform's real
// `fetch` (Node 18+/Electron/Bun/Deno) structurally satisfies this narrow signature.
declare const fetch: OpenAiFetchPort;
declare const setTimeout: (handler: () => void, timeoutMs: number) => unknown;
declare const clearTimeout: (handle: unknown) => void;

/** Minimal response surface we read from a fetch call. */
export interface OpenAiFetchResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

/**
 * Minimal port over `fetch` — declared explicitly so the gateway is testable without a
 * network and so the dependency footprint stays auditable (mirrors `AnthropicClientPort`).
 */
export type OpenAiFetchPort = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<OpenAiFetchResponse>;

/** Options for constructing an {@link OpenAiCompatibleLlmGateway}. */
export interface OpenAiGatewayOptions {
  /** Reports usage on every call. */
  meter: UsageMeter;
  /** Owner attributed for metering (quota is per-user). */
  ownerId: string;
  /** Bearer token for the endpoint (BYO-key). */
  apiKey: string;
  /** The single model used for every task. Required — there is no routing here. */
  model: string;
  /** API root, no trailing slash. Defaults to OpenAI's. Set this for OpenRouter/local/etc. */
  baseURL?: string;
  /** Injection point for tests; defaults to the platform `fetch`. */
  client?: OpenAiFetchPort;
  /** Max output tokens per request. Defaults to a value comfortably above a full plan. */
  maxTokens?: number;
  /** Transport timeout. Defaults to 60s so UI callers never wait forever. */
  requestTimeoutMs?: number;
  /**
   * Which request field carries the token cap. Defaults to `max_completion_tokens` (the
   * current canonical field). Set to `max_tokens` only for legacy self-hosted servers that
   * reject the new name.
   */
  maxTokensParam?: MaxTokensParam;
  /**
   * Structured-output request shape. OpenAI/OpenRouter support `json_schema`; providers such
   * as DeepSeek/Z.ai document `json_object`; compatible servers without either can use
   * `prompt`, which embeds the schema in the prompt and omits `response_format`.
   */
  structuredOutputMode?: StructuredOutputMode;
  /** Provider-specific request body defaults, e.g. DeepSeek thinking mode. */
  requestBodyDefaults?: Record<string, unknown>;
}

interface ChatCompletionResponse {
  choices?: Array<{
    finish_reason?: string | null;
    message?: { content?: string | null; refusal?: string | null };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
// `max_completion_tokens` is the current canonical field — OpenAI's reasoning models
// (o-series, gpt-5.x) REJECT the legacy `max_tokens` with an HTTP 400, and OpenAI (all
// tiers) + OpenRouter accept `max_completion_tokens`. Older self-hosted OpenAI-compatible
// servers that only know `max_tokens` can opt back via `maxTokensParam`.
const DEFAULT_MAX_TOKENS_PARAM: MaxTokensParam = "max_completion_tokens";
const DEFAULT_STRUCTURED_OUTPUT_MODE: StructuredOutputMode = "json_schema";
/** Schema name handed to `json_schema` — providers require a `^[A-Za-z0-9_-]+$` identifier. */
const SCHEMA_NAME = "aimcub_structured_output";

function isDeepSeekBaseUrl(baseURL: string): boolean {
  try {
    return new URL(baseURL).hostname === "api.deepseek.com";
  } catch {
    return baseURL.includes("api.deepseek.com");
  }
}

function hostnameOrRaw(baseURL: string): string {
  try {
    return new URL(baseURL).hostname;
  } catch {
    return baseURL;
  }
}

function inferCompatibleDefaults(baseURL: string): { maxTokensParam?: MaxTokensParam; structuredOutputMode?: StructuredOutputMode } {
  const host = hostnameOrRaw(baseURL);
  if (host.includes("api.deepseek.com")) return { maxTokensParam: "max_tokens", structuredOutputMode: "json_object" };
  if (host.includes("api.z.ai")) return { maxTokensParam: "max_tokens", structuredOutputMode: "json_object" };
  if (host.includes("api.minimax.io") || host.includes("api.minimaxi.com")) return { maxTokensParam: "max_tokens", structuredOutputMode: "prompt" };
  if (host.includes("dashscope") || host.includes("maas.aliyuncs.com")) return { maxTokensParam: "max_tokens", structuredOutputMode: "prompt" };
  if (host.includes("generativelanguage.googleapis.com")) return { maxTokensParam: "max_tokens", structuredOutputMode: "prompt" };
  return {};
}

function inferRequestBodyDefaults(baseURL: string): Record<string, unknown> | undefined {
  const host = hostnameOrRaw(baseURL);
  if (host.includes("api.deepseek.com")) return { thinking: { type: "disabled" } };
  return undefined;
}

function appendSchemaInstruction(prompt: string, schema: unknown): string {
  return [
    prompt,
    "",
    "Structured output contract:",
    "Return only valid JSON. Do not wrap the JSON in Markdown or add explanatory text.",
    "The JSON must satisfy this JSON Schema:",
    JSON.stringify(schema),
  ].join("\n");
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: unknown;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

export class OpenAiCompatibleLlmGateway implements LlmGateway {
  private readonly meter: UsageMeter;
  private readonly ownerId: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseURL: string;
  private readonly maxTokens: number;
  private readonly maxTokensParam: MaxTokensParam;
  private readonly structuredOutputMode: StructuredOutputMode;
  private readonly requestBodyDefaults?: Record<string, unknown>;
  private readonly requestTimeoutMs: number;
  private readonly fetchImpl: OpenAiFetchPort;

  constructor(opts: OpenAiGatewayOptions) {
    this.meter = opts.meter;
    this.ownerId = opts.ownerId;
    this.apiKey = opts.apiKey;
    this.model = opts.model;
    this.baseURL = (opts.baseURL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    const inferred = inferCompatibleDefaults(this.baseURL);
    this.maxTokensParam =
      opts.maxTokensParam ?? inferred.maxTokensParam ?? (isDeepSeekBaseUrl(this.baseURL) ? "max_tokens" : DEFAULT_MAX_TOKENS_PARAM);
    this.structuredOutputMode =
      opts.structuredOutputMode ??
      inferred.structuredOutputMode ??
      (isDeepSeekBaseUrl(this.baseURL) ? "json_object" : DEFAULT_STRUCTURED_OUTPUT_MODE);
    this.requestBodyDefaults = opts.requestBodyDefaults ?? inferRequestBodyDefaults(this.baseURL);
    this.fetchImpl = opts.client ?? fetch;
  }

  /** Plain-text completion. */
  async complete(req: LlmRequest): Promise<LlmResponse<string>> {
    const { text, usage } = await this.invoke(req, false);
    return { output: text, usage };
  }

  /**
   * Structured completion. The model is constrained by `req.schema` via
   * `response_format: json_schema (strict)`; the returned content is parsed as JSON.
   * Parsing/validation against the domain schema is the caller's job (see `decompose`).
   */
  async completeStructured<T>(req: LlmRequest & { schema: unknown }): Promise<LlmResponse<T>> {
    const { text, usage } = await this.invoke(req, true);
    let parsed: T;
    try {
      parsed = JSON.parse(text) as T;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`structured output was not valid JSON: ${message}`, { cause: err });
    }
    return { output: parsed, usage };
  }

  /** Shared request path: POST chat/completions, normalize usage, meter it. */
  private async invoke(
    req: LlmRequest,
    structured: boolean,
  ): Promise<{ text: string; usage: LlmUsage }> {
    // routeModel/req.model are Anthropic-only — an OpenAI-compatible deployment always
    // uses its single configured model.
    const messages: Array<{ role: "system" | "user"; content: string }> = [];
    if (req.system) messages.push({ role: "system", content: req.system });
    const prompt =
      structured && req.schema !== undefined && this.structuredOutputMode !== "json_schema"
        ? appendSchemaInstruction(req.prompt, req.schema)
        : req.prompt;
    messages.push({ role: "user", content: prompt });

    const body: Record<string, unknown> = {
      ...(this.requestBodyDefaults ?? {}),
      model: this.model,
      [this.maxTokensParam]: this.maxTokens,
      messages,
    };
    if (structured && req.schema !== undefined) {
      if (this.structuredOutputMode === "json_object") {
        body.response_format = { type: "json_object" };
      } else if (this.structuredOutputMode === "json_schema") {
        body.response_format = {
          type: "json_schema",
          json_schema: { name: SCHEMA_NAME, schema: req.schema, strict: true },
        };
      }
    }

    const response = await withTimeout(
      this.fetchImpl(`${this.baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      }),
      this.requestTimeoutMs,
    );

    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`openai-compatible request failed: ${response.status} ${raw}`.trim());
    }

    let data: ChatCompletionResponse;
    try {
      data = JSON.parse(raw) as ChatCompletionResponse;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`openai-compatible response was not valid JSON: ${message}`, { cause: err });
    }

    // A strict-mode safety refusal arrives as `message.refusal` with null content. Surface
    // it as a real error rather than letting empty content become a confusing JSON-parse fail.
    const choice = data.choices?.[0];
    if (choice?.finish_reason === "length") {
      throw new Error("structured output was truncated by the provider (finish_reason=length); try again with a shorter aim or a larger output budget");
    }
    const message = choice?.message;
    if (message?.refusal) {
      throw new Error(`model refused: ${message.refusal}`);
    }
    const text = message?.content ?? "";
    const usage: LlmUsage = {
      model: this.model,
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
    };

    await this.meter.record(this.ownerId, req.task, usage);
    return { text, usage };
  }
}
