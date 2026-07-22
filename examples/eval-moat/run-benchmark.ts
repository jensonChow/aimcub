#!/usr/bin/env node
/**
 * The eval-moat benchmark runner.
 *
 * Dry run (default, no provider, no key): seeds both conditions and reports the context diff.
 * Live run (`--live`): decomposes each aim in both conditions and blind-judges the plans.
 *
 * See ./README.md for what this proves, what it does not, and what a null result means.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  AnthropicLlmGateway,
  DEFAULT_OWNER,
  OpenAiCompatibleLlmGateway,
  getDefaultModel,
  getLlmProviderDefinition,
  loadSettings,
  resolveProvider,
  type LlmGateway,
  type ResolvedProvider,
  type UsageMeter,
} from "./src/core.ts";
import { estimateProviderCalls, parseArgs, resolveOutputDir, usage } from "./src/options.ts";
import { renderReport } from "./src/report.ts";
import { runBenchmark } from "./src/run.ts";
import type { BenchmarkRun } from "./src/types.ts";

const noopMeter: UsageMeter = { record: async () => {} };

function buildGateway(resolved: ResolvedProvider): LlmGateway {
  if (!resolved.provider) {
    throw new Error(`Unknown provider "${resolved.providerLabel}". Run \`aimcub setup\` or set AIMCUB_PROVIDER.`);
  }
  if (!resolved.apiKey) {
    throw new Error(
      `No API key for the ${resolved.provider} provider. Run \`aimcub setup\`, or set AIMCUB_API_KEY, ` +
      "or drop --live to run the provider-free dry run.",
    );
  }
  const definition = getLlmProviderDefinition(resolved.provider);
  if (!definition) throw new Error(`Unknown provider "${resolved.providerLabel}".`);

  if (definition.protocol === "openai-compatible") {
    if (!resolved.model) throw new Error("No model for this provider. Run `aimcub setup` or set AIMCUB_MODEL.");
    return new OpenAiCompatibleLlmGateway({
      meter: noopMeter,
      ownerId: DEFAULT_OWNER,
      apiKey: resolved.apiKey,
      model: resolved.model,
      baseURL: resolved.baseURL ?? undefined,
      maxTokensParam: definition.maxTokensParam,
      structuredOutputMode: definition.structuredOutputMode,
    });
  }
  return new AnthropicLlmGateway({
    meter: noopMeter,
    ownerId: DEFAULT_OWNER,
    apiKey: resolved.apiKey,
    model: resolved.model ?? getDefaultModel("anthropic"),
  });
}

async function main(): Promise<void> {
  const { options, errors } = parseArgs(process.argv.slice(2), process.env);
  if (options.help) {
    console.log(usage());
    return;
  }
  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    console.error("\n" + usage());
    process.exitCode = 1;
    return;
  }

  // Re-rendering proves the report is a pure function of the persisted results: anyone can rebuild
  // it from the artifacts of a run they did not pay for.
  if (options.rerender.trim()) {
    const resultsPath = resolve(process.cwd(), options.rerender.trim());
    const parsed: unknown = JSON.parse(readFileSync(resultsPath, "utf8"));
    if (!parsed || typeof parsed !== "object" || !("mode" in parsed) || !("diffs" in parsed)) {
      throw new Error(`${resultsPath} does not look like a benchmark results.json.`);
    }
    const reportPath = join(dirname(resultsPath), "eval-moat-report.md");
    writeFileSync(reportPath, renderReport(parsed as BenchmarkRun), "utf8");
    console.log(`Re-rendered report from ${resultsPath}`);
    console.log(`Report: ${reportPath}`);
    return;
  }

  const outDir = resolveOutputDir({ outDir: options.outDir, env: process.env, force: options.force });
  if (existsSync(outDir) && readdirSync(outDir).length > 0 && !options.force) {
    console.error(`Output directory is not empty: ${outDir}. Use a fresh directory or pass --force.`);
    process.exitCode = 1;
    return;
  }
  mkdirSync(outDir, { recursive: true });

  const estimate = estimateProviderCalls(options.aimIds.length, options.repeat);
  console.log(`Aimcub eval-moat benchmark · ${options.aimIds.length} aim(s) × 2 conditions × ${options.repeat} repetition(s)`);
  console.log(`Output: ${outDir}`);

  let resolved: ResolvedProvider | null = null;
  if (options.live) {
    resolved = resolveProvider(process.env, loadSettings());
    console.log(
      `Mode: LIVE · provider ${resolved.providerLabel} · model ${resolved.model ?? "(provider default)"} · ` +
      `key from ${resolved.keySource ?? "(not set)"}`,
    );
    console.log(
      `Estimated provider calls: ${estimate} ` +
      `(${options.aimIds.length}×${options.repeat} decompositions per condition + ${options.aimIds.length * options.repeat} judging calls). ` +
      `Hard cap: ${options.maxCalls}.`,
    );
  } else {
    console.log("Mode: DRY RUN · no provider call will be made. Pass --live to generate and judge plans.");
  }

  const result = await runBenchmark(options, outDir, {
    createGateway: () => buildGateway(resolved!),
    provider: resolved?.provider ?? null,
    model: resolved?.model ?? null,
    now: () => new Date().toISOString(),
    log: (line) => console.log(line),
  });

  console.log("");
  for (const warning of result.run.warnings) console.log(`WARNING: ${warning}`);
  console.log(`Provider calls made: ${result.run.providerCalls}`);
  console.log(`Report: ${result.reportPath}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
