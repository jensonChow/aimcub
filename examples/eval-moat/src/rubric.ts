/**
 * The rubric and the blind judge prompt.
 *
 * The rubric is fixed and committed: changing it changes the instrument, so it should move in its
 * own reviewable commit, never mid-experiment. Five criteria, 1-5, with anchors at 1/3/5 so two
 * humans re-scoring the persisted plans by hand land in roughly the same place.
 *
 * The judge is blind to CONDITION but not to TRUTH: it sees the persona's real constraints, the
 * same set for both plans, because "did this plan fit the user it was for" is the claim under test
 * and cannot be judged without knowing the user. The instructions explicitly protect the bare
 * condition — asking a good question is not a defect, and neither is arriving without history.
 */
import type { DecompositionOutput } from "./core.ts";
import type { BenchmarkAim, JudgeVerdict } from "./types.ts";

export interface RubricCriterion {
  id: string;
  title: string;
  question: string;
  anchors: { 1: string; 3: string; 5: string };
}

export const RUBRIC_VERSION = "1.0.0";

export const RUBRIC_CRITERIA: readonly RubricCriterion[] = [
  {
    id: "acceptance_specificity",
    title: "Acceptance specificity",
    question: "Could someone else tell, from the acceptance rule and required evidence alone, whether each milestone is done?",
    anchors: {
      1: "Acceptance is restated intent (\"the feature works\"); nothing names an artifact, event, or check.",
      3: "Some milestones name concrete proof; others fall back to generic confirmation.",
      5: "Every milestone names proof a third party could check, and the proof matches the kind of work.",
    },
  },
  {
    id: "persona_fit",
    title: "Fit to this person's reality",
    question: "Does the plan respect the known constraints, capabilities, and standards of this user, and avoid steps they cannot or will not take?",
    anchors: {
      1: "The plan contradicts a known constraint or assumes capability, budget, or tooling this user does not have.",
      3: "The plan is compatible with the user's reality but generic — it neither violates nor uses what is known about them.",
      5: "The plan is visibly shaped by this user's constraints and standards; a different user would get a different plan.",
    },
  },
  {
    id: "filler_absence",
    title: "Absence of filler",
    question: "Is any milestone generic scaffolding that would appear unchanged in a plan for a completely different aim?",
    anchors: {
      1: "Half or more of the plan is interchangeable boilerplate (\"research the topic\", \"gather requirements\", \"iterate\").",
      3: "One or two milestones are padding; the rest carry real content.",
      5: "Every milestone is specific to this aim; removing any one would leave a real gap.",
    },
  },
  {
    id: "routing_sanity",
    title: "Routing sanity",
    question: "Is the human/agent split right — human only where authority, judgment, or the physical world demands it, and agent work handed off with enough to act on?",
    anchors: {
      1: "Routing is arbitrary: delegable digital work sits with the human, or work needing authority or physical presence is given to an agent.",
      3: "Routing is mostly reasonable but some assignments are unexplained or mismatched with the evidence they require.",
      5: "Each owner is the only sensible one, and the handoff points between human and agent are explicit.",
    },
  },
  {
    id: "prerequisite_realism",
    title: "Prerequisite realism",
    question: "Does the plan surface the real-world prerequisites and lead times this aim depends on, and order the work accordingly?",
    anchors: {
      1: "The plan jumps to execution and ignores access, approvals, materials, or lead times the aim clearly requires.",
      3: "Some prerequisites appear, but the ordering treats slow external dependencies as if they were instant.",
      5: "Prerequisites with real lead times are surfaced early and the dependency order reflects what actually blocks what.",
    },
  },
];

export const RUBRIC_MAX_PER_CRITERION = 5;
export const RUBRIC_MAX_TOTAL = RUBRIC_CRITERIA.length * RUBRIC_MAX_PER_CRITERION;

/** Render a plan for the judge in one shape, so formatting cannot hint at its origin. */
export function renderPlanForJudging(plan: DecompositionOutput): string {
  const lines = [`Summary: ${plan.goal_summary || "(none)"}`, `Rationale: ${plan.rationale || "(none)"}`, ""];
  for (const [index, node] of plan.nodes.entries()) {
    const contract = node.decomposition_contract;
    const clauses = node.acceptance_rule.clauses
      .map((clause) => {
        const match = Object.entries(clause.match ?? {})
          .map(([key, value]) => `${key}=${String(value)}`)
          .join(", ");
        return match ? `${clause.evaluator} (${match})` : clause.evaluator;
      })
      .join("; ");
    lines.push(`${index + 1}. ${node.title} [${node.key}] · effort ${node.est_effort}`);
    lines.push(`   what: ${node.description || "(no description)"}`);
    lines.push(`   owner: ${contract?.likely_owner ?? "(unset)"}`);
    lines.push(`   done when: ${contract?.definition_of_done ?? "(unset)"}`);
    lines.push(`   evidence: ${contract?.required_evidence?.join(" | ") || "(none named)"}`);
    lines.push(`   eval signal: ${contract?.eval_signal ?? "(unset)"}`);
    const gaps = (contract?.context_gaps ?? []).map((gap) => `[${gap.category}] ${gap.question}`);
    lines.push(`   open questions: ${gaps.join(" | ") || "(none)"}`);
    lines.push(`   acceptance: ${node.acceptance_rule.completion_mode} · ${clauses}`);
  }
  lines.push("");
  lines.push(`Order: ${plan.edges.length > 0 ? plan.edges.map((edge) => `${edge.from} -> ${edge.to}`).join(", ") : "(no dependencies declared)"}`);
  return lines.join("\n");
}

function renderRubric(): string {
  return RUBRIC_CRITERIA.map((criterion) => [
    `- ${criterion.id} — ${criterion.title}`,
    `  ${criterion.question}`,
    `  1 = ${criterion.anchors[1]}`,
    `  3 = ${criterion.anchors[3]}`,
    `  5 = ${criterion.anchors[5]}`,
  ].join("\n")).join("\n");
}

export const JUDGE_SYSTEM_PROMPT = [
  "You are scoring two candidate plans for the same goal against a fixed rubric.",
  "",
  "You do not know where either plan came from, and you must not speculate. Judge only what is on",
  "the page. Score each plan independently against the rubric anchors, not against each other:",
  "identical scores are a correct answer when the plans are equally good, and one plan may win some",
  "criteria while losing others.",
  "",
  "Fairness rules that override any instinct to reward length or confidence:",
  "- A plan that asks a good open question is NOT penalized for asking. Missing information is a",
  "  legitimate state; inventing an answer is not.",
  "- More milestones is not better. Detail that does not change what someone would do is filler.",
  "- Confident wording is not evidence. A claim of verification is not verification.",
  "- Contradicting something stated as true about the user is the most serious defect available.",
].join("\n");

export function buildJudgePrompt(input: {
  aim: BenchmarkAim;
  groundTruth: ReadonlyArray<{ content: string; category: string }>;
  planA: string;
  planB: string;
}): string {
  return [
    `Goal title: ${input.aim.title}`,
    `Goal description: ${input.aim.description}`,
    `Who this is for: ${input.aim.persona}`,
    "",
    "What is true about this user (established facts — treat as ground truth for BOTH plans):",
    ...input.groundTruth.map((row) => `- [${row.category}] ${row.content}`),
    "",
    "Rubric (score each criterion 1-5 using the anchors):",
    renderRubric(),
    "",
    "=== PLAN A ===",
    input.planA,
    "",
    "=== PLAN B ===",
    input.planB,
    "",
    "Score PLAN A and PLAN B on every criterion. Give one short justification per criterion that",
    "quotes or names the part of the plan you are scoring. Then write one note on the clearest",
    "difference between the plans, or state that there is none.",
  ].join("\n");
}

/** Structured-output schema: every property required, no optionals (the repo's schema convention). */
export const judgeJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    plans: {
      type: "array",
      minItems: 2,
      maxItems: 2,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          label: { type: "string", enum: ["A", "B"] },
          criteria: {
            type: "array",
            minItems: RUBRIC_CRITERIA.length,
            maxItems: RUBRIC_CRITERIA.length,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                criterion: { type: "string", enum: RUBRIC_CRITERIA.map((criterion) => criterion.id) },
                score: { type: "integer", minimum: 1, maximum: 5 },
                justification: { type: "string" },
              },
              required: ["criterion", "score", "justification"],
            },
          },
        },
        required: ["label", "criteria"],
      },
    },
    notes: { type: "string" },
  },
  required: ["plans", "notes"],
} as const;

export interface JudgeParseResult {
  verdict: JudgeVerdict | null;
  errors: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate a judge response by hand. The example carries no dependencies of its own, and a bad
 * judge response must be reported as a failed cell rather than silently scored as a zero.
 */
export function parseJudgeOutput(raw: unknown): JudgeParseResult {
  const errors: string[] = [];
  if (!isRecord(raw)) return { verdict: null, errors: ["judge output was not an object"] };
  const plans = raw.plans;
  if (!Array.isArray(plans) || plans.length !== 2) {
    return { verdict: null, errors: ["judge output must contain exactly two plans"] };
  }

  const criterionIds = new Set(RUBRIC_CRITERIA.map((criterion) => criterion.id));
  const scores: JudgeVerdict["scores"] = [];
  const seenLabels = new Set<string>();

  for (const entry of plans) {
    if (!isRecord(entry)) {
      errors.push("plan entry was not an object");
      continue;
    }
    const label = entry.label;
    if (label !== "A" && label !== "B") {
      errors.push(`plan label must be A or B, got ${JSON.stringify(label)}`);
      continue;
    }
    if (seenLabels.has(label)) {
      errors.push(`duplicate plan label ${label}`);
      continue;
    }
    seenLabels.add(label);

    const criteria = entry.criteria;
    if (!Array.isArray(criteria)) {
      errors.push(`plan ${label} has no criteria array`);
      continue;
    }
    const parsed = criteria.flatMap((row) => {
      if (!isRecord(row)) return [];
      const criterion = typeof row.criterion === "string" ? row.criterion : "";
      const score = typeof row.score === "number" ? row.score : Number.NaN;
      if (!criterionIds.has(criterion)) {
        errors.push(`plan ${label} scored unknown criterion ${JSON.stringify(row.criterion)}`);
        return [];
      }
      if (!Number.isFinite(score) || score < 1 || score > RUBRIC_MAX_PER_CRITERION) {
        errors.push(`plan ${label} criterion ${criterion} has an out-of-range score`);
        return [];
      }
      return [{
        criterion,
        score: Math.round(score),
        justification: typeof row.justification === "string" ? row.justification : "",
      }];
    });

    const missing = [...criterionIds].filter((id) => !parsed.some((row) => row.criterion === id));
    if (missing.length > 0) errors.push(`plan ${label} is missing criteria: ${missing.join(", ")}`);
    scores.push({ label, criteria: parsed });
  }

  if (seenLabels.size !== 2 || errors.length > 0) return { verdict: null, errors };
  return { verdict: { scores, notes: typeof raw.notes === "string" ? raw.notes : "" }, errors };
}

export function totalScore(criteria: ReadonlyArray<{ score: number }>): number {
  return criteria.reduce((total, row) => total + row.score, 0);
}
