/**
 * Argument parsing and the output-directory guard. Pure, so the safety rules are testable without
 * touching a filesystem.
 *
 * The guard is deliberately paranoid in the same way `examples/local-alpha` is: this harness writes
 * whole store directories with `replace`, and pointing it at a real `~/.aimcub` would destroy a
 * user's aims. Nothing here can write to a home directory, a real store, or a filesystem root
 * without `--force`.
 */
import { homedir } from "node:os";
import { parse, resolve, sep } from "node:path";

import { BENCHMARK_AIMS } from "./aims.ts";
import { CONDITION_IDS } from "./types.ts";

export interface BenchmarkOptions {
  live: boolean;
  repeat: number;
  seed: string;
  outDir: string;
  aimIds: string[];
  /** Hard ceiling on provider calls. The run aborts rather than quietly overspending. */
  maxCalls: number;
  force: boolean;
  help: boolean;
  /** Path to a previous `results.json`: re-render its report and exit without running anything. */
  rerender: string;
}

export interface ParseArgsResult {
  options: BenchmarkOptions;
  errors: string[];
}

export const DEFAULT_SEED = "aimcub-eval-moat-1";

function defaultOutDir(env: Record<string, string | undefined>): string {
  return env.AIMCUB_EVAL_MOAT_OUT?.trim() || "";
}

export function usage(): string {
  return [
    "Usage:",
    "  pnpm --filter @app/cli exec esbuild ../../examples/eval-moat/run-benchmark.ts --bundle --platform=node --format=esm --target=node22 --outfile=/tmp/eval-moat.mjs",
    "  node /tmp/eval-moat.mjs --out /tmp/eval-moat-run",
    "  node /tmp/eval-moat.mjs --out /tmp/eval-moat-run --live",
    "",
    "Options:",
    "  --out <dir>      Output directory for stores, plans, judge output, and the report. Required.",
    "  --live           Run real decompositions and blind judging. Needs a provider key.",
    "  --repeat <n>     Repetitions per cell in live mode (default 1).",
    `  --aims <ids>     Comma-separated aim ids (default all: ${BENCHMARK_AIMS.map((aim) => aim.id).join(", ")}).`,
    `  --seed <string>  Seed for the blind A/B assignment (default "${DEFAULT_SEED}").`,
    "  --max-calls <n>  Hard cap on provider calls; the run aborts before exceeding it.",
    "  --force          Allow a dangerous output directory. Only for disposable paths.",
    "  --rerender <f>   Re-render the report from a previous results.json and exit. No provider call.",
    "  --help           Show this help.",
    "",
    "Without --live the harness never calls a provider: it seeds both conditions and reports the",
    "context diff only.",
  ].join("\n");
}

export function parseArgs(argv: readonly string[], env: Record<string, string | undefined> = {}): ParseArgsResult {
  const errors: string[] = [];
  const options: BenchmarkOptions = {
    live: false,
    repeat: 1,
    seed: DEFAULT_SEED,
    outDir: defaultOutDir(env),
    aimIds: BENCHMARK_AIMS.map((aim) => aim.id),
    maxCalls: 0,
    force: false,
    help: false,
    rerender: "",
  };

  const value = (index: number, flag: string): string | null => {
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      errors.push(`${flag} requires a value.`);
      return null;
    }
    return next;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    const [flag, inline] = arg.startsWith("--") && arg.includes("=")
      ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)]
      : [arg, null];

    switch (flag) {
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--live":
        options.live = true;
        break;
      case "--force":
        options.force = true;
        break;
      case "--out": {
        const raw = inline ?? value(index, "--out");
        if (raw !== null) options.outDir = raw;
        if (inline === null && raw !== null) index += 1;
        break;
      }
      case "--seed": {
        const raw = inline ?? value(index, "--seed");
        if (raw !== null) options.seed = raw;
        if (inline === null && raw !== null) index += 1;
        break;
      }
      case "--repeat": {
        const raw = inline ?? value(index, "--repeat");
        if (raw !== null) {
          const parsed = Number(raw);
          if (!Number.isInteger(parsed) || parsed < 1) errors.push(`--repeat must be a positive integer, got "${raw}".`);
          else options.repeat = parsed;
        }
        if (inline === null && raw !== null) index += 1;
        break;
      }
      case "--max-calls": {
        const raw = inline ?? value(index, "--max-calls");
        if (raw !== null) {
          const parsed = Number(raw);
          if (!Number.isInteger(parsed) || parsed < 1) errors.push(`--max-calls must be a positive integer, got "${raw}".`);
          else options.maxCalls = parsed;
        }
        if (inline === null && raw !== null) index += 1;
        break;
      }
      case "--rerender": {
        const raw = inline ?? value(index, "--rerender");
        if (raw !== null) options.rerender = raw;
        if (inline === null && raw !== null) index += 1;
        break;
      }
      case "--aims": {
        const raw = inline ?? value(index, "--aims");
        if (raw !== null) {
          const ids = raw.split(",").map((id) => id.trim()).filter(Boolean);
          const unknown = ids.filter((id) => !BENCHMARK_AIMS.some((aim) => aim.id === id));
          if (unknown.length > 0) errors.push(`Unknown aim id(s): ${unknown.join(", ")}.`);
          else if (ids.length === 0) errors.push("--aims needs at least one aim id.");
          else options.aimIds = ids;
        }
        if (inline === null && raw !== null) index += 1;
        break;
      }
      default:
        if (arg.startsWith("--")) errors.push(`Unknown option: ${arg}`);
        else if (arg.length > 0) errors.push(`Unexpected argument: ${arg}`);
    }
  }

  if (!options.help && !options.rerender.trim() && !options.outDir.trim()) {
    errors.push("Provide --out <dir> (or set AIMCUB_EVAL_MOAT_OUT) — an empty, disposable directory.");
  }
  if (options.maxCalls === 0) {
    options.maxCalls = estimateProviderCalls(options.aimIds.length, options.repeat);
  }

  return { options, errors };
}

/** decompositions (aims × conditions × repetitions) + one blind judging call per aim × repetition. */
export function estimateProviderCalls(aimCount: number, repeat: number): number {
  return aimCount * repeat * (CONDITION_IDS.length + 1);
}

export interface ResolveOutputDirInput {
  outDir: string;
  env?: Record<string, string | undefined>;
  cwd?: string;
  homeDir?: string;
  force?: boolean;
}

function pathInside(parent: string, child: string): boolean {
  return child === parent || child.startsWith(`${parent}${sep}`);
}

/**
 * Resolve the output directory, refusing the paths that would cost someone their real data. Mirrors
 * `resolveLocalAlphaDemoTarget`, because this harness writes stores the same destructive way.
 */
export function resolveOutputDir(input: ResolveOutputDirInput): string {
  const raw = input.outDir.trim();
  if (!raw) throw new Error("Provide --out <dir> — an empty, disposable directory.");

  const cwd = input.cwd ?? process.cwd();
  const home = resolve(input.homeDir ?? homedir());
  const target = resolve(cwd, raw);
  const homeAimcub = resolve(home, ".aimcub");
  const root = parse(target).root;
  const envHome = input.env?.AIMCUB_HOME?.trim();

  if (input.force === true) return target;
  if (target === root || target === home || pathInside(homeAimcub, target)) {
    throw new Error(`Refusing to write benchmark stores to ${target}. Use a disposable directory or pass --force.`);
  }
  if (envHome && pathInside(resolve(cwd, envHome), target)) {
    throw new Error(`Refusing to write benchmark stores inside AIMCUB_HOME (${envHome}). Use a separate disposable directory.`);
  }
  return target;
}
