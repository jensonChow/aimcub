import { describe, expect, it } from "vitest";

import type { AimIntakeReport, PlanReviewReport } from "@core/domain";
import type { PlanningContextSelectionReport } from "@core/llm";
import { localDecompose } from "@core/llm";

import type { PlanningToolIpcTrace } from "../shared/ipc";
import { buildContextBundleReview } from "./contextReview";

const planningContext: PlanningContextSelectionReport = {
  total: 3,
  limit: 2,
  selected: [
    {
      memoryId: "memory-1",
      content: "Preference: Keep planning output concise and evidence-backed.",
      category: "preference",
      confidence: 0.94,
      goalId: null,
      scope: "global",
      score: 70,
      reason: "global_context",
      matchedTokens: [],
    },
  ],
  ignored: [
    {
      memoryId: "memory-2",
      content: "Old project note without a current owner.",
      category: "project_fact",
      confidence: 0.42,
      goalId: null,
      scope: "global",
      score: 0,
      reason: "low_confidence",
      matchedTokens: [],
    },
  ],
};

const planningTools: PlanningToolIpcTrace = {
  observations: [],
  observationEvents: [
    {
      toolName: "context.linked_sources",
      observation: {
        summary: "Registered linked sources.",
        data: {
          sources: [
            {
              id: "notion-roadmap",
              kind: "notion",
              label: "Product roadmap",
              enabled: true,
              status: "needs_connector",
              uri: "notion://roadmap",
            },
            {
              id: "archive",
              kind: "local_file",
              label: "Archived notes",
              enabled: true,
              status: "unavailable",
              path: "/tmp/archive.md",
            },
          ],
        },
        sources: [{ kind: "connector", title: "Product roadmap", uri: "notion://roadmap" }],
        warnings: ["Treat connector-backed sources as known locations, not observed facts."],
      },
    },
  ],
  failures: [
    {
      toolName: "local.read",
      error: {
        code: "sensitive_path",
        message: "Refused to read a sensitive credentials file.",
        retryable: false,
      },
    },
    {
      toolName: "web.search",
      error: {
        code: "provider_error",
        message: "Search provider returned 503.",
        retryable: true,
      },
    },
  ],
  distillation: {
    summary: "Distilled source context.",
    usedSources: [],
    missingQuestions: [
      {
        id: "q_budget",
        question: "What budget ceiling changes the plan?",
        category: "constraint",
      },
    ],
    durableMemoryCandidates: [],
  },
};

const intake: AimIntakeReport = {
  title: "Launch a local Aim OS cockpit",
  readiness: "needs_targeted_context",
  score: 52,
  coverage: {
    profile: {
      totalActive: 0,
      totalPending: 0,
      highConfidenceActive: 0,
      coverageScore: 0,
      rows: [],
      gaps: [],
    },
    selectedTotal: 1,
    selectedByCategory: [{ category: "preference", count: 1, highConfidenceCount: 1 }],
    missingCoreCategories: ["eval_signal"],
  },
  questions: [
    {
      id: "done_signal",
      category: "eval_signal",
      priority: "high",
      source: "context_profile",
      reason: "missing_eval_signal",
      prompt: "What evidence proves the cockpit is ready?",
    },
  ],
  acquisition: [],
  loop: {
    version: 1,
    shouldContinue: true,
    nextStepId: "done_signal",
    stopCondition: "Resolve high-priority eval context before decomposition.",
    steps: [],
    aimContextTargets: [],
    durableMemoryTargets: [],
  },
  nextActions: ["Answer the eval-signal question before saving the plan."],
};

const review: PlanReviewReport = {
  quality: { score: 76, grade: "warn", issues: [] },
  context: {
    total: 1,
    applied: [],
    unapplied: [],
    ignoredLowConfidence: [],
    gaps: [
      {
        category: "constraint",
        priority: "medium",
        reason: "missing_constraint",
        prompt: "Which release deadline constrains the milestone order?",
        source: "decomposition_contract",
        nodeKey: "m1",
        nodeTitle: "Define release scope",
      },
    ],
  },
  actions: [],
  guidance: [],
};

describe("buildContextBundleReview", () => {
  it("separates selected context from skipped or unread context", () => {
    const bundle = buildContextBundleReview({ planningContext, planningTools });

    expect(bundle.usedContext).toHaveLength(1);
    expect(bundle.usedContext[0]).toMatchObject({
      title: "Selected for planning",
      category: "preference",
    });
    expect(bundle.skippedContext.map((item) => item.title)).toEqual(
      expect.arrayContaining(["Not used in this plan", "Linked source unavailable", "Web source not read"]),
    );
    expect(bundle.skippedContext.some((item) => item.body.includes("Old project note"))).toBe(true);
  });

  it("classifies permission and setup gaps separately", () => {
    const bundle = buildContextBundleReview({ planningContext, planningTools });

    expect(bundle.permissionGaps.map((item) => item.title)).toEqual(
      expect.arrayContaining(["Connector or access needed", "Local source not read"]),
    );
    expect(bundle.permissionGaps.some((item) => item.body.includes("Product roadmap"))).toBe(true);
    expect(bundle.permissionGaps.some((item) => item.body.includes("credentials"))).toBe(true);
  });

  it("collects unresolved decomposition risks from intake, distillation, review, plan, and warnings", () => {
    const plan = localDecompose({ title: "Launch a local Aim OS cockpit" });
    plan.nodes[0]!.decomposition_contract!.context_gaps = [
      {
        category: "eval_signal",
        question: "Which smoke test proves the cockpit is usable?",
        reason: "Missing acceptance signal.",
      },
    ];

    const bundle = buildContextBundleReview({ planningContext, planningTools, intake, review, plan });
    const riskText = bundle.decompositionRisks.map((item) => `${item.title}: ${item.body}`).join("\n");

    expect(riskText).toContain("Unanswered intake question");
    expect(riskText).toContain("What budget ceiling changes the plan?");
    expect(riskText).toContain("Which release deadline constrains the milestone order?");
    expect(riskText).toContain("Which smoke test proves the cockpit is usable?");
    expect(riskText).toContain("Context source warning");
  });

  it("does not report answered intake questions as unresolved risks", () => {
    const bundle = buildContextBundleReview({
      planningContext,
      planningTools,
      intake,
      answeredQuestionIds: ["intake_done_signal"],
    });

    expect(bundle.decompositionRisks.some((item) => item.id === "intake:done_signal")).toBe(false);
  });
});
