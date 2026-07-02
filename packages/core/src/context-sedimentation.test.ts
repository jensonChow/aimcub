import { describe, expect, it } from "vitest";
import { buildContextIntakeLoop } from "./aim-intake";
import { reviewContextIntakeProgress } from "./context-intake-progress";
import { reviewContextSedimentation } from "./context-sedimentation";

const loop = buildContextIntakeLoop({
  readiness: "needs_targeted_context",
  acquisition: [
    {
      id: "acq_1",
      channel: "web_research",
      priority: "high",
      scope: "aim",
      categories: ["project_fact", "eval_signal"],
      reason: "The aim depends on current external facts.",
      action: "Run web research.",
      suggestedTools: ["web.search", "web.fetch", "memory.write_candidate"],
      memoryTargets: [{
        scope: "aim",
        kind: "semantic",
        categories: ["project_fact", "eval_signal"],
      }],
    },
    {
      id: "acq_2",
      channel: "questionnaire",
      priority: "medium",
      scope: "global",
      categories: ["constraint"],
      reason: "A reusable constraint can improve future plans.",
      action: "Ask a targeted question.",
      suggestedTools: ["context.ask_user", "memory.write_candidate"],
      memoryTargets: [{
        scope: "global",
        kind: "semantic",
        categories: ["constraint"],
      }],
    },
  ],
});

describe("reviewContextSedimentation", () => {
  it("splits current aim context from durable memory candidates", () => {
    const progress = reviewContextIntakeProgress({
      loop,
      signals: [
        {
          source: "tool_observation",
          channel: "web_research",
          toolName: "web.fetch",
          category: "project_fact",
          scope: "aim",
          summary: "Project fact: Cambodia visa rules should be checked against official sources.",
        },
        {
          source: "user_answer",
          channel: "questionnaire",
          category: "constraint",
          scope: "global",
          questionId: "q1",
          summary: "Constraint: I prefer remote-first delivery and cannot travel in August.",
        },
      ],
    });

    const report = reviewContextSedimentation({
      loop,
      progress,
      signals: [
        {
          source: "tool_observation",
          channel: "web_research",
          toolName: "web.fetch",
          category: "project_fact",
          scope: "aim",
          summary: "Project fact: Cambodia visa rules should be checked against official sources.",
        },
        {
          source: "user_answer",
          channel: "questionnaire",
          category: "constraint",
          scope: "global",
          questionId: "q1",
          summary: "Constraint: I prefer remote-first delivery and cannot travel in August.",
        },
      ],
    });

    expect(report.aimContext).toEqual([
      expect.objectContaining({
        category: "project_fact",
        source: "tool_observation",
        channel: "web_research",
        stepId: "loop_1",
      }),
    ]);
    expect(report.durableMemoryCandidates).toEqual([
      expect.objectContaining({
        category: "constraint",
        source: "user_stated",
        channel: "questionnaire",
        stepId: "loop_2",
        originId: "q1",
      }),
    ]);
  });

  it("does not sediment search-only web observations as aim context", () => {
    const progress = reviewContextIntakeProgress({
      loop,
      signals: [
        {
          source: "tool_observation",
          channel: "web_research",
          toolName: "web.search",
          category: "project_fact",
          scope: "aim",
          summary: "Project fact: Search result snippets mention Cambodia visa rules.",
        },
      ],
    });

    const report = reviewContextSedimentation({
      loop,
      progress,
      signals: [
        {
          source: "tool_observation",
          channel: "web_research",
          toolName: "web.search",
          category: "project_fact",
          scope: "aim",
          summary: "Project fact: Search result snippets mention Cambodia visa rules.",
        },
      ],
    });

    expect(report.aimContext).toEqual([]);
    expect(report.readyForDecomposition).toBe(false);
    expect(report.shouldIterate).toBe(true);
  });

  it("filters prompt-like context and deduplicates candidates", () => {
    const report = reviewContextSedimentation({
      loop,
      candidates: [
        {
          content: "Pending answer needed: confirm whether this constraint context should shape the aim.",
          category: "constraint",
          scope: "global",
          source: "distilled_context",
        },
        {
          content: "Project fact: Official docs are the source of truth for visa timing.",
          category: "project_fact",
          scope: "aim",
          source: "distilled_context",
          channel: "web_research",
        },
        {
          content: "Project fact: Official docs are the source of truth for visa timing.",
          category: "project_fact",
          scope: "aim",
          source: "distilled_context",
          channel: "web_research",
        },
      ],
    });

    expect(report.aimContext).toHaveLength(1);
    expect(report.durableMemoryCandidates).toHaveLength(0);
    expect(report.aimContext[0]?.content).toBe("Project fact: Official docs are the source of truth for visa timing.");
  });

  it("keeps the loop iterative while acceptance-blocking intake remains pending", () => {
    const progress = reviewContextIntakeProgress({ loop, signals: [] });
    const report = reviewContextSedimentation({ loop, progress });

    expect(report.readyForDecomposition).toBe(false);
    expect(report.shouldIterate).toBe(true);
    expect(report.pendingSteps).toEqual([
      expect.objectContaining({
        stepId: "loop_1",
        channel: "web_research",
        status: "blocked",
        blocksPlanAcceptance: true,
      }),
      expect.objectContaining({
        stepId: "loop_2",
        channel: "questionnaire",
        status: "pending",
      }),
    ]);
    expect(report.nextActions[0]).toContain("web_research");
  });
});
