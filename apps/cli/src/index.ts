/**
 * Aimcub CLI — the headless, scriptable face of `@core` (developers first; "humans are
 * agents too"). Two kinds of commands:
 *   - stateless: `plan` / `clarify` — pipe a title through `@core`, print, store nothing.
 *   - stored:    `new` / `ls` / `show` / `rm` — persist to the SHARED local store
 *     (`~/.aimcub`, the same store the desktop app uses) via `@core/store`.
 *
 * No daemon, no agent-running. Provider config comes from the environment. The store is a
 * local JSON file today, behind the async `AimStore` interface so a Supabase adapter can
 * swap in later without changing these call sites.
 */
import { parseArgs } from "node:util";

import {
  decompose,
  clarify,
  AnthropicLlmGateway,
  OpenAiCompatibleLlmGateway,
  type LlmGateway,
} from "@core/llm";
import { createJsonFileStore, defaultDataDir } from "@core/store";

import { formatPlanPretty, formatClarifyPretty, formatGoalList, formatGoalDetail } from "./format";

const VERSION = "0.0.0";

/** A user-facing error: printed without a stack trace; exit code 1. */
class UserError extends Error {}

function out(s: string): void {
  process.stdout.write(`${s}\n`);
}
function err(s: string): void {
  process.stderr.write(`${s}\n`);
}

const HELP = `aim — Aimcub CLI: turn an aim into a verifiable plan.

Stateless (prints, stores nothing):
  aim plan "<title>" [--desc "..."] [--json]      Decompose an aim into milestones
  aim clarify "<title>" [--desc "..."] [--json]   Draft + surface clarifying questions

Stored (shared ~/.aimcub store — the desktop app sees these too):
  aim new "<title>" [--desc "..."] [--json]       Decompose AND save the aim
  aim ls [--json]                                 List saved aims
  aim show <id> [--json]                          Show a saved aim + milestones
  aim rm <id>                                     Delete a saved aim

  aim --help | --version

Provider (from environment):
  AIMCUB_PROVIDER   anthropic | openai-compatible   (default: anthropic)
  AIMCUB_API_KEY    API key (falls back to ANTHROPIC_API_KEY / OPENAI_API_KEY)
  AIMCUB_MODEL      model id (required for openai-compatible)
  AIMCUB_BASE_URL   endpoint (openai-compatible only; default https://api.openai.com/v1)
  AIMCUB_HOME       data dir for the shared store (default ~/.aimcub)

Examples:
  aim new "Build a CLI todo app with tests + CI"
  aim ls
  AIMCUB_PROVIDER=openai-compatible AIMCUB_BASE_URL=https://openrouter.ai/api/v1 \\
    AIMCUB_MODEL=deepseek/deepseek-chat AIMCUB_API_KEY=sk-... aim plan "ship auth"`;

const noopMeter = { async record(): Promise<void> {} };
const OWNER = "cli-local";
const store = createJsonFileStore(defaultDataDir());

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

/** Resolve a full or unique-prefix goal id to a full id. */
async function resolveGoalId(prefix: string): Promise<string> {
  const goals = await store.listGoals();
  const exact = goals.find((g) => g.id === prefix);
  if (exact) return exact.id;
  const matches = goals.filter((g) => g.id.startsWith(prefix));
  if (matches.length === 1) return matches[0]!.id;
  if (matches.length === 0) throw new UserError(`No aim matches id "${prefix}". Try \`aim ls\`.`);
  throw new UserError(`Ambiguous id "${prefix}" (${matches.length} matches). Use more characters.`);
}

async function decomposeOrThrow(title: string, description: string | undefined) {
  const gw = buildGatewayFromEnv();
  const res = await decompose(gw, { title, description });
  if (!res.output) {
    throw new UserError(`Could not produce a valid plan:\n  - ${res.validation.errors.join("\n  - ")}`);
  }
  return res.output;
}

async function runPlan(title: string, description: string | undefined, json: boolean): Promise<void> {
  const plan = await decomposeOrThrow(title, description);
  out(json ? JSON.stringify(plan, null, 2) : formatPlanPretty(plan));
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

async function runNew(title: string, description: string | undefined, json: boolean): Promise<void> {
  const plan = await decomposeOrThrow(title, description);
  const { goal, milestones } = await store.createGoal({ title, description, plan });
  if (json) {
    out(JSON.stringify({ goal, milestones }, null, 2));
    return;
  }
  out(`Created aim ${goal.id}`);
  out("");
  out(formatPlanPretty(plan));
}

async function runLs(json: boolean): Promise<void> {
  const goals = await store.listGoals();
  out(json ? JSON.stringify(goals, null, 2) : formatGoalList(goals));
}

async function runShow(idPrefix: string, json: boolean): Promise<void> {
  const id = await resolveGoalId(idPrefix);
  const got = await store.getGoal(id);
  if (!got) throw new UserError(`Aim ${id} not found.`);
  out(json ? JSON.stringify(got, null, 2) : formatGoalDetail(got.goal, got.milestones));
}

async function runRm(idPrefix: string): Promise<void> {
  const id = await resolveGoalId(idPrefix);
  await store.deleteGoal(id);
  out(`Deleted aim ${id}`);
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
    return command || values.help ? 0 : 2;
  }

  const arg = positionals[1];
  const description = values.desc;
  const json = Boolean(values.json);

  try {
    switch (command) {
      case "plan":
        if (!arg) throw new UserError('Missing aim title. Usage: aim plan "<title>"');
        await runPlan(arg, description, json);
        return 0;
      case "clarify":
        if (!arg) throw new UserError('Missing aim title. Usage: aim clarify "<title>"');
        await runClarify(arg, description, json);
        return 0;
      case "new":
        if (!arg) throw new UserError('Missing aim title. Usage: aim new "<title>"');
        await runNew(arg, description, json);
        return 0;
      case "ls":
        await runLs(json);
        return 0;
      case "show":
        if (!arg) throw new UserError("Missing aim id. Usage: aim show <id>");
        await runShow(arg, json);
        return 0;
      case "rm":
        if (!arg) throw new UserError("Missing aim id. Usage: aim rm <id>");
        await runRm(arg);
        return 0;
      default:
        err(`Unknown command "${command}". Run \`aim --help\` for usage.`);
        return 2;
    }
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
