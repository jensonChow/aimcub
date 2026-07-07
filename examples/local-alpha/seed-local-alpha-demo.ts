#!/usr/bin/env node
import {
  LOCAL_ALPHA_DEMO_GOAL_TITLE,
  resolveLocalAlphaDemoTarget,
  seedLocalAlphaDemo,
} from "../../packages/store/src/local-alpha-demo.ts";

interface CliOptions {
  targetDir?: string;
  force: boolean;
  help: boolean;
}

function usage(): string {
  return [
    "Usage:",
    "  pnpm --filter @app/cli exec esbuild ../../examples/local-alpha/seed-local-alpha-demo.ts --bundle --platform=node --format=esm --target=node22 --outfile=/tmp/aimcub-local-alpha-demo-seed.mjs",
    "  node /tmp/aimcub-local-alpha-demo-seed.mjs --target /tmp/aimcub-local-alpha-demo",
    "  AIMCUB_HOME=/tmp/aimcub-local-alpha-demo node /tmp/aimcub-local-alpha-demo-seed.mjs",
    "",
    "Options:",
    "  --target <dir>  Explicit Aimcub data directory to replace with the demo store.",
    "  --force         Allow dangerous paths such as ~/.aimcub. Use only for disposable data.",
    "  --help          Show this help.",
  ].join("\n");
}

function parseArgs(argv: string[]): CliOptions {
  const out: CliOptions = { force: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      out.help = true;
    } else if (arg === "--force") {
      out.force = true;
    } else if (arg === "--target") {
      const value = argv[index + 1];
      if (!value) throw new Error("--target requires a directory.");
      out.targetDir = value;
      index += 1;
    } else if (arg?.startsWith("--target=")) {
      out.targetDir = arg.slice("--target=".length);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return out;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const dataDir = resolveLocalAlphaDemoTarget({
    targetDir: options.targetDir,
    env: process.env,
    force: options.force,
  });
  const result = await seedLocalAlphaDemo(dataDir);
  console.log(`Seeded "${LOCAL_ALPHA_DEMO_GOAL_TITLE}".`);
  console.log(`AIMCUB_HOME=${result.dataDir}`);
  console.log(`Goal id: ${result.goalId}`);
  console.log(`Rows: ${result.imported.goals} aim, ${result.imported.milestones} sub-aims, ${result.imported.evidence} evidence items, ${result.imported.memories} context rows.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
