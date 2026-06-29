/**
 * Provider/store configuration for the CLI. Two layers, env wins:
 *   1. `AIMCUB_*` environment variables  (one-off / CI / scripts)
 *   2. the persisted `settings.json` written by `aimcub setup` (shared with the desktop app)
 * `resolveProvider` is pure (takes an env record + the loaded settings) so it is
 * unit-testable, and records WHERE each value came from for `aimcub config`. The raw API key is
 * never printed or returned for display — `formatConfig` redacts it. `buildSettingsFromInput`
 * is the pure validator behind `aimcub setup` (no I/O).
 */
import type { ProviderSettings } from "@core/store";

export type ProviderName = "anthropic" | "openai-compatible";

/** Where a resolved value came from (for `aimcub config` provenance). */
export type Source = "env" | "settings.json" | "default";

export interface ResolvedProvider {
  /** Provider label to display (the env/settings raw string, or "anthropic"). */
  providerLabel: string;
  /** Normalized provider, or `null` when the label is unrecognized. */
  provider: ProviderName | null;
  providerSource: Source;
  /** Resolved API key (`""` when none). Never rendered directly — redact it. */
  apiKey: string;
  /** Where the key came from (e.g. `env:AIMCUB_API_KEY`, `settings.json`), or null. */
  keySource: string | null;
  model: string | null;
  modelSource: Source | null;
  baseURL: string | null;
  baseURLSource: Source | null;
}

/** Per-provider key env vars, in precedence order (AIMCUB_API_KEY wins). */
const KEY_VARS: Record<ProviderName, readonly string[]> = {
  anthropic: ["AIMCUB_API_KEY", "ANTHROPIC_API_KEY"],
  "openai-compatible": ["AIMCUB_API_KEY", "OPENAI_API_KEY"],
};

/** Normalize a provider string (`openai` is accepted as an alias). */
export function normalizeProvider(raw: string): ProviderName | null {
  const s = raw.trim();
  if (s === "anthropic") return "anthropic";
  if (s === "openai-compatible" || s === "openai") return "openai-compatible";
  return null;
}

/**
 * Resolve provider settings from env + persisted settings, env taking precedence. Total:
 * never throws (callers validate `provider`/`apiKey`).
 */
export function resolveProvider(
  env: Record<string, string | undefined>,
  settings: ProviderSettings | null,
): ResolvedProvider {
  const envProvider = env.AIMCUB_PROVIDER?.trim();
  let providerLabel: string;
  let providerSource: Source;
  if (envProvider) {
    providerLabel = envProvider;
    providerSource = "env";
  } else if (settings?.provider) {
    providerLabel = settings.provider;
    providerSource = "settings.json";
  } else {
    providerLabel = "anthropic";
    providerSource = "default";
  }
  const provider = normalizeProvider(providerLabel);

  // The saved settings only apply when they are FOR the resolved provider. Otherwise (e.g. env
  // forces openai-compatible but settings.json holds an anthropic key) we must NOT fall back to
  // them — that would ship one provider's key/model to another provider's endpoint.
  const settingsMatch = Boolean(settings && settings.provider === provider);

  let apiKey = "";
  let keySource: string | null = null;
  for (const v of provider ? KEY_VARS[provider] : []) {
    const val = env[v]?.trim();
    if (val) {
      apiKey = val;
      keySource = `env:${v}`;
      break;
    }
  }
  if (!apiKey && settingsMatch && settings!.apiKey.trim()) {
    apiKey = settings!.apiKey.trim();
    keySource = "settings.json";
  }

  const envModel = env.AIMCUB_MODEL?.trim();
  const settingsModel = settingsMatch ? settings!.model?.trim() : undefined;
  const model = envModel || settingsModel || null;
  const modelSource: Source | null = envModel ? "env" : settingsModel ? "settings.json" : null;

  const envBaseURL = env.AIMCUB_BASE_URL?.trim();
  const settingsBaseURL = settingsMatch ? settings!.baseURL?.trim() : undefined;
  const baseURL = envBaseURL || settingsBaseURL || null;
  const baseURLSource: Source | null = envBaseURL ? "env" : settingsBaseURL ? "settings.json" : null;

  return { providerLabel, provider, providerSource, apiKey, keySource, model, modelSource, baseURL, baseURLSource };
}

/** Mask an API key for display: `sk-…ab`. Never reveals the middle. */
export function redactKey(key: string): string {
  if (!key) return "(not set)";
  if (key.length <= 6) return "set";
  return `${key.slice(0, 3)}…${key.slice(-2)}`;
}

/** Render the resolved config for `aimcub config` (key redacted, with provenance). Pure. */
export function formatConfig(r: ResolvedProvider, dataDir: string, version: string, settingsFile: string): string {
  const src = (s: Source | string | null): string => (s ? `  (from ${s})` : "");
  const lines = [
    `aimcub ${version}`,
    `provider:  ${r.providerLabel}${r.provider ? src(r.providerSource) : "  (unknown — use anthropic | openai-compatible)"}`,
    `api key:   ${r.keySource ? `${redactKey(r.apiKey)}${src(r.keySource)}` : "(not set)"}`,
  ];
  if (r.provider === "openai-compatible") {
    lines.push(`model:     ${r.model ? `${r.model}${src(r.modelSource)}` : "(not set — required for openai-compatible)"}`);
    lines.push(`base url:  ${r.baseURL ? `${r.baseURL}${src(r.baseURLSource)}` : "https://api.openai.com/v1 (default)"}`);
  } else {
    lines.push(`model:     ${r.model ? `${r.model}${src(r.modelSource)}` : "(provider default)"}`);
  }
  lines.push(`store:     ${dataDir}`);
  lines.push(`config:    ${settingsFile}`);
  if (!r.apiKey) lines.push("\nNo API key yet — run `aimcub setup` to configure a provider.");
  return lines.join("\n");
}

// ──────────────────────────────────────────────────────────────────────────
// aimcub setup — pure validation/merge of the wizard (or flag) input.
// ──────────────────────────────────────────────────────────────────────────

export interface SetupInput {
  provider: string;
  /** Blank ⇒ keep the existing key when the provider is unchanged. */
  apiKey: string;
  model?: string;
  baseURL?: string;
}

export interface BuildSettingsResult {
  settings?: ProviderSettings;
  errors: string[];
}

/**
 * Validate + merge setup input against the current settings into a `ProviderSettings` to save.
 * A blank key (or model/baseURL) keeps the current value when the provider is unchanged — so
 * the user can tweak the model without re-pasting the secret. Pure (no I/O).
 */
export function buildSettingsFromInput(input: SetupInput, current: ProviderSettings | null): BuildSettingsResult {
  const errors: string[] = [];
  const provider = normalizeProvider(input.provider);
  if (!provider) {
    return { errors: [`Unknown provider "${input.provider}". Use "anthropic" or "openai-compatible".`] };
  }
  const sameProvider = current?.provider === provider;

  const apiKey = input.apiKey.trim() || (sameProvider ? current!.apiKey : "");
  if (!apiKey) errors.push("API key is required.");

  const model = input.model?.trim() || (sameProvider ? current?.model : undefined) || undefined;
  // baseURL is only meaningful for openai-compatible; never persist one for anthropic (the
  // Anthropic gateway ignores it, so saving it would be a silent no-op).
  const baseURL =
    provider === "openai-compatible"
      ? input.baseURL?.trim() || (sameProvider ? current?.baseURL : undefined) || undefined
      : undefined;
  if (provider === "openai-compatible" && !model) {
    errors.push("Model is required for the openai-compatible provider (e.g. deepseek/deepseek-chat).");
  }

  if (errors.length > 0) return { errors };
  return { settings: { provider, apiKey, model, baseURL }, errors: [] };
}
