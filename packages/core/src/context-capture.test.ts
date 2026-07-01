import { describe, expect, it } from "vitest";

import {
  contextCaptureFulfillmentFromMetadata,
  reviewContextCaptureFulfillment,
  summarizeContextCaptureLearning,
} from "./context-capture";
import type { ContextCaptureContract } from "./aim-intake";

const evalCapture: ContextCaptureContract = {
  category: "eval_signal",
  scope: "global",
  purpose: "define_eval",
  improvesDimension: "verifiability",
  reason: "clarify_verifiability",
};

const procedureCapture: ContextCaptureContract = {
  category: "procedure",
  scope: "aim",
  purpose: "document_procedure",
  improvesDimension: "verifiability",
  reason: "profile_missing",
};

describe("reviewContextCaptureFulfillment", () => {
  it("reports answered, memory-captured, and plan-impacted capture contracts", () => {
    const report = reviewContextCaptureFulfillment({
      questions: [
        {
          id: "proof",
          question: "What proves this is complete?",
          capture: evalCapture,
        },
        {
          id: "workflow",
          prompt: "Ask for the release workflow.",
          capture: procedureCapture,
        },
      ],
      answers: [
        { question_id: "proof", selected_label: "Passing smoke test", other_text: null },
      ],
      memories: [
        {
          category: "eval_signal",
          content: "Eval signal: Passing smoke test. Clarify question: What proves this is complete?",
        },
      ],
      impacts: [
        {
          question_id: "proof",
          affected_node_keys: ["m1"],
          signals: ["quality_dimension_improved", "acceptance_rule_changed"],
        },
      ],
    });

    expect(report).toMatchObject({
      version: 1,
      total: 2,
      answeredCount: 1,
      memoryCapturedCount: 1,
      impactedCount: 1,
    });
    expect(report.rows[0]).toMatchObject({
      questionId: "proof",
      answered: true,
      memoryCaptured: true,
      impactedPlan: true,
      status: "captured_and_impacted",
      affectedNodeKeys: ["m1"],
    });
    expect(report.rows[1]).toMatchObject({
      questionId: "workflow",
      answered: false,
      memoryCaptured: false,
      impactedPlan: false,
      status: "unanswered",
    });
  });

  it("marks answered contracts without matching memory as incomplete capture", () => {
    const report = reviewContextCaptureFulfillment({
      questions: [{ id: "proof", question: "What proves this is complete?", capture: evalCapture }],
      answers: [{ question_id: "proof", selected_label: "Passing smoke test", other_text: null }],
      memories: [],
      impacts: [],
    });

    expect(report.rows[0]).toMatchObject({
      answered: true,
      memoryCaptured: false,
      impactedPlan: false,
      status: "answered_without_memory",
    });
  });
});

describe("summarizeContextCaptureLearning", () => {
  it("turns fulfillment history into capture-aware question recommendations", () => {
    const report = summarizeContextCaptureLearning([
      {
        version: 1,
        total: 3,
        answeredCount: 3,
        memoryCapturedCount: 3,
        impactedCount: 2,
        rows: [
          {
            questionId: "proof_1",
            question: "What proves this is complete?",
            capture: {
              ...evalCapture,
              origin: {
                source: "review_gap",
                reason: "missing_contract_eval_signal",
                prompt: "What proves milestone one?",
                gapSource: "decomposition_contract",
                nodeKey: "m1",
                nodeTitle: "Scaffold CLI",
                roiScore: 88,
                roiSignals: ["high_priority", "decomposition_contract", "node_specific", "eval_signal"],
                issueCodes: ["missing_contract_eval_signal"],
              },
            },
            answer: "Passing smoke test",
            answered: true,
            memoryCaptured: true,
            impactedPlan: true,
            affectedNodeKeys: ["m1"],
            signals: ["quality_dimension_improved"],
            status: "captured_and_impacted",
          },
          {
            questionId: "proof_2",
            question: "What proves this is complete?",
            capture: {
              ...evalCapture,
              origin: {
                source: "review_gap",
                reason: "missing_contract_eval_signal",
                prompt: "What proves milestone two?",
                gapSource: "decomposition_contract",
                nodeKey: "m2",
                nodeTitle: "Wire storage",
                roiScore: 76,
                roiSignals: ["medium_priority", "decomposition_contract", "node_specific", "eval_signal"],
                issueCodes: ["missing_contract_eval_signal"],
              },
            },
            answer: "Passing e2e",
            answered: true,
            memoryCaptured: true,
            impactedPlan: true,
            affectedNodeKeys: ["m2"],
            signals: ["acceptance_rule_changed"],
            status: "captured_and_impacted",
          },
          {
            questionId: "workflow",
            question: "What workflow should this follow?",
            capture: procedureCapture,
            answer: "Run release checklist",
            answered: true,
            memoryCaptured: false,
            impactedPlan: false,
            affectedNodeKeys: [],
            signals: [],
            status: "answered_without_memory",
          },
        ],
      },
    ]);

    expect(report).toMatchObject({
      totalAsked: 3,
      totalAnswered: 3,
      totalCaptured: 2,
      totalImpacted: 2,
    });
    expect(report.rows.find((row) => row.category === "eval_signal")).toMatchObject({
      recommendation: "ask_more",
      answerRate: 1,
      captureRate: 1,
      impactRate: 1,
    });
    expect(report.rows.find((row) => row.category === "procedure")).toMatchObject({
      recommendation: "fix_capture",
      answerRate: 1,
      captureRate: 0,
    });
    expect(report.originRows?.find((row) => row.nodeKey === "m1")).toMatchObject({
      source: "review_gap",
      gapSource: "decomposition_contract",
      nodeTitle: "Scaffold CLI",
      category: "eval_signal",
      avgRoiScore: 88,
      recommendation: "ask_more",
      roiSignals: ["high_priority", "decomposition_contract", "node_specific", "eval_signal"],
      issueCodes: ["missing_contract_eval_signal"],
    });
    expect(report.guidance.join("\n")).toContain("Prefer eval-signal questions");
    expect(report.guidance.join("\n")).toContain("For m1 (Scaffold CLI), prefer eval-signal questions");
    expect(report.guidance.join("\n")).toContain("fail to become memory");
  });

  it("normalizes persisted fulfillment metadata before summarizing", () => {
    const fulfillment = contextCaptureFulfillmentFromMetadata({
      context_capture_fulfillment: {
        version: 1,
        rows: [
          {
            questionId: "proof",
            question: "What proves this?",
            capture: {
              ...evalCapture,
              origin: {
                source: "review_gap",
                reason: "missing_eval",
                prompt: "What proves this?",
                gapSource: "decomposition_contract",
                nodeKey: "m1",
                nodeTitle: "Scaffold",
                roiScore: 88,
                roiSignals: ["high_priority", "decomposition_contract", "node_specific", "eval_signal"],
                issueCodes: ["missing_contract_eval_signal"],
              },
            },
            answer: "Tests pass",
            answered: true,
            memoryCaptured: true,
            impactedPlan: false,
            affectedNodeKeys: [],
            signals: [],
            status: "captured",
          },
        ],
      },
    });

    expect(fulfillment).toMatchObject({
      total: 1,
      answeredCount: 1,
      memoryCapturedCount: 1,
      impactedCount: 0,
      rows: [
        {
          capture: {
            origin: {
              source: "review_gap",
              gapSource: "decomposition_contract",
              nodeKey: "m1",
              roiScore: 88,
              roiSignals: ["high_priority", "decomposition_contract", "node_specific", "eval_signal"],
            },
          },
        },
      ],
    });
    expect(summarizeContextCaptureLearning([fulfillment]).rows[0]).toMatchObject({
      category: "eval_signal",
      recommendation: "ask_selectively",
    });
    expect(summarizeContextCaptureLearning([fulfillment]).originRows?.[0]).toMatchObject({
      source: "review_gap",
      gapSource: "decomposition_contract",
      nodeKey: "m1",
      category: "eval_signal",
      avgRoiScore: 88,
      recommendation: "ask_selectively",
    });
  });

  it("tracks decomposition-strategy capture origins for learning", () => {
    const fulfillment = contextCaptureFulfillmentFromMetadata({
      context_capture_fulfillment: {
        version: 1,
        rows: [
          {
            questionId: "workflow_boundary",
            question: "Which workflow should define milestone boundaries?",
            capture: {
              category: "constraint",
              scope: "global",
              purpose: "shape_plan",
              improvesDimension: "context_fit",
              reason: "clarify_context_fit",
              origin: {
                source: "decomposition_strategy",
                reason: "context_fit: Ask only context that can change the next decomposition.",
                prompt: "context_fit: Ask only context that can change the next decomposition.",
              },
            },
            answer: "Developer CLI workflow",
            answered: true,
            memoryCaptured: true,
            impactedPlan: true,
            affectedNodeKeys: ["m1", "m2"],
            signals: ["milestone_text_changed"],
            status: "captured_and_impacted",
          },
        ],
      },
    });

    const learning = summarizeContextCaptureLearning([fulfillment]);

    expect(learning.originRows?.[0]).toMatchObject({
      source: "decomposition_strategy",
      category: "constraint",
      purpose: "shape_plan",
      improvesDimension: "context_fit",
      askedCount: 1,
      answeredCount: 1,
      memoryCapturedCount: 1,
      impactedCount: 1,
      recommendation: "ask_more",
    });
    expect(learning.guidance.join("\n")).toContain("decomposition-strategy");
  });
});
