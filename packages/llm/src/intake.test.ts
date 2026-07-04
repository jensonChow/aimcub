import { describe, expect, it } from "vitest";

import { reviewAimIntake, type AimIntakeReport } from "@core/domain";
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
});
