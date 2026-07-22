/**
 * The live path, verified up to the provider boundary with a mock gateway: no key, no network, no
 * cost — but the same orchestration, the same budget guard, the same blind bookkeeping, and the
 * same files on disk that a real run produces.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

import type { LlmGateway, LlmRequest, LlmResponse } from "./core.ts";
import { parseArgs } from "./options.ts";
import { RUBRIC_CRITERIA, totalScore } from "./rubric.ts";
import { BudgetExceededError, budgetedGateway, runBenchmark, type BenchmarkDeps } from "./run.ts";

const workDir = mkdtempSync(resolve(tmpdir(), "aimcub-eval-moat-run-"));
afterAll(() => rmSync(workDir, { recursive: true, force: true }));

/** A plan whose milestone count encodes how much context the prompt carried. */
function fakePlan(milestones: number): unknown {
  return {
    goal_summary: "Mock plan",
    domain: "software",
    rationale: "Mock rationale.",
    nodes: Array.from({ length: milestones }, (_, index) => ({
      key: `m${index + 1}`,
      title: `Milestone ${index + 1}`,
      description: "Do the thing.",
      est_effort: "m",
      xp_reward: 10,
      acceptance_rule: {
        logic: "all",
        threshold: 1,
        completion_mode: "auto_then_confirm",
        clauses: [{
          evaluator: "commit_pattern",
          auto_verifiable: true,
          path_glob: "src/**",
          min_files: 1,
          message_pattern: `milestone ${index + 1}`,
          branch: null,
          workflow: null,
          conclusion: null,
        }],
      },
      decomposition_contract: {
        why: "It is needed.",
        definition_of_done: "It is done.",
        required_evidence: ["A commit."],
        likely_owner: index === 0 ? "human" : "agent",
        context_gaps: [],
        eval_signal: "Trusted evidence exists.",
      },
      routing_override: null,
    })),
    edges: Array.from({ length: Math.max(0, milestones - 1) }, (_, index) => ({
      from: `m${index + 1}`,
      to: `m${index + 2}`,
    })),
  };
}

interface MockGateway {
  gateway: LlmGateway;
  prompts: string[];
  tasks: string[];
}

/** The judge always favours whichever plan has more milestones — a stand-in for a real preference. */
function mockGateway(options: { judgeReturns?: unknown } = {}): MockGateway {
  const prompts: string[] = [];
  const tasks: string[] = [];
  const gateway: LlmGateway = {
    complete: async () => {
      throw new Error("complete() should not be used by the benchmark");
    },
    completeStructured: async <T,>(req: LlmRequest & { schema: unknown }): Promise<LlmResponse<T>> => {
      prompts.push(req.prompt);
      tasks.push(req.task);
      const usage = { model: "mock-model", inputTokens: 10, outputTokens: 20 };
      if (req.task === "decompose") {
        // A prompt carrying real context yields a bigger plan; the bare prompt says "(none yet)".
        const contexted = !req.prompt.includes("Known user context from previous aims:\n(none yet)");
        return { output: fakePlan(contexted ? 4 : 2) as T, usage };
      }
      if (options.judgeReturns !== undefined) return { output: options.judgeReturns as T, usage };
      const planALength = req.prompt.split("=== PLAN B ===")[0]?.split("\n").length ?? 0;
      const planBLength = req.prompt.split("=== PLAN B ===")[1]?.split("\n").length ?? 0;
      const score = (winner: boolean) =>
        RUBRIC_CRITERIA.map((criterion) => ({ criterion: criterion.id, score: winner ? 4 : 2, justification: "mock" }));
      return {
        output: {
          plans: [
            { label: "A", criteria: score(planALength >= planBLength) },
            { label: "B", criteria: score(planBLength > planALength) },
          ],
          notes: "mock note",
        } as T,
        usage,
      };
    },
  };
  return { gateway, prompts, tasks };
}

function deps(gateway: LlmGateway): BenchmarkDeps {
  return {
    createGateway: () => gateway,
    provider: "mock",
    model: "mock-model",
    now: () => "2026-07-22T00:00:00.000Z",
    log: () => {},
  };
}

describe("budgetedGateway", () => {
  it("refuses to spend past the ceiling", async () => {
    const inner = mockGateway().gateway;
    const budgeted = budgetedGateway(inner, 2);
    const call = () => budgeted.gateway.completeStructured({ task: "decompose", prompt: "x", schema: {} });
    await call();
    await call();
    await expect(call()).rejects.toBeInstanceOf(BudgetExceededError);
    expect(budgeted.calls()).toBe(2);
  });
});

describe("runBenchmark", () => {
  it("never touches a provider in dry-run mode", async () => {
    const mock = mockGateway();
    const createGateway = vi.fn(() => mock.gateway);
    const outDir = join(workDir, "dry");
    const { options } = parseArgs(["--out", outDir, "--aims", "receipt-scanning"]);

    const result = await runBenchmark(options, outDir, { ...deps(mock.gateway), createGateway });

    expect(createGateway).not.toHaveBeenCalled();
    expect(result.run.providerCalls).toBe(0);
    expect(result.run.mode).toBe("dry-run");
    expect(result.run.diffs).toHaveLength(1);
    expect(result.run.diffs[0]!.nonEmpty).toBe(true);
    expect(existsSync(join(outDir, "context", "receipt-scanning-contexted.txt"))).toBe(true);
    expect(readFileSync(result.reportPath, "utf8")).toContain("No plans were generated");
  });

  it("runs the live path end to end and maps blind labels back to conditions", async () => {
    const mock = mockGateway();
    const outDir = join(workDir, "live");
    const { options } = parseArgs(["--out", outDir, "--aims", "pottery-course", "--live"]);

    const result = await runBenchmark(options, outDir, deps(mock.gateway));

    // 2 decompositions + 1 judging call, exactly as estimated.
    expect(result.run.providerCalls).toBe(3);
    expect(mock.tasks).toEqual(["decompose", "decompose", "classify"]);
    expect(result.run.cells).toHaveLength(2);
    expect(result.run.cells.every((cell) => cell.ok)).toBe(true);
    expect(result.run.warnings).toEqual([]);

    // The judge saw plans labelled A/B; the harness un-blinds them by the persisted map.
    const judgement = result.run.judgements[0]!;
    expect(judgement.aimId).toBe("pottery-course");
    const labels = JSON.parse(readFileSync(join(outDir, "judge", "pottery-course-rep1-labels.json"), "utf8")) as {
      labelMap: Record<string, string>;
    };
    expect(labels.labelMap).toEqual(judgement.labelMap);
    // The mock judge prefers the longer plan, which is always the contexted one here.
    expect(totalScore(judgement.byCondition.contexted)).toBeGreaterThan(totalScore(judgement.byCondition.bare));

    // The judge prompt must not name the conditions, and both plans must be in it.
    const prompt = mock.prompts[2] ?? "";
    expect(prompt).toContain("=== PLAN A ===");
    expect(prompt).toContain("=== PLAN B ===");
    expect(prompt.toLowerCase()).not.toContain("contexted");

    for (const condition of ["bare", "contexted"]) {
      expect(existsSync(join(outDir, "plans", `pottery-course-${condition}-rep1.json`))).toBe(true);
    }
    expect(readFileSync(result.reportPath, "utf8")).toContain("Blind judgement");
    expect(existsSync(join(outDir, "results.json"))).toBe(true);
  });

  it("records a rejected judge response as a warning instead of a score", async () => {
    const mock = mockGateway({ judgeReturns: { plans: [{ label: "A", criteria: [] }], notes: "" } });
    const outDir = join(workDir, "bad-judge");
    const { options } = parseArgs(["--out", outDir, "--aims", "impact-report", "--live"]);

    const result = await runBenchmark(options, outDir, deps(mock.gateway));

    expect(result.run.judgements).toHaveLength(0);
    expect(result.run.warnings.join(" ")).toContain("judge output rejected");
    expect(readFileSync(result.reportPath, "utf8")).toContain("no claim can be made");
  });

  it("stops at the budget instead of quietly overspending", async () => {
    const mock = mockGateway();
    const outDir = join(workDir, "budget");
    const { options } = parseArgs(["--out", outDir, "--aims", "receipt-scanning", "--live", "--max-calls", "1"]);

    await expect(runBenchmark(options, outDir, deps(mock.gateway))).rejects.toBeInstanceOf(BudgetExceededError);
  });
});
