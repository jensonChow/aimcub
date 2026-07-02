/**
 * `aimcub setup` interactive wizard — the I/O half (the pure validation lives in
 * `buildSettingsFromInput`, config.ts). Prompts for provider (validated + re-prompted), then
 * the model/base-URL the chosen provider needs, then the API key with echo SUPPRESSED, and
 * hands a {@link SetupInput} back to the caller to persist. Reached only on a TTY; the
 * non-interactive path uses flags.
 *
 * The key prompt is read last, via a raw-mode keystroke reader (NOT readline) so nothing is
 * echoed — `node:readline/promises` has no overridable echo hook, so the visible prompts use
 * readline and the secret is read separately after the readline interface is closed.
 */
import { createInterface } from "node:readline/promises";
import { stdin as procStdin, stdout as procStdout } from "node:process";

import type { ProviderSettings } from "@core/store";
import { getDefaultBaseURL, getDefaultModel, getLlmProviderDefinition } from "@core/llm/providers";

import { normalizeProvider, type ProviderName, type SetupInput } from "./config";

interface HiddenIO {
  input: NodeJS.ReadStream;
  output: NodeJS.WritableStream;
}

// Control codes (numeric, to avoid embedding raw control bytes in source).
const ETX = 3; // Ctrl-C
const EOT = 4; // Ctrl-D
const BS = 8; // backspace
const LF = 10;
const CR = 13;
const DEL = 127;

/**
 * Read a single line with the echo suppressed (for secrets). Reads keystrokes in raw mode and
 * writes nothing back, so the typed characters never reach the terminal / scrollback. Streams
 * are injectable for testing. Backspace edits the buffer; Ctrl-C/Ctrl-D end the read.
 */
export function promptHidden(
  query: string,
  io: HiddenIO = { input: procStdin, output: procStdout },
): Promise<string> {
  const { input, output } = io;
  return new Promise((resolve, reject) => {
    output.write(query);
    const canRaw = Boolean(input.isTTY) && typeof input.setRawMode === "function";
    const wasRaw = input.isRaw === true;
    if (canRaw) input.setRawMode(true);
    input.resume();

    let buf = "";
    const finish = (done: () => void): void => {
      input.removeListener("data", onData);
      if (canRaw) input.setRawMode(wasRaw);
      input.pause();
      output.write("\n");
      done();
    };
    const onData = (chunk: Buffer | string): void => {
      const s = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      for (const ch of s) {
        const code = ch.charCodeAt(0);
        if (code === CR || code === LF || code === EOT) return finish(() => resolve(buf)); // Enter / Ctrl-D
        if (code === ETX) return finish(() => reject(new Error("aborted"))); // Ctrl-C
        if (code === DEL || code === BS) buf = buf.slice(0, -1); // backspace / DEL
        else if (code >= 32) buf += ch; // ignore other control chars
      }
    };
    input.on("data", onData);
  });
}

/** Run the interactive setup wizard, seeded by the current settings (blank = keep). */
export async function promptSetup(current: ProviderSettings | null): Promise<SetupInput> {
  const rl = createInterface({ input: procStdin, output: procStdout });
  let provider: ProviderName;
  let model: string | undefined;
  let baseURL: string | undefined;
  try {
    procStdout.write("aimcub setup — configure your LLM provider (saved to settings.json, shared with the desktop app)\n\n");

    // Provider first, validated + re-prompted, so a typo can't waste the rest of the wizard.
    const defProvider = current?.provider ?? "anthropic";
    for (;;) {
      const raw =
        (await rl.question(`Provider [anthropic | openai | deepseek | minimax | zai | google | qwen | openai-compatible] (${defProvider}): `)).trim() ||
        defProvider;
      const norm = normalizeProvider(raw);
      if (norm) {
        provider = norm;
        break;
      }
      procStdout.write(`  "${raw}" is not a known provider.\n`);
    }

    const providerDef = getLlmProviderDefinition(provider);
    if (providerDef?.protocol === "openai-compatible") {
      const defModel = current?.provider === provider ? current?.model : getDefaultModel(provider);
      model = (await rl.question(`Model${defModel ? ` (${defModel})` : " (required)"}: `)).trim() || undefined;
      const defBase = current?.provider === provider ? current?.baseURL : getDefaultBaseURL(provider);
      baseURL =
        (await rl.question(`Base URL${defBase ? ` (${defBase})` : " (OpenAI-compatible /v1 root)"}: `)).trim() ||
        undefined;
    } else {
      const defModel = current?.provider === "anthropic" ? current?.model : undefined;
      const defaultModel = defModel || getDefaultModel("anthropic");
      model = (await rl.question(`Model (${defaultModel}): `)).trim() || undefined;
    }
  } finally {
    rl.close();
  }

  // Read the key LAST, with readline closed, so the raw-mode (no-echo) read owns stdin alone.
  const hasKey = Boolean(current?.apiKey);
  const apiKey = await promptHidden(hasKey ? "API key (Enter to keep the current one): " : "API key: ");

  return { provider, apiKey, model, baseURL };
}
