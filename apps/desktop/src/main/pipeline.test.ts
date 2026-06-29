import { describe, expect, it } from "vitest";

import { localDecompose, localClarify, buildRefinedDescription, type ClarifyAnswer } from "@core/llm";

import { materialize } from "./materialize";

/**
 * Exercises the desktop's OFFLINE planning pipeline end to end (no Electron, no API key):
 * draft → clarify → fold answers → materialize. This is the exact logic the app runs when
 * no ANTHROPIC_API_KEY is present.
 */
describe("desktop offline pipeline: draft → clarify → refine → materialize", () => {
  const aim = { title: "Build a CLI todo app with tests + CI", description: "A small command-line todo app." };

  it("drafts a non-empty plan", () => {
    const draft = localDecompose(aim);
    expect(draft.nodes.length).toBeGreaterThan(0);
    expect(draft.edges.length).toBe(draft.nodes.length - 1); // linear chain
  });

  it("clarifies into real forks (>=2 options each) + disclosed assumptions", () => {
    const draft = localDecompose(aim);
    const clar = localClarify({ ...aim, draft });
    expect(clar.questions.length).toBeGreaterThan(0);
    expect(clar.questions.every((q) => q.options.length >= 2)).toBe(true);
    expect(clar.assumptions.length).toBeGreaterThan(0);
  });

  it("folds an answer into the refined description", () => {
    const draft = localDecompose(aim);
    const clar = localClarify({ ...aim, draft });
    const q0 = clar.questions[0]!;
    const answers: ClarifyAnswer[] = [
      { question_id: q0.id, selected_label: q0.options[0]!.label, other_text: null },
    ];
    const refined = buildRefinedDescription(aim.description, clar.questions, answers);
    expect(refined).toContain("Clarifications from the user");
    expect(refined).toContain(q0.options[0]!.label);
  });

  it("materializes the plan into linked milestones (validatePlan gate passes)", () => {
    const draft = localDecompose(aim);
    const milestones = materialize(draft, "goal-1", "owner-1");
    expect(milestones).toHaveLength(draft.nodes.length);
    expect(milestones[0]!.goal_id).toBe("goal-1");
    expect(milestones[0]!.owner_id).toBe("owner-1");
    // linear chain: each milestone after the first depends on the previous.
    expect(milestones[0]!.depends_on_id).toBeNull();
    expect(milestones[1]!.depends_on_id).toBe(milestones[0]!.id);
    // acceptance rules survive into the materialized rows.
    expect(milestones[0]!.acceptance_rule.clauses.length).toBeGreaterThan(0);
  });
});
