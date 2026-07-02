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

  it("tracks requested user input without treating it as an answer", () => {
    const intake = reviewAimIntake({
      title: "Plan",
      description: "",
      selectedContext: [],
      memories: [],
    });
    const questionnaire = intake.loop.steps.find((step) => step.channel === "questionnaire");
    expect(questionnaire).toBeTruthy();

    const progress = reviewContextIntakeProgress({
      loop: intake.loop,
      signals: [
        {
          source: "user_request",
          channel: "questionnaire",
          scope: "aim",
          category: "project_fact",
          questionId: "missing_planning_context",
          summary: "Asked the user what context should shape the aim.",
        },
      ],
    });

    expect(progress.steps.find((step) => step.stepId === questionnaire!.id)).toMatchObject({
      status: "pending",
      matchedSignalCount: 1,
      requestedUserInputCount: 1,
      satisfiedOutputs: [],
      remainingOutputs: ["aim_context", "durable_memory_candidate", "clarifying_answer"],
      reason: expect.stringContaining("waiting on 1 user request"),
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

  it("keeps permission-required intake blocked before any tool observation", () => {
    const intake = reviewAimIntake({
      title: "Research latest travel docs",
      description: "Need current web information.",
      selectedContext: [],
      memories: [],
    });
    const webResearch = intake.loop.steps.find((step) => step.channel === "web_research");
    expect(webResearch).toBeTruthy();

    const progress = reviewContextIntakeProgress({
      loop: intake.loop,
      signals: [],
    });

    expect(progress.steps.find((step) => step.stepId === webResearch!.id)).toMatchObject({
      status: "blocked",
      satisfiedOutputs: [],
      remainingOutputs: ["aim_context"],
    });
  });

  it("uses first-party memory search before requiring personal database connectors", () => {
    const intake = reviewAimIntake({
      title: "Plan from my Notion travel notes",
      description: "Use my personal notes and known preferences.",
      selectedContext: [],
      memories: [],
    });
    const personalDatabase = intake.loop.steps.find((step) => step.channel === "personal_database");
    expect(personalDatabase).toBeTruthy();

    const blocked = reviewContextIntakeProgress({
      loop: intake.loop,
      signals: [],
    });

    expect(blocked.steps.find((step) => step.stepId === personalDatabase!.id)).toMatchObject({
      status: "blocked",
      requiredTools: expect.arrayContaining([
        expect.objectContaining({
          name: "external.notion",
          boundary: "external_connector",
        }),
      ]),
    });

    const memoryOnly = reviewContextIntakeProgress({
      loop: intake.loop,
      signals: [
        {
          source: "tool_observation",
          channel: "personal_database",
          toolName: "memory.search",
          scope: "global",
          category: "preference",
          summary: "Preference: Keep travel plans lightweight.",
        },
      ],
    });

    expect(memoryOnly.steps.find((step) => step.stepId === personalDatabase!.id)).toMatchObject({
      status: "pending",
      satisfiedOutputs: ["durable_memory_candidate"],
      remainingOutputs: ["aim_context"],
    });

    const firstPartyMemory = reviewContextIntakeProgress({
      loop: intake.loop,
      signals: [
        {
          source: "tool_observation",
          channel: "personal_database",
          toolName: "memory.search",
          scope: "aim",
          category: "project_fact",
          summary: "Found the user's Cambodia travel note.",
        },
        {
          source: "tool_observation",
          channel: "personal_database",
          toolName: "memory.search",
          scope: "global",
          category: "preference",
          summary: "Preference: Keep travel plans lightweight.",
        },
      ],
    });

    expect(firstPartyMemory.steps.find((step) => step.stepId === personalDatabase!.id)).toMatchObject({
      status: "satisfied",
      satisfiedOutputs: expect.arrayContaining(["aim_context", "durable_memory_candidate"]),
      remainingOutputs: [],
    });
  });

  it("requires fetched web source context before satisfying web research intake", () => {
    const intake = reviewAimIntake({
      title: "Research latest Cambodia travel docs",
      description: "Need current official source material before planning.",
      selectedContext: [],
      memories: [],
    });
    const webResearch = intake.loop.steps.find((step) => step.channel === "web_research");
    expect(webResearch).toBeTruthy();

    const searchOnly = reviewContextIntakeProgress({
      loop: intake.loop,
      signals: [
        {
          source: "tool_observation",
          channel: "web_research",
          toolName: "web.search",
          scope: "aim",
          category: "project_fact",
          summary: "Found search results for Cambodia travel docs.",
        },
      ],
    });

    expect(searchOnly.steps.find((step) => step.stepId === webResearch!.id)).toMatchObject({
      status: "pending",
      satisfiedOutputs: [],
      remainingOutputs: ["aim_context"],
    });

    const fetched = reviewContextIntakeProgress({
      loop: intake.loop,
      signals: [
        {
          source: "tool_observation",
          channel: "web_research",
          toolName: "web.fetch",
          scope: "aim",
          category: "project_fact",
          summary: "Fetched the official Cambodia travel advisory page.",
        },
      ],
    });

    expect(fetched.steps.find((step) => step.stepId === webResearch!.id)).toMatchObject({
      status: "satisfied",
      satisfiedOutputs: ["aim_context"],
      remainingOutputs: [],
    });
  });
});
