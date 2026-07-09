import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { routingRecommendationForPlanNode, type RoutingRuntimeAgentOption } from "@core/domain";
import type { AimDraft, AimProgressReadModel, DecompositionOutput, Goal, Milestone } from "@core/types";
import type { ContextSourceStatus, GoalDetail, ProviderStatus, WebResearchStatus } from "../shared/ipc";

import { App, buildSettingsModel, InitialWorkspacePanel, SettingsPanel } from "./App";
import { CockpitShell, WORKBENCH_STAGE_IDS } from "./CockpitShell";
import { I18nProvider, STRINGS, translate, type I18n } from "./i18n";
import { EvidenceSubmissionForm } from "./stages/execute/EvidenceSubmissionForm";
import { ExecutePanel } from "./stages/execute/ExecutePanel";
import { LocalAgentExecutionSummary } from "./stages/execute/LocalAgentExecutionSummary";
import { PlanContractCard } from "./stages/plan/PlanContractCard";
import { PlanPanel } from "./stages/plan/PlanPanel";
import { editableContractForNode, formatAcceptanceRule } from "./stages/plan/planContract";

const OWNER = "00000000-0000-4000-8000-000000000001";
const GOAL = "00000000-0000-4000-8000-000000000010";
const MILESTONE = "00000000-0000-4000-8000-000000000020";

const milestone: Milestone = {
  id: MILESTONE,
  goal_id: GOAL,
  owner_id: OWNER,
  title: "Approve release",
  description: "Human approval is required.",
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
    decomposition_contract: {
      why: "The user owns approval.",
      definition_of_done: "The user approves the release.",
      required_evidence: ["Approval note."],
      likely_owner: "human",
      context_gaps: [],
      eval_signal: "Done means the user confirms approval.",
    },
  },
};

const savedGoal: Goal = {
  id: GOAL,
  owner_id: OWNER,
  title: "Ship a sidebar pass",
  description: "Refine the desktop sidebar.",
  domain: "software",
  status: "active",
  target_date: null,
  plan_json: null,
  metadata: {},
};

const noop = () => {};
const asyncNoop = async () => {};
const testT: I18n["t"] = (key, vars) => translate("en", key, vars);

const providerStatus: ProviderStatus = {
  configured: false,
  provider: null,
  model: null,
  baseURL: null,
  hasApiKey: false,
};

const webResearchStatus: WebResearchStatus = {
  configured: false,
  provider: "brave",
  enabled: false,
  fetchPages: true,
  hasApiKey: false,
  keySource: null,
};

const contextSourceStatus: ContextSourceStatus = {
  version: 1,
  local: {
    enabled: false,
    filePaths: [],
    configured: false,
    source: null,
    resolvedWorkspaceRoot: null,
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

const contractPlan: DecompositionOutput = {
  goal_summary: "Ship a useful contract review.",
  domain: "software",
  rationale: "The aim needs execution contracts before work is saved.",
  nodes: [
    {
      key: "contract-review",
      title: "Review execution contracts",
      description: "Check the sub-aim contract before saving.",
      est_effort: "s",
      xp_reward: 10,
      acceptance_rule: {
        logic: "all",
        threshold: 1,
        completion_mode: "auto_then_confirm",
        clauses: [{ evaluator: "manual_confirm", auto_verifiable: false, match: {} }],
      },
      decomposition_contract: {
        why: "The user needs a clear agreement before execution starts.",
        definition_of_done: "Every sub-aim has a clear owner and evidence standard.",
        required_evidence: ["Reviewed contract notes.", "Selected owner."],
        likely_owner: "agent",
        context_gaps: [],
        eval_signal: "The saved aim contains reviewed contract terms.",
      },
      routing_override: null,
    },
  ],
  edges: [],
};

const draftRow: AimDraft = {
  id: "00000000-0000-4000-8000-000000000090",
  owner_id: OWNER,
  title: "Unfinished local-first aim",
  description: "This work has not been saved as an aim yet.",
  parent_goal_id: null,
  parent_milestone_id: null,
  current_stage: "contracts",
  phase: "post_draft",
  status: "save_blocked",
  context_note: "Keep the context note.",
  intake_questions: [],
  intake_answers: [],
  clarify_questions: [],
  clarify_answers: [],
  clarify_assumptions: [],
  draft_plan: null,
  final_plan: contractPlan,
  save_block: {
    title: "Aim needs a plan repair",
    message: "Acceptance rule needs repair.",
    recovery: "Edit the contract, then save again.",
    issues: ["Acceptance rule needs repair."],
  },
  created_at: "2026-07-09T00:00:00.000Z",
  updated_at: "2026-07-09T00:01:00.000Z",
};

const routingAgents: RoutingRuntimeAgentOption[] = [
  {
    id: "codex",
    label: "Codex CLI",
    available: true,
    authenticated: true,
    models: [{ id: "gpt-5", label: "GPT-5" }],
  },
];

const AGENT_MILESTONE = "00000000-0000-4000-8000-000000000071";
const HUMAN_MILESTONE = "00000000-0000-4000-8000-000000000072";
const COMPLETE_MILESTONE = "00000000-0000-4000-8000-000000000073";
const LOW_TRUST_MILESTONE = "00000000-0000-4000-8000-000000000074";
const AGENT_ACTOR = "00000000-0000-4000-8000-000000000075";

function executeMilestone(id: string, title: string, owner: "agent" | "human", status: Milestone["status"] = "pending"): Milestone {
  return {
    ...milestone,
    id,
    title,
    status,
    completed_at: status === "completed" ? "2026-07-07T09:00:00.000Z" : null,
    metadata: {
      ...milestone.metadata,
      routing_override: owner === "agent"
        ? {
          owner: "agent",
          agent_id: "codex",
          agent_label: "Codex CLI",
          run_mode: "local_cli",
          model: "gpt-5",
          model_label: "GPT-5",
          reason: "Use the local coding agent.",
        }
        : {
          owner: "human",
          agent_id: null,
          agent_label: null,
          run_mode: null,
          model: null,
          model_label: null,
          reason: "The user must provide proof.",
        },
    },
  };
}

function executeRow(input: {
  id: string;
  title: string;
  owner: "agent" | "human";
  completed?: boolean;
  lowTrust?: boolean;
}): AimProgressReadModel["milestones"][number] {
  const completed = input.completed ?? false;
  const lowTrust = input.lowTrust ?? false;
  const currentMilestone = executeMilestone(input.id, input.title, input.owner, completed ? "completed" : "pending");
  return {
    milestone: currentMilestone,
    assignment: {
      id: `00000000-0000-4000-8000-0000000001${input.id.slice(-2)}`,
      owner_id: OWNER,
      goal_id: GOAL,
      milestone_id: input.id,
      actor_kind: input.owner,
      actor_id: input.owner === "agent" ? AGENT_ACTOR : null,
      status: "assigned",
      source: "routing",
      reason: input.owner === "agent" ? "Agent-routed software work." : "Human proof is required.",
      capability_tags: input.owner === "agent" ? ["code"] : [],
      created_at: "2026-07-07T09:00:00.000Z",
      updated_at: "2026-07-07T09:00:00.000Z",
    },
    latest_run: input.owner === "agent" ? {
      id: `00000000-0000-4000-8000-0000000002${input.id.slice(-2)}`,
      owner_id: OWNER,
      goal_id: GOAL,
      milestone_id: input.id,
      assignment_id: `00000000-0000-4000-8000-0000000001${input.id.slice(-2)}`,
      actor_kind: "agent",
      actor_id: AGENT_ACTOR,
      kind: "agent",
      status: completed || lowTrust ? "completed" : "queued",
      attempt: 1,
      workspace_root: "/Users/jenson/project",
      sandbox: "read-only",
      network_enabled: false,
      model: "gpt-5",
      reasoning: "high",
      summary: "Agent run summarized.",
      error: null,
      queued_at: "2026-07-07T09:00:00.000Z",
      started_at: "2026-07-07T09:00:05.000Z",
      finished_at: completed || lowTrust ? "2026-07-07T09:04:00.000Z" : null,
      created_at: "2026-07-07T09:00:00.000Z",
    } : null,
    child_relations: [],
    eval_review: {
      passed: completed,
      matched_evidence_ids: completed ? ["00000000-0000-4000-8000-000000000081"] : [],
      trust_score: completed ? 0.92 : lowTrust ? 0.54 : 0,
      reason: completed ? "Eval passed." : lowTrust ? "Evidence is below the trust floor." : "",
      next_action: lowTrust ? "Review low-trust evidence in Eval." : completed ? "Review the completed evidence in Eval." : "",
    },
    evaluator_results: [],
    evidence: lowTrust || completed ? [{
      evidence: {
        id: lowTrust ? "00000000-0000-4000-8000-000000000082" : "00000000-0000-4000-8000-000000000081",
        owner_id: OWNER,
        goal_id: GOAL,
        milestone_id: input.id,
        emitter_id: null,
        kind: "mcp_report",
        source_event_id: `execute-test:${input.id}`,
        occurred_at: "2026-07-07T09:04:00.000Z",
        summary: lowTrust ? "Agent self-report needs review." : "Trusted proof was recorded.",
        payload: {
          agent_id: "codex",
          model: "gpt-5",
          events: [
            { type: "agent.run.started", summary: "Codex CLI started." },
            { type: "agent.message.delta", summary: "Raw message delta should stay hidden." },
            { type: "agent.raw", summary: "Raw stream event should stay hidden." },
            { type: "agent.run.completed", summary: "Local agent completed." },
          ],
        },
        trust_score: lowTrust ? 0.54 : 0.92,
        created_at: "2026-07-07T09:04:00.000Z",
      },
      rule_matches: completed ? [{ clause_index: 0, evaluator: "manual_confirm" }] : [],
      status: lowTrust ? "low_trust" : "matched",
      review_note: lowTrust ? "Trust is below the floor." : "Matches rule 1.",
    }] : [],
    evidence_count: lowTrust || completed ? 1 : 0,
    completed,
    blocked: false,
    next_action: completed ? "Completed." : lowTrust ? "Review low-trust evidence." : "Run the next work.",
  };
}

function executeProgress(rows: AimProgressReadModel["milestones"]): AimProgressReadModel {
  return {
    goal: savedGoal,
    milestones: rows,
    actors: [{
      id: AGENT_ACTOR,
      owner_id: OWNER,
      kind: "agent",
      display_name: "Codex CLI",
      capabilities: ["code"],
      status: "active",
      agent_kind: "local_cli",
      run_mode: "local_cli",
      model: "gpt-5",
      connection_ref: null,
      created_at: "2026-07-07T09:00:00.000Z",
    }],
    assignments: rows.flatMap((row) => row.assignment ? [row.assignment] : []),
    runs: rows.flatMap((row) => row.latest_run ? [row.latest_run] : []),
    sub_aim_relations: [],
    context_candidates: [],
    completion_recap: null,
    completed_milestones: rows.filter((row) => row.completed).length,
    total_milestones: rows.length,
    blocked_count: rows.filter((row) => row.blocked).length,
    next_action: "Continue selected work.",
  };
}

function renderExecute(rows: AimProgressReadModel["milestones"]): string {
  const detail: GoalDetail = {
    goal: savedGoal,
    milestones: rows.map((row) => row.milestone),
  };
  return renderToStaticMarkup(
    <I18nProvider>
      <ExecutePanel
        detail={detail}
        progress={executeProgress(rows)}
        disabled={false}
        onRunAgent={noop}
        onConfirm={asyncNoop}
        onPickFiles={async () => []}
        onBreakDown={noop}
        onReviewEval={noop}
      />
    </I18nProvider>,
  );
}

describe("EvidenceSubmissionForm", () => {
  it("renders proof note, URL, file, and required evidence controls", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <EvidenceSubmissionForm
          milestone={milestone}
          draft={{
            proofNote: "",
            url: "",
            filePaths: [],
            requiredEvidence: [{ text: "Approval note.", satisfied: false }],
          }}
          disabled={false}
          pickingFiles={false}
          onChange={noop}
          onPickFiles={noop}
          onCancel={noop}
          onSubmit={noop}
        />
      </I18nProvider>,
    );

    expect(html).toContain("Submit evidence");
    expect(html).toContain("Proof note");
    expect(html).toContain("URL");
    expect(html).toContain("Local file references");
    expect(html).toContain("Approval note.");
    expect(html).toContain("Submit proof");
  });
});

describe("ExecutePanel", () => {
  it("keeps the Execute stage out of the App controller body", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

    expect(source).not.toContain("export function ExecutePanel");
    expect(source).not.toContain("function ExecutePanel");
    expect(source).not.toContain('className="od-execute-layout"');
    expect(source).not.toContain("activeProofId");
  });

  it("renders a selected-work surface with a compact sub-aim selector", () => {
    const html = renderExecute([
      executeRow({ id: AGENT_MILESTONE, title: "Run implementation agent", owner: "agent" }),
      executeRow({ id: HUMAN_MILESTONE, title: "Submit launch approval", owner: "human" }),
    ]);

    expect(html).toContain('class="od-execute-layout"');
    expect(html).toContain('aria-label="Sub-aims"');
    expect(html).toContain('aria-label="Selected work detail"');
    expect(html).toContain("Run implementation agent");
    expect(html).toContain("Agent route");
    expect(html).toContain("Human route");
    expect(html).toContain("Selected sub-aim");
    expect(html).toContain("Primary action");
  });

  it("shows one dominant Run agent primary action for an agent-routed incomplete sub-aim", () => {
    const html = renderExecute([
      executeRow({ id: AGENT_MILESTONE, title: "Run implementation agent", owner: "agent" }),
      executeRow({ id: HUMAN_MILESTONE, title: "Submit launch approval", owner: "human" }),
    ]);

    expect(html.match(/class="od-aim-primary od-execute-primary-button"/g) ?? []).toHaveLength(1);
    expect(html).toContain('<button class="od-aim-primary od-execute-primary-button" type="button">Run agent</button>');
    expect(html).toContain('class="od-execute-secondary-actions"');
    expect(html).toContain('<button class="od-aim-secondary" type="button">Submit proof</button>');
    expect(html).toContain('<button class="od-aim-secondary" type="button">Break down</button>');
    expect(html).not.toContain('class="od-aim-primary od-execute-primary-button" type="button">Break down</button>');
  });

  it("shows Submit proof as the primary action for a human-routed incomplete sub-aim", () => {
    const html = renderExecute([
      executeRow({ id: HUMAN_MILESTONE, title: "Submit launch approval", owner: "human" }),
    ]);

    expect(html.match(/class="od-aim-primary od-execute-primary-button"/g) ?? []).toHaveLength(1);
    expect(html).toContain('<button class="od-aim-primary od-execute-primary-button" type="button">Submit proof</button>');
    expect(html).toContain("Submit human proof with the required evidence checklist.");
    expect(html).toContain('<button class="od-aim-secondary" type="button">Break down</button>');
    expect(html).not.toContain('<button class="od-aim-secondary" type="button">Run agent</button>');
  });

  it("routes completed and low-trust selected work to Eval review instead of expanding evidence detail", () => {
    const completedHtml = renderExecute([
      executeRow({ id: COMPLETE_MILESTONE, title: "Review completed proof", owner: "agent", completed: true }),
    ]);
    const lowTrustHtml = renderExecute([
      executeRow({ id: LOW_TRUST_MILESTONE, title: "Inspect low-trust report", owner: "agent", lowTrust: true }),
    ]);

    expect(completedHtml).toContain('<button class="od-aim-primary od-execute-primary-button" type="button">Review in Eval</button>');
    expect(lowTrustHtml).toContain('<button class="od-aim-primary od-execute-primary-button" type="button">Review in Eval</button>');
    expect(lowTrustHtml).toContain("Low-trust evidence needs review");
    expect(lowTrustHtml).not.toContain("Trust is below the floor.");
    expect(lowTrustHtml).not.toContain('class="od-evidence-review');
  });

  it("keeps Break Down secondary and raw agent deltas hidden", () => {
    const html = renderExecute([
      executeRow({ id: LOW_TRUST_MILESTONE, title: "Inspect low-trust report", owner: "agent", lowTrust: true }),
    ]);

    expect(html).toContain('class="od-execute-secondary-actions"');
    expect(html).toContain('<button class="od-aim-secondary" type="button">Break down</button>');
    expect(html).not.toContain('class="od-aim-primary od-execute-primary-button" type="button">Break down</button>');
    expect(html).toContain("Activity");
    expect(html).not.toContain("Raw message delta");
    expect(html).not.toContain("Raw stream event");
  });
});

describe("LocalAgentExecutionSummary", () => {
  it("shows selected sub-aim, local agent config, low-trust evidence, activity, and next eval action", () => {
    const row: AimProgressReadModel["milestones"][number] = {
      milestone: {
        ...milestone,
        title: "Implement execution skeleton",
        description: "Clarify the local-agent run display without adding a durable queue.",
      },
      assignment: {
        id: "00000000-0000-4000-8000-000000000030",
        owner_id: OWNER,
        goal_id: GOAL,
        milestone_id: MILESTONE,
        actor_kind: "agent",
        actor_id: "00000000-0000-4000-8000-000000000040",
        status: "assigned",
        source: "routing",
        reason: "Agent-routed software work.",
        capability_tags: ["code"],
        created_at: "2026-07-07T01:00:00.000Z",
        updated_at: "2026-07-07T01:00:00.000Z",
      },
      latest_run: {
        id: "00000000-0000-4000-8000-000000000050",
        owner_id: OWNER,
        goal_id: GOAL,
        milestone_id: MILESTONE,
        assignment_id: "00000000-0000-4000-8000-000000000030",
        actor_kind: "agent",
        actor_id: "00000000-0000-4000-8000-000000000040",
        kind: "agent",
        status: "completed",
        attempt: 1,
        workspace_root: "/Users/jenson/project",
        sandbox: "read-only",
        network_enabled: false,
        model: "gpt-5",
        reasoning: "high",
        summary: "Local agent completed its run.",
        error: null,
        queued_at: "2026-07-07T01:00:00.000Z",
        started_at: "2026-07-07T01:00:05.000Z",
        finished_at: "2026-07-07T01:02:00.000Z",
        created_at: "2026-07-07T01:00:00.000Z",
      },
      child_relations: [],
      eval_review: {
        passed: false,
        matched_evidence_ids: [],
        trust_score: 0.6,
        reason: "1 evidence item is below the auto-verification trust floor.",
        next_action: "Add trusted webhook or CI evidence, or confirm manually if the proof is sufficient.",
      },
      evaluator_results: [],
      evidence: [{
        evidence: {
          id: "00000000-0000-4000-8000-000000000060",
          owner_id: OWNER,
          goal_id: GOAL,
          milestone_id: MILESTONE,
          emitter_id: null,
          kind: "mcp_report",
          source_event_id: "local-agent:codex:1",
          occurred_at: "2026-07-07T01:02:00.000Z",
          summary: "Local agent worked on the execution display.",
          payload: {
            agent_id: "codex",
            model: "gpt-5",
            events: [
              { type: "agent.run.started", summary: "Codex CLI started." },
              { type: "agent.tool.started", summary: "shell" },
              { type: "agent.message.delta", summary: "Verbose assistant output that should not become the default activity list." },
              { type: "agent.run.completed", summary: "Local agent run completed." },
            ],
          },
          trust_score: 0.6,
          created_at: "2026-07-07T01:02:00.000Z",
        },
        rule_matches: [],
        status: "low_trust",
        review_note: "Trust is below the floor for auto-verifiable rules.",
      }],
      evidence_count: 1,
      completed: false,
      blocked: false,
      next_action: "Review low-trust evidence.",
    };

    const html = renderToStaticMarkup(
      <I18nProvider>
        <LocalAgentExecutionSummary
          row={row}
          actors={[{
            id: "00000000-0000-4000-8000-000000000040",
            owner_id: OWNER,
            kind: "agent",
            display_name: "Codex CLI",
            capabilities: ["code"],
            status: "active",
            agent_kind: "local_cli",
            run_mode: "local_cli",
            model: "gpt-5",
            connection_ref: null,
            created_at: "2026-07-07T01:00:00.000Z",
          }]}
        />
      </I18nProvider>,
    );
    const css = readFileSync(new URL("./cockpit.css", import.meta.url), "utf8");

    expect(html).toContain("Selected sub-aim");
    expect(html).toContain("Implement execution skeleton");
    expect(html).toContain("Codex CLI");
    expect(html).toContain("Completed");
    expect(html).toContain("Produced evidence");
    expect(html).toContain("Next human/eval action");
    expect(html).toContain("Runtime details");
    expect(html).toContain("gpt-5");
    expect(html).toContain("Reasoning: high");
    expect(html).toContain("/Users/jenson/project");
    expect(html).toContain("Sandbox read-only");
    expect(html).toContain("Network off");
    expect(html).toContain("Low-trust evidence needs review");
    expect(html).toContain("1/1 evidence item(s) are below the trust floor.");
    expect(html).toContain("Next human/eval action");
    expect(html).toContain("Add trusted webhook or CI evidence");
    expect(html).toContain("Activity");
    expect(html).toContain("Started");
    expect(html).toContain("Tool started");
    expect(html).not.toContain("Verbose assistant output");
    expect(css).toMatch(/\.od-execution-grid\s*{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/s);
    expect(css).toMatch(/\.od-execution-runtime\s*{[^}]*border-top:\s*1px solid var\(--od-border-soft\);/s);

    const rawOnlyRow: AimProgressReadModel["milestones"][number] = {
      ...row,
      latest_run: row.latest_run ? { ...row.latest_run, summary: "" } : null,
      evidence: [{
        ...row.evidence[0]!,
        evidence: {
          ...row.evidence[0]!.evidence,
          payload: {
            agent_id: "codex",
            model: "gpt-5",
            events: [
              { type: "agent.message.delta", summary: "Raw message delta should stay hidden." },
              { type: "agent.raw", summary: "Raw stream event should stay hidden." },
            ],
          },
        },
      }],
    };
    const rawOnlyHtml = renderToStaticMarkup(
      <I18nProvider>
        <LocalAgentExecutionSummary
          row={rawOnlyRow}
          actors={[]}
        />
      </I18nProvider>,
    );
    expect(rawOnlyHtml).not.toContain("Raw message delta");
    expect(rawOnlyHtml).not.toContain("Raw stream event");
    expect(rawOnlyHtml).toContain("No run activity has been recorded.");
  });
});

describe("App first-run workspace", () => {
  it("keeps the initial main workspace free of the aim composer", () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain('class="od-initial-workspace"');
    expect(html).toContain("Workspace ready");
    expect(html).toContain("Create a new aim when you are ready to start.");
    expect(html).not.toContain('class="od-aim-composer"');
    expect(html).not.toContain('id="aim-title"');
    expect(html).not.toContain('id="aim-context"');
    expect(html).not.toContain(">Continue</button>");
  });

  it("shows recoverable drafts on the Home panel without calling them saved aims", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <InitialWorkspacePanel
          drafts={[draftRow]}
          onResumeDraft={noop}
          onDiscardDraft={noop}
        />
      </I18nProvider>,
    );

    expect(html).toContain("Drafts in progress");
    expect(html).toContain("Resume aim-building work or discard it explicitly.");
    expect(html).toContain("Unfinished local-first aim");
    expect(html).toContain("Save blocked");
    expect(html).toContain("More actions for Unfinished local-first aim");
    expect(html).not.toContain("od-draft-recovery-action");
    expect(html).not.toContain("od-draft-discard");
    expect(html).not.toContain(">Discard</button>");
    expect(html).not.toContain("Saved aim");
    expect(html).not.toContain("Saved aims");
  });
});

describe("App planning state guards", () => {
  it("keeps product error details behind an explicit developer disclosure", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

    expect(source).toContain('className="od-notice-copy"');
    expect(source).toContain('className="od-notice-details"');
    expect(source).toContain('summary>{t("plan.developerDetails")}</summary>');
    expect(source).toContain('props.error.details.join("\\n")');
  });

  it("clears stale draft, error, and context state for New Aim and opened aims", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    const resetComposer = source.match(/function resetComposer[\s\S]*?\n {2}function descriptionWithContext/)?.[0] ?? "";
    const openGoal = source.match(/async function openGoal[\s\S]*?\n {2}async function refreshGoalState/)?.[0] ?? "";

    for (const body of [resetComposer, openGoal]) {
      expect(body).toContain("setDraft(null)");
      expect(body).toContain("setFinalPlan(null)");
      expect(body).toContain("setPlanResult(null)");
      expect(body).toContain("setPlanningDebugTraces([])");
      expect(body).toContain("setPlanningLiveEvents([])");
      expect(body).toContain("setIntakeClarify(null)");
      expect(body).toContain("setIntakeAnswers({})");
      expect(body).toContain("setClarify(null)");
      expect(body).toContain("setAnswers({})");
      expect(body).toContain("setContextNote(\"\")");
      expect(body).toContain("setError(null)");
    }

    expect(resetComposer).toContain("setAimTitle(\"\")");
    expect(resetComposer).toContain("setAimDescription(\"\")");
    expect(openGoal).toContain("setAimComposerOpen(false)");
  });

  it("keeps plan validation failures repairable instead of disabling contract edits", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    const planPanel = source.match(/<PlanPanel[\s\S]*?\/>/)?.[0] ?? "";

    expect(planPanel).toContain("validationErrors={activePlanValidationMessages}");
    expect(planPanel).toContain("disabled={Boolean(busy)}");
    expect(planPanel).not.toContain("activePlanValidation?.ok === false");
  });

  it("autosaves draft state before Home, New Aim, or opening a saved aim clears the composer", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    const openGoal = source.match(/async function openGoal[\s\S]*?\n {2}async function refreshGoalState/)?.[0] ?? "";
    const startNewAim = source.match(/async function startNewAim[\s\S]*?\n {2}async function openHomePanel/)?.[0] ?? "";
    const openHomePanel = source.match(/async function openHomePanel[\s\S]*?\n {2}function openSettingsForAim/)?.[0] ?? "";

    expect(openGoal).toContain("await persistCurrentDraftNow();");
    expect(startNewAim.indexOf("await persistCurrentDraftNow();")).toBeLessThan(startNewAim.indexOf("resetComposer({ openComposer: true })"));
    expect(openHomePanel.indexOf("await persistCurrentDraftNow();")).toBeLessThan(openHomePanel.indexOf("resetComposer();"));
    expect(source).toContain("window.aimcub.upsertAimDraft(req)");
    expect(source).not.toContain("localStorage.setItem(\"aim");
  });

  it("clears the saved draft only after saveGoal succeeds", () => {
    const appSource = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    const mainIpcSource = readFileSync(new URL("../main/ipc.ts", import.meta.url), "utf8");
    const savePlan = appSource.match(/async function savePlan[\s\S]*?\n {2}async function runAgent/)?.[0] ?? "";
    const persistCurrentDraftNow = appSource.match(/async function persistCurrentDraftNow[\s\S]*?\n {2}async function refreshAimDrafts/)?.[0] ?? "";

    expect(persistCurrentDraftNow).toContain("if (draftPersistencePausedRef.current || selected) return null;");
    expect(savePlan.indexOf("const savedDraft = await persistCurrentDraftNow();")).toBeLessThan(savePlan.indexOf("draftPersistencePausedRef.current = true;"));
    expect(savePlan.indexOf("draftPersistencePausedRef.current = true;")).toBeLessThan(savePlan.indexOf("window.aimcub.saveGoal"));
    expect(savePlan).toContain("draftId: savedDraft?.id ?? activeDraftIdRef.current ?? undefined");
    expect(savePlan).toContain("draftPersistencePausedRef.current = false;");
    expect(mainIpcSource).toContain("if (req.draftId) await aimStore.discardAimDraft(req.draftId);");
  });

  it("requires an explicit discard path for draft deletion", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    const discard = source.match(/async function discardAimDraft[\s\S]*?\n {2}useEffect/)?.[0] ?? "";

    expect(discard).not.toContain("window.confirm");
    expect(discard).toContain("window.aimcub.discardAimDraft(draftRow.id)");
  });

  it("keeps typed draft IPC wired through shared channels and preload", () => {
    const shared = readFileSync(new URL("../shared/ipc.ts", import.meta.url), "utf8");
    const preload = readFileSync(new URL("../preload/index.ts", import.meta.url), "utf8");
    const mainIpc = readFileSync(new URL("../main/ipc.ts", import.meta.url), "utf8");

    for (const channel of ["listAimDrafts", "getAimDraft", "upsertAimDraft", "discardAimDraft"]) {
      expect(shared).toContain(`${channel}: "aimcub:${channel}"`);
      expect(preload).toContain(`${channel}:`);
      expect(mainIpc).toContain(`IPC.${channel}`);
    }
  });
});

describe("PlanPanel", () => {
  it("renders summary-first contract cards by default without raw acceptance JSON", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <PlanPanel
          plan={contractPlan}
          quality={null}
          review={null}
          saved={false}
          disabled={false}
          validationErrors={[]}
          routingAgents={routingAgents}
          routingValidation={null}
          onChange={noop}
          onSave={noop}
        />
      </I18nProvider>,
    );
    const css = readFileSync(new URL("./cockpit.css", import.meta.url), "utf8");
    const titleIndex = html.indexOf("Sub-aim title");
    const routeIndex = html.indexOf("recommend human");
    const doneIndex = html.indexOf("Done when");
    const evidenceIndex = html.indexOf("Evidence needed");
    const rationaleIndex = html.indexOf("Routing rationale");
    const detailsIndex = html.indexOf("Contract details");

    expect(html).toContain("Execution contracts");
    expect(html).toContain("Review each sub-aim, owner, proof, and route.");
    expect(titleIndex).toBeGreaterThanOrEqual(0);
    expect(routeIndex).toBeGreaterThan(titleIndex);
    expect(doneIndex).toBeGreaterThan(routeIndex);
    expect(evidenceIndex).toBeGreaterThan(doneIndex);
    expect(rationaleIndex).toBeGreaterThan(evidenceIndex);
    expect(html).toContain("Every sub-aim has a clear owner and evidence standard.");
    expect(html).toContain("Reviewed contract notes.");
    expect(html).toContain("Selected owner.");
    expect(html).toContain("The eval rule requires manual confirmation, so Aimcub recommends a human route.");
    expect(detailsIndex).toBeGreaterThan(rationaleIndex);
    expect(html.indexOf("Sub-aim body")).toBeGreaterThan(detailsIndex);
    expect(html.indexOf("Why this exists")).toBeGreaterThan(detailsIndex);
    expect(html.indexOf("Eval signal")).toBeGreaterThan(detailsIndex);
    expect(html).toContain("Routing controls");
    expect(html).toContain("Structure edits");
    expect(html).toContain("Developer details");
    expect(html).toContain("Save aim");
    expect(html).not.toContain("Acceptance check");
    expect(html).not.toContain("Acceptance rule");
    expect(html).not.toContain("completion_mode");
    expect(html).not.toContain("auto_then_confirm");
    expect(html).not.toContain("manual_confirm");
    expect(html).not.toContain("clauses");
    expect(css).toMatch(/\.od-plan-contract-card\s*{[^}]*border:\s*1px solid var\(--od-border-soft\);[^}]*padding:\s*12px 14px;/s);
    expect(css).toMatch(/\.od-plan-contract-summary,\s*\.od-plan-contract-review\s*{[^}]*border-top:\s*1px solid var\(--od-border-soft\);/s);
    expect(css).toMatch(/\.od-plan-edit-details,\s*\.od-plan-routing-details,\s*\.od-plan-structure-details\s*{[^}]*border-top:\s*1px solid var\(--od-border-soft\);/s);
    expect(css).toMatch(/\.od-plan-route-chip\s*{[^}]*min-height:\s*26px;[^}]*border:\s*1px solid var\(--od-border-soft\);/s);
    expect(css).toMatch(/\.od-plan-advanced-body\s*{[^}]*border-top:\s*1px solid var\(--od-border-soft\);/s);
  });

  it("keeps contract, routing, and structure controls collapsed but reachable", () => {
    const node = contractPlan.nodes[0]!;
    const html = renderToStaticMarkup(
      <I18nProvider>
        <PlanContractCard
          node={node}
          index={1}
          nodeCount={3}
          editable
          disabled={false}
          contract={editableContractForNode(node)}
          recommendation={routingRecommendationForPlanNode(node)}
          owner="agent"
          selectedAgent={routingAgents[0]!}
          selectedModel="gpt-5"
          readyAgents={routingAgents}
          nodeIssues={["Codex CLI needs authentication."]}
          overrideActive
          ruleText={formatAcceptanceRule(node.acceptance_rule)}
          advancedOpen={false}
          onNode={noop}
          onContract={noop}
          onMoveUp={noop}
          onMoveDown={noop}
          onMergeUp={noop}
          onMergeDown={noop}
          onSplit={noop}
          onOwner={noop}
          onAgent={noop}
          onModel={noop}
          onRoutingReset={noop}
          onAdvancedToggle={noop}
          onRuleText={noop}
          onRuleCommit={noop}
        />
      </I18nProvider>,
    );

    expect(html).toContain('<details class="od-plan-edit-details">');
    expect(html).toContain('<details class="od-plan-routing-details">');
    expect(html).toContain('<details class="od-plan-structure-details">');
    expect(html).not.toContain('<details class="od-plan-edit-details" open');
    expect(html).not.toContain('<details class="od-plan-routing-details" open');
    expect(html).not.toContain('<details class="od-plan-structure-details" open');
    expect(html).toContain("Sub-aim body");
    expect(html).toContain("Why this exists");
    expect(html).toContain("Done when");
    expect(html).toContain("Evidence needed");
    expect(html).toContain("Eval signal");
    expect(html).toContain("Human");
    expect(html).toContain("Agent");
    expect(html).toContain("Codex CLI");
    expect(html).toContain("GPT-5");
    expect(html).toContain("Use recommendation");
    expect(html).toContain('aria-label="Move up"');
    expect(html).toContain('aria-label="Move down"');
    expect(html).toContain('aria-label="Merge up"');
    expect(html).toContain('aria-label="Merge down"');
    expect(html).toContain('aria-label="Split"');
    expect(html).toContain("Route needs attention");
    expect(html).toContain("Codex CLI needs authentication.");
  });

  it("keeps acceptance rule editing inside Developer details", () => {
    const node = contractPlan.nodes[0]!;
    const html = renderToStaticMarkup(
      <I18nProvider>
        <PlanContractCard
          node={node}
          index={0}
          nodeCount={contractPlan.nodes.length}
          editable
          disabled={false}
          contract={editableContractForNode(node)}
          recommendation={routingRecommendationForPlanNode(node)}
          owner="agent"
          selectedAgent={routingAgents[0]!}
          selectedModel="gpt-5"
          readyAgents={routingAgents}
          nodeIssues={[]}
          overrideActive={false}
          ruleText={formatAcceptanceRule(node.acceptance_rule)}
          advancedOpen
          onNode={noop}
          onContract={noop}
          onMoveUp={noop}
          onMoveDown={noop}
          onMergeUp={noop}
          onMergeDown={noop}
          onSplit={noop}
          onOwner={noop}
          onAgent={noop}
          onModel={noop}
          onRoutingReset={noop}
          onAdvancedToggle={noop}
          onRuleText={noop}
          onRuleCommit={noop}
        />
      </I18nProvider>,
    );

    expect(html).toContain("Hide developer details");
    expect(html).toContain("Acceptance check");
    expect(html).toContain("You confirm it is done");
    expect(html).toContain("Acceptance rule");
    expect(html).toContain("Apply rule");
    expect(html).toContain("completion_mode");
    expect(html).toContain("auto_then_confirm");
    expect(html).toContain("clauses");
  });
});

describe("SettingsPanel", () => {
  it("renders only the selected settings detail pane", () => {
    const model = buildSettingsModel({
      provider: providerStatus,
      webResearch: webResearchStatus,
      contextSources: contextSourceStatus,
      localAgents: [],
    }, testT);
    const html = renderToStaticMarkup(
      <I18nProvider>
        <SettingsPanel
          provider={providerStatus}
          webResearch={webResearchStatus}
          contextSources={contextSourceStatus}
          localAgents={[]}
          model={model}
          activeSection="overview"
          onSection={noop}
          aimContext={null}
          onProvider={noop}
          onWeb={noop}
          onContextSources={noop}
          onRefreshAgents={asyncNoop}
        />
      </I18nProvider>,
    );
    const css = readFileSync(new URL("./cockpit.css", import.meta.url), "utf8");

    expect(html).toContain("Overview");
    expect(html).toContain("Planning status");
    expect(html).toContain("Configure");
    expect(html).not.toContain("Settings sections");
    expect(html).not.toContain("API key");
    expect(html).not.toContain("Rescan");
    expect(css).toMatch(/\.od-settings-row-list\s*{[^}]*border:\s*1px solid var\(--od-border-soft\);[^}]*border-radius:\s*var\(--od-radius-md\);[^}]*background:\s*var\(--od-surface-warm\);/s);
    expect(css).toMatch(/\.od-settings-row,\s*\.od-settings-current-aim\s*{[^}]*padding:\s*14px 16px;/s);
    expect(css).toMatch(/\.od-settings-row:last-child\s*{[^}]*border-bottom:\s*0;/s);
    expect(css).toMatch(/\.od-settings-status-pill\s*{[^}]*gap:\s*6px;[^}]*background:\s*transparent;[^}]*color:\s*var\(--od-muted\);/s);
    expect(css).toMatch(/\.od-settings-status-pill::before\s*{[^}]*width:\s*6px;[^}]*height:\s*6px;[^}]*background:\s*var\(--od-meta\);/s);
    expect(css).toMatch(/\.od-settings-status-pill\.warn\s*{[^}]*color:\s*var\(--od-muted\);/s);
    expect(css).toMatch(/\.od-settings-row-button\s*{[^}]*min-height:\s*28px;[^}]*border:\s*1px solid transparent;[^}]*background:\s*var\(--od-surface\);/s);
  });
});

describe("CockpitShell", () => {
  it("renders a sidebar footer user menu trigger", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <CockpitShell
          goals={[]}
          selected={null}
          activeStage="aim"
          activeSidebarAction={null}
          onHome={noop}
          onNewAim={noop}
          onOpenGoal={noop}
          onStage={noop}
          main={<div>New aim</div>}
        />
      </I18nProvider>,
    );

    expect(html).toContain('data-od-id="sidebar-user-menu-trigger"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Local user");
    expect(html).toContain("Aimcub workspace");
    expect(html).not.toContain("<h1>Aimcub</h1>");
    expect(html).not.toContain("<p>Workbench</p>");
  });

  it("renders Home Panel and New Aim as top-left app-level sidebar actions", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <CockpitShell
          goals={[]}
          selected={null}
          activeStage="aim"
          activeSidebarAction="home"
          onHome={noop}
          onNewAim={noop}
          onOpenGoal={noop}
          onStage={noop}
          main={<div>New aim</div>}
        />
      </I18nProvider>,
    );
    const css = readFileSync(new URL("./cockpit.css", import.meta.url), "utf8");

    expect(html).toContain('data-od-id="sidebar-global-actions"');
    expect(html).toContain('aria-label="Workspace actions"');
    expect(html).toContain('data-od-id="sidebar-home-panel-action"');
    expect(html).toContain('data-od-id="sidebar-new-aim-action"');
    expect(html).toContain('<button class="od-sidebar-action od-home-panel" type="button" aria-current="page" data-od-id="sidebar-home-panel-action"');
    expect(html).toContain('<button class="od-sidebar-action od-new-aim" type="button" data-od-id="sidebar-new-aim-action"');
    expect(html).toContain("od-home-panel");
    expect(html).toContain("od-new-aim");
    expect(html).toContain("od-sidebar-action-icon");
    expect(html).toContain("od-sidebar-action-label");
    expect(html).toContain("Home panel");
    expect(html).toContain("New aim");
    expect(html).toContain('aria-label="Command 0"');
    expect(html).toContain('aria-label="Command N"');
    expect(html).toContain("⌘");
    expect(html).not.toContain("Cmd N</kbd>");
    expect(css).toContain("--sidebar-horizontal-inset: 12px;");
    expect(css).toContain("--sidebar-row-padding-x: 8px;");
    expect(css).toContain("--sidebar-icon-column: 28px;");
    expect(css).toContain("--sidebar-action-icon-slot: 18px;");
    expect(css).toContain("--sidebar-action-label-gap: 6px;");
    expect(css).toContain("--sidebar-action-icon-offset-x: -2px;");
    expect(css).toContain("--sidebar-content-width: calc(var(--sidebar-width) - (var(--sidebar-horizontal-inset) * 2) - 1px);");
    expect(css).toContain("--od-type-meta: 12px;");
    expect(css).toContain("--od-type-body: 13px;");
    expect(css).toContain("--od-type-title: 16px;");
    expect(css).toContain("--od-font-weight-medium: 400;");
    expect(css).toContain("--od-font-weight-semibold: 450;");
    expect(css).toContain("--od-icon-stroke: 1.55;");
    expect(css).toContain("--od-interaction-hover-bg: color-mix(in oklab, var(--od-fg), transparent 96%);");
    expect(css).toContain("--od-selection-bg: color-mix(in oklab, var(--od-fg), transparent 91%);");
    expect(css).toContain("--od-selection-border: color-mix(in oklab, var(--od-fg), transparent 82%);");
    expect(css).toContain("--od-interaction-hover-shadow: var(--od-shadow-sidebar-action);");
    expect(css).toContain("--od-interaction-focus-shadow: var(--od-focus), var(--od-shadow-sidebar-action);");
    expect(css).toMatch(/\.od-sidebar\s*{[^}]*padding:\s*56px var\(--sidebar-horizontal-inset\) 16px;[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;/s);
    expect(css).toMatch(/\.od-sidebar-global-actions\s*{[^}]*width:\s*var\(--sidebar-content-width\);[^}]*display:\s*grid;[^}]*justify-self:\s*center;[^}]*gap:\s*3px;/s);
    expect(css).toMatch(/\.od-sidebar-action\s*{[^}]*min-height:\s*34px;[^}]*grid-template-columns:\s*var\(--sidebar-action-icon-slot\) minmax\(0, 1fr\) auto;[^}]*column-gap:\s*var\(--sidebar-action-label-gap\);[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/s);
    expect(css).toMatch(/\.od-sidebar-action\s*{[^}]*padding:\s*0 var\(--sidebar-row-padding-x\);/s);
    expect(css).toMatch(/\.od-sidebar-action:hover,\s*\.od-sidebar-action:focus-visible\s*{[^}]*background:\s*var\(--od-interaction-hover-bg\);[^}]*box-shadow:\s*var\(--od-interaction-hover-shadow\);[^}]*color:\s*var\(--od-fg\);/s);
    expect(css).toMatch(/\.od-sidebar-action\[aria-current="page"\]\s*{[^}]*background:\s*var\(--od-selection-bg\);[^}]*border-color:\s*transparent;[^}]*box-shadow:\s*none;[^}]*color:\s*var\(--od-fg\);/s);
    expect(css).toMatch(/\.od-sidebar-action:focus-visible\s*{[^}]*box-shadow:\s*var\(--od-interaction-focus-shadow\);/s);
    expect(css).toMatch(/\.od-sidebar-action\[aria-current="page"\]:focus-visible\s*{[^}]*background:\s*var\(--od-selection-hover-bg\);[^}]*border-color:\s*transparent;[^}]*box-shadow:\s*var\(--od-focus\);/s);
    expect(css).toMatch(/\.od-sidebar-action-icon\s*{[^}]*width:\s*var\(--sidebar-action-icon-slot\);[^}]*height:\s*20px;[^}]*justify-items:\s*start;[^}]*transform:\s*translateX\(var\(--sidebar-action-icon-offset-x\)\);/s);
    expect(css).toMatch(/\.od-sidebar-action-icon svg\s*{[^}]*width:\s*18px;[^}]*height:\s*18px;[^}]*stroke-width:\s*var\(--od-icon-stroke\);/s);
    expect(css).toMatch(/\.od-sidebar-action-label\s*{[^}]*font-weight:\s*var\(--od-font-weight-medium\);[^}]*line-height:\s*16px;/s);
    expect(css).toMatch(/\.od-sidebar-action kbd\s*{[^}]*display:\s*inline-flex;[^}]*align-items:\s*center;[^}]*gap:\s*2px;[^}]*min-height:\s*16px;[^}]*color:\s*var\(--od-meta\);[^}]*font-weight:\s*var\(--od-font-weight-medium\);[^}]*opacity:\s*0;[^}]*transform:\s*translateX\(2px\);/s);
    expect(css).toMatch(/\.od-sidebar-action kbd span\[aria-hidden="true"\]\s*{[^}]*font-size:\s*var\(--od-type-meta\);[^}]*font-weight:\s*var\(--od-font-weight-semibold\);/s);
    expect(css).toMatch(/\.od-sidebar-action:hover kbd,\s*\.od-sidebar-action:focus-visible kbd\s*{[^}]*opacity:\s*1;[^}]*transform:\s*translateX\(0\);/s);
    expect(css).not.toContain("--od-new-aim-bg");
    expect(css).not.toContain(".od-sidebar-action[data-current");
    expect(css).not.toContain(".od-sidebar-action[data-current=\"true\"] kbd");
    expect(css).not.toContain('.od-app[data-empty-aim="true"] .od-new-aim');
  });

  it("marks New Aim as current while a new aim is open", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <CockpitShell
          goals={[]}
          selected={null}
          activeStage="aim"
          activeSidebarAction="newAim"
          onHome={noop}
          onNewAim={noop}
          onOpenGoal={noop}
          onStage={noop}
          main={<div>New aim</div>}
        />
      </I18nProvider>,
    );

    expect(html).toContain('<button class="od-sidebar-action od-home-panel" type="button" data-od-id="sidebar-home-panel-action"');
    expect(html).toContain('<button class="od-sidebar-action od-new-aim" type="button" aria-current="page" data-od-id="sidebar-new-aim-action"');
  });

  it("renders recoverable drafts as draft rows, not saved recent aims", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <CockpitShell
          goals={[]}
          drafts={[draftRow]}
          activeDraftId={draftRow.id}
          selected={null}
          activeStage="aim"
          activeSidebarAction="home"
          onHome={noop}
          onNewAim={noop}
          onOpenGoal={noop}
          onOpenDraft={noop}
          onDiscardDraft={noop}
          onStage={noop}
          main={<div>Home</div>}
        />
      </I18nProvider>,
    );

    expect(html).toContain('data-od-id="sidebar-drafts-label"');
    expect(html).toContain("Drafts");
    expect(html).toContain("Unfinished local-first aim");
    expect(html).toContain("Save blocked");
    expect(html).toContain('class="od-content-entry od-draft-card" data-selected="true"');
    expect(html).toContain("More actions for Unfinished local-first aim");
    expect(html).not.toContain(">Discard</button>");
    expect(html).toContain("Recent aims");
    expect(html).toContain("Saved aims appear here.");
    expect(html).not.toContain('class="od-aim-card selected"');
  });

  it("keeps draft row destructive actions inside the contextual menu pattern", () => {
    const css = readFileSync(new URL("./cockpit.css", import.meta.url), "utf8");
    const actionMenuSource = readFileSync(new URL("./ui/ActionMenu.tsx", import.meta.url), "utf8");
    const strings = [
      "aimDraft.moreActions",
      "aimDraft.moreActionsFor",
      "aimDraft.resumeDraft",
      "aimDraft.discardDraft",
      "aimDraft.discardConfirm",
    ] as const;

    expect(css).toContain(".od-content-entry");
    expect(css).toContain(".od-action-menu");
    expect(css).toMatch(/\.od-action-menu\s*{[^}]*box-shadow:\s*var\(--od-shadow-popover\);/s);
    expect(css).not.toContain("od-draft-row-discard");
    expect(css).not.toContain("od-draft-discard");
    expect(css).not.toContain("od-draft-recovery-action");
    expect(css).not.toMatch(/\.od-content-entry-main:hover[\s\S]*box-shadow:\s*var\(--od-interaction-hover-shadow\)/);
    expect(actionMenuSource).toContain('role="menu"');
    expect(actionMenuSource).toContain('role="menuitem"');
    expect(actionMenuSource).toContain('document.addEventListener("pointerdown"');
    expect(actionMenuSource).toContain('event.key !== "Escape"');
    for (const key of ["ArrowDown", "ArrowUp", "Home", "End", "Enter"]) {
      expect(actionMenuSource).toContain(key);
    }
    for (const key of strings) {
      expect(STRINGS[key].en.length).toBeGreaterThan(0);
      expect(STRINGS[key].zh.length).toBeGreaterThan(0);
    }
  });

  it("keeps Desktop typography on three sizes and light shared weights", () => {
    const css = readFileSync(new URL("./cockpit.css", import.meta.url), "utf8");

    expect(css).toMatch(/font-size:\s*var\(--od-type-(meta|body|title)\);/);
    expect(css).not.toMatch(/font-size:\s*(9|10|11|12|13|14|15|16|18|20|22|28|32)px;/);
    expect(css).not.toMatch(/font-weight:\s*(600|650|700|750|800);/);
    expect(css).toContain("--od-font-weight-strong: 500;");
    expect(css).toContain("--od-font-weight-heavy: var(--od-font-weight-strong);");
  });

  it("reserves a stage-nav row for saved Aim overview at compact widths", () => {
    const css = readFileSync(new URL("./cockpit.css", import.meta.url), "utf8");

    expect(css).toMatch(/\.od-main-aim\s*{[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\);[^}]*}/s);
    expect(css).toMatch(/\.od-main-aim:has\(>\s*\.od-stage-nav\)\s*{[^}]*grid-template-rows:\s*auto minmax\(0,\s*1fr\);[^}]*}/s);
    expect(css).toMatch(/\.od-workspace-aim:has\(>\s*\.od-aim-overview\)\s*{[^}]*align-content:\s*start;[^}]*}/s);
  });

  it("uses the New Aim quiet hover treatment for secondary desktop controls", () => {
    const css = readFileSync(new URL("./cockpit.css", import.meta.url), "utf8");

    expect(css).toMatch(/\.od-aim-composer\s*{[^}]*border:\s*1px solid transparent;[^}]*transition:\s*border-color 160ms ease, box-shadow 160ms ease, background 160ms ease;/s);
    expect(css).toMatch(/\.od-aim-composer:hover\s*{[^}]*border-color:\s*color-mix\(in oklab, var\(--od-fg\), transparent 86%\);/s);
    expect(css).toMatch(/\.od-aim-composer:has\(\.od-aim-title-input:focus-visible,\s*\.od-aim-context-input:focus-visible\)\s*{[^}]*border-color:\s*color-mix\(in oklab, var\(--od-fg\), transparent 86%\);[^}]*box-shadow:\s*var\(--od-shadow-composer-focus\);/s);
    expect(css).toMatch(/\.od-aim-composer \.od-aim-title-input\s*{[^}]*padding:\s*8px 18px 0;/s);
    expect(css).toMatch(/\.od-sidebar-toggle:hover,\s*\.od-sidebar-toggle\[data-state="peek"\]\s*{[^}]*background:\s*var\(--od-interaction-hover-bg\);[^}]*border-color:\s*transparent;[^}]*box-shadow:\s*var\(--od-interaction-hover-shadow\);/s);
    expect(css).toMatch(/\.od-sidebar-toggle:focus-visible\s*{[^}]*background:\s*var\(--od-interaction-hover-bg\);[^}]*border-color:\s*transparent;[^}]*box-shadow:\s*var\(--od-interaction-focus-shadow\);/s);
    expect(css).toMatch(/\.od-user-menu-trigger:hover,\s*\.od-user-menu-trigger\[aria-expanded="true"\]\s*{[^}]*border-color:\s*transparent;[^}]*background:\s*var\(--od-interaction-hover-bg\);[^}]*box-shadow:\s*var\(--od-interaction-hover-shadow\);/s);
    expect(css).toMatch(/\.od-user-menu-trigger:focus-visible\s*{[^}]*border-color:\s*transparent;[^}]*background:\s*var\(--od-interaction-hover-bg\);[^}]*box-shadow:\s*var\(--od-interaction-focus-shadow\);/s);
    expect(css).toMatch(/\.od-settings-button:hover\s*{[^}]*border-color:\s*transparent;[^}]*background:\s*var\(--od-interaction-hover-bg\);[^}]*box-shadow:\s*var\(--od-interaction-hover-shadow\);/s);
    expect(css).toMatch(/\.od-aim-secondary:hover\s*{[^}]*border-color:\s*transparent;[^}]*background:\s*var\(--od-interaction-hover-bg\);[^}]*box-shadow:\s*var\(--od-interaction-hover-shadow\);/s);
    expect(css).toMatch(/\.od-command-row:hover,\s*\.od-command-row\[data-active="true"\]\s*{[^}]*border-color:\s*transparent;[^}]*background:\s*var\(--od-interaction-hover-bg\);[^}]*box-shadow:\s*var\(--od-interaction-hover-shadow\);/s);
    expect(css).toMatch(/\.od-routing-owner button:hover:not\(:disabled\)\s*{[^}]*background:\s*var\(--od-interaction-hover-bg\);[^}]*box-shadow:\s*var\(--od-interaction-hover-shadow\);/s);
    expect(css).toMatch(/\.od-scope-button:hover:not\(:disabled\)\s*{[^}]*border-color:\s*transparent;[^}]*background:\s*var\(--od-interaction-hover-bg\);[^}]*box-shadow:\s*var\(--od-interaction-hover-shadow\);/s);
  });

  it("keeps the normal aim sidebar left aligned without a recent-count zero", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <CockpitShell
          goals={[]}
          selected={null}
          activeStage="aim"
          activeSidebarAction={null}
          onHome={noop}
          onNewAim={noop}
          onOpenGoal={noop}
          onStage={noop}
          main={<div>New aim</div>}
        />
      </I18nProvider>,
    );
    const css = readFileSync(new URL("./cockpit.css", import.meta.url), "utf8");

    expect(html).toContain('<div class="od-section-label" data-od-id="sidebar-recent-aims-label"><span>Recent aims</span></div>');
    expect(html).not.toContain('<span>Recent aims</span><span>0</span>');
    expect(css).toMatch(/\.od-aim-browser\s*{[^}]*width:\s*var\(--sidebar-content-width\);[^}]*justify-self:\s*center;[^}]*padding-right:\s*0;/s);
    expect(css).toMatch(/\.od-section-label\s*{[^}]*justify-content:\s*flex-start;[^}]*padding:\s*0 var\(--sidebar-row-padding-x\);/s);
    expect(css).toMatch(/\.od-sidebar-empty\s*{[^}]*padding:\s*7px var\(--sidebar-row-padding-x\);/s);
    expect(css).toMatch(/\.od-aim-card\s*{[^}]*padding:\s*8px 10px 8px var\(--sidebar-row-padding-x\);/s);
    expect(css).toMatch(/\.od-aim-card\.selected,\s*\.od-aim-card\.current\s*{[^}]*background:\s*var\(--od-selection-bg\);[^}]*box-shadow:\s*var\(--od-selection-shadow\);[^}]*color:\s*var\(--od-fg\);/s);
    expect(css).toMatch(/\.od-aim-card\.selected:focus-visible,\s*\.od-aim-card\.current:focus-visible\s*{[^}]*background:\s*var\(--od-selection-hover-bg\);[^}]*box-shadow:\s*var\(--od-focus\), var\(--od-selection-shadow\);/s);
    expect(css).toMatch(/\.od-sidebar-search\s*{[^}]*padding:\s*0 var\(--sidebar-row-padding-x\);/s);
    expect(css).toMatch(/\.od-filter-row\s*{[^}]*padding:\s*0 var\(--sidebar-row-padding-x\) 2px;/s);
    expect(css).toMatch(/\.od-user-menu-anchor\s*{[^}]*width:\s*var\(--sidebar-content-width\);[^}]*justify-self:\s*center;/s);
    expect(css).toMatch(/\.od-user-menu-trigger\s*{[^}]*grid-template-columns:\s*var\(--sidebar-icon-column\) minmax\(0, 1fr\) 18px;[^}]*padding:\s*6px var\(--sidebar-row-padding-x\);/s);
    expect(css).toMatch(/\.od-user-menu-popover\s*{[^}]*display:\s*grid;[^}]*gap:\s*2px;[^}]*overflow:\s*visible;[^}]*padding:\s*6px;/s);
    expect(css).toMatch(/\.od-user-menu-header\s*{[^}]*grid-template-columns:\s*26px minmax\(0, 1fr\);[^}]*padding:\s*4px 6px 6px;/s);
    expect(css).toMatch(/\.od-user-menu-item\s*{[^}]*min-height:\s*32px;[^}]*grid-template-columns:\s*18px minmax\(0, 1fr\) auto;[^}]*padding:\s*0 6px;/s);
    expect(css).toMatch(/\.od-user-menu-item span\s*{[^}]*font-size:\s*var\(--od-type-meta\);[^}]*line-height:\s*var\(--od-line-meta\);/s);
    expect(css).toMatch(/\.od-user-menu-item kbd\s*{[^}]*min-height:\s*18px;[^}]*font-size:\s*var\(--od-type-meta\);[^}]*font-weight:\s*var\(--od-font-weight-medium\);/s);
    expect(css).toMatch(/\.od-user-menu-submenu-anchor\s*{[^}]*position:\s*relative;[^}]*display:\s*grid;/s);
    expect(css).toMatch(/\.od-user-menu-submenu-anchor::after\s*{[^}]*left:\s*100%;[^}]*width:\s*10px;/s);
    expect(css).toMatch(/\.od-user-language-menu\s*{[^}]*position:\s*absolute;[^}]*top:\s*-4px;[^}]*left:\s*calc\(100% \+ 8px\);[^}]*width:\s*180px;/s);
  });

  it("marks the saved aim row as current when a saved aim is open", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <CockpitShell
          goals={[savedGoal]}
          selected={savedGoal}
          activeStage="aim"
          activeSidebarAction={null}
          onHome={noop}
          onNewAim={noop}
          onOpenGoal={noop}
          onStage={noop}
          main={<div>Saved aim</div>}
        />
      </I18nProvider>,
    );

    expect(html).toContain('data-od-id="sidebar-new-aim-action"');
    expect(html).toContain('<button class="od-sidebar-action od-new-aim" type="button" data-od-id="sidebar-new-aim-action"');
    expect(html).toContain('<button class="od-aim-card selected" type="button" aria-current="page"');
    expect(html).not.toContain('data-current=');
  });

  it("renders an invisible pinned sidebar resize hot zone with accessible controls", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <CockpitShell
          goals={[]}
          selected={null}
          activeStage="aim"
          activeSidebarAction={null}
          onHome={noop}
          onNewAim={noop}
          onOpenGoal={noop}
          onStage={noop}
          main={<div>New aim</div>}
        />
      </I18nProvider>,
    );
    const css = readFileSync(new URL("./cockpit.css", import.meta.url), "utf8");

    expect(html).toContain('style="--sidebar-width:280px"');
    expect(html).toContain('id="od-left-aim-sidebar"');
    expect(html).toContain('data-od-id="sidebar-resizer"');
    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-label="Resize left sidebar"');
    expect(html).toContain('aria-controls="od-left-aim-sidebar"');
    expect(html).toContain('aria-orientation="vertical"');
    expect(html).toContain('aria-valuemin="216"');
    expect(html).toContain('aria-valuemax="360"');
    expect(html).toContain('aria-valuenow="280"');
    expect(css).toMatch(/\.od-sidebar-resizer\s*{[^}]*cursor:\s*col-resize;[^}]*touch-action:\s*none;/s);
    expect(css).toMatch(/\.od-sidebar-resizer\s*{[^}]*background:\s*transparent;/s);
    expect(css).not.toContain(".od-sidebar-resizer::before");
  });

  it("uses compact default window bounds instead of a large desktop footprint", () => {
    const main = readFileSync(new URL("../main/index.ts", import.meta.url), "utf8");

    expect(main).toContain("const DEFAULT_WINDOW_WIDTH = 960;");
    expect(main).toContain("const DEFAULT_WINDOW_HEIGHT = 680;");
    expect(main).toContain("const MIN_WINDOW_WIDTH = 640;");
    expect(main).toContain("const MIN_WINDOW_HEIGHT = 520;");
    expect(main).toContain("width: DEFAULT_WINDOW_WIDTH");
    expect(main).toContain("height: DEFAULT_WINDOW_HEIGHT");
    expect(main).toContain("minWidth: MIN_WINDOW_WIDTH");
    expect(main).toContain("minHeight: MIN_WINDOW_HEIGHT");
  });

  it("renders compact non-linear workbench navigation without numbered stage pills", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <CockpitShell
          goals={[savedGoal]}
          selected={savedGoal}
          activeStage="context"
          activeSidebarAction={null}
          onHome={noop}
          onNewAim={noop}
          onOpenGoal={noop}
          onStage={noop}
          main={<div>Context stage</div>}
        />
      </I18nProvider>,
    );

    expect(html).toContain('aria-label="Workbench navigation"');
    expect(html).toContain('class="od-stage-current"');
    expect(html).toContain('<span class="od-stage-current-label">Surface</span>');
    expect(html).toContain('<strong class="od-stage-current-title">Context</strong>');
    expect(html).toContain('class="od-stage-switcher" role="group" aria-label="Workbench surfaces"');
    expect(html).toContain('data-stage="aim"');
    expect(html).toContain('data-stage="context"');
    expect(html).toContain('data-stage="contracts"');
    expect(html).toContain('data-stage="run"');
    expect(html).toContain('data-stage="eval"');
    expect(html).toContain('<span class="od-stage-title">Aim</span>');
    expect(html).toContain('<span class="od-stage-title">Contracts</span>');
    expect(html).toContain('<span class="od-stage-title">Work</span>');
    expect(html).toContain('<span class="od-stage-title">Review</span>');
    expect(html).toContain('<button class="active" type="button" aria-current="page" data-stage="context"');
    expect(html).not.toContain("od-stage-index");
    expect(html).not.toContain('aria-current="step"');
  });

  it("keeps command palette and keyboard stage mappings on the same workbench stages", () => {
    const source = readFileSync(new URL("./CockpitShell.tsx", import.meta.url), "utf8");

    expect(WORKBENCH_STAGE_IDS).toEqual(["aim", "context", "contracts", "run", "eval"]);
    expect(source).toContain("const stage = WORKBENCH_STAGE_IDS[Number(key) - 1];");
    expect(source).toContain("...stages.map((item) => ({");
    expect(source).toContain("id: `stage-${item.stage}`");
    expect(source).toContain("shortcut: `Cmd ${item.shortcut}`");
    expect(source).toContain("action: () => onStage(item.stage)");
  });

  it("keeps workbench navigation clear of titlebar controls at compact widths", () => {
    const css = readFileSync(new URL("./cockpit.css", import.meta.url), "utf8");
    const stageSafeAreaRule = css.match(
      /\.od-main:not\(\.od-main-aim\):not\(\.od-main-settings\)\s*{[^}]*}/s,
    )?.[0] ?? "";

    expect(css).toMatch(/\.od-main\s*{[^}]*--stage-nav-titlebar-safe-top:\s*0px;/s);
    expect(stageSafeAreaRule).toContain("--stage-nav-titlebar-safe-top: calc(var(--titlebar-toggle-top) + var(--titlebar-toggle-size) + 16px);");
    expect(stageSafeAreaRule).toContain("padding-top: max(16px, var(--stage-nav-titlebar-safe-top));");
    expect(stageSafeAreaRule).not.toContain("data-sidebar-state");
    expect(stageSafeAreaRule).not.toMatch(/\.od-sidebar|\.od-user-menu-|\.od-window-drag-strip/);
    expect(css).toMatch(/\.od-stage-nav\s*{[^}]*justify-content:\s*space-between;[^}]*gap:\s*12px;[^}]*min-height:\s*32px;/s);
    expect(css).toMatch(/\.od-stage-switcher\s*{[^}]*gap:\s*4px;[^}]*padding:\s*2px;[^}]*border:\s*1px solid var\(--od-border-soft\);/s);
    expect(css).toMatch(/\.od-stage-nav button\s*{[^}]*max-width:\s*112px;[^}]*min-height:\s*28px;[^}]*background:\s*transparent;/s);
    expect(css).not.toContain(".od-stage-index");
  });

  it("wraps and compresses workbench navigation without shell selector changes", () => {
    const css = readFileSync(new URL("./cockpit.css", import.meta.url), "utf8");
    const compactStageNavRule = css.match(/@media \(max-width: 1040px\)\s*{[\s\S]*?\.od-stage-nav\s*{[^}]*}/)?.[0] ?? "";
    const compactStageSwitcherRule = css.match(/@media \(max-width: 1040px\)\s*{[\s\S]*?\.od-stage-switcher\s*{[^}]*}/)?.[0] ?? "";
    const narrowStageCurrentLabelRule = css.match(/\.od-stage-current-label\s*{[^}]*display:\s*none;[^}]*}/s)?.[0] ?? "";
    const narrowStageSwitcherRule = css.match(/\.od-stage-switcher\s*{[^}]*flex:\s*1 1 320px;[^}]*}/s)?.[0] ?? "";
    const narrowStageNavButtonRule = css.match(/\.od-stage-nav button\s*{[^}]*flex:\s*1 1 0;[^}]*}/s)?.[0] ?? "";

    expect(compactStageNavRule).toMatch(/\.od-stage-nav\s*{[^}]*flex-wrap:\s*wrap;[^}]*row-gap:\s*8px;/s);
    expect(compactStageSwitcherRule).toMatch(/\.od-stage-switcher\s*{[^}]*flex:\s*0 1 auto;/s);
    expect(narrowStageCurrentLabelRule).toMatch(/\.od-stage-current-label\s*{[^}]*display:\s*none;/s);
    expect(narrowStageSwitcherRule).toMatch(/\.od-stage-switcher\s*{[^}]*flex:\s*1 1 320px;/s);
    expect(narrowStageNavButtonRule).toMatch(/\.od-stage-nav button\s*{[^}]*flex:\s*1 1 0;[^}]*max-width:\s*none;[^}]*padding:\s*0 8px;/s);
    expect(narrowStageNavButtonRule).not.toMatch(/\.od-sidebar|\.od-user-menu-|\.od-window-drag-strip|data-sidebar-state/);
    expect(narrowStageSwitcherRule).not.toMatch(/\.od-sidebar|\.od-user-menu-|\.od-window-drag-strip|data-sidebar-state/);
    expect(narrowStageCurrentLabelRule).not.toMatch(/\.od-sidebar|\.od-user-menu-|\.od-window-drag-strip|data-sidebar-state/);
  });

  it("replaces the primary left sidebar with settings navigation on settings stage", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <CockpitShell
          goals={[]}
          selected={null}
          activeStage="settings"
          activeSidebarAction={null}
          onHome={noop}
          onNewAim={noop}
          onOpenGoal={noop}
          onStage={noop}
          settingsSidebar={<nav aria-label="Settings sections"><button type="button">Planning model</button></nav>}
          main={<div>Settings detail pane</div>}
        />
      </I18nProvider>,
    );
    const css = readFileSync(new URL("./cockpit.css", import.meta.url), "utf8");

    expect(html).toContain('data-od-id="left-settings-sidebar"');
    expect(html).not.toContain('data-od-id="sidebar-toggle"');
    expect(html).not.toContain('data-od-id="sidebar-peek-trigger"');
    expect(html).toContain('data-sidebar-state="pinned"');
    expect(html).not.toContain('data-od-id="mac-titlebar"');
    expect(html).not.toContain("<h1>Aimcub</h1>");
    expect(html).not.toContain("<p>Workbench</p>");
    expect(html).toContain("Settings sections");
    expect(html).toContain("Planning model");
    expect(html).toContain("Settings detail pane");
    expect(html).toContain('data-od-id="sidebar-user-menu-trigger"');
    expect(html).not.toContain("Search aims");
    expect(html).not.toContain("Workbench navigation");
    expect(html).not.toContain("Workbench surfaces");
    expect(css).toMatch(/\.od-workspace-settings\s*{[^}]*width:\s*min\(100%, 1080px\);/s);
    expect(css).toMatch(/\.od-settings-sidebar-content\s*{[^}]*width:\s*var\(--sidebar-content-width\);[^}]*justify-self:\s*center;/s);
    expect(css).toMatch(/\.od-settings-back\s*{[^}]*width:\s*100%;[^}]*grid-template-columns:\s*var\(--sidebar-action-icon-slot\) minmax\(0, 1fr\);[^}]*padding:\s*0 var\(--sidebar-row-padding-x\);/s);
    expect(css).toMatch(/\.od-settings-search\s*{[^}]*width:\s*100%;/s);
    expect(css).toMatch(/\.od-settings-search input\s*{[^}]*min-height:\s*36px;[^}]*border-radius:\s*var\(--od-radius-md\);[^}]*padding:\s*0 11px 0 calc\(var\(--sidebar-row-padding-x\) \+ var\(--sidebar-action-icon-slot\) \+ var\(--sidebar-action-label-gap\)\);/s);
    expect(css).toMatch(/\.od-settings-search-icon\s*{[^}]*left:\s*var\(--sidebar-row-padding-x\);[^}]*width:\s*18px;[^}]*transform:\s*translate\(var\(--sidebar-action-icon-offset-x\), -50%\);/s);
    expect(css).toMatch(/\.od-settings-nav\s*{[^}]*padding-right:\s*0;[^}]*scrollbar-gutter:\s*auto;/s);
    expect(css).toMatch(/\.od-settings-nav-section\s*{[^}]*padding:\s*8px var\(--sidebar-row-padding-x\) 4px;/s);
    expect(css).toMatch(/\.od-settings-nav-empty\s*{[^}]*padding:\s*8px var\(--sidebar-row-padding-x\);/s);
    expect(css).toMatch(/\.od-settings-nav-item\s*{[^}]*grid-template-columns:\s*var\(--sidebar-action-icon-slot\) minmax\(0, 1fr\) auto;[^}]*column-gap:\s*var\(--sidebar-action-label-gap\);[^}]*padding:\s*0 var\(--sidebar-row-padding-x\);/s);
    expect(css).toMatch(/\.od-settings-nav-item\[data-active="true"\]\s*{[^}]*background:\s*var\(--od-selection-bg\);[^}]*border-color:\s*transparent;/s);
    expect(css).not.toContain(".od-settings-nav-item[data-active=\"true\"]::before");
    expect(css).toMatch(/\.od-settings-nav-icon\s*{[^}]*justify-self:\s*start;[^}]*transform:\s*translateX\(var\(--sidebar-action-icon-offset-x\)\);/s);
    expect(css).toMatch(/\.od-settings-nav-item\[data-active="true"\] \.od-settings-nav-icon\s*{[^}]*color:\s*currentColor;/s);
  });

  it("keeps a stable top drag strip outside the dynamic sidebar layers", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <CockpitShell
          goals={[]}
          selected={null}
          activeStage="aim"
          activeSidebarAction={null}
          onHome={noop}
          onNewAim={noop}
          onOpenGoal={noop}
          onStage={noop}
          main={<div>New aim</div>}
        />
      </I18nProvider>,
    );
    const css = readFileSync(new URL("./cockpit.css", import.meta.url), "utf8");

    expect(html).toContain('data-od-id="window-drag-strip"');
    expect(html).toContain('data-window-fullscreen="false"');
    expect(html).toContain('data-system-appearance="light"');
    expect(html).not.toContain('data-od-id="traffic-light-inactive-dots"');
    expect(html).not.toContain("data-window-focused");
    expect(html).not.toContain("data-window-traffic-lights");
    expect(css).toMatch(/\.od-window-drag-strip\s*{[^}]*app-region:\s*drag;[^}]*-webkit-app-region:\s*drag;/s);
    expect(css).toContain("--window-drag-strip-height: 36px;");
    expect(css).toMatch(
      /\.od-window-drag-strip\s*{[^}]*left:\s*calc\(var\(--titlebar-toggle-left\) \+ var\(--titlebar-toggle-size\) \+ 8px\);[^}]*height:\s*var\(--window-drag-strip-height\);/s,
    );
    expect(css).toMatch(/\.od-sidebar-toggle\s*{[^}]*app-region:\s*no-drag;[^}]*-webkit-app-region:\s*no-drag;/s);
    expect(css).toMatch(/\.od-user-menu-anchor,\s*\.od-user-menu-anchor \*,\s*\.od-action-menu-anchor,\s*\.od-action-menu-anchor \*\s*{[^}]*app-region:\s*no-drag;[^}]*-webkit-app-region:\s*no-drag;/s);
  });

  it("leaves macOS traffic lights to native window chrome", () => {
    const css = readFileSync(new URL("./cockpit.css", import.meta.url), "utf8");
    const main = readFileSync(new URL("../main/index.ts", import.meta.url), "utf8");

    expect(main).toContain('titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default"');
    expect(main).toContain('trafficLightPosition: process.platform === "darwin" ? nativeTrafficLightPosition() : undefined');
    expect(main).toContain("win.setWindowButtonVisibility(true)");
    expect(main).not.toContain("win.setWindowButtonVisibility(!win.isFullScreen())");
    expect(main).toContain("win.setWindowButtonPosition(nativeTrafficLightPosition(win.webContents.getZoomFactor()))");
    expect(main).toContain('win.webContents.on("zoom-changed", () => scheduleNativeMacWindowChrome(win))');
    expect(css).not.toContain("od-traffic-light-inactive-dots");
    expect(css).not.toContain("--traffic-light-size");
  });

  it("follows the native system appearance for dark mode", () => {
    const css = readFileSync(new URL("./cockpit.css", import.meta.url), "utf8");
    const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
    const main = readFileSync(new URL("../main/index.ts", import.meta.url), "utf8");
    const ipc = readFileSync(new URL("../main/ipc.ts", import.meta.url), "utf8");

    expect(main).toContain('nativeTheme.themeSource = "system"');
    expect(main).toContain('const DARK_WINDOW_BACKGROUND = "#1c1c1e"');
    expect(main).toContain("win.setBackgroundColor(nativeWindowBackgroundColor())");
    expect(main).toContain('nativeTheme.on("updated"');
    expect(main).toContain("colorScheme: systemColorScheme()");
    expect(ipc).toContain('colorScheme: nativeTheme.shouldUseDarkColors ? "dark" : "light"');
    expect(css).toContain("@media (prefers-color-scheme: dark)");
    expect(css).toContain(':root:has(.od-app[data-system-appearance="dark"])');
    expect(css).toContain("color-scheme: dark;");
    expect(css).toContain("--od-bg: #1c1c1e;");
    expect(css).toContain("--od-fg: #e8e8ed;");
    expect(css).toContain("--od-fg-2: #c9c9cf;");
    expect(css).toContain("--od-muted: #a8a8af;");
    expect(css).toContain("--od-meta: #8f8f99;");
    expect(css).toContain("--od-popover-bg: rgba(36, 36, 38, 0.96);");
    expect(css).toContain("--od-selection-bg: color-mix(in oklab, var(--od-fg), transparent 84%);");
    expect(css).toContain("--od-selection-border: color-mix(in oklab, var(--od-fg), transparent 72%);");
    expect(html).toContain("color-scheme: light dark;");
    expect(html).toContain("@media (prefers-color-scheme: dark)");
    expect(html).not.toContain("background: #fafafa;");
  });

  it("moves the sidebar toggle left in fullscreen without hiding native titlebar traffic lights", () => {
    const css = readFileSync(new URL("./cockpit.css", import.meta.url), "utf8");
    const main = readFileSync(new URL("../main/index.ts", import.meta.url), "utf8");

    expect(css).toMatch(
      /\.od-app\s*{[^}]*--titlebar-toggle-left:\s*calc\(var\(--traffic-light-left\) \+ var\(--traffic-light-cluster-width\) \+ var\(--titlebar-control-gap\)\);/s,
    );
    expect(css).toMatch(
      /\.od-app\[data-window-fullscreen="true"\]\s*{[^}]*--titlebar-toggle-left:\s*var\(--fullscreen-titlebar-toggle-left\);/s,
    );
    expect(css).toContain("--traffic-light-row-height: 46px;");
    expect(css).toContain("--traffic-light-button-size: 14px;");
    expect(css).toContain("--titlebar-toggle-top: calc((var(--traffic-light-row-height) - var(--titlebar-toggle-size)) / 2);");
    expect(main).toContain("win.setWindowButtonVisibility(true)");
  });

  it("groups transient sidebar hover controls without changing grid layout", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <CockpitShell
          goals={[]}
          selected={null}
          activeStage="aim"
          activeSidebarAction={null}
          onHome={noop}
          onNewAim={noop}
          onOpenGoal={noop}
          onStage={noop}
          main={<div>New aim</div>}
        />
      </I18nProvider>,
    );
    const css = readFileSync(new URL("./cockpit.css", import.meta.url), "utf8");

    expect(html).toContain('data-od-id="sidebar-hover-zone"');
    expect(html).toContain('data-od-id="sidebar-toggle"');
    expect(html).toContain('data-od-id="sidebar-peek-trigger"');
    expect(css).toMatch(/\.od-sidebar-hover-zone\s*{[^}]*display:\s*contents;/s);
  });

  it("keeps manual pinned sidebar in layout while only collapsed and peek states free workspace width", () => {
    const css = readFileSync(new URL("./cockpit.css", import.meta.url), "utf8");

    expect(css).toContain("@media (max-width: 1040px)");
    expect(css).toContain(".od-app:not(.od-app-stage-settings)[data-sidebar-state=\"collapsed\"]");
    expect(css).toContain(".od-app:not(.od-app-stage-settings)[data-sidebar-state=\"peek\"]");
    expect(css).toContain("grid-template-columns: 0 minmax(0, 1fr);");
    expect(css).toContain(".od-app:not(.od-app-stage-settings)[data-sidebar-state=\"peek\"] .od-sidebar");
    expect(css).not.toContain(".od-app:not(.od-app-stage-settings)[data-sidebar-state=\"pinned\"] .od-sidebar");
    expect(css).toContain("flex-wrap: wrap;");
  });

  it("keeps the peek sidebar visible until its collapse animation finishes", () => {
    const css = readFileSync(new URL("./cockpit.css", import.meta.url), "utf8");

    expect(css).toMatch(
      /\.od-sidebar\s*{[^}]*transition:\s*transform 180ms ease, opacity 160ms ease, box-shadow 180ms ease, visibility 0s linear 180ms;/s,
    );
    expect(css).toMatch(
      /\.od-app\[data-sidebar-state="pinned"\] \.od-sidebar,\s*\.od-app\[data-sidebar-state="peek"\] \.od-sidebar\s*{[^}]*transition-delay:\s*0s, 0s, 0s, 0s;/s,
    );
    expect(css).toMatch(
      /\.od-app\[data-sidebar-state="collapsed"\] \.od-sidebar\s*{[^}]*visibility:\s*hidden;[^}]*transform:\s*translateX/s,
    );
  });
});
