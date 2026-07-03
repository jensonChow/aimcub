import { reviewPlan } from "@core/domain";
import { describe, expect, it } from "vitest";
import { buildGoalDebugTrace } from "./debug-trace.server";
import { goalDebugTraceFromMetadata } from "./debug-trace";
import { localDecompose } from "./decompose";

describe("goal debug trace", () => {
  it("captures model, context intake, and plan review reports", () => {
    const plan = localDecompose({ title: "Ship debug context panel" });
    const review = reviewPlan({ plan, context: [] });
    const trace = buildGoalDebugTrace({
      aim: { title: "Ship debug context panel", description: "", domain: "software" },
      mode: "mock",
      plan,
      review,
      model: {
        primaryProvider: "local",
        finalProvider: "local",
        status: "local_only",
        attempts: 1,
        retried: false,
        usage: [],
      },
      generatedAt: "2026-07-03T00:00:00.000Z",
    });

    expect(trace.version).toBe(1);
    expect(trace.model.status).toBe("local_only");
    expect(trace.model.reasoningVisibility).toContain("Hidden chain-of-thought is not requested or stored");
    expect(trace.context.preModel.intake.questions.length).toBeGreaterThan(0);
    expect(trace.context.preModel.progress.pendingCount).toBeGreaterThan(0);
    expect(trace.context.postModel.intake.questions.length).toBeGreaterThan(0);
    expect(trace.plan.nodes).toHaveLength(plan.nodes.length);
    expect(trace.plan.review.actions.length).toBeGreaterThan(0);
  });

  it("reads trace metadata defensively", () => {
    const plan = localDecompose({ title: "Ship debug context panel" });
    const review = reviewPlan({ plan, context: [] });
    const trace = buildGoalDebugTrace({
      aim: { title: "Ship debug context panel" },
      mode: "mock",
      plan,
      review,
      model: {
        primaryProvider: "local",
        finalProvider: "local",
        status: "local_only",
        attempts: 1,
        retried: false,
        usage: [],
      },
    });

    expect(goalDebugTraceFromMetadata({ debug_trace: trace })?.plan.nodeCount).toBe(plan.nodes.length);
    expect(goalDebugTraceFromMetadata({ debug_trace: { model: {} } })).toBeNull();
    expect(goalDebugTraceFromMetadata(undefined)).toBeNull();
  });
});
