/**
 * Aimcub CLI — the headless, scriptable face of `@core` (developers first; "humans are
 * agents too"). It runs the same planning loop as the desktop app over the same local
 * store, exposing the planning cognitive verbs:
 *   - plan     — one-shot draft: pipe a title through `@core`, print, store nothing.
 *   - clarify  — the full loop: draft → surface high-impact questions → (answer) → refine.
 *   - new      — quick decompose AND save (no questions).
 *   - ls/show/rm — CRUD over the SHARED local store (`~/.aimcub`, what desktop reads too).
 *   - replan   — re-decompose a saved aim via the LLM, freezing completed milestones.
 *   - edit     — hand-edit a saved aim's plan JSON (in $EDITOR or via --plan), then validate.
 *   - setup    — configure + persist the provider to settings.json (shared with the desktop).
 *   - config   — show the resolved provider + store path (API key redacted).
 *
 * No daemon, no agent-running. Provider config is read from settings.json (`aim setup`) with
 * `AIMCUB_*` env vars overriding it. The store is a
 * local JSON file today, behind the async `AimStore` interface so a Supabase adapter can
 * swap in later without changing these call sites. Deeper verbs (`eval`/`route`/`why`) wait
 * on the eval pillar.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { planMerge } from "@core/domain";
import {
  decompose,
  clarify,
  buildRefinedDescription,
  AnthropicLlmGateway,
  OpenAiCompatibleLlmGateway,
  type LlmGateway,
  type ClarifyAnswer,
} from "@core/llm";
import { createJsonFileStore, defaultDataDir, loadSettings, saveSettings, settingsPath } from "@core/store";
import type { DecompositionOutput, Goal, Milestone } from "@core/types";

import { resolveProvider, formatConfig, buildSettingsFromInput, type SetupInput } from "./config";
import { parseAnswers, answersToMemories, promptAnswers } from "./answers";
import { promptSetup } from "./setup";
import {
  formatPlanPretty,
  formatClarifyPretty,
  formatGoalList,
  formatGoalDetail,
  formatMergeSummary,
} from "./format";

/** A user-facing error: printed without a stack trace; exit code 1. */
class UserError extends Error {}

function out(s: string): void {
  process.stdout.write(`${s}\n`);
}
function err(s: string): void {
  process.stderr.write(`${s}\n`);
}

/** True when both ends are a real terminal — the precondition for interactive prompting. */
function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

const HELP = `aim — Aimcub CLI: turn an aim into a verifiable plan.

Planning (prints, stores nothing):
  aim plan "<title>" [--desc "..."] [--json]       Decompose an aim into milestones
  aim clarify "<title>" [opts]                      Draft → ask high-impact questions → refine
       [--answers <file|-|json>] [--yes] [--max N] [--save] [--json]

Stored (shared ~/.aimcub store — the desktop app sees these too):
  aim new "<title>" [--desc "..."] [--json]         Decompose AND save the aim
  aim ls [--json]                                   List saved aims
  aim show <id> [--json]                            Show a saved aim + milestones
  aim replan <id> [--title "..."] [--desc "..."] [--json]
                                                    Re-decompose a saved aim (keeps done work)
  aim edit <id> [--plan <file|-|json>] [--json]     Edit a saved aim's plan ($EDITOR or --plan)
  aim rm <id>                                       Delete a saved aim

  aim setup [--provider <p>] [--api-key <k|->] [--model <m>] [--base-url <u>]
                                                    Configure + save the LLM provider (wizard)
  aim config [--json]                               Show the resolved provider + store path
  aim --help | --version

Run \`aim setup\` with NO flags for the interactive wizard (the key is typed hidden). With flags
each is optional; a literal --api-key <k> is recorded in your shell history — prefer the wizard,
or pipe the key: echo "$KEY" | aim setup --provider anthropic --api-key -

The title may be piped on stdin (use "-" or omit it): echo "ship auth" | aim plan -

Provider config — run \`aim setup\` once; it saves to ~/.aimcub/settings.json (shared with the
desktop app). Environment variables override the saved settings for one-off / CI use:
  AIMCUB_PROVIDER   anthropic | openai-compatible
  AIMCUB_API_KEY    API key (falls back to ANTHROPIC_API_KEY / OPENAI_API_KEY)
  AIMCUB_MODEL      model id (required for openai-compatible)
  AIMCUB_BASE_URL   endpoint (openai-compatible only; default https://api.openai.com/v1)
  AIMCUB_HOME       data dir for the shared store (default ~/.aimcub)

Examples:
  aim setup                                # interactive: pick provider, paste key (hidden)
  aim new "Build a CLI todo app with tests + CI"
  aim clarify "ship auth" --save           # guided: answer the forks, then save
  aim ls && aim show 1a2b
  aim replan 1a2b --desc "now mobile-first"`;

const noopMeter = { async record(): Promise<void> {} };
const OWNER = "cli-local";
const store = createJsonFileStore(defaultDataDir());

/** The CLI's own version, read at runtime from the shipped package.json (next to dist/). */
function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      version?: string;
    };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** Read all of stdin synchronously (fd 0); "" if nothing is piped / on error. */
function readStdin(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

/**
 * Resolve a `--answers` / `--plan` value into text: "-" → stdin, a leading "[" or "{" → inline
 * JSON, otherwise a file path. Throws a friendly UserError if the file cannot be read.
 */
function loadTextArg(value: string): string {
  const s = value.trim();
  if (s === "-") return readStdin();
  if (s.startsWith("[") || s.startsWith("{")) return value;
  try {
    return readFileSync(s, "utf8");
  } catch {
    throw new UserError(`Cannot read file: ${s}`);
  }
}

/** Build a gateway from the resolved config (env over settings.json), or a friendly UserError. */
function buildGateway(): LlmGateway {
  const r = resolveProvider(process.env, loadSettings());
  if (r.provider === null) {
    throw new UserError(`Unknown provider "${r.providerLabel}". Use "anthropic" or "openai-compatible".`);
  }
  if (!r.apiKey) {
    throw new UserError(`No API key for the ${r.provider} provider. Run \`aim setup\` to configure one.`);
  }
  if (r.provider === "openai-compatible") {
    if (!r.model) {
      throw new UserError("No model for the openai-compatible provider. Run `aim setup` (or set AIMCUB_MODEL).");
    }
    return new OpenAiCompatibleLlmGateway({
      meter: noopMeter,
      ownerId: OWNER,
      apiKey: r.apiKey,
      model: r.model,
      baseURL: r.baseURL ?? undefined,
    });
  }
  return new AnthropicLlmGateway({ meter: noopMeter, ownerId: OWNER, apiKey: r.apiKey });
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

async function decomposeOrThrow(title: string, description: string | undefined): Promise<DecompositionOutput> {
  const gw = buildGateway();
  const res = await decompose(gw, { title, description });
  if (!res.output) {
    throw new UserError(`Could not produce a valid plan:\n  - ${res.validation.errors.join("\n  - ")}`);
  }
  return res.output;
}

/** Re-plan via the store, mapping its "not found" / invalid-plan failures to UserErrors. */
async function updateGoalOrThrow(input: {
  id: string;
  title?: string;
  description?: string;
  plan: DecompositionOutput;
}): Promise<{ goal: Goal; milestones: Milestone[] }> {
  let res;
  try {
    res = await store.updateGoal(input);
  } catch (e) {
    throw new UserError(e instanceof Error ? e.message : String(e));
  }
  if (!res) throw new UserError(`Aim ${input.id} not found.`);
  return res;
}

interface ClarifyOpts {
  json: boolean;
  save: boolean;
  yes: boolean;
  max: number | undefined;
  answersRaw: string | undefined;
}

async function runPlan(title: string, description: string | undefined, json: boolean): Promise<void> {
  const plan = await decomposeOrThrow(title, description);
  out(json ? JSON.stringify(plan, null, 2) : formatPlanPretty(plan));
}

async function runClarify(title: string, description: string | undefined, opts: ClarifyOpts): Promise<void> {
  const gw = buildGateway();
  const draft = await decompose(gw, { title, description });
  if (!draft.output) {
    throw new UserError(`Could not draft a plan to clarify:\n  - ${draft.validation.errors.join("\n  - ")}`);
  }

  const cl = await clarify(gw, { title, description, draft: draft.output, maxQuestions: opts.max });
  const questions = cl.output?.questions ?? [];
  const assumptions = cl.output?.assumptions ?? [];
  if (!cl.output) err(`(clarify step unavailable: ${cl.validation.errors.join("; ")} — using the draft)`);

  // Gather answers: explicit --answers wins; otherwise prompt only when we can (TTY, not --yes).
  let answers: ClarifyAnswer[] = [];
  if (opts.answersRaw !== undefined) {
    try {
      answers = parseAnswers(opts.answersRaw);
    } catch (e) {
      throw new UserError(e instanceof Error ? e.message : String(e));
    }
  } else if (!opts.yes && isInteractive() && questions.length > 0) {
    answers = await promptAnswers(questions);
  }

  // Refine only when there is something to fold in; otherwise the draft stands.
  let plan = draft.output;
  if (answers.length > 0) {
    const refined = await decompose(gw, {
      title,
      description: buildRefinedDescription(description, questions, answers),
    });
    if (!refined.output) {
      throw new UserError(`Could not refine the plan:\n  - ${refined.validation.errors.join("\n  - ")}`);
    }
    plan = refined.output;
  }

  let saved: { goal: Goal; milestones: Milestone[] } | null = null;
  if (opts.save) {
    saved = await store.createGoal({ title, description, plan, memories: answersToMemories(questions, answers) });
  }

  if (opts.json) {
    out(JSON.stringify({ questions, assumptions, plan, ...(saved ? { goal: saved.goal, milestones: saved.milestones } : {}) }, null, 2));
    return;
  }
  // When we never refined but there were forks, surface them so the user sees what was assumed.
  if (answers.length === 0 && questions.length > 0) {
    out(formatClarifyPretty(title, { questions, assumptions }));
    out("");
  }
  if (saved) {
    out(`Created aim ${saved.goal.id}`);
    out("");
  }
  out(formatPlanPretty(plan));
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
  if (json) {
    out(JSON.stringify(goals, null, 2));
    return;
  }
  // Count the materialized milestone rows (not plan_json.nodes) so `aim ls` agrees with
  // `aim show` after a replan/edit that froze or skipped a milestone. N+1 reads are fine for
  // the local single-user JSON store.
  const items = await Promise.all(
    goals.map(async (goal) => ({ goal, milestoneCount: (await store.getGoal(goal.id))?.milestones.length ?? 0 })),
  );
  out(formatGoalList(items));
}

async function runShow(idPrefix: string, json: boolean): Promise<void> {
  const id = await resolveGoalId(idPrefix);
  const got = await store.getGoal(id);
  if (!got) throw new UserError(`Aim ${id} not found.`);
  out(json ? JSON.stringify(got, null, 2) : formatGoalDetail(got.goal, got.milestones));
}

async function runReplan(
  idPrefix: string,
  title: string | undefined,
  description: string | undefined,
  json: boolean,
): Promise<void> {
  const id = await resolveGoalId(idPrefix);
  const got = await store.getGoal(id);
  if (!got) throw new UserError(`Aim ${id} not found.`);

  const plan = await decomposeOrThrow(title?.trim() || got.goal.title, description ?? got.goal.description);
  const merged = planMerge(
    got.milestones.map((m) => ({ id: m.id, title: m.title, status: m.status })),
    plan,
  );
  const res = await updateGoalOrThrow({ id, title, description, plan });

  if (json) {
    out(JSON.stringify({ goal: res.goal, milestones: res.milestones, merge: merged }, null, 2));
    return;
  }
  out(formatMergeSummary(merged));
  out("");
  out(formatGoalDetail(res.goal, res.milestones));
}

/**
 * Open $EDITOR on `initial`; returns the edited text, or null if the editor exited nonzero.
 * Throws a UserError if the editor binary cannot be launched (e.g. a typo'd $EDITOR / not on
 * PATH). Always removes its temp dir, on every exit path.
 */
function editViaEditor(initial: string): string | null {
  const editor = (process.env.VISUAL || process.env.EDITOR || "vi").trim();
  const [cmd, ...editorArgs] = editor.split(/\s+/);
  const dir = mkdtempSync(join(tmpdir(), "aim-edit-"));
  const file = join(dir, "plan.json");
  try {
    writeFileSync(file, initial, "utf8");
    const res = spawnSync(cmd ?? "vi", [...editorArgs, file], { stdio: "inherit" });
    // spawnSync sets `error` (e.g. ENOENT) when the binary can't be launched — distinct from
    // the editor running and exiting nonzero (a deliberate abort).
    if (res.error) throw new UserError(`Could not launch editor "${cmd ?? "vi"}": ${res.error.message}`);
    if (res.status !== 0) return null;
    return readFileSync(file, "utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function runEdit(idPrefix: string, planRaw: string | undefined, json: boolean): Promise<void> {
  const id = await resolveGoalId(idPrefix);
  const got = await store.getGoal(id);
  if (!got) throw new UserError(`Aim ${id} not found.`);
  const current = JSON.stringify(got.goal.plan_json ?? {}, null, 2);

  let edited: string;
  if (planRaw !== undefined) {
    edited = planRaw;
  } else if (isInteractive()) {
    const result = editViaEditor(current);
    if (result === null) throw new UserError("Editor exited without saving — no changes.");
    if (result.trim() === current.trim()) {
      out("No changes.");
      return;
    }
    edited = result;
  } else {
    throw new UserError("No TTY for an editor. Pass --plan <file|-|json> to set the plan non-interactively.");
  }

  let plan: DecompositionOutput;
  try {
    plan = JSON.parse(edited) as DecompositionOutput;
  } catch {
    throw new UserError("Edited plan is not valid JSON.");
  }

  const res = await updateGoalOrThrow({ id, plan });
  if (json) {
    out(JSON.stringify({ goal: res.goal, milestones: res.milestones }, null, 2));
    return;
  }
  out(`Updated aim ${res.goal.id}`);
  out("");
  out(formatGoalDetail(res.goal, res.milestones));
}

async function runRm(idPrefix: string): Promise<void> {
  const id = await resolveGoalId(idPrefix);
  await store.deleteGoal(id);
  out(`Deleted aim ${id}`);
}

function runConfig(json: boolean): void {
  const r = resolveProvider(process.env, loadSettings());
  const dataDir = defaultDataDir();
  const version = readVersion();
  if (json) {
    // Never emit the raw key — only whether one is set and where it came from.
    out(
      JSON.stringify(
        {
          version,
          provider: r.provider,
          providerLabel: r.providerLabel,
          providerSource: r.providerSource,
          model: r.model,
          modelSource: r.modelSource,
          baseURL: r.baseURL,
          baseURLSource: r.baseURLSource,
          keySet: Boolean(r.apiKey),
          keySource: r.keySource,
          store: dataDir,
          config: settingsPath(),
        },
        null,
        2,
      ),
    );
    return;
  }
  out(formatConfig(r, dataDir, version, settingsPath()));
}

/** `aim setup` — configure + persist the provider (interactive wizard, or flags). */
async function runSetup(opts: {
  provider?: string;
  apiKey?: string;
  model?: string;
  baseURL?: string;
  json: boolean;
}): Promise<void> {
  const current = loadSettings();
  const hasFlags =
    opts.provider !== undefined || opts.apiKey !== undefined || opts.model !== undefined || opts.baseURL !== undefined;

  let input: SetupInput;
  if (hasFlags) {
    // `--api-key -` reads the key from stdin so it need not appear in argv / shell history.
    const flagKey = opts.apiKey === "-" ? readStdin().trim() : opts.apiKey;
    input = {
      provider: opts.provider ?? current?.provider ?? "anthropic",
      apiKey: flagKey ?? "",
      model: opts.model,
      baseURL: opts.baseURL,
    };
  } else if (isInteractive()) {
    input = await promptSetup(current);
  } else {
    throw new UserError(
      "aim setup needs a terminal, or pass flags: --provider <p> --api-key <k> [--model <m>] [--base-url <u>].",
    );
  }

  const result = buildSettingsFromInput(input, current);
  if (!result.settings) {
    throw new UserError(`Could not save settings:\n  - ${result.errors.join("\n  - ")}`);
  }
  saveSettings(result.settings);

  if (opts.json) {
    out(
      JSON.stringify(
        {
          saved: true,
          provider: result.settings.provider,
          model: result.settings.model ?? null,
          baseURL: result.settings.baseURL ?? null,
          config: settingsPath(),
        },
        null,
        2,
      ),
    );
    return;
  }
  out(`Saved provider settings to ${settingsPath()}`);
  out("");
  out(formatConfig(resolveProvider(process.env, result.settings), defaultDataDir(), readVersion(), settingsPath()));
  out('\nTry it:  aim plan "ship auth"');
}

/**
 * Resolve the title argument, falling back to stdin ("-" or omitted + piped). `stdinClaimed`
 * is true when `--answers -`/`--plan -` already drained stdin — a single stdin stream can't
 * feed two consumers, so we say so plainly instead of the misleading "missing title".
 */
function resolveTitle(arg: string | undefined, stdinClaimed: boolean): string {
  if (arg && arg !== "-") return arg;
  if (arg === "-" || !process.stdin.isTTY) {
    if (stdinClaimed) {
      throw new UserError("Cannot read the title from stdin: --answers/--plan already consumed it. Pass the title as an argument or a file.");
    }
    const piped = readStdin().trim();
    if (piped) return piped;
  }
  throw new UserError("Missing aim title. Pass it as an argument or pipe it on stdin.");
}

async function main(): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: process.argv.slice(2),
      allowPositionals: true,
      options: {
        desc: { type: "string", short: "d" },
        title: { type: "string" },
        answers: { type: "string" },
        plan: { type: "string" },
        max: { type: "string" },
        provider: { type: "string" },
        "api-key": { type: "string" },
        model: { type: "string" },
        "base-url": { type: "string" },
        save: { type: "boolean" },
        yes: { type: "boolean", short: "y" },
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
    out(readVersion());
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
  // A single stdin stream can't feed both the title and an --answers/--plan value.
  const stdinClaimed = values.answers?.trim() === "-" || values.plan?.trim() === "-";

  try {
    // These derive user input and may throw (bad --max, unreadable file); keep them inside the
    // catch so they surface as clean UserErrors, not a "Fatal:" crash.
    let max: number | undefined;
    if (values.max !== undefined) {
      const n = Number(values.max);
      if (!Number.isInteger(n) || n < 1) throw new UserError("--max must be a positive integer.");
      max = n;
    }
    const answersRaw = values.answers !== undefined ? loadTextArg(values.answers) : undefined;
    const planRaw = values.plan !== undefined ? loadTextArg(values.plan) : undefined;

    switch (command) {
      case "plan":
        await runPlan(resolveTitle(arg, stdinClaimed), description, json);
        return 0;
      case "clarify":
        await runClarify(resolveTitle(arg, stdinClaimed), description, {
          json,
          save: Boolean(values.save),
          yes: Boolean(values.yes),
          max,
          answersRaw,
        });
        return 0;
      case "new":
        await runNew(resolveTitle(arg, stdinClaimed), description, json);
        return 0;
      case "ls":
        await runLs(json);
        return 0;
      case "show":
        if (!arg) throw new UserError("Missing aim id. Usage: aim show <id>");
        await runShow(arg, json);
        return 0;
      case "replan":
        if (!arg) throw new UserError("Missing aim id. Usage: aim replan <id>");
        await runReplan(arg, values.title, description, json);
        return 0;
      case "edit":
        if (!arg) throw new UserError("Missing aim id. Usage: aim edit <id>");
        await runEdit(arg, planRaw, json);
        return 0;
      case "rm":
        if (!arg) throw new UserError("Missing aim id. Usage: aim rm <id>");
        await runRm(arg);
        return 0;
      case "config":
        runConfig(json);
        return 0;
      case "setup":
        if (positionals.length > 1) {
          throw new UserError(
            'aim setup takes no positional arguments. Run `aim setup` for the wizard, or use flags: --provider <p> --api-key <k> [--model <m>] [--base-url <u>].',
          );
        }
        await runSetup({
          provider: values.provider,
          apiKey: values["api-key"],
          model: values.model,
          baseURL: values["base-url"],
          json,
        });
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
