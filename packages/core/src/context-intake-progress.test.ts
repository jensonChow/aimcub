import { describe, expect, it } from "vitest";

import { reviewAimIntake } from "./aim-intake";
import { reviewContextIntakeProgress } from "./context-intake-progress";

describe("reviewContextIntakeProgress", () => {
  it("marks local workspace intake satisfied from first-party tool observations", () => {
    const intake = reviewAimIntake({
      title: "Improve the current desktop app using this local repo",
      description: "Use the existing codebase and tests.",
      selectedContext: [],
      memories: [],
    });
    const localStep = intake.loop.steps.find((step) => step.channel === "local_workspace");
    expect(localStep).toBeTruthy();

    const progress = reviewContextIntakeProgress({
      loop: intake.loop,
      signals: [
        {
          source: "tool_observation",
          channel: "local_workspace",
          toolName: "local.scan_workspace",
          scope: "aim",
          category: "project_fact",
          summary: "Scanned the selected workspace.",
        },
      ],
    });

    expect(progress.steps.find((step) => step.stepId === localStep!.id)).toMatchObject({
      status: "satisfied",
      satisfiedOutputs: ["aim_context"],
      remainingOutputs: [],
    });
  });

  it("keeps questionnaire intake pending until answers become captured context", () => {
    const intake = reviewAimIntake({
      title: "Plan",
      description: "",
      selectedContext: [],
      memories: [],
    });
    const questionnaire = intake.loop.steps.find((step) => step.channel === "questionnaire");
    expect(questionnaire).toBeTruthy();

    const answeredOnly = reviewContextIntakeProgress({
      loop: intake.loop,
      signals: [
        {
          source: "user_answer",
          channel: "questionnaire",
          scope: "aim",
          category: "project_fact",
          questionId: "intake_1",
          summary: "The user answered the project fact question.",
        },
      ],
    });

    expect(answeredOnly.steps.find((step) => step.stepId === questionnaire!.id)).toMatchObject({
      status: "pending",
      satisfiedOutputs: ["aim_context", "clarifying_answer"],
      remainingOutputs: ["durable_memory_candidate"],
    });

    const captured = reviewContextIntakeProgress({
      loop: intake.loop,
      signals: [
        {
          source: "user_answer",
          channel: "questionnaire",
          scope: "aim",
          category: "project_fact",
          questionId: "intake_1",
        },
        {
          source: "memory_candidate",
          channel: "questionnaire",
          scope: "global",
          category: "eval_signal",
          questionId: "intake_2",
        },
      ],
    });

    expect(captured.steps.find((step) => step.stepId === questionnaire!.id)).toMatchObject({
      status: "satisfied",
      remainingOutputs: [],
    });
  });

  it("selects the next unsatisfied acceptance-blocking step", () => {
    const intake = reviewAimIntake({
      title: "Research latest travel docs and save the plan in Notion",
      description: "Need current web information and my personal notes.",
      selectedContext: [],
      memories: [],
    });

    const progress = reviewContextIntakeProgress({
      loop: intake.loop,
      signals: [
        {
          source: "tool_observation",
          channel: "web_research",
          toolName: "web.search",
          scope: "aim",
          category: "project_fact",
        },
      ],
    });

    const next = progress.steps.find((step) => step.stepId === progress.nextStepId);
    expect(progress.shouldContinue).toBe(true);
    expect(next?.blocksPlanAcceptance).toBe(true);
    expect(progress.blockedAcceptanceCount).toBeGreaterThan(0);
    expect(progress.nextActions.join(" ")).toContain("context intake");
  });
});
