/**
 * `AnthropicLlmGateway` — the concrete `LlmGateway` backed by the official Anthropic SDK.
 *
 * Billing decision (locked in v0): always call the Anthropic API directly with an API key,
 * so usage is meterable / cacheable / batchable. The key is read from
 * `process.env.ANTHROPIC_API_KEY` lazily (only when a request is made) so importing this
 * module — or running the test suite with a mock gateway — never requires a key.
 *
 * Model selection goes through `routeModel(task)`; callers may override per request.
 * Every call reports `LlmUsage` to an injected `UsageMeter` (for quota / circuit-breaker).
 */
import Anthropic from "@anthropic-ai/sdk";

// Narrow ambient for the one Node global we use. The package tsconfig sets `types: []`
// (mirroring @core purity), so @types/node is not pulled in — we declare just `process.env`
// rather than widening the type surface for the whole package.
declare const process: { env: Record<string, string | undefined> };
declare const setTimeout: (handler: () => void, timeoutMs: number) => unknown;
declare const clearTimeout: (handle: unknown) => void;

import {
  routeModel,
  type LlmGateway,
  type LlmRequest,
  type LlmResponse,
  type LlmUsage,
  type UsageMeter,
} from "./index";

/** Options for constructing an {@link AnthropicLlmGateway}. */
export interface AnthropicGatewayOptions {
  /** Reports usage on every call. */
  meter: UsageMeter;
  /** Owner attributed for metering (quota is per-user). */
  ownerId: string;
  /**
   * Pre-constructed SDK client. Optional — mainly an injection point for tests.
   * In production this is omitted and a client is created from `apiKey` (or the env key).
   */
  client?: AnthropicClientPort;
  /**
   * Explicit API key (BYO-key). When provided, the client is built from it instead of
   * reading `process.env.ANTHROPIC_API_KEY` — used by the desktop app, which stores the
   * key itself rather than mutating the process env.
   */
  apiKey?: string;
  /** Max output tokens per request. Defaults to a value comfortably above a full plan. */
  maxTokens?: number;
  /** Transport timeout. Defaults to 60s so UI callers never wait forever. */
  requestTimeoutMs?: number;
  /** Optional fixed model selected by a UI/config; omitted keeps task-based routing. */
  model?: string;
}

/**
 * Minimal port over the Anthropic SDK surface we depend on. Declared explicitly so the
 * gateway is testable without the real SDK and so the dependency footprint is auditable.
 * The real `Anthropic` client structurally satisfies this.
 */
export interface AnthropicClientPort {
  messages: {
    create(body: AnthropicCreateBody): Promise<AnthropicMessageResponse>;
  };
}

interface AnthropicCreateBody {
  model: string;
  max_tokens: number;
  system?: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  output_config?: {
    format?: { type: "json_schema"; schema: Record<string, unknown> };
  };
}

interface AnthropicMessageResponse {
  content: Array<{ type: string; text?: string }>;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  };
}

const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

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

/**
 * Resolve the API key: an explicit `opts.apiKey` (BYO-key) wins over the env var. Pure +
 * exported so the precedence and the no-key error are unit-testable without the SDK.
 */
export function resolveAnthropicApiKey(explicit: string | undefined, env: string | undefined): string {
  const apiKey = explicit ?? env;
  if (!apiKey) {
    throw new Error("no Anthropic API key (opts.apiKey or ANTHROPIC_API_KEY); cannot construct AnthropicLlmGateway client");
  }
  return apiKey;
}

export class AnthropicLlmGateway implements LlmGateway {
  private readonly meter: UsageMeter;
  private readonly ownerId: string;
  private readonly maxTokens: number;
  private readonly requestTimeoutMs: number;
  private readonly model?: string;
  private readonly injectedClient?: AnthropicClientPort;
  private readonly apiKey?: string;
  private cachedClient?: AnthropicClientPort;

  constructor(opts: AnthropicGatewayOptions) {
    this.meter = opts.meter;
    this.ownerId = opts.ownerId;
    this.maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.model = opts.model;
    this.injectedClient = opts.client;
    this.apiKey = opts.apiKey;
  }

  /** Plain-text completion. */
  async complete(req: LlmRequest): Promise<LlmResponse<string>> {
    const { text, usage } = await this.invoke(req);
    return { output: text, usage };
  }

  /**
   * Structured completion. The model is constrained by `req.schema` via
   * `output_config.format`; the returned text is parsed as JSON. Parsing/validation of
   * the JSON against the domain schema is the caller's job (see `decompose`).
   */
  async completeStructured<T>(req: LlmRequest & { schema: unknown }): Promise<LlmResponse<T>> {
    const { text, usage } = await this.invoke(req);
    let parsed: T;
    try {
      parsed = JSON.parse(text) as T;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`structured output was not valid JSON: ${message}`);
    }
    return { output: parsed, usage };
  }

  /** Shared request path: route the model, call the SDK, normalize usage, meter it. */
  private async invoke(req: LlmRequest): Promise<{ text: string; usage: LlmUsage }> {
    const model = req.model ?? this.model ?? routeModel(req.task);
    const client = this.getClient();

    const body: AnthropicCreateBody = {
      model,
      max_tokens: this.maxTokens,
      messages: [{ role: "user", content: req.prompt }],
    };
    if (req.system) body.system = req.system;
    if (req.schema !== undefined) {
      body.output_config = {
        format: { type: "json_schema", schema: req.schema as Record<string, unknown> },
      };
    }

    // TODO(v1a-live): this is the only real network call. Add retry / circuit-breaker /
    // prompt-caching breakpoints here once we are exercising it against the live API.
    const response = await withTimeout(client.messages.create(body), this.requestTimeoutMs);

    const text = extractText(response);
    const usage: LlmUsage = {
      model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? undefined,
      cacheWriteTokens: response.usage.cache_creation_input_tokens ?? undefined,
    };

    await this.meter.record(this.ownerId, req.task, usage);
    return { text, usage };
  }

  /** Lazily construct (and cache) the SDK client from the env API key. */
  private getClient(): AnthropicClientPort {
    if (this.injectedClient) return this.injectedClient;
    if (this.cachedClient) return this.cachedClient;

    // TODO(v1a-live): read the key from a secrets manager rather than the raw env in prod.
    const apiKey = resolveAnthropicApiKey(this.apiKey, process.env.ANTHROPIC_API_KEY);
    // The real SDK client structurally satisfies AnthropicClientPort.
    this.cachedClient = new Anthropic({ apiKey }) as unknown as AnthropicClientPort;
    return this.cachedClient;
  }
}

/** Concatenate the `text` blocks of an Anthropic message response. */
function extractText(response: AnthropicMessageResponse): string {
  return response.content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text ?? "")
    .join("");
}
