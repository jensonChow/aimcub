import { describe, expect, it } from "vitest";

import { BENCHMARK_AIMS, groundTruthContext } from "./aims.ts";
import type { DecompositionOutput } from "./core.ts";
import {
  RUBRIC_CRITERIA,
  RUBRIC_MAX_TOTAL,
  buildJudgePrompt,
  parseJudgeOutput,
  renderPlanForJudging,
  totalScore,
} from "./rubric.ts";

const plan: DecompositionOutput = {
  goal_summary: "Ship the thing",
  domain: "software",
  rationale: "Because it needs shipping.",
  nodes: [
    {
      key: "m1",
      title: "Build the importer",
      description: "Parse the input and write rows.",
      est_effort: "m",
      xp_reward: 20,
      acceptance_rule: {
        logic: "all",
        threshold: 1,
        completion_mode: "auto_then_confirm",
        clauses: [{ evaluator: "commit_pattern", auto_verifiable: true, match: { message_pattern: "importer", path_glob: "src/**", min_files: 1 } }],
      },
      decomposition_contract: {
        why: "The importer is the deliverable.",
        definition_of_done: "A sample file imports without manual repair.",
        required_evidence: ["Commit touching the importer with tests."],
        likely_owner: "agent",
        context_gaps: [{ category: "project_fact", question: "Which formats must be supported?", reason: "" }],
        eval_signal: "Done means a real file imports offline.",
      },
      routing_override: null,
    },
  ],
  edges: [],
};

function verdict(scoreA: number, scoreB: number): unknown {
  const criteria = (score: number) =>
    RUBRIC_CRITERIA.map((criterion) => ({ criterion: criterion.id, score, justification: "because" }));
  return {
    plans: [
      { label: "A", criteria: criteria(scoreA) },
      { label: "B", criteria: criteria(scoreB) },
    ],
    notes: "A names its evidence; B does not.",
  };
}

describe("rubric", () => {
  it("is a fixed five-criterion, 25-point instrument", () => {
    expect(RUBRIC_CRITERIA).toHaveLength(5);
    expect(RUBRIC_MAX_TOTAL).toBe(25);
    expect(new Set(RUBRIC_CRITERIA.map((criterion) => criterion.id)).size).toBe(5);
    for (const criterion of RUBRIC_CRITERIA) {
      expect(criterion.anchors[1].length).toBeGreaterThan(20);
      expect(criterion.anchors[3].length).toBeGreaterThan(20);
      expect(criterion.anchors[5].length).toBeGreaterThan(20);
    }
  });

  it("renders a plan with the fields the rubric scores", () => {
    const rendered = renderPlanForJudging(plan);
    expect(rendered).toContain("Build the importer");
    expect(rendered).toContain("owner: agent");
    expect(rendered).toContain("done when: A sample file imports without manual repair.");
    expect(rendered).toContain("commit_pattern");
    expect(rendered).toContain("open questions: [project_fact] Which formats must be supported?");
  });

  it("shows the judge the ground truth but never the condition", () => {
    const aim = BENCHMARK_AIMS[0]!;
    const prompt = buildJudgePrompt({
      aim,
      groundTruth: groundTruthContext(aim),
      planA: renderPlanForJudging(plan),
      planB: renderPlanForJudging(plan),
    });
    expect(prompt).toContain("PLAN A");
    expect(prompt).toContain("PLAN B");
    expect(prompt).toContain(aim.title);
    expect(prompt.toLowerCase()).not.toContain("contexted");
    expect(prompt.toLowerCase()).not.toContain("bare store");
    expect(prompt).toContain(groundTruthContext(aim)[0]!.content);
  });

  it("accepts a well-formed verdict", () => {
    const parsed = parseJudgeOutput(verdict(4, 2));
    expect(parsed.errors).toEqual([]);
    expect(parsed.verdict?.scores).toHaveLength(2);
    expect(totalScore(parsed.verdict!.scores[0]!.criteria)).toBe(20);
    expect(parsed.verdict?.notes).toContain("A names its evidence");
  });

  it("rejects malformed verdicts instead of scoring them as zero", () => {
    expect(parseJudgeOutput("nope").verdict).toBeNull();
    expect(parseJudgeOutput({ plans: [] }).verdict).toBeNull();

    const outOfRange = verdict(4, 2) as { plans: Array<{ criteria: Array<{ score: number }> }> };
    outOfRange.plans[0]!.criteria[0]!.score = 9;
    const parsedRange = parseJudgeOutput(outOfRange);
    expect(parsedRange.verdict).toBeNull();
    expect(parsedRange.errors.join(" ")).toContain("out-of-range");

    const missing = verdict(4, 2) as { plans: Array<{ criteria: unknown[] }> };
    missing.plans[1]!.criteria = missing.plans[1]!.criteria.slice(0, 2);
    const parsedMissing = parseJudgeOutput(missing);
    expect(parsedMissing.verdict).toBeNull();
    expect(parsedMissing.errors.join(" ")).toContain("missing criteria");

    const duplicate = verdict(4, 2) as { plans: Array<{ label: string }> };
    duplicate.plans[1]!.label = "A";
    expect(parseJudgeOutput(duplicate).verdict).toBeNull();
  });
});
