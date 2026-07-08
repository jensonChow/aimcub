import { describe, expect, it } from "vitest";

import type { AimIntakeReport } from "@core/domain";
import type { PlanningContextSelectionReport } from "@core/llm";

import type { ContextSourceStatus, PlanningToolIpcTrace } from "../../../shared/ipc";
import type { ContextBundleReview } from "../../contextReview";
import { buildContextLoopModel } from "./contextLoop";

const emptyReview: ContextBundleReview = {
  usedContext: [],
  skippedContext: [],
  permissionGaps: [],
  decompositionRisks: [],
  sourceCount: 0,
};

const contextSources: ContextSourceStatus = {
  version: 1,
  local: {
    enabled: true,
    workspaceRoot: "/Users/jenson/Desktop/Aimcub",
    filePaths: ["/Users/jenson/Desktop/Aimcub/docs/local-alpha.md"],
    configured: true,
    source: "settings",
    resolvedWorkspaceRoot: "/Users/jenson/Desktop/Aimcub",
    resolvedFilePaths: ["/Users/jenson/Desktop/Aimcub/docs/local-alpha.md"],
  },
  online: {
    enabled: true,
    sources: [{
      id: "roadmap",
      provider: "notion",
      label: "Roadmap",
      reference: "notion://roadmap",
      enabled: true,
    }],
    configuredCount: 1,
    enabledCount: 1,
  },
  research: {
    webEnabled: true,
    deepResearch: true,
  },
  userSession: {
    enabled: true,
  },
  questionnaire: {
    enabled: true,
  },
};

const planningContext: PlanningContextSelectionReport = {
  total: 2,
  limit: 2,
  selected: [
    {
      memoryId: "memory-1",
      content: "Use local alpha docs as the source of truth.",
      category: "procedure",
      confidence: 0.95,
      goalId: null,
      scope: "global",
      score: 82,
      reason: "global_context",
      matchedTokens: ["local", "alpha"],
    },
    {
      memoryId: "memory-2",
      content: "Require eval-backed completion.",
      category: "eval_signal",
      confidence: 0.9,
      goalId: null,
      scope: "global",
      score: 76,
      reason: "global_context",
      matchedTokens: ["eval"],
    },
  ],
  ignored: [],
};

const planningTools: PlanningToolIpcTrace = {
  observations: [],
  observationEvents: [
    {
      toolName: "local.read",
      observation: {
        summary: "Read local docs.",
        data: {},
        sources: [{ kind: "file", title: "local-alpha.md", path: "/Users/jenson/Desktop/Aimcub/docs/local-alpha.md" }],
      },
    },
    {
      toolName: "web.search",
      observation: {
        summary: "Checked current source-backed facts.",
        data: {},
        sources: [{ kind: "web", title: "Aimcub docs", url: "https://example.com" }],
      },
    },
    {
      toolName: "context.distill",
      observation: {
        summary: "Distilled source context.",
        data: {},
        sources: [],
      },
    },
  ],
  failures: [],
  distillation: {
    summary: "Local alpha context is ready.",
    usedSources: [],
    missingQuestions: [],
    durableMemoryCandidates: [],
  },
};

const intake: AimIntakeReport = {
  title: "Ship Context loop",
  readiness: "ready",
  score: 84,
  coverage: {
    profile: {
      totalActive: 2,
      totalPending: 0,
      highConfidenceActive: 2,
      coverageScore: 84,
      rows: [],
      gaps: [],
    },
    selectedTotal: 2,
    selectedByCategory: [{ category: "procedure", count: 1, highConfidenceCount: 1 }],
    missingCoreCategories: [],
  },
  questions: [],
  acquisition: [],
  loop: {
    version: 1,
    shouldContinue: false,
    nextStepId: null,
    stopCondition: "Enough context exists.",
    steps: [],
    aimContextTargets: [],
    durableMemoryTargets: [],
  },
  nextActions: [],
};

describe("buildContextLoopModel", () => {
  it("raises sufficiency for local sources, used context, answers, notes, and distillation", () => {
    const weak = buildContextLoopModel({
      contextSources: null,
      review: emptyReview,
    });
    const strong = buildContextLoopModel({
      contextSources,
      review: {
        ...emptyReview,
        usedContext: [
          { id: "used-1", title: "Selected", body: "Local alpha docs", meta: [], tone: "success" },
          { id: "used-2", title: "Selected", body: "Eval rules", meta: [], tone: "success" },
        ],
        sourceCount: 2,
      },
      planningContext,
      planningTools,
      intake,
      answeredQuestionCount: 2,
      contextNote: "Keep the Context stage iterative.",
    });

    expect(weak.sufficiency.level).toBe("thin");
    expect(strong.sufficiency.score).toBeGreaterThan(weak.sufficiency.score);
    expect(strong.sufficiency.level).toBe("strong");
    expect(strong.activity.map((item) => item.state)).toContain("complete");
  });

  it("warns and lowers sufficiency for skipped context, permission gaps, and risks", () => {
    const useful = buildContextLoopModel({
      contextSources,
      review: { ...emptyReview, usedContext: [{ id: "used", title: "Selected", body: "Docs", meta: [], tone: "success" }], sourceCount: 1 },
      planningContext,
      answeredQuestionCount: 1,
    });
    const risky = buildContextLoopModel({
      contextSources,
      review: {
        ...emptyReview,
        usedContext: [{ id: "used", title: "Selected", body: "Docs", meta: [], tone: "success" }],
        skippedContext: [{ id: "skipped", title: "Unread", body: "Ignored note", meta: [], tone: "warn" }],
        permissionGaps: [{ id: "linked-gap", title: "Connector needed", body: "Roadmap", meta: [], tone: "warn" }],
        decompositionRisks: [{ id: "risk", title: "Unanswered intake question", body: "Done signal?", meta: [], tone: "danger" }],
        sourceCount: 1,
      },
      planningContext,
      answeredQuestionCount: 1,
    });

    expect(risky.sufficiency.score).toBeLessThan(useful.sufficiency.score);
    expect(risky.sufficiency.warnings.map((warning) => warning.key)).toEqual(
      expect.arrayContaining([
        "context.sufficiency.warning.permissions",
        "context.sufficiency.warning.risks",
        "context.sufficiency.warning.skipped",
      ]),
    );
    expect(risky.activity.find((item) => item.id === "linked")?.state).toBe("blocked");
  });
});
