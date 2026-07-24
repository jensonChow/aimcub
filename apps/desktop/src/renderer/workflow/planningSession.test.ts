import { describe, expect, it } from "vitest";

import type { LocalAgentDetection } from "@aimcub/local-agent";
import type { PlanningSessionQuestion } from "@aimcub/llm";

import type { PlanningSessionStateView } from "../../shared/ipc";
import {
  embeddedPlanningAgentId,
  planningModelMenu,
  sessionAnswerRequest,
  sessionPayloadIsCurrent,
  sessionQuestionClarifyOutput,
  sessionSurfaceVisible,
} from "./planningSession";

function detection(overrides: Partial<LocalAgentDetection>): LocalAgentDetection {
  return {
    id: "claude",
    name: "Claude Code",
    runMode: "local_cli",
    available: true,
    path: "/bin/claude",
    version: "2.1.191",
    authStatus: "ok",
    authMessage: null,
    models: [],
    modelsSource: "fallback",
    reasoningOptions: [],
    diagnostics: [],
    ...overrides,
  };
}

function question(overrides: Partial<PlanningSessionQuestion> = {}): PlanningSessionQuestion {
  return {
    id: "ask_1",
    question: "Which platform should the first release target?",
    kind: "scope",
    why_high_impact: "Platform changes distribution and evidence.",
    allow_other: true,
    selection_mode: "single",
    selection_mode_reason: "primary_choice_requested",
    capture_scope: "current_aim",
    options: [
      { label: "iOS", tradeoff: "Review gate" },
      { label: "Web", tradeoff: "No review" },
    ],
    ...overrides,
  };
}

function view(overrides: Partial<PlanningSessionStateView>): PlanningSessionStateView {
  return {
    goalId: "g1",
    agentId: "claude",
    model: null,
    active: true,
    phase: "researching",
    pendingQuestion: null,
    questionsAsked: 0,
    researchFindingCount: 0,
    researchGapCount: 0,
    activity: [],
    landing: null,
    failure: null,
    ...overrides,
  };
}

describe("embeddedPlanningAgentId", () => {
  it("requires an available, authenticated claude", () => {
    expect(embeddedPlanningAgentId([detection({})])).toBe("claude");
    expect(embeddedPlanningAgentId([detection({ available: false })])).toBeNull();
    expect(embeddedPlanningAgentId([detection({ authStatus: "missing" })])).toBeNull();
    expect(embeddedPlanningAgentId([detection({ id: "codex", name: "Codex" })])).toBeNull();
    expect(embeddedPlanningAgentId([])).toBeNull();
  });
});

describe("planningModelMenu", () => {
  const liveModels = [
    { id: "default", label: "Default" },
    { id: "gpt-5.6-sol", label: "gpt-5.6-sol" },
    { id: "gpt-5.5", label: "gpt-5.5" },
  ];

  it("builds the menu from the live list with Auto following the first advertised model", () => {
    const menu = planningModelMenu([detection({ modelsSource: "live", models: liveModels })], null);
    expect(menu).not.toBeNull();
    expect(menu?.agentId).toBe("claude");
    expect(menu?.autoSelected).toBe(true);
    expect(menu?.currentLabel).toBe("gpt-5.6-sol");
    expect(menu?.options.map((option) => option.id)).toEqual(["gpt-5.6-sol", "gpt-5.5"]);
    expect(menu?.options.every((option) => !option.selected)).toBe(true);
  });

  it("marks an explicit matching pick and shows it on the chip", () => {
    const menu = planningModelMenu(
      [detection({ modelsSource: "live", models: liveModels })],
      { agentId: "claude", model: "gpt-5.5" },
    );
    expect(menu?.autoSelected).toBe(false);
    expect(menu?.currentLabel).toBe("gpt-5.5");
    expect(menu?.options.find((option) => option.id === "gpt-5.5")?.selected).toBe(true);
  });

  it("ignores picks for another runtime or models no longer advertised", () => {
    const otherAgent = planningModelMenu(
      [detection({ modelsSource: "live", models: liveModels })],
      { agentId: "codex", model: "gpt-5.5" },
    );
    expect(otherAgent?.autoSelected).toBe(true);
    const staleModel = planningModelMenu(
      [detection({ modelsSource: "live", models: liveModels })],
      { agentId: "claude", model: "retired-model" },
    );
    expect(staleModel?.autoSelected).toBe(true);
  });

  it("returns null without a capable brain or a live model list", () => {
    expect(planningModelMenu([], null)).toBeNull();
    expect(planningModelMenu([detection({ authStatus: "missing" })], null)).toBeNull();
    expect(planningModelMenu([detection({ modelsSource: "fallback", models: liveModels })], null)).toBeNull();
    expect(planningModelMenu([detection({ modelsSource: "live", models: [{ id: "default", label: "Default" }] })], null)).toBeNull();
  });
});

describe("sessionQuestionClarifyOutput", () => {
  it("maps a session question onto the existing clarify surface shape", () => {
    const output = sessionQuestionClarifyOutput(question());
    expect(output.questions).toHaveLength(1);
    expect(output.assumptions).toEqual([]);
    expect(output.questions[0]).toMatchObject({
      id: "ask_1",
      selection_mode: "single",
      allow_other: true,
      options: [
        { label: "iOS", tradeoff: "Review gate" },
        { label: "Web", tradeoff: "No review" },
      ],
    });
  });
});

describe("sessionAnswerRequest", () => {
  it("builds the answer from the shared answer map", () => {
    const req = sessionAnswerRequest("g1", question(), {
      ask_1: { labels: ["iOS"], other: "prefer TestFlight first" },
    });
    expect(req).toEqual({
      goalId: "g1",
      requestId: "ask_1",
      labels: ["iOS"],
      other: "prefer TestFlight first",
    });
  });

  it("falls back to an empty answer when nothing was picked", () => {
    expect(sessionAnswerRequest("g1", question(), {})).toEqual({
      goalId: "g1",
      requestId: "ask_1",
      labels: [],
      other: "",
    });
  });
});

describe("session view predicates", () => {
  it("matches payloads to the selected aim only", () => {
    expect(sessionPayloadIsCurrent(view({}), "g1")).toBe(true);
    expect(sessionPayloadIsCurrent(view({}), "g2")).toBe(false);
    expect(sessionPayloadIsCurrent(null, "g1")).toBe(false);
    expect(sessionPayloadIsCurrent(view({}), null)).toBe(false);
  });

  it("shows the surface while active, failed, or landed-but-uncommitted", () => {
    expect(sessionSurfaceVisible(view({}))).toBe(true);
    expect(sessionSurfaceVisible(view({ active: false, phase: "failed", failure: { code: "no_plan_submitted", message: "x" } }))).toBe(true);
    expect(sessionSurfaceVisible(view({
      active: false,
      phase: "draft_ready",
      landing: { plan: { goal_summary: "", domain: "software", rationale: "", nodes: [], edges: [] }, quality: null, review: null, questions: [], answers: [], assumptions: [] },
    }))).toBe(true);
    expect(sessionSurfaceVisible(view({ active: false, phase: "canceled" }))).toBe(false);
    expect(sessionSurfaceVisible(null)).toBe(false);
  });
});
