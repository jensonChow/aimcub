import type {
  AimcubToolFailure,
  AimcubToolHandler,
  AimcubToolHandlerContext,
  AimcubToolPermissionKind,
  AimcubToolResult,
  AimcubToolSource,
  WebFetchInput,
  WebFetchOutput,
  WebSearchInput,
  WebSearchOutput,
} from "./tool-contract";

// The llm package intentionally does not pull DOM or Node ambient types. Declare the
// narrow globals we can use in Electron/Node 18+ runtimes while keeping tests injectable.
declare const fetch: WebResearchFetchPort | undefined;
declare const process: { env?: Record<string, string | undefined> } | undefined;
declare const setTimeout: (handler: () => void, timeoutMs: number) => unknown;
declare const clearTimeout: (handle: unknown) => void;

export interface WebResearchFetchResponse {
  ok: boolean;
  status: number;
  url?: string;
  headers?: { get(name: string): string | null };
  text(): Promise<string>;
}

export type WebResearchFetchPort = (
  url: string,
  init?: { method?: string; headers?: Record<string, string> },
) => Promise<WebResearchFetchResponse>;

export interface WebSearchClient {
  search(input: WebSearchInput): Promise<WebSearchOutput>;
}

export interface WebResearchRuntime {
  search: AimcubToolHandler<WebSearchInput, WebSearchOutput>;
  fetch: AimcubToolHandler<WebFetchInput, WebFetchOutput>;
  handlers: {
    "web.search": AimcubToolHandler<WebSearchInput, WebSearchOutput>;
    "web.fetch": AimcubToolHandler<WebFetchInput, WebFetchOutput>;
  };
}

export interface WebResearchRuntimeOptions {
  fetchImpl?: WebResearchFetchPort;
  searchClient?: WebSearchClient | null;
  braveApiKey?: string;
  braveEndpoint?: string;
  userAgent?: string;
  requestTimeoutMs?: number;
  fetchMaxBytes?: number;
  allowPrivateHosts?: boolean;
  now?: () => Date;
}

export interface BraveWebSearchClientOptions {
  apiKey: string;
  fetchImpl?: WebResearchFetchPort;
  endpoint?: string;
  userAgent?: string;
  requestTimeoutMs?: number;
}

interface BraveSearchResponse {
  web?: {
    results?: Array<{
      title?: string;
      url?: string;
      description?: string;
      age?: string;
      profile?: { name?: string };
    }>;
  };
}

const DEFAULT_SEARCH_LIMIT = 5;
const HARD_SEARCH_LIMIT = 10;
const DEFAULT_FETCH_MAX_BYTES = 200_000;
const HARD_FETCH_MAX_BYTES = 2_000_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_USER_AGENT = "Aimcub/0.1 (+https://aimcub.local)";
const DEFAULT_BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const MAX_QUERY_LENGTH = 500;
const MAX_LINKS = 50;

function fail<T>(
  code: AimcubToolFailure["code"],
  message: string,
  retryable = false,
  details?: Record<string, unknown>,
): AimcubToolResult<T> {
  return { ok: false, error: { code, message, retryable, details } };
}

function hasPermission(context: AimcubToolHandlerContext, permission: AimcubToolPermissionKind): boolean {
  return context.permissions.includes(permission);
}

function nowIso(context: AimcubToolHandlerContext, fallbackNow: () => Date): string {
  try {
    return context.now().toISOString();
  } catch {
    return fallbackNow().toISOString();
  }
}

function normalizeLimit(limit: number | undefined, fallback: number, max: number): number {
  if (limit === undefined) return fallback;
  if (!Number.isInteger(limit) || limit < 1) return fallback;
  return Math.min(limit, max);
}

function normalizeMaxBytes(maxBytes: number | undefined, configuredMaxBytes: number): number {
  const cappedConfig = Math.min(Math.max(configuredMaxBytes, 1), HARD_FETCH_MAX_BYTES);
  if (maxBytes === undefined) return cappedConfig;
  if (!Number.isInteger(maxBytes) || maxBytes < 1) return cappedConfig;
  return Math.min(maxBytes, HARD_FETCH_MAX_BYTES);
}

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^\*\./, "");
}

function hostnameMatchesDomain(hostname: string, domain: string): boolean {
  const normalizedHost = hostname.toLowerCase();
  const normalizedDomain = normalizeDomain(domain);
  return normalizedHost === normalizedDomain || normalizedHost.endsWith(`.${normalizedDomain}`);
}

function filterSearchResultsByDomains(output: WebSearchOutput, domains?: string[]): WebSearchOutput {
  const normalizedDomains = (domains ?? []).map(normalizeDomain).filter(Boolean);
  if (normalizedDomains.length === 0) return output;

  return {
    results: output.results.filter((result) => {
      try {
        const hostname = new URL(result.url).hostname;
        return normalizedDomains.some((domain) => hostnameMatchesDomain(hostname, domain));
      } catch {
        return false;
      }
    }),
  };
}

function sourcesFromSearch(output: WebSearchOutput, observedAt: string): AimcubToolSource[] {
  return output.results.map((result) => ({
    kind: "web",
    title: result.title,
    url: result.url,
    uri: result.url,
    observedAt,
  }));
}

function sourceFromFetch(output: WebFetchOutput, observedAt: string): AimcubToolSource[] {
  return [{
    kind: "web",
    title: output.title,
    url: output.finalUrl,
    uri: output.finalUrl,
    observedAt,
  }];
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

function recencyToBraveFreshness(recencyDays?: number): string | undefined {
  if (recencyDays === undefined || !Number.isInteger(recencyDays) || recencyDays < 1) return undefined;
  if (recencyDays <= 1) return "pd";
  if (recencyDays <= 7) return "pw";
  if (recencyDays <= 31) return "pm";
  if (recencyDays <= 365) return "py";
  return undefined;
}

function safeSnippet(value: string | undefined): string {
  return stripHtml(value ?? "").slice(0, 1_000);
}

function isHttpUrl(url: URL): boolean {
  return url.protocol === "http:" || url.protocol === "https:";
}

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (host === "localhost" || host === "0.0.0.0" || host === "::1") return true;
  if (host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (host.startsWith("127.")) return true;
  if (host.startsWith("10.")) return true;
  if (host.startsWith("192.168.")) return true;
  if (host.startsWith("169.254.")) return true;

  const match = /^172\.(\d{1,3})\./.exec(host);
  if (!match) return false;
  const secondOctet = Number(match[1]);
  return secondOctet >= 16 && secondOctet <= 31;
}

function contentType(response: WebResearchFetchResponse): string {
  return response.headers?.get("content-type")?.toLowerCase() ?? "";
}

function contentLength(response: WebResearchFetchResponse): number | undefined {
  const raw = response.headers?.get("content-length");
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function looksLikeHtml(type: string, text: string): boolean {
  return type.includes("text/html") || /<html[\s>]/i.test(text) || /<!doctype html/i.test(text);
}

function looksLikeText(type: string): boolean {
  return (
    type === "" ||
    type.startsWith("text/") ||
    type.includes("application/json") ||
    type.includes("application/xml") ||
    type.includes("application/xhtml+xml") ||
    type.includes("+json") ||
    type.includes("+xml")
  );
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: "\"",
    apos: "'",
    nbsp: " ",
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith("#x")) {
      const code = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    if (lower.startsWith("#")) {
      const code = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return named[lower] ?? match;
  });
}

function extractTitle(html: string): string | undefined {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = decodeHtmlEntities(stripHtml(match?.[1] ?? "")).trim();
  return title || undefined;
}

function stripHtml(value: string): string {
  return decodeHtmlEntities(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|section|article|li|h[1-6]|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t\r\f\v]+/g, " ")
      .replace(/\n\s+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
}

function extractLinks(html: string, baseUrl: string): Array<{ text: string; url: string }> {
  const links: Array<{ text: string; url: string }> = [];
  const seen = new Set<string>();
  const pattern = /<a\b[^>]*\bhref=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) && links.length < MAX_LINKS) {
    const rawHref = decodeHtmlEntities(match[2] ?? "").trim();
    if (!rawHref || rawHref.startsWith("#") || rawHref.startsWith("mailto:") || rawHref.startsWith("javascript:")) continue;
    try {
      const url = new URL(rawHref, baseUrl);
      if (!isHttpUrl(url) || seen.has(url.href)) continue;
      const text = stripHtml(match[3] ?? "").slice(0, 200);
      seen.add(url.href);
      links.push({ text, url: url.href });
    } catch {
      // Ignore malformed hrefs; a fetch observation should not fail because of one link.
    }
  }
  return links;
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code <= 0xffff) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}

function truncateText(text: string, maxBytes: number): { text: string; truncated: boolean } {
  if (utf8ByteLength(text) <= maxBytes) return { text, truncated: false };

  let bytes = 0;
  let output = "";
  for (const char of text) {
    const charBytes = utf8ByteLength(char);
    if (bytes + charBytes > maxBytes) break;
    bytes += charBytes;
    output += char;
  }
  return { text: output, truncated: true };
}

export class BraveWebSearchClient implements WebSearchClient {
  private readonly apiKey: string;
  private readonly fetchImpl?: WebResearchFetchPort;
  private readonly endpoint: string;
  private readonly userAgent: string;
  private readonly requestTimeoutMs: number;

  constructor(options: BraveWebSearchClientOptions) {
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.endpoint = options.endpoint ?? DEFAULT_BRAVE_ENDPOINT;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  async search(input: WebSearchInput): Promise<WebSearchOutput> {
    if (!this.fetchImpl) {
      throw new Error("No fetch implementation is available for Brave web search.");
    }

    const query = input.query.trim();
    const limit = normalizeLimit(input.limit, DEFAULT_SEARCH_LIMIT, HARD_SEARCH_LIMIT);
    const url = new URL(this.endpoint);
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(limit));
    const freshness = recencyToBraveFreshness(input.recencyDays);
    if (freshness) url.searchParams.set("freshness", freshness);

    const response = await withTimeout(
      this.fetchImpl(url.href, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": this.userAgent,
          "X-Subscription-Token": this.apiKey,
        },
      }),
      this.requestTimeoutMs,
    );

    const body = await response.text();
    if (!response.ok) {
      throw new Error(`Brave search failed with HTTP ${response.status}: ${body.slice(0, 500)}`);
    }

    let parsed: BraveSearchResponse;
    try {
      parsed = JSON.parse(body) as BraveSearchResponse;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Brave search response was not valid JSON: ${message}`, { cause: err });
    }

    const results = (parsed.web?.results ?? [])
      .filter((result) => result.url && result.title)
      .slice(0, limit)
      .map((result) => ({
        title: result.title ?? "",
        url: result.url ?? "",
        snippet: safeSnippet(result.description),
        source: result.profile?.name,
        publishedAt: result.age,
      }));

    return filterSearchResultsByDomains({ results }, input.domains);
  }
}

export function createWebResearchRuntime(options: WebResearchRuntimeOptions = {}): WebResearchRuntime {
  const fetchImpl = options.fetchImpl ?? fetch;
  const searchClient = options.searchClient ?? (
    options.braveApiKey
      ? new BraveWebSearchClient({
        apiKey: options.braveApiKey,
        fetchImpl,
        endpoint: options.braveEndpoint,
        userAgent: options.userAgent,
        requestTimeoutMs: options.requestTimeoutMs,
      })
      : null
  );
  const fallbackNow = options.now ?? (() => new Date());
  const fetchMaxBytes = options.fetchMaxBytes ?? DEFAULT_FETCH_MAX_BYTES;
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  const allowPrivateHosts = options.allowPrivateHosts ?? false;

  const searchHandler: AimcubToolHandler<WebSearchInput, WebSearchOutput> = async (input, context) => {
    if (!hasPermission(context, "network.search")) {
      return fail("permission_denied", "web.search requires the network.search permission.");
    }
    if (!searchClient) {
      return fail("disabled", "No web search provider is configured for Aimcub.");
    }

    const rawInput = input as Partial<WebSearchInput> | null | undefined;
    if (!rawInput || typeof rawInput.query !== "string") {
      return fail("invalid_input", "web.search requires a query string.");
    }
    const query = rawInput.query.trim();
    if (!query) return fail("invalid_input", "web.search requires a non-empty query.");
    if (query.length > MAX_QUERY_LENGTH) {
      return fail("invalid_input", `web.search query exceeds ${MAX_QUERY_LENGTH} characters.`);
    }

    try {
      const limitedInput: WebSearchInput = {
        ...input,
        query,
        limit: normalizeLimit(input.limit, DEFAULT_SEARCH_LIMIT, HARD_SEARCH_LIMIT),
      };
      const output = filterSearchResultsByDomains(
        await withTimeout(searchClient.search(limitedInput), requestTimeoutMs),
        limitedInput.domains,
      );
      const observedAt = nowIso(context, fallbackNow);
      return {
        ok: true,
        observation: {
          summary: output.results.length === 1 ? "Found 1 web result." : `Found ${output.results.length} web results.`,
          data: output,
          sources: sourcesFromSearch(output, observedAt),
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isTimeout = /timed out/i.test(message);
      return fail(isTimeout ? "timeout" : "provider_error", message, true);
    }
  };

  const fetchHandler: AimcubToolHandler<WebFetchInput, WebFetchOutput> = async (input, context) => {
    if (!hasPermission(context, "network.fetch")) {
      return fail("permission_denied", "web.fetch requires the network.fetch permission.");
    }
    if (!fetchImpl) {
      return fail("disabled", "No fetch implementation is available for Aimcub web.fetch.");
    }

    const rawInput = input as Partial<WebFetchInput> | null | undefined;
    if (!rawInput || typeof rawInput.url !== "string") {
      return fail("invalid_input", "web.fetch requires a URL string.");
    }

    let url: URL;
    try {
      url = new URL(rawInput.url);
    } catch {
      return fail("invalid_input", "web.fetch requires a valid absolute URL.");
    }

    if (!isHttpUrl(url)) {
      return fail("invalid_input", "web.fetch only supports http and https URLs.");
    }
    if (!allowPrivateHosts && isPrivateHostname(url.hostname)) {
      return fail("permission_denied", "web.fetch refuses localhost and private-network URLs by default.", false, {
        hostname: url.hostname,
      });
    }

    const maxBytes = normalizeMaxBytes(input.maxBytes, fetchMaxBytes);
    const extractMode = input.extractMode ?? "text";
    if (!["text", "metadata", "text_with_links"].includes(extractMode)) {
      return fail("invalid_input", "web.fetch extractMode must be text, metadata, or text_with_links.");
    }

    try {
      const response = await withTimeout(
        fetchImpl(url.href, {
          method: "GET",
          headers: {
            Accept: "text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.1",
            "User-Agent": userAgent,
          },
        }),
        requestTimeoutMs,
      );

      const declaredLength = contentLength(response);
      if (declaredLength !== undefined && declaredLength > maxBytes) {
        return fail("bounds_exceeded", `web.fetch response declares ${declaredLength} bytes, above the ${maxBytes} byte limit.`, false, {
          contentLength: declaredLength,
          maxBytes,
        });
      }

      if (!response.ok) {
        return fail("provider_error", `web.fetch received HTTP ${response.status}.`, response.status >= 500, {
          status: response.status,
        });
      }

      const rawText = await response.text();
      const type = contentType(response);
      if (!looksLikeText(type)) {
        return fail("unsupported_content_type", `web.fetch cannot extract content type ${type || "unknown"}.`, false, {
          contentType: type,
        });
      }

      const finalUrl = response.url ?? url.href;
      const isHtml = looksLikeHtml(type, rawText);
      const title = isHtml ? extractTitle(rawText) : undefined;
      const extractedText = isHtml ? stripHtml(rawText) : rawText.trim();
      const truncated = truncateText(extractedText, maxBytes);
      const output: WebFetchOutput = {
        finalUrl,
        status: response.status,
        title,
        truncated: truncated.truncated,
      };

      if (extractMode !== "metadata") {
        output.text = truncated.text;
      }
      if (extractMode === "text_with_links" && isHtml) {
        output.links = extractLinks(rawText, finalUrl);
      }

      const observedAt = nowIso(context, fallbackNow);
      const warnings: string[] = [];
      if (truncated.truncated) warnings.push(`Content truncated to ${maxBytes} bytes.`);
      return {
        ok: true,
        observation: {
          summary: `Fetched ${finalUrl} (${response.status}).`,
          data: output,
          sources: sourceFromFetch(output, observedAt),
          ...(warnings.length > 0 ? { warnings } : {}),
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isTimeout = /timed out/i.test(message);
      return fail(isTimeout ? "timeout" : "provider_error", message, true);
    }
  };

  return {
    search: searchHandler,
    fetch: fetchHandler,
    handlers: {
      "web.search": searchHandler,
      "web.fetch": fetchHandler,
    },
  };
}

export function createWebResearchRuntimeFromEnv(
  env: Record<string, string | undefined> = typeof process === "undefined" ? {} : process.env ?? {},
  options: Omit<WebResearchRuntimeOptions, "braveApiKey"> = {},
): WebResearchRuntime {
  return createWebResearchRuntime({
    ...options,
    braveApiKey: env.AIMCUB_BRAVE_SEARCH_API_KEY ?? env.BRAVE_SEARCH_API_KEY,
  });
}
