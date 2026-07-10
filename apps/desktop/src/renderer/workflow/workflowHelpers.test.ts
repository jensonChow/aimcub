import { describe, expect, it } from "vitest";

import type { AimIntakeReport } from "@core/domain";
import type { DecompositionOutput, Goal, Milestone } from "@core/types";
import type { ContextSourceStatus, GoalDetail, LocalAgentDetection } from "../../shared/ipc";
import { translate, type I18n } from "../i18n";

import {
  emptyEvidenceDraft,
  evidenceDraftIsSubmittable,
  evidenceSubmissionPayload,
} from "./evidenceSubmission";
import {
  appendIntakeQuestions,
  answersFor,
  buildDescriptionWithContext,
  intakeToClarifyOutput,
  shouldBlockForIntake,
} from "./intakeClarify";
import { latestLiveValue } from "./planningLiveEvents";
import {
  formatPlanValidationIssues,
  formatPlanningFailure,
  routeAfterPlanningFailure,
} from "./planningErrors";
import { formatRoutingValidation, routingAgentsFromDetections } from "./routingAgents";
import { buildSettingsModel } from "./settingsModel";
import { cockpitStageFor, planNodeForMilestone, progressRows } from "./stageRouting";

const OWNER = "00000000-0000-4000-8000-000000000001";
const GOAL = "00000000-0000-4000-8000-000000000010";
const MILESTONE = "00000000-0000-4000-8000-000000000020";

const milestone: Milestone = {
  id: MILESTONE,
  goal_id: GOAL,
  owner_id: OWNER,
  title: "Collect launch proof",
  description: "Add the evidence the launch is complete.",
  status: "pending",
  order_index: 0,
  depends_on_id: null,
  acceptance_rule: {
    logic: "all",
    threshold: 1,
    completion_mode: "manual",
    clauses: [{ evaluator: "manual_confirm", auto_verifiable: false, match: {} }],
  },
  xp_reward: 10,
  completed_at: null,
  metadata: {
    plan_key: "launch-proof",
    decomposition_contract: {
      required_evidence: ["Approval note", "Launch URL"],
    },
  },
};

const goal: Goal = {
  id: GOAL,
  owner_id: OWNER,
  title: "Launch a local cockpit",
  description: "Ship the alpha loop.",
  domain: "software",
  status: "active",
  target_date: null,
  plan_json: null,
  metadata: {},
};

const intake: AimIntakeReport = {
  title: "Launch a local cockpit",
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
  questions: [{
    id: "done_signal",
    category: "eval_signal",
    priority: "high",
    source: "context_profile",
    reason: "missing_eval_signal",
    prompt: "What evidence proves the cockpit is ready?",
  }],
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

const contextSources: ContextSourceStatus = {
  version: 1,
  local: {
    enabled: true,
    filePaths: [],
    configured: true,
    source: "settings",
    resolvedWorkspaceRoot: "/Users/jenson/Desktop/Aimcub",
    resolvedFilePaths: [],
  },
  online: {
    enabled: false,
    sources: [],
    configuredCount: 0,
    enabledCount: 0,
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

const testT = (key: string, vars?: Record<string, unknown>): string => {
  if (!vars) return key;
  return `${key} ${JSON.stringify(vars)}`;
};
const englishT: I18n["t"] = (key, vars) => translate("en", key, vars);

describe("evidence submission helpers", () => {
  it("builds the manual proof draft and payload without IPC side effects", () => {
    const draft = emptyEvidenceDraft(milestone);

    expect(draft.requiredEvidence).toEqual([
      { text: "Approval note", satisfied: false },
      { text: "Launch URL", satisfied: false },
    ]);
    expect(evidenceDraftIsSubmittable(draft)).toBe(false);

    const submittable = {
      ...draft,
      proofNote: "  Approved for launch. ",
      url: "https://example.com/a, https://example.com/b\nhttps://example.com/c",
      requiredEvidence: [{ text: "Approval note", satisfied: true }],
    };

    expect(evidenceDraftIsSubmittable(submittable)).toBe(true);
    expect(evidenceSubmissionPayload(submittable)).toEqual({
      proofNote: "Approved for launch.",
      urls: ["https://example.com/a", "https://example.com/b", "https://example.com/c"],
      filePaths: [],
      requiredEvidence: [{ text: "Approval note", satisfied: true }],
    });
  });
});

describe("intake clarify helpers", () => {
  it("maps intake questions into clarify questions and builds context descriptions", () => {
    const clarify = intakeToClarifyOutput(intake, false);
    const answers = answersFor(clarify, {
      intake_done_signal: { labels: ["Automated evidence"], other: "CI proof" },
    });

    expect(shouldBlockForIntake(intake)).toBe(true);
    expect(clarify.questions[0]).toMatchObject({
      id: "intake_done_signal",
      kind: "assumption",
      source_dimension: "verifiability",
      selection_mode: "multiple",
    });
    expect(intakeToClarifyOutput(intake, true).questions[0]?.options[0]?.label).toBe("\u81ea\u52a8\u8bc1\u636e");
    expect(answers).toEqual([{
      question_id: "intake_done_signal",
      selected_label: "Automated evidence",
      selected_labels: ["Automated evidence"],
      other_text: "CI proof",
    }]);
    expect(buildDescriptionWithContext({
      baseDescription: "Ship the loop.",
      intakeClarify: clarify,
      intakeAnswers: { intake_done_signal: { labels: ["Automated evidence"], other: "CI proof" } },
      contextNote: "Use the desktop alpha contract.",
    })).toContain("Context collected before decomposition");
  });

  it("appends adaptive intake turns with stable history and unique ids", () => {
    const first = intakeToClarifyOutput(intake, false);
    const next = intakeToClarifyOutput({
      ...intake,
      questions: [{
        ...intake.questions[0]!,
        prompt: "Who must approve the cockpit before launch?",
      }],
    }, false);

    const merged = appendIntakeQuestions(first, next);
    expect(merged.questions.map((question) => question.question)).toEqual([
      "What evidence proves the cockpit is ready?",
      "Who must approve the cockpit before launch?",
    ]);
    expect(merged.questions.map((question) => question.id)).toEqual([
      "intake_done_signal",
      "intake_done_signal_2",
    ]);
    expect(appendIntakeQuestions(merged, next).questions).toHaveLength(2);
  });
});

describe("stage routing helpers", () => {
  it("keeps opened aims on run while unsaved plans route to contracts", () => {
    const detail: GoalDetail = {
      goal,
      milestones: [{ ...milestone, status: "completed", completed_at: "2026-07-07T00:00:00.000Z" }],
    };
    const plan: DecompositionOutput = {
      goal_summary: "Launch the loop.",
      domain: "software",
      rationale: "The aim needs proof.",
      nodes: [{
        key: "launch-proof",
        title: "Collect launch proof",
        description: "Add proof.",
        est_effort: "s",
        xp_reward: 10,
        acceptance_rule: milestone.acceptance_rule,
        decomposition_contract: null,
        routing_override: null,
      }],
      edges: [],
    };

    expect(cockpitStageFor("cockpit", goal, null)).toBe("run");
    expect(cockpitStageFor("cockpit", null, plan)).toBe("contracts");
    expect(progressRows(detail, null)[0]?.completed).toBe(true);
    expect(planNodeForMilestone(plan, milestone)?.key).toBe("launch-proof");
  });
});

describe("routing and settings helpers", () => {
  it("normalizes local agent detections and settings readiness", () => {
    const agents: LocalAgentDetection[] = [{
      id: "codex",
      name: "Codex CLI",
      runMode: "local_cli",
      available: true,
      path: "/opt/codex",
      version: "1.0.0",
      authStatus: "ok",
      authMessage: null,
      models: [{ id: "gpt-5", label: "GPT-5" }],
      modelsSource: "fallback",
      reasoningOptions: [],
      diagnostics: [],
    }];
    const routingAgents = routingAgentsFromDetections(agents);

    expect(routingAgents).toEqual([{
      id: "codex",
      label: "Codex CLI",
      available: true,
      authenticated: true,
      models: [{ id: "gpt-5", label: "GPT-5" }],
      unavailableReason: null,
    }]);
    expect(formatRoutingValidation({
      ok: false,
      issues: [{
        nodeKey: "launch-proof",
        code: "missing_agent_selection",
        title: "Missing agent",
        message: "Select a ready agent.",
      }],
    })).toBe("Missing agent: Select a ready agent.");
    const settings = buildSettingsModel({
      provider: null,
      webResearch: {
        configured: false,
        provider: "brave",
        enabled: true,
        fetchPages: true,
        hasApiKey: false,
        keySource: null,
      },
      contextSources,
      localAgents: agents,
    }, testT);
    expect(settings.planningReady).toBe(true);
    expect(settings.webResearchHelper.status).toBe("intake.ready");
  });
});

describe("planning live event helpers", () => {
  it("uses the latest non-null live value", () => {
    expect(latestLiveValue([
      { runId: "a", type: "planning.started", stage: "planning", at: "2026-07-07T00:00:00.000Z", message: "started" },
      { runId: "a", type: "planning.failed", stage: "planning", at: "2026-07-07T00:00:01.000Z" },
    ], (event) => event.message)).toBe("started");
  });
});

describe("planning error helpers", () => {
  it("formats raw validation paths into user-facing save text while keeping developer details", () => {
    const raw = "nodes.10.acceptance_rule.clauses.0.match.min_files: Invalid input";
    const issueText = formatPlanValidationIssues([raw], englishT);
    const error = formatPlanningFailure({ stage: "save", errors: [raw], t: englishT });

    expect(issueText).toEqual(["A sub-aim contract has invalid structured fields."]);
    expect(error.title).toBe("Plan needs repair before saving");
    expect(error.message).toBe("A sub-aim contract has invalid structured fields.");
    expect(error.recovery).toContain("Stay in Plan");
    expect(`${error.title} ${error.message} ${error.recovery}`).not.toContain("nodes.10");
    expect(error.details).toEqual([raw]);
  });

  it("keeps draft and refine failures on retryable Context routes", () => {
    expect(routeAfterPlanningFailure("draft")).toEqual({ mode: "contexting", stageOverride: "context" });
    expect(routeAfterPlanningFailure("refine")).toEqual({ mode: "answering", stageOverride: "context" });
    expect(routeAfterPlanningFailure("save")).toEqual({ mode: "reviewing", stageOverride: "contracts" });
  });
});
