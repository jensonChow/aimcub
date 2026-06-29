/**
 * Builds the Anthropic gateway in the Electron MAIN process (Node) — the SDK + API key
 * never reach the renderer. The gateway reads `process.env.ANTHROPIC_API_KEY` lazily, so
 * we seed the env from settings.json on startup and on setKey. A fresh gateway per call
 * is cheap and picks up a newly-set key.
 */
import { AnthropicLlmGateway } from "@core/llm";

import { LOCAL_OWNER } from "./store";

const noopMeter = { async record(): Promise<void> {} };

export function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** Seed the env from a stored key if the shell didn't provide one (packaged-app launch). */
export function applyStoredKey(key: string | null): void {
  if (key && !process.env.ANTHROPIC_API_KEY) {
    process.env.ANTHROPIC_API_KEY = key;
  }
}

export function setApiKey(key: string): void {
  process.env.ANTHROPIC_API_KEY = key;
}

export function buildGateway(): AnthropicLlmGateway {
  return new AnthropicLlmGateway({ meter: noopMeter, ownerId: LOCAL_OWNER });
}
