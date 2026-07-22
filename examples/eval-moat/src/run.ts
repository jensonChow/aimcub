/**
 * The benchmark itself.
 *
 * Every provider call goes through `budgetedGateway`, which counts calls and refuses to exceed the
 * ceiling — so a mistake in a loop costs an error, not a bill. The gateway is injected, which is
 * also how the live path is tested up to (and including) the provider boundary without a key.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { BENCHMARK_AIMS, groundTruthContext } from "./aims.ts";
import { assignBlindLabels } from "./blind.ts";
import { buildContextDiff, captureConditionContext, type ConditionCapture } from "./context.ts";
import {
  createJsonFileStore,
  critiquePlan,
  decompose,
  type DecompositionOutput,
  type LlmGateway,
  type LlmRequest,
  type LlmResponse,
} from "./core.ts";
import type { BenchmarkOptions } from "./options.ts";
import { renderReport } from "./report.ts";
import {
  JUDGE_SYSTEM_PROMPT,
  buildJudgePrompt,
  judgeJsonSchema,
  parseJudgeOutput,
  renderPlanForJudging,
} from "./rubric.ts";
import { seedCondition } from "./seed.ts";
import {
  CONDITION_IDS,
  type BenchmarkAim,
  type BenchmarkRun,
  type ConditionId,
  type JudgeCriterionScore,
  type PlanCell,
  type ResolvedJudgement,
} from "./types.ts";

export class BudgetExceededError extends Error {
  constructor(budget: number) {
    super(`Provider call budget exhausted (${budget} calls). Raise --max-calls only on purpose.`);
    this.name = "BudgetExceededError";
  }
}

export interface BudgetedGateway {
  gateway: LlmGateway;
  calls: () => number;
  /**
   * Pre-flight check. `decompose` is total — it turns a gateway error into `{ ok: false }` — so a
   * budget hit inside it would look like a bad plan instead of an aborted run. Callers assert the
   * budget BEFORE spending it, and the wrapper stays as the backstop.
   */
  assertAvailable: (count: number) => void;
}

/** Wrap a gateway so the harness can never spend more than it announced. */
export function budgetedGateway(inner: LlmGateway, budget: number): BudgetedGateway {
  let calls = 0;
  const spend = (): void => {
    if (calls >= budget) throw new BudgetExceededError(budget);
    calls += 1;
  };
  return {
    calls: () => calls,
    assertAvailable: (count: number) => {
      if (calls + count > budget) throw new BudgetExceededError(budget);
    },
    gateway: {
      // Async so an exhausted budget arrives as a rejected promise, like every other gateway error.
      complete: async (req: LlmRequest): Promise<LlmResponse<string>> => {
        spend();
        return inner.complete(req);
      },
      completeStructured: async <T,>(req: LlmRequest & { schema: unknown }): Promise<LlmResponse<T>> => {
        spend();
        return inner.completeStructured<T>(req);
      },
    },
  };
}

export interface BenchmarkDeps {
  /** Called once, only in live mode. */
  createGateway: () => LlmGateway;
  provider: string | null;
  model: string | null;
  now: () => string;
  log: (line: string) => void;
}

function ownerMix(plan: DecompositionOutput): Record<string, number> {
  const mix: Record<string, number> = {};
  for (const node of plan.nodes) {
    const owner = node.decomposition_contract?.likely_owner ?? "unset";
    mix[owner] = (mix[owner] ?? 0) + 1;
  }
  return mix;
}

function manualOnlyNodes(plan: DecompositionOutput): number {
  return plan.nodes.filter((node) =>
    node.acceptance_rule.clauses.every((clause) => clause.evaluator === "manual_confirm"),
  ).length;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function judgeAim(input: {
  gateway: LlmGateway;
  model: string | null;
  aim: BenchmarkAim;
  repetition: number;
  seed: string;
  plans: Record<ConditionId, DecompositionOutput>;
  judgeDir: string;
}): Promise<{ judgement: ResolvedJudgement | null; warnings: string[] }> {
  const { labelMap } = assignBlindLabels(input.seed, input.aim.id, input.repetition);
  const rendered: Record<"A" | "B", string> = {
    A: renderPlanForJudging(input.plans[labelMap.A]),
    B: renderPlanForJudging(input.plans[labelMap.B]),
  };
  const prompt = buildJudgePrompt({
    aim: input.aim,
    groundTruth: groundTruthContext(input.aim),
    planA: rendered.A,
    planB: rendered.B,
  });

  const stem = join(input.judgeDir, `${input.aim.id}-rep${input.repetition}`);
  writeFileSync(`${stem}-prompt.txt`, `${JUDGE_SYSTEM_PROMPT}\n\n---\n\n${prompt}\n`, "utf8");
  // The label map is written BEFORE the call, so a crash still leaves the blind decipherable.
  writeJson(`${stem}-labels.json`, { seed: input.seed, aimId: input.aim.id, repetition: input.repetition, labelMap });

  let raw: LlmResponse<unknown>;
  try {
    raw = await input.gateway.completeStructured<unknown>({
      task: "classify",
      system: JUDGE_SYSTEM_PROMPT,
      prompt,
      schema: judgeJsonSchema,
      ...(input.model ? { model: input.model } : {}),
    });
  } catch (error) {
    if (error instanceof BudgetExceededError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    return { judgement: null, warnings: [`judge call failed for ${input.aim.id} rep ${input.repetition}: ${message}`] };
  }

  writeJson(`${stem}-raw.json`, raw.output);
  const parsed = parseJudgeOutput(raw.output);
  if (!parsed.verdict) {
    return {
      judgement: null,
      warnings: [`judge output rejected for ${input.aim.id} rep ${input.repetition}: ${parsed.errors.join("; ")}`],
    };
  }

  const byLabel = new Map(parsed.verdict.scores.map((row) => [row.label, row.criteria]));
  const byCondition: Record<ConditionId, JudgeCriterionScore[]> = {
    bare: byLabel.get(labelMap.A === "bare" ? "A" : "B") ?? [],
    contexted: byLabel.get(labelMap.A === "contexted" ? "A" : "B") ?? [],
  };
  return {
    judgement: {
      aimId: input.aim.id,
      repetition: input.repetition,
      labelMap,
      byCondition,
      notes: parsed.verdict.notes,
    },
    warnings: [],
  };
}

export interface BenchmarkResult {
  run: BenchmarkRun;
  reportPath: string;
  outDir: string;
}

export async function runBenchmark(
  options: BenchmarkOptions,
  outDir: string,
  deps: BenchmarkDeps,
): Promise<BenchmarkResult> {
  const aims = options.aimIds.flatMap((id) => {
    const aim = BENCHMARK_AIMS.find((row) => row.id === id);
    return aim ? [aim] : [];
  });

  const dirs = {
    stores: join(outDir, "stores"),
    plans: join(outDir, "plans"),
    context: join(outDir, "context"),
    judge: join(outDir, "judge"),
  };
  for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true });

  const budgeted = options.live ? budgetedGateway(deps.createGateway(), options.maxCalls) : null;
  const run: BenchmarkRun = {
    mode: options.live ? "live" : "dry-run",
    startedAt: deps.now(),
    seed: options.seed,
    repeat: options.repeat,
    provider: options.live ? deps.provider : null,
    model: options.live ? deps.model : null,
    providerCalls: 0,
    aims: aims.map((aim) => aim.id),
    diffs: [],
    cells: [],
    judgements: [],
    warnings: [],
  };

  /** Seed one condition into its own isolated store and record what it would inject. */
  const seedAndCapture = async (aim: BenchmarkAim, condition: ConditionId): Promise<ConditionCapture> => {
    const dataDir = join(dirs.stores, aim.id, condition);
    const seeded = await seedCondition(aim, condition, dataDir);
    const store = createJsonFileStore(dataDir);
    const capture = await captureConditionContext(store, aim, condition, seeded.goalId);

    writeFileSync(join(dirs.context, `${aim.id}-${condition}.txt`), `${capture.captured.renderedBlock}\n`, "utf8");
    writeJson(join(dirs.context, `${aim.id}-${condition}-selection.json`), capture.captured.report);
    deps.log(
      `  seeded ${condition}: ${seeded.counts.goals} aim(s), ${seeded.counts.memories} context row(s), ` +
      `${seeded.counts.completions} completion(s) → injects ${capture.captured.memories.length} row(s)`,
    );
    return capture;
  };

  for (const aim of aims) {
    deps.log(`\n${aim.id} — ${aim.label}`);
    const captures: Record<ConditionId, ConditionCapture> = {
      bare: await seedAndCapture(aim, "bare"),
      contexted: await seedAndCapture(aim, "contexted"),
    };

    const diff = buildContextDiff(aim, captures.bare, captures.contexted);
    run.diffs.push(diff);
    if (!diff.nonEmpty) {
      run.warnings.push(`${aim.id}: the contexted condition injected nothing the bare one lacks — check the fixture.`);
    }

    if (!options.live || !budgeted) continue;

    for (let repetition = 1; repetition <= options.repeat; repetition += 1) {
      const plans: Partial<Record<ConditionId, DecompositionOutput>> = {};

      for (const condition of CONDITION_IDS) {
        const capture = captures[condition];
        budgeted.assertAvailable(1);
        const result = await decompose(budgeted.gateway, {
          title: aim.title,
          description: aim.description,
          domain: aim.domain,
          memories: capture.planningMemories,
          lineageLearning: capture.lineageLearning,
          decompositionLearning: capture.decompositionLearning,
          decompositionStrategy: capture.decompositionStrategy,
        });

        const cell: PlanCell = {
          aimId: aim.id,
          condition,
          repetition,
          ok: Boolean(result.output),
          errors: result.validation.ok ? [] : result.validation.errors,
          plan: result.output,
          groundTruthQuality: result.output
            ? critiquePlan({ plan: result.output, context: groundTruthContext(aim) })
            : null,
          nodeCount: result.output?.nodes.length ?? 0,
          manualOnlyNodes: result.output ? manualOnlyNodes(result.output) : 0,
          ownerMix: result.output ? ownerMix(result.output) : {},
          usage: result.usage
            ? { model: result.usage.model, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens }
            : null,
        };
        run.cells.push(cell);

        if (result.output) {
          plans[condition] = result.output;
          writeJson(join(dirs.plans, `${aim.id}-${condition}-rep${repetition}.json`), result.output);
          deps.log(
            `  ${condition} rep${repetition}: ${cell.nodeCount} milestone(s), ` +
            `ground-truth quality ${cell.groundTruthQuality?.score ?? "—"}/100`,
          );
        } else {
          run.warnings.push(
            `${aim.id}/${condition} rep ${repetition} produced no valid plan: ${cell.errors.join("; ") || "unknown error"}`,
          );
          deps.log(`  ${condition} rep${repetition}: NO VALID PLAN (${cell.errors[0] ?? "unknown"})`);
        }
      }

      if (!plans.bare || !plans.contexted) {
        run.warnings.push(`${aim.id} rep ${repetition}: skipped judging because a plan is missing.`);
        continue;
      }

      budgeted.assertAvailable(1);
      const judged = await judgeAim({
        gateway: budgeted.gateway,
        model: deps.model,
        aim,
        repetition,
        seed: options.seed,
        plans: { bare: plans.bare, contexted: plans.contexted },
        judgeDir: dirs.judge,
      });
      run.warnings.push(...judged.warnings);
      if (judged.judgement) run.judgements.push(judged.judgement);
    }
  }

  run.providerCalls = budgeted?.calls() ?? 0;
  const reportPath = join(outDir, "eval-moat-report.md");
  writeFileSync(reportPath, renderReport(run), "utf8");
  writeJson(join(outDir, "results.json"), run);
  return { run, reportPath, outDir };
}
