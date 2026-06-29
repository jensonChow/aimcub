/**
 * Aimcub CLI — the headless, scriptable face of `@core` (developers first; "humans are
 * agents too"). First cut is STATELESS: pipe an aim title through the same `@core` brain
 * the desktop app uses and print the plan / clarifying questions. No local store, no
 * daemon, no agent-running — provider config comes from the environment.
 *
 * State-backed commands (aim ls/show/new) come in a later cut, once the store is extracted
 * out of the Electron shell into a shared, platform-neutral adapter.
 */
import { parseArgs } from "node:util";

import {
  decompose,
  clarify,
  AnthropicLlmGateway,
  OpenAiCompatibleLlmGateway,
  type LlmGateway,
} from "@core/llm";

import { formatPlanPretty, formatClarifyPretty } from "./format";

const VERSION = "0.0.0";

/** A user-facing error: printed without a stack trace; exit code 1. */
class UserError extends Error {}

function out(s: string): void {
  process.stdout.write(`${s}\n`);
}
function err(s: string): void {
  process.stderr.write(`${s}\n`);
}

const HELP = `aim — Aimcub CLI (stateless): turn an aim into a verifiable plan.

Usage:
  aim plan "<title>" [--desc "..."] [--json]      Decompose an aim into milestones
  aim clarify "<title>" [--desc "..."] [--json]   Draft + surface clarifying questions
  aim --help | --version

Provider (from environment):
  AIMCUB_PROVIDER   anthropic | openai-compatible   (default: anthropic)
  AIMCUB_API_KEY    API key (falls back to ANTHROPIC_API_KEY / OPENAI_API_KEY)
  AIMCUB_MODEL      model id (required for openai-compatible)
  AIMCUB_BASE_URL   endpoint (openai-compatible only; default https://api.openai.com/v1)

Examples:
  aim plan "Build a CLI todo app with tests + CI"
  AIMCUB_PROVIDER=openai-compatible AIMCUB_BASE_URL=https://openrouter.ai/api/v1 \\
    AIMCUB_MODEL=deepseek/deepseek-chat AIMCUB_API_KEY=sk-... aim plan "ship auth"`;

const noopMeter = { async record(): Promise<void> {} };
const OWNER = "cli-local";

/** Build a gateway from environment variables, or throw a friendly UserError. */
function buildGatewayFromEnv(): LlmGateway {
  const provider = (process.env.AIMCUB_PROVIDER ?? "anthropic").trim();

  if (provider === "openai-compatible" || provider === "openai") {
    const apiKey = (process.env.AIMCUB_API_KEY ?? process.env.OPENAI_API_KEY ?? "").trim();
    const model = (process.env.AIMCUB_MODEL ?? "").trim();
    if (!apiKey) throw new UserError("No API key. Set AIMCUB_API_KEY (or OPENAI_API_KEY) for the openai-compatible provider.");
    if (!model) throw new UserError("No model. Set AIMCUB_MODEL (e.g. deepseek/deepseek-chat) for the openai-compatible provider.");
    const baseURL = process.env.AIMCUB_BASE_URL?.trim() || undefined;
    return new OpenAiCompatibleLlmGateway({ meter: noopMeter, ownerId: OWNER, apiKey, model, baseURL });
  }

  if (provider === "anthropic") {
    const apiKey = (process.env.AIMCUB_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? "").trim();
    if (!apiKey) throw new UserError("No API key. Set AIMCUB_API_KEY or ANTHROPIC_API_KEY for the anthropic provider.");
    return new AnthropicLlmGateway({ meter: noopMeter, ownerId: OWNER, apiKey });
  }

  throw new UserError(`Unknown AIMCUB_PROVIDER "${provider}". Use "anthropic" or "openai-compatible".`);
}

async function runPlan(title: string, description: string | undefined, json: boolean): Promise<void> {
  const gw = buildGatewayFromEnv();
  const res = await decompose(gw, { title, description });
  if (!res.output) {
    throw new UserError(`Could not produce a valid plan:\n  - ${res.validation.errors.join("\n  - ")}`);
  }
  out(json ? JSON.stringify(res.output, null, 2) : formatPlanPretty(res.output));
}

async function runClarify(title: string, description: string | undefined, json: boolean): Promise<void> {
  const gw = buildGatewayFromEnv();
  const draft = await decompose(gw, { title, description });
  if (!draft.output) {
    throw new UserError(`Could not draft a plan to clarify:\n  - ${draft.validation.errors.join("\n  - ")}`);
  }
  const res = await clarify(gw, { title, description, draft: draft.output });
  if (!res.output) {
    throw new UserError(`Could not produce clarifying questions:\n  - ${res.validation.errors.join("\n  - ")}`);
  }
  out(json ? JSON.stringify(res.output, null, 2) : formatClarifyPretty(title, res.output));
}

async function main(): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: process.argv.slice(2),
      allowPositionals: true,
      options: {
        desc: { type: "string", short: "d" },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
    });
  } catch (e) {
    err(e instanceof Error ? e.message : String(e));
    err("Run `aim --help` for usage.");
    return 2;
  }

  const { values, positionals } = parsed;
  if (values.version) {
    out(VERSION);
    return 0;
  }
  const command = positionals[0];
  if (values.help || !command) {
    out(HELP);
    return command ? 0 : values.help ? 0 : 2;
  }

  const title = positionals[1];
  const description = values.desc;
  const json = Boolean(values.json);

  try {
    if (command === "plan") {
      if (!title) throw new UserError('Missing aim title. Usage: aim plan "<title>"');
      await runPlan(title, description, json);
      return 0;
    }
    if (command === "clarify") {
      if (!title) throw new UserError('Missing aim title. Usage: aim clarify "<title>"');
      await runClarify(title, description, json);
      return 0;
    }
    err(`Unknown command "${command}". Run \`aim --help\` for usage.`);
    return 2;
  } catch (e) {
    if (e instanceof UserError) {
      err(e.message);
      return 1;
    }
    err(`Unexpected error: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((e) => {
    err(`Fatal: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  });
