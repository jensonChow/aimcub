import { describe, expect, it } from "vitest";

import { reviewAimIntake } from "@core/domain";
import type { LlmGateway, LlmRequest, LlmResponse, LlmUsage } from "./index";
import { generateAimIntakeQuestions } from "./intake";

const USAGE: LlmUsage = { model: "mock", inputTokens: 1, outputTokens: 1 };

function gateway(output: unknown): LlmGateway & { calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  return {
    calls,
    async complete(): Promise<LlmResponse<string>> {
      throw new Error("not used");
    },
    async completeStructured<T>(req: LlmRequest & { schema: unknown }): Promise<LlmResponse<T>> {
      calls.push(req);
      return { output: output as T, usage: USAGE };
    },
  };
}

function tarotIntake(): AimIntakeReport {
  return reviewAimIntake({
    title: "Develop a tarot app",
    memories: [],
    selectedContext: [],
  });
}

describe("generateAimIntakeQuestions", () => {
  it("allows the model to confirm that no high-impact intake question remains", async () => {
    const intake = tarotIntake();
    const result = await generateAimIntakeQuestions(gateway({ questions: [] }), {
      title: "Develop a tarot app",
      intake,
    });

    expect(result.validation.ok).toBe(true);
    expect(result.report).toMatchObject({
      readiness: "ready",
      score: 100,
      questions: [],
      loop: { shouldContinue: false, nextStepId: null },
    });
    expect(result.report?.nextActions[0]).toContain("Proceed with decomposition");
  });

  it("uses the model to rewrite internal gaps into grounded user-facing questions", async () => {
    const intake = tarotIntake();
    const firstGap = intake.questions[0]!;
    const gw = gateway({
      questions: [
        {
          source_question_id: firstGap.id,
          question: "Before planning the iOS tarot app, do you already have the Apple Developer access needed for App Store distribution?",
          why_high_impact: "This decides whether the plan needs an access/setup milestone before implementation.",
          selection_mode: "single",
          selection_mode_reason: "mutually_exclusive",
          options: [
            { label: "Already available", tradeoff: "Planning can move directly to product and build milestones." },
            { label: "Need to set it up", tradeoff: "The plan must add an account/access prerequisite first." },
          ],
        },
      ],
    });

    const result = await generateAimIntakeQuestions(gw, {
      title: "Develop a tarot app",
      intake,
      memories: [
        {
          id: "memory-1",
          content: "Preference: The user prefers iOS first.",
          kind: "semantic",
          category: "preference",
          source: "memory.search",
          confidence: 0.9,
          goalId: null,
          goal_id: null,
        },
      ],
      researchRequired: true,
      research: null,
      toolSignals: [{ toolName: "memory.search", summary: "Selected 1 planning memory." }],
    });

    expect(result.validation.ok).toBe(true);
    expect(gw.calls).toHaveLength(1);
    expect(gw.calls[0]!.task).toBe("classify");
    expect(gw.calls[0]!.prompt).toContain("Internal gap signals to rewrite");
    expect(gw.calls[0]!.prompt).toContain("Research was required");
    expect(gw.calls[0]!.prompt).toContain("Selected 1 planning memory");
    expect(gw.calls[0]!.system).toContain("Test every option pair");
    expect(result.report?.questions).toHaveLength(1);
    expect(result.report?.questions[0]).toMatchObject({
      id: firstGap.id,
      prompt: expect.stringContaining("Apple Developer access"),
      whyHighImpact: expect.stringContaining("access/setup milestone"),
      selectionMode: "single",
      options: expect.arrayContaining([
        expect.objectContaining({ label: "Already available" }),
      ]),
    });
    expect(result.report?.questions[0]!.prompt).not.toMatch(/^Ask\b/i);
  });

  it("rejects model output that copies template-style Ask prompts", async () => {
    const intake = tarotIntake();
    const gw = gateway({
      questions: [
        {
          source_question_id: intake.questions[0]!.id,
          question: "Ask for the target user/scenario, desired outcome, distribution surface, current state, and known environment facts before decomposing.",
          why_high_impact: "Generic.",
          selection_mode: "multiple",
          selection_mode_reason: "unclear_defaults_multiple",
          options: [
            { label: "A", tradeoff: "A" },
            { label: "B", tradeoff: "B" },
          ],
        },
      ],
    });

    const result = await generateAimIntakeQuestions(gw, {
      title: "Develop a tarot app",
      intake,
    });

    expect(result.validation.ok).toBe(false);
    expect(result.report).toBeNull();
    expect(result.validation.errors[0]).toContain("valid grounded questions");
  });

  it("rejects a generated question whose option labels collapse to duplicates", async () => {
    const intake = tarotIntake();
    const gw = gateway({
      questions: [{
        source_question_id: intake.questions[0]!.id,
        question: "Which context sources apply?",
        why_high_impact: "Changes the plan.",
        selection_mode: "multiple",
        selection_mode_reason: "compatible_options",
        options: [
          { label: "Local files", tradeoff: "Grounds the plan." },
          { label: " local files ", tradeoff: "Duplicates the same source." },
        ],
      }],
    });

    const result = await generateAimIntakeQuestions(gw, { title: "Develop a tarot app", intake });

    expect(result.validation.ok).toBe(false);
    expect(result.report).toBeNull();
  });

  it("corrects an explicit single mode when compatible routes can coexist", async () => {
    const intake = tarotIntake();
    const source = intake.questions[0]!;
    const gw = gateway({
      questions: [{
        source_question_id: source.id,
        question: "\u4f60\u7684\u2018\u540d\u5782\u9752\u53f2\u2019\u53ef\u4ee5\u901a\u8fc7\u54ea\u4e9b\u8def\u5f84\u5171\u540c\u5b9e\u73b0\uff1f",
        why_high_impact: "\u4e0d\u540c\u8def\u5f84\u4f1a\u6539\u53d8\u957f\u671f\u8ba1\u5212\u3001\u8d44\u6e90\u4e0e\u9a8c\u6536\u65b9\u5f0f\u3002",
        selection_mode: "single",
        selection_mode_reason: "mutually_exclusive",
        options: [
          { label: "\u6587\u5b66\u521b\u4f5c", tradeoff: "\u9700\u8981\u957f\u671f\u5199\u4f5c\u4e0e\u51fa\u7248\u3002" },
          { label: "\u79d1\u5b66\u7a81\u7834", tradeoff: "\u9700\u8981\u4e13\u4e1a\u7814\u7a76\u4e0e\u540c\u884c\u8ba4\u53ef\u3002" },
          { label: "\u521b\u4e1a\u521b\u65b0", tradeoff: "\u9700\u8981\u4ea7\u54c1\u3001\u56e2\u961f\u4e0e\u5e02\u573a\u9a8c\u8bc1\u3002" },
          { label: "\u793e\u4f1a\u5f71\u54cd", tradeoff: "\u9700\u8981\u7ec4\u7ec7\u884c\u52a8\u4e0e\u516c\u5171\u6210\u679c\u3002" },
        ],
      }],
    });

    const result = await generateAimIntakeQuestions(gw, {
      title: "\u6211\u60f3\u8981\u540d\u5782\u9752\u53f2",
      intake,
    });

    expect(result.validation.ok).toBe(true);
    expect(result.report?.questions[0]).toMatchObject({
      selectionMode: "multiple",
      selectionModeReason: "compatible_options",
    });
  });

  it("allows one broad internal gap to become several atomic questions", async () => {
    const intake = tarotIntake();
    const source = intake.questions[0]!;
    const gw = gateway({
      questions: [
        {
          source_question_id: source.id,
          question: "Who is the first real user?",
          why_high_impact: "Changes the audience and product boundaries.",
          selection_mode: "single",
          selection_mode_reason: "primary_choice_requested",
          options: [
            { label: "Individual readers", tradeoff: "Optimizes for personal use." },
            { label: "Professional teams", tradeoff: "Requires collaboration and controls." },
          ],
        },
        {
          source_question_id: source.id,
          question: "Which launch channels should be included?",
          why_high_impact: "Changes distribution work and prerequisites.",
          selection_mode: "multiple",
          selection_mode_reason: "compatible_options",
          options: [
            { label: "App Store", tradeoff: "Requires store review." },
            { label: "Direct web", tradeoff: "Requires hosting and web onboarding." },
          ],
        },
      ],
    });

    const result = await generateAimIntakeQuestions(gw, {
      title: "Develop a tarot app",
      intake,
    });

    expect(result.validation.ok).toBe(true);
    expect(result.report?.questions.map((question) => question.id)).toEqual([source.id, `${source.id}_2`]);
    expect(result.report?.questions.map((question) => question.selectionMode)).toEqual(["single", "multiple"]);
    expect(result.report?.nextActions.join(" ")).toContain("Answer 2 high-priority intake questions");
    expect(result.report?.loop).toEqual(intake.loop);
  });

  it("keeps derived question ids unique when another source already owns the suffix", async () => {
    const base = tarotIntake();
    const first = { ...base.questions[0]!, id: "source", prompt: "Internal gap one." };
    const colliding = { ...first, id: "source_2", prompt: "Internal gap two." };
    const intake = {
      ...base,
      questions: [first, colliding],
    };
    const gw = gateway({
      questions: [
        {
          source_question_id: first.id,
          question: "Who is the first audience?",
          why_high_impact: "Changes scope.",
          selection_mode: "single",
          selection_mode_reason: "primary_choice_requested",
          options: [
            { label: "Individuals", tradeoff: "Personal workflow." },
            { label: "Teams", tradeoff: "Collaborative workflow." },
          ],
        },
        {
          source_question_id: first.id,
          question: "Which channels apply?",
          why_high_impact: "Changes distribution.",
          selection_mode: "multiple",
          selection_mode_reason: "compatible_options",
          options: [
            { label: "Web", tradeoff: "Browser distribution." },
            { label: "Desktop", tradeoff: "Native distribution." },
          ],
        },
        {
          source_question_id: colliding.id,
          question: "Which evidence applies?",
          why_high_impact: "Changes verification.",
          selection_mode: "multiple",
          selection_mode_reason: "compatible_options",
          options: [
            { label: "Tests", tradeoff: "Automated evidence." },
            { label: "Review", tradeoff: "Human evidence." },
          ],
        },
      ],
    });

    const result = await generateAimIntakeQuestions(gw, { title: "Build a product", intake });

    const ids = result.report?.questions.map((question) => question.id) ?? [];
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(["source", "source_2_next", "source_2"]);
  });

  it("enforces a finite integer maxQuestions limit outside the model schema", async () => {
    const intake = tarotIntake();
    const source = intake.questions[0]!;
    const row = (question: string) => ({
      source_question_id: source.id,
      question,
      why_high_impact: "Changes the plan.",
      selection_mode: "multiple",
      selection_mode_reason: "compatible_options",
      options: [
        { label: "Local files", tradeoff: "Grounds the plan." },
        { label: "Web research", tradeoff: "Adds current facts." },
      ],
    });
    const gw = gateway({ questions: [row("Which sources apply?"), row("Which evidence applies?")] });

    const result = await generateAimIntakeQuestions(gw, {
      title: "Develop a tarot app",
      intake,
      maxQuestions: 1.9,
    });

    expect(result.report?.questions).toHaveLength(1);
    expect(gw.calls[0]!.prompt).toContain("Return at most 1 atomic questions");

    const nanGateway = gateway({ questions: [row("Which sources apply?"), row("Which evidence applies?")] });
    const nanResult = await generateAimIntakeQuestions(nanGateway, {
      title: "Develop a tarot app",
      intake,
      maxQuestions: Number.NaN,
    });
    expect(nanResult.report?.questions).toHaveLength(2);
    expect(nanGateway.calls[0]!.prompt).toContain("Return at most 6 atomic questions");
  });

  it("preserves internal gaps and cardinality instructions when context sections are large", async () => {
    const intake = tarotIntake();
    const source = intake.questions[0]!;
    const gw = gateway({
      questions: [{
        source_question_id: source.id,
        question: "Which constraints apply?",
        why_high_impact: "Changes the plan.",
        selection_mode: "multiple",
        selection_mode_reason: "compatible_options",
        options: [
          { label: "Budget", tradeoff: "Limits scope." },
          { label: "Deadline", tradeoff: "Changes sequencing." },
        ],
      }],
    });

    await generateAimIntakeQuestions(gw, {
      title: "Develop a tarot app ".repeat(500),
      description: "Long pasted aim context. ".repeat(500),
      intake,
      memories: [{
        id: "large-memory",
        content: "context ".repeat(4_000),
        kind: "semantic",
        category: "project_fact",
        source: "memory.search",
        confidence: 0.9,
        goalId: null,
        goal_id: null,
      }],
    });

    expect(gw.calls[0]!.prompt).toContain("Internal gap signals to rewrite");
    expect(gw.calls[0]!.prompt).toContain(source.id);
    expect(gw.calls[0]!.prompt).toContain("A single internal gap may produce multiple questions");
    expect(gw.calls[0]!.prompt.length).toBeLessThan(15_000);
  });
});
