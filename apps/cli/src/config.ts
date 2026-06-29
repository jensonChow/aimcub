/**
 * Provider/store configuration resolved from the environment — the one place the CLI reads
 * the `AIMCUB_*` env vars. `resolveProvider` is pure (takes an env record) so it is
 * unit-testable and reused by both `buildGatewayFromEnv` (index.ts) and `aim config`.
 * `formatConfig` renders the human view with the API key redacted; the raw key is never
 * printed or returned for display.
 */
export type ProviderName = "anthropic" | "openai-compatible";

export interface ResolvedProvider {
  /** The raw `AIMCUB_PROVIDER` value, kept for display + error messages. */
  providerRaw: string;
  /** Normalized provider, or `null` when `AIMCUB_PROVIDER` is unrecognized. */
  provider: ProviderName | null;
  /** Resolved API key (`""` when none is set). Never rendered directly — redact it. */
  apiKey: string;
  /** Which env var supplied the key (for `aim config`), or `null` when no key is set. */
  keySource: string | null;
  /** Model id, or `null` when unset (anthropic then falls back to a gateway default). */
  model: string | null;
  /** Base URL (openai-compatible only), or `null`. */
  baseURL: string | null;
}

/** Per-provider key env vars, in precedence order (AIMCUB_API_KEY wins). */
const KEY_VARS: Record<ProviderName, readonly string[]> = {
  anthropic: ["AIMCUB_API_KEY", "ANTHROPIC_API_KEY"],
  "openai-compatible": ["AIMCUB_API_KEY", "OPENAI_API_KEY"],
};

/** Resolve provider settings from an env record. Total: never throws (callers validate). */
export function resolveProvider(env: Record<string, string | undefined>): ResolvedProvider {
  const providerRaw = (env.AIMCUB_PROVIDER ?? "anthropic").trim() || "anthropic";
  const provider: ProviderName | null =
    providerRaw === "anthropic"
      ? "anthropic"
      : providerRaw === "openai-compatible" || providerRaw === "openai"
        ? "openai-compatible"
        : null;

  let apiKey = "";
  let keySource: string | null = null;
  for (const v of provider ? KEY_VARS[provider] : []) {
    const val = env[v]?.trim();
    if (val) {
      apiKey = val;
      keySource = v;
      break;
    }
  }

  return {
    providerRaw,
    provider,
    apiKey,
    keySource,
    model: env.AIMCUB_MODEL?.trim() || null,
    baseURL: env.AIMCUB_BASE_URL?.trim() || null,
  };
}

/** Mask an API key for display: `sk-…ab`. Never reveals the middle. */
export function redactKey(key: string): string {
  if (!key) return "(not set)";
  if (key.length <= 6) return "set";
  return `${key.slice(0, 3)}…${key.slice(-2)}`;
}

/** Render the resolved config for `aim config` (key redacted). Pure. */
export function formatConfig(r: ResolvedProvider, dataDir: string, version: string): string {
  const lines = [
    `aim ${version}`,
    `provider:  ${r.providerRaw}${r.provider ? "" : "  (unknown — use anthropic | openai-compatible)"}`,
    `api key:   ${r.keySource ? `${redactKey(r.apiKey)} (from ${r.keySource})` : "(not set)"}`,
  ];
  if (r.provider === "openai-compatible") {
    lines.push(`model:     ${r.model ?? "(not set — required for openai-compatible)"}`);
    lines.push(`base url:  ${r.baseURL ?? "https://api.openai.com/v1 (default)"}`);
  } else {
    lines.push(`model:     ${r.model ?? "(provider default)"}`);
  }
  lines.push(`store:     ${dataDir}`);
  return lines.join("\n");
}
