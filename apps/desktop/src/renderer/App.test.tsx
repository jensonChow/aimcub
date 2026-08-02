import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { routingRecommendationForPlanNode, type RoutingRuntimeAgentOption } from "@aimcub/core";
import type { AimDraft, AimProgressReadModel, DecompositionOutput, Goal, Milestone } from "@aimcub/types";
import type { ContextSourceStatus, ProviderStatus, WebResearchStatus } from "../shared/ipc";

import { App, SettingsPanel, SettingsSidebarNav } from "./App";
import { DeveloperModeProvider } from "./developerMode";
import { StoreDiagnosticsBanner } from "./StoreDiagnosticsBanner";
import { HomeView } from "./stages/home/HomeView";
import { CockpitShell } from "./CockpitShell";
import { I18nProvider, STRINGS } from "./i18n";
import { EvidenceSubmissionForm } from "./stages/execute/EvidenceSubmissionForm";
import { JourneyPlanBand } from "./stages/journey/JourneyPlanBand";
import { LocalAgentExecutionSummary } from "./stages/execute/LocalAgentExecutionSummary";
import { PlanContractCard } from "./stages/plan/PlanContractCard";
import { PlanPanel } from "./stages/plan/PlanPanel";
import { editableContractForNode, formatAcceptanceRule } from "./stages/plan/planContract";
import { Notice } from "./Notice";

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
const asyncTrue = async () => true;

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
  aim_surface: "summary",
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
  planning_session: null,
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
  /** The agent run's recorded sandbox — defaults to the desktop background-drain floor. */
  runSandbox?: string;
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
      sandbox: input.runSandbox ?? "read-only",
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

function renderExecute(
  rows: AimProgressReadModel["milestones"],
  options: { sessionRunIds?: ReadonlySet<string> } = {},
): string {
  return renderToStaticMarkup(
    <I18nProvider>
      <JourneyPlanBand
        progress={executeProgress(rows)}
        disabled={false}
        sessionRunIds={options.sessionRunIds ?? new Set()}
        selectedMilestoneId={rows[0]?.milestone.id ?? null}
        onSelectMilestone={noop}
        activeProofId={null}
        onProofActiveChange={noop}
        onRunAgent={noop}
        onConfirmMilestone={asyncTrue}
        onPickEvidenceFiles={async () => []}
        onBreakDown={noop}
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
    expect(html).toContain('autofocus=""');
    expect(html).toContain("URL");
    expect(html).toContain("Local file references");
    expect(html).toContain("Approval note.");
    expect(html).toContain("Submit proof");
  });
});

describe("JourneyPlanBand work detail (the Execute stage's surface, ported home)", () => {
  it("keeps the work detail out of the App controller body", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

    expect(source).not.toContain("ExecutePanel");
    expect(source).not.toContain('className="od-execute-layout"');
    expect(source).not.toContain("activeProofId");
  });

  it("renders plan rows with the selected row's work detail expanded in place", () => {
    const html = renderExecute([
      executeRow({ id: AGENT_MILESTONE, title: "Run implementation agent", owner: "agent" }),
      executeRow({ id: HUMAN_MILESTONE, title: "Submit launch approval", owner: "human" }),
    ]);

    expect(html).toContain("journey-plan-band");
    expect(html).toContain("journey-planrow-detail");
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

  it("shows eval receipts inline for completed and low-trust work — no Eval-stage hop, no primary button", () => {
    const completedHtml = renderExecute([
      executeRow({ id: COMPLETE_MILESTONE, title: "Review completed proof", owner: "agent", completed: true }),
    ]);
    const lowTrustHtml = renderExecute([
      executeRow({ id: LOW_TRUST_MILESTONE, title: "Inspect low-trust report", owner: "agent", lowTrust: true }),
    ]);

    expect(completedHtml).not.toContain("od-execute-primary-button");
    expect(lowTrustHtml).not.toContain("od-execute-primary-button");
    expect(completedHtml).toContain("od-eval-detail-section");
    expect(lowTrustHtml).toContain("od-eval-detail-section");
    expect(lowTrustHtml).toContain('class="od-evidence-review');
    // The review note now IS the inline receipt — the collapse shows it in place.
    expect(lowTrustHtml).toContain("Trust is below the floor.");
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

  it("asks for per-run permission before an agent run, defaulting to read-only with no network", () => {
    const html = renderExecute([
      executeRow({ id: AGENT_MILESTONE, title: "Run implementation agent", owner: "agent" }),
    ]);

    expect(html).toContain('aria-label="What this run may do"');
    expect(html).toContain('data-escalated="false"');
    expect(html).toContain("Read only");
    expect(html).toContain("Write in a folder");
    expect(html).toContain("The agent can read and think. It cannot change any file on this machine.");
    expect(html).toContain("Web search and page fetching stay disabled for this run.");
    // The one level the cockpit will never grant.
    expect(html).not.toContain("danger-full-access");
    // The consent control points at the written threat model.
    expect(html).toContain("docs/agent-permissions.md");
  });

  it("leaves the consent control off a human-routed sub-aim, which runs no agent", () => {
    const html = renderExecute([
      executeRow({ id: HUMAN_MILESTONE, title: "Submit launch approval", owner: "human" }),
    ]);
    expect(html).not.toContain('aria-label="What this run may do"');
  });

  it("shows a per-run timeline built from persisted run events", () => {
    const html = renderExecute([
      executeRow({ id: AGENT_MILESTONE, title: "Run implementation agent", owner: "agent" }),
    ]);
    expect(html).toContain('data-od-id="run-timeline"');
    expect(html).toContain("Run timeline");
  });

  it("gives the live run its own Glass row instead of reusing the work-note style", () => {
    const band = readFileSync(new URL("./stages/journey/JourneyPlanBand.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("./cockpit.css", import.meta.url), "utf8");

    expect(band).toContain('<div className="od-live-run" data-running={live.status === "running" ? "true" : "false"}');
    expect(band).not.toMatch(/className="od-work-note" role="status"/);
    expect(css).toMatch(/\.od-live-run\s*{[^}]*background:\s*var\(--field\);/s);
    expect(css).toMatch(/\.od-live-run\[data-running="true"\] \.od-live-run-dot\s*{[^}]*animation:\s*od-journey-pulse/s);
  });

  it("surfaces a queued workspace-write run left behind by an earlier session, with re-grant and cancel", () => {
    const html = renderExecute([
      executeRow({ id: AGENT_MILESTONE, title: "Run implementation agent", owner: "agent", runSandbox: "workspace-write" }),
    ]);

    expect(html).toContain('data-od-id="stranded-run-notice"');
    expect(html).toContain("Waiting on access granted in an earlier session");
    expect(html).toContain("/Users/jenson/project");
    expect(html).toContain("Re-grant and run");
    expect(html).toContain("Cancel run");
  });

  it("never shows the stranded-run notice for a run this session itself just queued", () => {
    const row = executeRow({ id: AGENT_MILESTONE, title: "Run implementation agent", owner: "agent", runSandbox: "workspace-write" });
    const html = renderExecute([row], { sessionRunIds: new Set([row.latest_run!.id]) });

    expect(html).not.toContain('data-od-id="stranded-run-notice"');
    expect(html).not.toContain("Waiting on access granted in an earlier session");
  });

  it("never treats a queued read-only run as stranded — the background drain already covers it", () => {
    const html = renderExecute([
      executeRow({ id: AGENT_MILESTONE, title: "Run implementation agent", owner: "agent" }),
    ]);

    expect(html).not.toContain('data-od-id="stranded-run-notice"');
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
    expect(html).toContain('<details class="od-execution-secondary-details"><summary>');
    expect(html).not.toContain('<details class="od-execution-secondary-details" open="">');
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

    expect(html).toContain("od-initial-workspace");
    expect(html).toContain('data-has-drafts="false"');
    expect(html).toContain("Point Aimcub at an outcome.");
    expect(html).toContain("Set your first aim");
    expect(html).not.toContain('class="od-aim-composer"');
    expect(html).not.toContain('id="aim-title"');
    expect(html).not.toContain('id="aim-context"');
    expect(html).not.toContain(">Continue</button>");
  });

  it("shows recoverable drafts on the Home panel without calling them saved aims", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <HomeView
          drafts={[draftRow]}
          onResumeDraft={noop}
          onDiscardDraft={noop}
        />
      </I18nProvider>,
    );

    expect(html).toContain("Drafts in progress");
    expect(html).toContain("Resume aim-building work or discard it explicitly.");
    expect(html).toContain('data-has-drafts="true"');
    expect(html.match(/aria-label="Recoverable drafts"/g)).toHaveLength(1);
    expect(html).not.toContain('aria-label="Empty workspace"');
    expect(html).toContain("Ship a useful contract review");
    expect(html).toContain("Save blocked");
    expect(html).toContain("More actions for Ship a useful contract review");
    expect(html).not.toContain("Workspace ready");
    expect(html).not.toContain("od-draft-recovery-action");
    expect(html).not.toContain("od-draft-discard");
    expect(html).not.toContain(">Discard</button>");
    expect(html).not.toContain("Saved aim");
    expect(html).not.toContain("Saved aims");
  });
});

describe("App planning state guards", () => {
  it("announces errors and busy state with appropriate live-region roles", () => {
    const errorHtml = renderToStaticMarkup(<Notice tone="error">Proof failed</Notice>);
    const infoHtml = renderToStaticMarkup(<Notice tone="info">Saving proof</Notice>);

    expect(errorHtml).toContain('role="alert"');
    expect(infoHtml).toContain('role="status"');
  });

  it("keeps manual proof drafts open when confirmation fails or navigation is attempted", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    const navigationGuard = source.match(/function navigationIsLocked\(\)[\s\S]*?function workflowMutationIsLocked/)?.[0] ?? "";
    const confirmFlow = source.match(/async function confirmMilestone[\s\S]*?async function acceptContextCandidate/)?.[0] ?? "";
    const openGoal = source.match(/async function openGoal[\s\S]*?async function refreshGoalState/)?.[0] ?? "";

    expect(navigationGuard).toContain("manualProofDraftActive");
    expect(navigationGuard).toContain('const message = t("os.proofNavigationBlocked")');
    expect(navigationGuard).toContain("proofNavigationErrorRef.current = message");
    expect(openGoal).toContain("if (!options.allowDuringSave && navigationIsLocked()) return;");
    expect(confirmFlow).toContain("Promise<boolean>");
    expect(confirmFlow).toContain("confirmMilestoneAndRefresh(");
    expect(confirmFlow).toContain("const mutationTargetIsCurrent");
    expect(confirmFlow).toContain('outcome.status === "confirmation_failed"');
    expect(confirmFlow).toMatch(/outcome\.status === "refresh_failed"[\s\S]*?setError\([\s\S]*?return true;/);
    expect(confirmFlow).toContain("return true;");
    expect(confirmFlow).toContain("return false;");
  });

  it("re-attaches a running planning session on aim re-entry instead of restarting it", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    const applyView = source.match(/function applySessionView[\s\S]*?applySessionViewRef\.current = applySessionView;/)?.[0] ?? "";
    const openGoal = source.match(/async function openGoal[\s\S]*?async function refreshGoalState/)?.[0] ?? "";

    // Main is the authority on session existence: any view for the on-screen aim restores
    // the surface attachment (openGoal clears it on every navigation), and a session that
    // finished off-screen lands the moment the user returns. Without both, re-entering the
    // aim showed the start card and one click spawned a brand-new session (founder
    // 2026-07-25: "every time I retap into the aim, the whole process will restart").
    expect(applyView).toContain("if (selectedGoalRef.current?.id === view.goalId) setPlanningShellId(view.goalId);");
    expect(applyView).toContain('view.phase === "draft_ready" && view.landing && selectedGoalRef.current?.id === view.goalId');
    expect(applyView).not.toContain("planningShellId === view.goalId");
    // Re-tapping the already-open aim must not detach the live surface either (the
    // re-attach effect keys on selected.id and will not refire for the same id).
    expect(openGoal).toContain("setPlanningShellId((current) => (current === goal.id ? current : null));");
  });

  it("keeps accepted or skipped draft refinements on the Journey", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    const clarifyPanel = source.match(/const clarifyPanel = clarify[\s\S]*?const debugPanel =/)?.[0] ?? "";
    const refinePlan = source.match(/async function refinePlan[\s\S]*?\n {2}\/\/ ── Goal-first/)?.[0] ?? "";
    const builtAnswers = source.match(/const builtAnswers[\s\S]*?const builtIntakeAnswers/)?.[0] ?? "";
    const currentAimDraftInput = source.match(/function currentAimDraftInput[\s\S]*?async function persistCurrentDraftNow/)?.[0] ?? "";

    expect(source).toContain("const clarifyPanelActive = clarifyPhase !== null;");
    // Skipping refinement stays in place: clear the phase, the in-Journey plan review takes over.
    expect(clarifyPanel).toContain('onSkip={clarifyPhase === "intake" ? undefined : () => setClarifyPhase(null)}');
    expect(refinePlan.indexOf("setClarifyPhase(null)")).toBeLessThan(refinePlan.indexOf('setStageOverride("aim")'));
    expect(builtAnswers).toContain('clarifyPhase === "intake" ? null : clarify');
    expect(currentAimDraftInput).toContain('clarify: resetPlanning || clarifyPhase === "intake" ? null : clarify');
    expect(clarifyPanel).toContain('flowKey={activeDraftId ?? selected?.id ?? "new-aim"}');
  });

  it("runs pre-draft Context as a bounded adaptive one-question interview", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    const startDraft = source.match(/async function startDraft[\s\S]*?const builtAnswers/)?.[0] ?? "";
    const continueFromContext = source.match(/async function continueFromContext[\s\S]*?async function refinePlan/)?.[0] ?? "";

    expect(startDraft).toContain("maxQuestions: 1");
    expect(continueFromContext).toContain("priorQuestions");
    expect(continueFromContext).toContain("answers: answersFor(intakeClarify, intakeAnswers)");
    expect(continueFromContext).toContain("appendIntakeQuestions(intakeClarify, next)");
    expect(continueFromContext).toContain("MAX_ADAPTIVE_INTAKE_TURNS");
    expect(continueFromContext).toMatch(/next\.questions\.length > 0[\s\S]*?setClarifyPhase\("intake"\)/);
    expect(continueFromContext).toMatch(/setClarifyPhase\(null\)[\s\S]*?startDraft\(\{ skipIntakeGate: true[^}]*\}\)/);
  });

  it("has no standalone stage branches left — the Journey is the one work surface", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

    expect(source).not.toContain('activeStage === "context"');
    expect(source).not.toContain('activeStage === "contracts"');
    expect(source).not.toContain('activeStage === "run"');
    expect(source).not.toContain('activeStage === "eval"');
    expect(source).toContain("if (journeyView && (isPlanningShell || !draft))");
  });

  it("keeps product error details behind developer mode, not merely a disclosure", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

    expect(source).toContain('className="od-notice-copy"');
    expect(source).toContain('className="od-notice-details"');
    expect(source).toContain('summary>{t("plan.developerDetails")}</summary>');
    expect(source).toContain('props.error.details.join("\\n")');
    // The raw failure dump renders only when the user has explicitly turned developer mode on.
    expect(source).toContain("{developerMode && props.error.details.length > 0 ? (");
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
    expect(openGoal).toContain('setAimSurfaceMode("idle")');
  });

  it("keeps a compose-only intake surface with no legacy funnel or edit machinery", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    const startDraft = source.match(/async function startDraft[\s\S]*?\n {2}const builtAnswers/)?.[0] ?? "";
    const applyHydratedDraft = source.match(/function applyHydratedDraft[\s\S]*?async function openAimDraft/)?.[0] ?? "";
    const mainStage = source.match(/const mainStageContent = \(\(\) => \{[\s\S]*?\n {2}\}\)\(\);/)?.[0] ?? "";
    const draftAutosave = source.match(/useEffect\(\(\) => \{\n {4}if \(selected\) return;[\s\S]*?\n {2}\}\);/)?.[0] ?? "";

    // Goal-first: the surface mode is compose-only (no summary/edit funnel states).
    expect(source).toContain('type AimSurfaceMode = "idle" | "compose";');
    expect(source).toContain('const showAimEditor = aimSurfaceMode === "compose";');
    expect(source).toContain('activeDraftId: aimSurfaceMode === "compose" ? null : activeDraftId');
    expect(draftAutosave).toContain("aimSurfaceMode");

    // startDraft is shell-only — no unsaved-aim funnel (options.aim / aimSurfaceAfterSubmit / checkpoint).
    expect(startDraft).toContain("options: { skipIntakeGate?: boolean; shell: {");
    expect(startDraft).not.toContain("options.aim");
    expect(startDraft).not.toContain("aimSurfaceAfterSubmit");
    expect(startDraft).not.toContain("checkpointSubmittedAim");

    // Resumes land in the composer (drop the legacy plan/summary/parent hydration).
    expect(applyHydratedDraft).toContain('setAimSurfaceMode("compose")');
    expect(applyHydratedDraft).not.toContain("hydrated.aimSurface");
    expect(applyHydratedDraft).not.toContain("setParent(hydrated.parent)");

    // The composer is the only intake surface; the funnel intake panels are gone.
    expect(mainStage).toContain("if (showAimEditor)");
    expect(mainStage).toContain("<NewAimComposer");
    expect(mainStage).not.toContain("<AimIntakePanel");
    expect(mainStage).not.toContain("<DraftAimOverviewPanel");

    // The edit-mode machinery is fully removed.
    expect(source).not.toContain("function beginAimEdit");
    expect(source).not.toContain("aimEditBuffer");
    expect(source).not.toContain('aimSurfaceMode === "edit"');
    expect(source).not.toContain('setAimSurfaceMode("summary")');
    expect(source).not.toContain("function checkpointSubmittedAim");

    // The saved-goal contracts hop went with the standalone stages.
    expect(source).not.toContain("continueContextToPlan");
  });

  it("keeps plan validation on the in-place commit paths, never disabling repair edits", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    const commitShellPlan = source.match(/async function commitShellPlan[\s\S]*?\n {2}async function commitPlanEdit/)?.[0] ?? "";
    const commitPlanEdit = source.match(/async function commitPlanEdit[\s\S]*?\n {2}async function/)?.[0] ?? "";
    const beginWorkspaceTransition = source.match(/function beginWorkspaceTransition[\s\S]*?function bumpWorkspaceRevision/)?.[0] ?? "";
    const openGoal = source.match(/async function openGoal[\s\S]*?async function refreshGoalState/)?.[0] ?? "";
    const resetComposer = source.match(/function resetComposer[\s\S]*?function descriptionWithContext/)?.[0] ?? "";
    const applyHydratedDraft = source.match(/function applyHydratedDraft[\s\S]*?async function openAimDraft/)?.[0] ?? "";

    expect(commitShellPlan).toContain("validateExecutablePlan(plan)");
    expect(commitPlanEdit).toContain("validateExecutablePlan(plan)");
    expect(beginWorkspaceTransition).not.toContain("bumpWorkspaceRevision()");
    expect(openGoal).toContain("bumpWorkspaceRevision()");
    expect(resetComposer).toContain("bumpWorkspaceRevision()");
    expect(applyHydratedDraft).toContain("bumpWorkspaceRevision()");
    // The Journey's plan review passes validation messages through, not a disabled state.
    expect(source).toContain("validationErrors: activePlanValidationMessages");
  });

  it("autosaves draft state before Home, New Aim, or opening a saved aim clears the composer", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    const openGoal = source.match(/async function openGoal[\s\S]*?\n {2}async function refreshGoalState/)?.[0] ?? "";
    const startNewAim = source.match(/async function startNewAim[\s\S]*?\n {2}async function openHomePanel/)?.[0] ?? "";
    const openHomePanel = source.match(/async function openHomePanel[\s\S]*?\n {2}function openSettingsForAim/)?.[0] ?? "";

    expect(openGoal).toContain("await checkpointCurrentDraftBeforeNavigation()");
    expect(startNewAim.indexOf("await checkpointCurrentDraftBeforeNavigation()")).toBeLessThan(startNewAim.indexOf("resetComposer({ openComposer: true })"));
    expect(openHomePanel.indexOf("await checkpointCurrentDraftBeforeNavigation()")).toBeLessThan(openHomePanel.indexOf("resetComposer();"));
    expect(source).toContain("draftPersistence.flushForNavigation(req)");
    expect(source).toContain('title: t("aimDraft.checkpointErrorTitle")');
    expect(source).not.toContain("localStorage.setItem(\"aim");
  });

  it("keeps the renderer goal-first: no saveGoal path, drafts persist through the queue", () => {
    const appSource = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    const persistCurrentDraftNow = appSource.match(/async function persistCurrentDraftNow[\s\S]*?\n {2}async function refreshAimDrafts/)?.[0] ?? "";

    expect(persistCurrentDraftNow).toContain("const discardingCurrentDraft = Boolean(discardInFlightDraftIdRef.current)");
    expect(persistCurrentDraftNow).toContain("discardingCurrentDraft && !options.allowDuringDiscard");
    expect(persistCurrentDraftNow).toContain("draftPersistence.enqueue(req)");
    expect(appSource).not.toContain("window.aimcub.saveGoal");
    expect(appSource).not.toContain("async function savePlan");
  });

  it("discards a pre-goal draft when the goal-first shell is created", () => {
    const appSource = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    const createShell = appSource.match(/async function createAimAndOpenJourney[\s\S]*?\n {2}\/\*\* "Build the plan"/)?.[0]
      ?? appSource.match(/async function createAimAndOpenJourney[\s\S]*?\n {2}async function/)?.[0]
      ?? "";

    // Capture + pause BEFORE createAim so the in-flight autosave timer can't re-mint the row.
    expect(createShell).toContain(
      "const pendingDraftId = draftPersistence.currentDraftId() ?? activeDraftIdRef.current ?? undefined;",
    );
    expect(createShell.indexOf("draftPersistence.pauseAutosave();")).toBeLessThan(
      createShell.indexOf("window.aimcub.createAim"),
    );
    expect(createShell).toContain("window.aimcub.createAim({ title, description, draftId: pendingDraftId })");
    expect(createShell).toContain("draftPersistence.resumeAutosave();");
  });

  it("renames the selected aim in place via renameGoal (no plan change)", () => {
    const appSource = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    const mainIpcSource = readFileSync(new URL("../main/ipc.ts", import.meta.url), "utf8");
    const renameAim = appSource.match(/async function renameAim[\s\S]*?\n {2}async function runAgent/)?.[0] ?? "";

    // Title/description-only patch through the epoch-safe App handler + the rename IPC.
    expect(renameAim).toContain("window.aimcub.renameGoal({ goalId: goal.id, title, description: input.description })");
    expect(renameAim).toContain("setSelected(updated)");
    // Wired onto the Journey header, not a station interaction.
    expect(appSource).toContain("onRenameAim={isPlanningShell ? undefined : (input) => void renameAim(input)}");
    // The main handler renames without materializing a plan.
    expect(mainIpcSource).toContain("ipcMain.handle(IPC.renameGoal");
    expect(mainIpcSource).toContain("aimStore.renameGoal({ id: req.goalId, title: req.title, description: req.description })");
  });

  it("requires an explicit discard path for draft deletion", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    const openDraft = source.match(/async function openAimDraft[\s\S]*?\n {2}async function discardAimDraft/)?.[0] ?? "";
    const discard = source.match(/async function discardAimDraft[\s\S]*?\n {2}useEffect/)?.[0] ?? "";

    expect(openDraft).toContain("draftActivationTrackerRef.current.capture(draftRow.id)");
    expect(openDraft).toContain("draftActivationTrackerRef.current.isCurrent(activation)");
    expect(openDraft).toContain("draftPersistence.resumeAutosave()");
    expect(openDraft).toContain("beginPendingTargetNavigation(transition, draftRow.id)");
    expect(openDraft).toContain("finishPendingTargetNavigation(transition)");
    expect(discard).not.toContain("window.confirm");
    expect(discard).toContain("draftActivationTrackerRef.current.invalidate(draftRow.id)");
    expect(discard).toContain("cancelPendingTargetNavigation()");
    expect(discard).toContain("cancelsPendingDraftActivation");
    expect(discard).toContain("discardInFlightDraftIdRef.current = draftRow.id");
    expect(discard).toContain("allowDuringDiscard: true");
    expect(discard.indexOf("draftPersistence.invalidateSession()")).toBeLessThan(discard.indexOf("window.aimcub.discardAimDraft(draftRow.id)"));
    expect(discard).toContain("discardInFlightDraftIdRef.current = null");
    expect(discard).toContain("window.aimcub.discardAimDraft(draftRow.id)");
  });

  it("does not let a stale startup list replace drafts created during slower configuration probes", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    const refreshAll = source.match(/async function refreshAll[\s\S]*?\n {2}async function openGoal/)?.[0] ?? "";

    expect(refreshAll).toContain("const configurationRefresh = Promise.all([");
    expect(refreshAll.indexOf("const [nextGoals, nextDrafts] = await Promise.all([")).toBeLessThan(
      refreshAll.indexOf("await configurationRefresh"),
    );
    expect(refreshAll.indexOf("if (!isCurrentWorkspaceTransition(transitionAtStart))")).toBeLessThan(
      refreshAll.indexOf("setAimDrafts(nextDrafts)"),
    );
  });

  it("keeps navigation on the collapsed stage model (Journey + Settings + Memory)", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    const openCockpitStage = source.match(/function openCockpitStage[\s\S]*?\n {2}function resetPlanningForAimUpdate/)?.[0] ?? "";

    // Only Settings is special-cased; everything else lands on the Journey ("aim").
    expect(openCockpitStage).toContain('if (stage === "settings")');
    expect(openCockpitStage).not.toContain('"contracts"');
    expect(source).not.toContain("settingsReturnStageRef");
    expect(source).not.toContain("isWorkbenchStageAvailable");
    expect(source).not.toContain("LockedStagePanel");
  });

  it("guards async planning and goal responses against later target or surface navigation", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    const openGoal = source.match(/async function openGoal[\s\S]*?\n {2}async function refreshGoalState/)?.[0] ?? "";
    const refreshGoalState = source.match(/async function refreshGoalState[\s\S]*?\n {2}function resetComposer/)?.[0] ?? "";
    const startDraft = source.match(/async function startDraft[\s\S]*?\n {2}const builtAnswers/)?.[0] ?? "";
    const checkpoint = source.match(/async function checkpointCurrentDraftBeforeNavigation[\s\S]*?\n {2}async function refreshAimDrafts/)?.[0] ?? "";
    const openCockpitStage = source.match(/function openCockpitStage[\s\S]*?\n {2}function resetPlanningForAimUpdate/)?.[0] ?? "";
    const runAgent = source.match(/async function runAgent[\s\S]*?\n {2}async function confirmMilestone/)?.[0] ?? "";

    expect(openGoal).toContain("const transition = beginWorkspaceTransition()");
    expect(openGoal).toContain("canActivateGoal(");
    expect(openGoal).toContain('options.allowDuringSave ? "save_success" : "external_navigation"');
    expect(source).toContain("if (!isCurrentWorkspaceTransition(transition)) return;");
    expect(startDraft).toContain("if (workflowMutationIsLocked()) return;");
    expect(startDraft).toContain("isCurrentPlanningRun(runId, transition)");
    expect(refreshGoalState).toContain("if (!isCurrentWorkspaceTransition(transition)) return;");
    expect(openCockpitStage).toContain("beginSurfaceTransition()");
    expect(runAgent).toContain("beginSideEffectOperation(operationId");
    expect(runAgent).toContain("finishSideEffectOperation(operationId)");
    expect(checkpoint).toContain("clearPlanningRun()");
    expect(checkpoint).toContain("setBusy(null)");
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
  it("shows one selected contract instead of stacking every contract", () => {
    const secondNode = {
      ...contractPlan.nodes[0]!,
      key: "ship-contract",
      title: "Ship the reviewed contract",
      description: "SECOND CONTRACT BODY SHOULD STAY HIDDEN",
      decomposition_contract: {
        ...contractPlan.nodes[0]!.decomposition_contract!,
        definition_of_done: "SECOND CONTRACT DONE SHOULD STAY HIDDEN",
      },
    };
    const html = renderToStaticMarkup(
      <I18nProvider>
        <PlanPanel
          plan={{ ...contractPlan, nodes: [...contractPlan.nodes, secondNode] }}
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

    expect(html).toContain('data-od-id="plan-contract-selector"');
    expect(html).toContain("Current contract");
    expect(html).toContain("1. Review execution contracts");
    expect(html).toContain("2. Ship the reviewed contract");
    expect(html.match(/class="od-plan-contract-card/g)).toHaveLength(1);
    expect(html).not.toContain("SECOND CONTRACT BODY SHOULD STAY HIDDEN");
    expect(html).not.toContain("SECOND CONTRACT DONE SHOULD STAY HIDDEN");
    expect(css).toMatch(/\.od-plan-contract-selector\s*{[^}]*grid-template-columns:\s*auto minmax\(0, 1fr\);/s);
  });

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
    // Developer mode is off by default, so the whole developer affordance is absent — not merely
    // collapsed. The product plan surface has no debug shape at all.
    expect(html).not.toContain("Developer details");
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
          structureDisabled={false}
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

  it("keeps acceptance rule editing inside Developer details, and only in developer mode", () => {
    const node = contractPlan.nodes[0]!;
    const html = renderToStaticMarkup(
      <I18nProvider>
        <DeveloperModeProvider enabled>
        <PlanContractCard
          node={node}
          index={0}
          nodeCount={contractPlan.nodes.length}
          editable
          disabled={false}
          structureDisabled={false}
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
        </DeveloperModeProvider>
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

  it("locks contract mutations while busy and renders saved acceptance rules as code", () => {
    const node = contractPlan.nodes[0]!;
    const sharedProps = {
      node,
      index: 0,
      nodeCount: contractPlan.nodes.length,
      contract: editableContractForNode(node),
      recommendation: routingRecommendationForPlanNode(node),
      owner: "agent" as const,
      selectedAgent: routingAgents[0]!,
      selectedModel: "gpt-5",
      readyAgents: routingAgents,
      nodeIssues: [] as string[],
      overrideActive: false,
      ruleText: formatAcceptanceRule(node.acceptance_rule),
      advancedOpen: true,
      onNode: noop,
      onContract: noop,
      onMoveUp: noop,
      onMoveDown: noop,
      onMergeUp: noop,
      onMergeDown: noop,
      onSplit: noop,
      onOwner: noop,
      onAgent: noop,
      onModel: noop,
      onRoutingReset: noop,
      onAdvancedToggle: noop,
      onRuleText: noop,
      onRuleCommit: noop,
    };
    const busyHtml = renderToStaticMarkup(
      <I18nProvider>
        <DeveloperModeProvider enabled>
          <PlanContractCard {...sharedProps} editable disabled structureDisabled />
        </DeveloperModeProvider>
      </I18nProvider>,
    );
    const busyTextareas = [...busyHtml.matchAll(/<textarea[^>]*>/g)].map(([tag]) => tag);
    const structureButtons = [...busyHtml.matchAll(/<button[^>]*aria-label="(?:Move|Merge|Split)[^"]*"[^>]*>/g)].map(([tag]) => tag);

    expect(busyHtml.match(/<input[^>]*>/)?.[0]).toContain('disabled=""');
    expect(busyTextareas).toHaveLength(6);
    expect(busyTextareas.every((tag) => tag.includes('disabled=""'))).toBe(true);
    expect(structureButtons).toHaveLength(5);
    expect(structureButtons.every((tag) => tag.includes('disabled=""'))).toBe(true);
    expect(busyHtml).toContain('<button type="button" disabled="">Apply rule</button>');

    const savedHtml = renderToStaticMarkup(
      <I18nProvider>
        <DeveloperModeProvider enabled>
          <PlanContractCard {...sharedProps} editable={false} disabled={false} structureDisabled={false} />
        </DeveloperModeProvider>
      </I18nProvider>,
    );
    expect(savedHtml).not.toContain("Apply rule");
    expect(savedHtml).toContain('<pre class="od-plan-rule-code" aria-label="Acceptance rule" tabindex="0"><code>');
    expect(savedHtml).not.toContain('<textarea aria-label="Acceptance rule"');
  });
});

describe("SettingsPanel", () => {
  function renderSettings(
    section: "general" | "brain" | "workers" | "research" | "about",
    developerMode = false,
  ) {
    return renderToStaticMarkup(
      <I18nProvider>
        <SettingsPanel
          provider={providerStatus}
          webResearch={webResearchStatus}
          contextSources={contextSourceStatus}
          localAgents={[]}
          activeSection={section}
          developerMode={developerMode}
          planningBrain={null}
          planningModel={null}
          onSelectBrain={noop}
          onSelectModel={noop}
          onDeveloperMode={noop}
          onProvider={noop}
          onWeb={noop}
          onContextSources={noop}
          onRefreshAgents={asyncNoop}
        />
      </I18nProvider>,
    );
  }

  it("renders the settings nav in the sidebar and one centered detail pane", () => {
    const navHtml = renderToStaticMarkup(
      <I18nProvider>
        <SettingsSidebarNav activeSection="general" onSection={noop} onBack={noop} />
      </I18nProvider>,
    );
    const paneHtml = renderSettings("general");
    const css = readFileSync(new URL("./cockpit.css", import.meta.url), "utf8");

    // The category nav is sidebar content now (swapped in for the aim list by CockpitShell).
    expect(navHtml).toContain('data-od-id="settings-sidebar-nav"');
    expect(navHtml).toContain(">Back</span>");
    expect(navHtml).toContain('class="od-settings-side-title"');
    for (const label of ["General", "Planning brain", "Workers", "Research", "About"]) {
      expect(navHtml).toContain(`<span>${label}</span>`);
    }
    expect(navHtml).toContain('aria-current="page"');
    // The workspace holds only the centered detail pane — no in-workspace rail.
    expect(paneHtml).toContain('data-od-id="settings-view"');
    expect(paneHtml).not.toContain("od-settings-rail-item");
    expect(paneHtml).not.toContain("od-settings-side");
    expect(css).toMatch(/\.od-settings\s*{[^}]*display:\s*flex;[^}]*justify-content:\s*center;/s);
    expect(css).toMatch(/\.od-settings-side\s*{[^}]*width:\s*var\(--sidebar-content-width\);[^}]*justify-self:\s*center;/s);
    expect(css).toMatch(/\.od-settings-back\s*{[^}]*min-height:\s*26px;[^}]*color:\s*var\(--mut\);/s);
    expect(css).toMatch(/\.od-settings-pane\s*{[^}]*max-width:\s*620px;[^}]*padding:\s*40px 24px 44px;/s);
    expect(css).toMatch(/\.od-settings-rail-item\[aria-current="page"\]\s*{[^}]*background:\s*var\(--acc-soft\);[^}]*color:\s*var\(--acc\);/s);
    expect(css).toMatch(/\.od-settings-card\s*{[^}]*border-radius:\s*18px;[^}]*background:\s*var\(--island\);[^}]*backdrop-filter:\s*blur\(28px\);/s);
    expect(css).toMatch(/\.od-settings-card-row \+ \.od-settings-card-row\s*{[^}]*border-top:\s*1px solid var\(--edge\);/s);
  });

  it("renders only the selected settings pane", () => {
    const generalHtml = renderSettings("general");
    expect(generalHtml).toContain("Appearance");
    expect(generalHtml).toContain("Workspace");
    expect(generalHtml).toContain("Reveal");
    expect(generalHtml).not.toContain("API key");
    expect(generalHtml).not.toContain("Rescan");

    const brainHtml = renderSettings("brain");
    expect(brainHtml).toContain("Planning brain");
    expect(brainHtml).toContain("Embedded planning brain");
    expect(brainHtml).toContain("API provider (fallback planning path)");

    const workersHtml = renderSettings("workers");
    expect(workersHtml).toContain("You and your agents — same rules, same receipts.");
    expect(workersHtml).toContain("judgment, approvals, anything with your card");

    const researchHtml = renderSettings("research");
    expect(researchHtml).toContain("Context sources");
    expect(researchHtml).toContain("Manage");

    const aboutHtml = renderSettings("about");
    expect(aboutHtml).toContain("Aimcub runs on your machine.");
    expect(aboutHtml).toContain("Everything stays on device. Nothing leaves ~/.aimcub without your approval.");
    // No fabricated updater — About only states real facts.
    expect(aboutHtml).not.toContain("Check");
    expect(aboutHtml).not.toContain("latest");
  });

  it("offers the developer-mode toggle in General, off by default", () => {
    const offHtml = renderSettings("general");
    const onHtml = renderSettings("general", true);

    expect(offHtml).toContain("Developer mode");
    expect(offHtml).toContain("Show traces, raw payloads, and other diagnostics for debugging Aimcub itself. Off by default.");
    expect(offHtml).toContain('aria-label="Developer mode"');
    // Off is the selected radio when nothing has been turned on.
    expect(offHtml).toMatch(/aria-checked="true"[^>]*data-active="true">Off</);
    expect(onHtml).toMatch(/aria-checked="true"[^>]*data-active="true">On</);
  });
});

describe("developer mode gating", () => {
  it("is off by default, including for a component with no provider around it", () => {
    const source = readFileSync(new URL("./developerMode.tsx", import.meta.url), "utf8");
    expect(source).toContain("createContext<boolean>(false)");
  });

  it("hides the plan's raw acceptance JSON until developer mode is on", () => {
    const node = contractPlan.nodes[0]!;
    const cardProps = {
      node,
      index: 0,
      nodeCount: contractPlan.nodes.length,
      editable: true,
      disabled: false,
      structureDisabled: false,
      contract: editableContractForNode(node),
      recommendation: routingRecommendationForPlanNode(node),
      owner: "agent" as const,
      selectedAgent: routingAgents[0]!,
      selectedModel: "gpt-5",
      readyAgents: routingAgents,
      nodeIssues: [] as string[],
      overrideActive: false,
      ruleText: formatAcceptanceRule(node.acceptance_rule),
      advancedOpen: true,
      onNode: noop,
      onContract: noop,
      onMoveUp: noop,
      onMoveDown: noop,
      onMergeUp: noop,
      onMergeDown: noop,
      onSplit: noop,
      onOwner: noop,
      onAgent: noop,
      onModel: noop,
      onRoutingReset: noop,
      onAdvancedToggle: noop,
      onRuleText: noop,
      onRuleCommit: noop,
    };
    const productHtml = renderToStaticMarkup(
      <I18nProvider>
        <DeveloperModeProvider enabled={false}>
          <PlanContractCard {...cardProps} />
        </DeveloperModeProvider>
      </I18nProvider>,
    );
    const developerHtml = renderToStaticMarkup(
      <I18nProvider>
        <DeveloperModeProvider enabled>
          <PlanContractCard {...cardProps} />
        </DeveloperModeProvider>
      </I18nProvider>,
    );

    // Even with `advancedOpen` set, the product build shows no developer affordance at all.
    expect(productHtml).not.toContain("Developer details");
    expect(productHtml).not.toContain("od-plan-developer-row");
    expect(productHtml).not.toContain("completion_mode");
    expect(developerHtml).toContain("Hide developer details");
    expect(developerHtml).toContain("completion_mode");
  });

  it("persists the preference through its own desktop settings file, never widening a permission", () => {
    const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    const settings = readFileSync(new URL("../main/app-settings.ts", import.meta.url), "utf8");

    expect(app).toContain("<DeveloperModeProvider enabled={developerMode}>");
    expect(app).toContain("await window.aimcub.setDesktopPreferences({");
    expect(app).toContain("developerMode: enabled,");
    // Preference saves carry the FULL object so one toggle can never wipe another field.
    expect(app).toContain("planningModel: planningModelPref,");
    expect(settings).toContain("developerMode: false");
    expect(settings).toContain("developerMode: record.developerMode === true");
    // The preferences file is desktop-only chrome; it must not carry run permissions.
    expect(settings).not.toContain("sandbox");
  });
});

describe("StoreDiagnosticsBanner", () => {
  const recovered = {
    kind: "recovered_from_backup" as const,
    at: "2026-07-22T09:00:00.000Z",
    message: "Recovered store.json from store.json.bak",
    path: "/tmp/aimcub/store.json",
    quarantinePath: "/tmp/aimcub/store.json.corrupt-2026-07-22T09-00-00-000Z",
    backupPath: "/tmp/aimcub/store.json.bak",
  };

  it("says what happened and where the unusable file was kept", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <StoreDiagnosticsBanner diagnostics={[recovered]} onDismiss={noop} />
      </I18nProvider>,
    );

    expect(html).toContain('data-od-id="store-diagnostics-banner"');
    expect(html).toContain("Your workspace file was recovered");
    expect(html).toContain("Aimcub restored your workspace from its backup copy. Very recent changes may be missing.");
    expect(html).toContain("/tmp/aimcub/store.json.corrupt-2026-07-22T09-00-00-000Z");
    expect(html).toContain("Dismiss");
    // Non-blocking: a status region, never an alert or a modal.
    expect(html).toContain('role="status"');
  });

  it("names the quarantined file once, not once per diagnostic of the same incident", () => {
    // What a real corrupt-then-recover load actually produces: two diagnostics, one file.
    const html = renderToStaticMarkup(
      <I18nProvider>
        <StoreDiagnosticsBanner
          diagnostics={[{ ...recovered, kind: "corrupt_quarantined" }, recovered]}
          onDismiss={noop}
        />
      </I18nProvider>,
    );

    expect(html).toContain("The workspace file could not be read, so Aimcub set it aside instead of overwriting it.");
    expect(html).toContain("Aimcub restored your workspace from its backup copy. Very recent changes may be missing.");
    expect(html.split(recovered.quarantinePath).length - 1).toBe(1);
  });

  it("reports a kind it does not recognize rather than staying silent", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <StoreDiagnosticsBanner
          diagnostics={[{ ...recovered, kind: "something_new" as never, quarantinePath: undefined }]}
          onDismiss={noop}
        />
      </I18nProvider>,
    );
    expect(html).toContain("Aimcub reported a storage recovery event.");
  });

  it("renders nothing when the store had a clean load", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <StoreDiagnosticsBanner diagnostics={[]} onDismiss={noop} />
      </I18nProvider>,
    );
    expect(html).toBe("");
  });

  it("is wired into the cockpit as a dismissible, non-blocking banner", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

    expect(source).toContain("window.aimcub.getStoreDiagnostics?.().then(applyStoreDiagnostics)");
    expect(source).toContain("{storeDiagnosticsDismissed ? null : (");
    expect(source).toContain("onDismiss={() => setStoreDiagnosticsDismissed(true)}");
  });
});

describe("CockpitShell", () => {
  it("renders a sidebar footer user menu trigger", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <CockpitShell
          goals={[]}
          activeStage="aim"
          workspaceTarget={{ kind: "home" }}
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
    expect(html).toContain("Local workspace");
    expect(html).toContain("~/.aimcub");
    expect(html).not.toContain("<h1>Aimcub</h1>");
    expect(html).not.toContain("<p>Workbench</p>");
  });

  it("gates aim deletion behind the row's More Actions menu with an inline confirm", () => {
    const goal = { ...savedGoal, id: "00000000-0000-4000-8000-000000000077", title: "Throwaway test aim" };
    const withDelete = renderToStaticMarkup(
      <I18nProvider>
        <CockpitShell
          goals={[goal]}
          activeStage="aim"
          workspaceTarget={{ kind: "home" }}
          onHome={noop}
          onNewAim={noop}
          onOpenGoal={noop}
          onDeleteGoal={noop}
          onStage={noop}
          main={<div>Home</div>}
        />
      </I18nProvider>,
    );

    // The trigger is present and labelled per aim; the destructive item renders only
    // inside the opened menu (never as visible row text), and never as a bare button.
    expect(withDelete).toContain('aria-label="Actions for Throwaway test aim"');
    expect(withDelete).toContain('aria-haspopup="menu"');
    expect(withDelete).not.toContain(">Delete aim</button>");

    const withoutDelete = renderToStaticMarkup(
      <I18nProvider>
        <CockpitShell
          goals={[goal]}
          activeStage="aim"
          workspaceTarget={{ kind: "home" }}
          onHome={noop}
          onNewAim={noop}
          onOpenGoal={noop}
          onStage={noop}
          main={<div>Home</div>}
        />
      </I18nProvider>,
    );
    expect(withoutDelete).not.toContain('aria-label="Actions for Throwaway test aim"');
  });

  it("deletes an aim only through guarded handlers that stop writers first", () => {
    const appSource = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    const mainIpcSource = readFileSync(new URL("../main/ipc.ts", import.meta.url), "utf8");
    const deleteAim = appSource.match(/async function deleteAim[\s\S]*?\n {2}useEffect/)?.[0] ?? "";

    expect(deleteAim).toContain("if (navigationIsLocked() || sideEffectOperationRef.current) return;");
    expect(deleteAim).toContain("beginSideEffectOperation(operationId");
    expect(deleteAim).toContain("await window.aimcub.cancelRun(liveRun.runId);");
    expect(deleteAim).toContain("if (deletingSelected && isCurrentWorkspaceTransition(transition)) resetComposer();");
    expect(deleteAim).toContain("finishSideEffectOperation(operationId)");
    // Main is the authority: it stops a planning brain for the aim before the cascade.
    expect(mainIpcSource).toMatch(/IPC\.deleteGoal[\s\S]*?cancelPlanningSession\(id\);[\s\S]*?aimStore\.deleteGoal\(id\)/);
  });

  it("keeps the aim row's pressed-scale off while its More Actions menu is open", () => {
    const css = readFileSync(new URL("./cockpit.css", import.meta.url), "utf8");

    // Pressing inside the open popover bubbles :active up to the row card. A bare transform
    // on the card (even at scale≈1, mid-transition) instantly creates a stacking context
    // that traps the z-indexed popover under the NEXT sibling row, which then steals the
    // pointerup — the menu item's click never fires, so aims could not be deleted (2026-07-25).
    expect(css).not.toMatch(/^\.od-aim-card:active,?\s*$/m);
    expect(css).toContain('.od-aim-card:active:not(:has(.od-content-entry-more [aria-expanded="true"]))');

    // The confirm card is right-pinned to the trigger; uncapped it walks off the island's
    // left rounded clip and the Cancel/Delete actions render half-hidden.
    expect(css).toContain(".od-sidebar .od-action-menu-confirm");
    expect(css).toContain("width: min(216px, calc(var(--sidebar-content-width) - 20px));");
  });

  it("keeps question choice cards the same size with top-aligned content", () => {
    const css = readFileSync(new URL("./cockpit.css", import.meta.url), "utf8");

    // Founder 2026-07-25: uneven tradeoff lengths made the option grid ragged. Rows
    // equalize to the tallest card and content reads from the top edge.
    const choiceList = css.match(/\.od-context-choice-list \{[\s\S]*?\}/)?.[0] ?? "";
    expect(choiceList).toContain("grid-auto-rows: 1fr;");
    const choiceCard = css.match(/\.od-context-choice\.od-ui-button \{[\s\S]*?\}/)?.[0] ?? "";
    expect(choiceCard).toContain("height: 100%;");
    expect(choiceCard).toContain("justify-content: flex-start;");
  });

  it("renders the sidebar brand row: Aimcub → Home plus a compact New-aim action", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <CockpitShell
          goals={[]}
          activeStage="aim"
          workspaceTarget={{ kind: "home" }}
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
    expect(html).toContain('<button class="od-sidebar-brand-home" type="button" aria-current="page" aria-label="Home panel" title="Home panel" data-od-id="sidebar-home-panel-action"');
    expect(html).toContain('<span class="od-brand-mark" aria-hidden="true">A</span>');
    expect(html).toContain('<span class="od-brand-name">Aimcub</span>');
    expect(html).toContain('<button class="od-sidebar-plus" type="button" aria-label="New aim" title="New aim" data-od-id="sidebar-new-aim-action"');
    // The old two-row action list (with hover kbd hints) is gone; shortcuts live in the palette.
    expect(html).not.toContain("od-sidebar-action");
    expect(html).not.toContain("<kbd");
    expect(css).toContain("--sidebar-horizontal-inset: 12px;");
    expect(css).toContain("--sidebar-row-padding-x: 10px;");
    expect(css).toContain("--sidebar-icon-column: 28px;");
    expect(css).toContain("--sidebar-content-width: calc(var(--sidebar-width) - (var(--sidebar-horizontal-inset) * 2) - 1px);");
    expect(css).toContain("--od-type-meta: 11.5px;");
    expect(css).toContain("--od-type-body: 13.5px;");
    expect(css).toContain("--od-type-title: 15.5px;");
    expect(css).toContain("--od-font-weight-medium: 500;");
    expect(css).toContain("--od-font-weight-semibold: 600;");
    expect(css).toContain("--od-icon-stroke: 1.55;");
    // Floating Glass island: rounded, ring-inset, blurred, clipped — the aim list scrolls inside.
    expect(css).toMatch(/\.od-sidebar\s*{[^}]*padding:\s*18px var\(--sidebar-horizontal-inset\) 12px;[^}]*overflow:\s*hidden;[^}]*border-radius:\s*18px;[^}]*box-shadow:\s*var\(--sh-md\), inset 0 0 0 1px var\(--ring\);/s);
    expect(css).toMatch(/\.od-app\s*{[^}]*--sidebar-width:\s*224px;[^}]*--shell-top:\s*44px;[^}]*--shell-gutter:\s*22px;[^}]*--shell-gap:\s*18px;/s);
    expect(css).toMatch(/\.od-sidebar-brand\s*{[^}]*width:\s*var\(--sidebar-content-width\);[^}]*display:\s*flex;[^}]*justify-self:\s*center;[^}]*align-items:\s*center;[^}]*gap:\s*6px;/s);
    expect(css).toMatch(/\.od-sidebar-brand-home\s*{[^}]*flex:\s*1;[^}]*min-height:\s*34px;[^}]*border-radius:\s*10px;[^}]*background:\s*transparent;[^}]*padding:\s*0 6px;/s);
    expect(css).toMatch(/\.od-sidebar-brand-home:hover[^{]*{[^}]*background:\s*var\(--island2\);/s);
    expect(css).toMatch(/\.od-brand-mark\s*{[^}]*width:\s*26px;[^}]*height:\s*26px;[^}]*border-radius:\s*8px;[^}]*background:\s*var\(--acc\);[^}]*color:\s*var\(--acc-on\);/s);
    expect(css).toMatch(/\.od-sidebar-plus\s*{[^}]*width:\s*26px;[^}]*height:\s*26px;[^}]*border-radius:\s*8px;[^}]*background:\s*transparent;[^}]*color:\s*var\(--od-muted\);/s);
    expect(css).toMatch(/\.od-sidebar-plus:hover,\s*\.od-sidebar-plus\[aria-current="page"\]\s*{[^}]*background:\s*var\(--field\);[^}]*color:\s*var\(--od-fg\);/s);
    expect(css).toMatch(/\.od-sidebar-plus:focus-visible\s*{[^}]*box-shadow:\s*var\(--od-focus\);/s);
    expect(css).not.toContain("--od-new-aim-bg");
    expect(css).not.toContain(".od-sidebar-action");
    expect(css).not.toContain(".od-sidebar-search");
    expect(css).not.toContain(".od-filter-row");
  });

  it("marks New Aim as current while a new aim is open", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <CockpitShell
          goals={[]}
          activeStage="aim"
          workspaceTarget={{ kind: "newAim" }}
          onHome={noop}
          onNewAim={noop}
          onOpenGoal={noop}
          onStage={noop}
          main={<div>New aim</div>}
        />
      </I18nProvider>,
    );

    expect(html).toContain('<button class="od-sidebar-brand-home" type="button" aria-label="Home panel" title="Home panel" data-od-id="sidebar-home-panel-action"');
    expect(html).toContain('<button class="od-sidebar-plus" type="button" aria-current="page" aria-label="New aim" title="New aim" data-od-id="sidebar-new-aim-action"');
  });

  it("renders recoverable drafts as draft rows, not saved recent aims", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <CockpitShell
          goals={[]}
          drafts={[draftRow]}
          activeStage="aim"
          workspaceTarget={{ kind: "draft", id: draftRow.id }}
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
    expect(html).toContain("Ship a useful contract review");
    expect(html).not.toContain("Unfinished local-first aim");
    expect(html).not.toContain("Save blocked");
    expect(html).toContain('class="od-content-entry od-draft-card" data-selected="true"');
    expect(html).toContain('class="od-content-entry-main od-draft-card-main" type="button" aria-current="page"');
    expect(html).not.toMatch(/class="od-sidebar-brand-home"[^>]*aria-current="page"/);
    expect(html).not.toMatch(/class="od-sidebar-plus"[^>]*aria-current="page"/);
    expect(html).toContain("More actions for Ship a useful contract review");
    expect(html).not.toContain(">Discard</button>");
    expect(html).toContain("Your aims will live here.");
    expect(html).not.toContain('class="od-aim-card selected"');
  });

  it("keeps every recoverable draft reachable in the scrolling sidebar", () => {
    const drafts = Array.from({ length: 7 }, (_, index) => ({
      ...draftRow,
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      title: `Reachable draft ${index + 1}`,
      draft_plan: null,
      final_plan: null,
    }));
    const html = renderToStaticMarkup(
      <I18nProvider>
        <CockpitShell
          goals={[]}
          drafts={drafts}
          activeStage="aim"
          workspaceTarget={{ kind: "home" }}
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

    expect(html).toContain("Reachable draft 1");
    expect(html).toContain("Reachable draft 7");
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

  it("keeps Desktop typography fully on the organized Glass type ramp", () => {
    const css = readFileSync(new URL("./cockpit.css", import.meta.url), "utf8");

    // Every font-size / font-weight / letter-spacing routes through a ramp token — no raw
    // numeric values anywhere outside the token definitions themselves.
    expect(css).not.toMatch(/font-size:\s*[\d.]/);
    expect(css).not.toMatch(/font-weight:\s*\d/);
    expect(css).not.toMatch(/letter-spacing:\s*-?\.?\d*[1-9]/);

    // The ramp contract (sizes climb tag → hero; weights 400/500/600/700, strong = semibold).
    expect(css).toContain("--od-type-tag: 10.5px;");
    expect(css).toContain("--od-type-meta: 11.5px;");
    expect(css).toContain("--od-type-sub: 12.5px;");
    expect(css).toContain("--od-type-body: 13.5px;");
    expect(css).toContain("--od-type-title-s: 14.5px;");
    expect(css).toContain("--od-type-title: 15.5px;");
    expect(css).toContain("--od-type-title-m: 17.5px;");
    expect(css).toContain("--od-type-title-l: 19px;");
    expect(css).toContain("--od-type-display: 24px;");
    expect(css).toContain("--od-type-hero: 27px;");
    expect(css).toContain("--od-font-weight-regular: 400;");
    expect(css).toContain("--od-font-weight-medium: 500;");
    expect(css).toContain("--od-font-weight-semibold: 600;");
    expect(css).toContain("--od-font-weight-strong: var(--od-font-weight-semibold);");
    expect(css).toContain("--od-font-weight-heavy: 700;");
    expect(css).toContain("--od-ls-title: -0.01em;");
    expect(css).toContain("--od-ls-display: -0.015em;");
    expect(css).toContain("--od-ls-caps: 0.06em;");
  });

  it("speaks the session's real language to the OS and relaxes zh titles to medium", () => {
    // index.html ships lang="en" as a boot value only; the provider must stamp the live
    // language, because the zh weight rule (semibold reads as 500 in Chinese — the ramp's
    // own note, made structural) keys off :lang(zh) and dies silently without it.
    const i18nSource = readFileSync(new URL("./i18n.tsx", import.meta.url), "utf8");
    expect(i18nSource).toContain("document.documentElement.lang = lang;");
    const css = readFileSync(new URL("./cockpit.css", import.meta.url), "utf8");
    expect(css).toMatch(/:root:lang\(zh\)\s*{[^}]*--od-font-weight-semibold:\s*var\(--od-font-weight-medium\)|:root:lang\(zh\)\s*{[^}]*--od-font-weight-semibold:\s*500;/s);
  });

  it("keeps the planning card's typography at content size and its pills clustered", () => {
    // Founder 2026-08-02 (排版布局): "Plan ready" floated detached in the card's middle
    // (space-between with three head children), and the trace — the card's actual content
    // on a stopped pass — sat at footnote size.
    const css = readFileSync(new URL("./cockpit.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.od-planning-session-head\s*{[^}]*}/s);
    expect(css).not.toMatch(/\.od-planning-session-head\s*{[^}]*justify-content:\s*space-between/s);
    expect(css).toMatch(/\.od-planning-session-title\s*{[^}]*flex:\s*1 1 auto;/s);
    expect(css).toMatch(/\.od-planning-session-trace li\s*{[^}]*font-size:\s*var\(--od-type-sub\);/s);
    expect(css).toMatch(/\.od-journey-sub\s*{[^}]*font-size:\s*var\(--od-type-sub\);/s);
  });

  it("keeps sidebar Aim rows compact, single-line, and free of status subtitles", () => {
    const verboseDraftTitle = "Coordinate the entire desktop application layout and ensure every workbench surface shares a coherent alignment system";
    const goalWithSummary: Goal = {
      ...savedGoal,
      title: "I want to ship a coherent desktop workspace with compact navigation",
      plan_json: {
        ...contractPlan,
        goal_summary: "Ship a coherent desktop workspace",
      },
    };
    const html = renderToStaticMarkup(
      <I18nProvider>
        <CockpitShell
          goals={[goalWithSummary]}
          drafts={[draftRow, {
            ...draftRow,
            id: "00000000-0000-4000-8000-000000000099",
            title: verboseDraftTitle,
            draft_plan: null,
            final_plan: null,
          }]}
          activeStage="aim"
          workspaceTarget={{ kind: "home" }}
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
    const css = readFileSync(new URL("./cockpit.css", import.meta.url), "utf8");

    expect(html).toContain('<div class="od-aim-card">');
    expect(html).toContain('<button class="od-aim-card-main" type="button" aria-label="Ship a coherent desktop workspace" title="Ship a coherent desktop workspace"');
    expect(html).toContain('class="od-content-entry-main od-draft-card-main" type="button" aria-label="Ship a useful contract review" title="Ship a useful contract review"');
    expect(html).toContain(`aria-label="More actions for ${verboseDraftTitle}"`);
    expect(html).toContain("Coordinate the entire desktop application…");
    expect(html).not.toContain(">active<");
    expect(html).not.toContain("Save blocked");
    expect(css).toMatch(/\.od-aim-card\s*{[^}]*min-height:\s*32px;[^}]*border-radius:\s*10px;[^}]*color:\s*var\(--mut\);/s);
    expect(css).toMatch(/\.od-aim-card\.selected\s*{[^}]*background:\s*var\(--field\);[^}]*border-color:\s*transparent;[^}]*box-shadow:\s*0 1px 3px rgba\(30, 40, 70, 0\.08\);/s);
    expect(css).toMatch(/\.od-aim-card-main\s*{[^}]*min-height:\s*32px;[^}]*padding:\s*0 2px 0 var\(--sidebar-row-padding-x\);/s);
    expect(css).toMatch(/\.od-aim-card-main:focus-visible\s*{[^}]*box-shadow:\s*var\(--od-focus\);/s);
    // The row menu stays hidden until hover/focus, and while its popover is open.
    expect(css).toMatch(/\.od-aim-card \.od-content-entry-more\s*{[^}]*opacity:\s*0;/s);
    expect(css).toMatch(/\.od-aim-card:hover \.od-content-entry-more,\s*[\r\n\s]*\.od-aim-card:focus-within \.od-content-entry-more/s);
    expect(css).toMatch(/\.od-draft-card \.od-content-entry-main\s*{[^}]*min-height:\s*32px;[^}]*padding:\s*0 2px 0 var\(--sidebar-row-padding-x\);/s);
    expect(css).toMatch(/\.od-aim-card strong,\s*\.od-draft-card \.od-content-entry-copy strong\s*{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s);
  });

  it("keeps Home drafts and workbench navigation on coherent alignment rails", () => {
    const css = readFileSync(new URL("./cockpit.css", import.meta.url), "utf8");

    expect(css).toMatch(/\.od-main\s*{[^}]*--od-rail-operational:\s*940px;[^}]*--od-rail-reading:\s*760px;[^}]*--od-rail-compose:\s*560px;/s);
    expect(css).toMatch(/\.od-workspace\s*{[^}]*width:\s*min\(100%, var\(--od-rail-operational\)\);/s);
    expect(css).toMatch(/\.od-workspace-aim:has\(> \.od-initial-workspace\[data-has-drafts="true"\]\)\s*{[^}]*align-content:\s*safe center;[^}]*justify-items:\s*stretch;/s);
    expect(css).toMatch(/\.od-initial-workspace\[data-has-drafts="true"\]\s*{[^}]*min-height:\s*0;[^}]*align-content:\s*start;[^}]*padding:\s*0;/s);
    expect(css).toMatch(/\.od-draft-recovery\s*{[^}]*width:\s*min\(100%, var\(--od-rail-compose\)\);[^}]*margin:\s*0 auto;/s);
  });

  it("keeps the saved-goal workbench on a single-row grid", () => {
    const css = readFileSync(new URL("./cockpit.css", import.meta.url), "utf8");

    // The top stage-nav is gone (Stage 7), so .od-main is single-row and .od-main-aim matches it.
    expect(css).toMatch(/\.od-main-aim\s*{[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\);[^}]*}/s);
  });

  it("uses the quiet hover treatment for secondary desktop controls", () => {
    const css = readFileSync(new URL("./cockpit.css", import.meta.url), "utf8");

    expect(css).toMatch(/\.od-sidebar-toggle:hover,\s*\.od-sidebar-toggle\[data-state="peek"\]\s*{[^}]*background:\s*var\(--od-interaction-hover-bg\);[^}]*border-color:\s*transparent;[^}]*box-shadow:\s*var\(--od-interaction-hover-shadow\);/s);
    expect(css).toMatch(/\.od-sidebar-toggle:focus-visible\s*{[^}]*background:\s*var\(--od-interaction-hover-bg\);[^}]*border-color:\s*transparent;[^}]*box-shadow:\s*var\(--od-interaction-focus-shadow\);/s);
    expect(css).toMatch(/\.od-user-menu-trigger:hover,\s*\.od-user-menu-trigger\[aria-expanded="true"\]\s*{[^}]*border-color:\s*transparent;[^}]*background:\s*var\(--island2\);[^}]*box-shadow:\s*none;/s);
    expect(css).toMatch(/\.od-user-menu-trigger:focus-visible\s*{[^}]*border-color:\s*transparent;[^}]*background:\s*var\(--island2\);[^}]*box-shadow:\s*var\(--od-focus\);/s);
    expect(css).toMatch(/\.od-aim-secondary:hover\s*{[^}]*border-color:\s*transparent;[^}]*background:\s*var\(--od-interaction-hover-bg\);[^}]*box-shadow:\s*var\(--od-interaction-hover-shadow\);/s);
    expect(css).toMatch(/\.od-command-row:hover,\s*\.od-command-row\[data-active="true"\]\s*{[^}]*border-color:\s*transparent;[^}]*background:\s*var\(--od-interaction-hover-bg\);[^}]*box-shadow:\s*var\(--od-interaction-hover-shadow\);/s);
    expect(css).toMatch(/\.od-routing-owner button:hover:not\(:disabled\)\s*{[^}]*background:\s*var\(--od-interaction-hover-bg\);[^}]*box-shadow:\s*var\(--od-interaction-hover-shadow\);/s);
    expect(css).toMatch(/\.od-scope-button:hover:not\(:disabled\)\s*{[^}]*border-color:\s*transparent;[^}]*background:\s*var\(--od-interaction-hover-bg\);[^}]*box-shadow:\s*var\(--od-interaction-hover-shadow\);/s);
  });

  it("keeps the aim list and account menu on the shared sidebar rails", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <CockpitShell
          goals={[]}
          activeStage="aim"
          workspaceTarget={{ kind: "home" }}
          onHome={noop}
          onNewAim={noop}
          onOpenGoal={noop}
          onStage={noop}
          main={<div>New aim</div>}
        />
      </I18nProvider>,
    );
    const css = readFileSync(new URL("./cockpit.css", import.meta.url), "utf8");

    // No "Recent aims" section label / search / filters — a plain list with a quiet empty hint.
    expect(html).not.toContain('data-od-id="sidebar-recent-aims-label"');
    expect(html).toContain('<div class="od-sidebar-empty">Your aims will live here.</div>');
    expect(css).toMatch(/\.od-aim-browser\s*{[^}]*width:\s*var\(--sidebar-content-width\);[^}]*justify-self:\s*center;[^}]*padding-right:\s*0;/s);
    expect(css).toMatch(/\.od-section-label\s*{[^}]*justify-content:\s*flex-start;[^}]*padding:\s*0 var\(--sidebar-row-padding-x\);/s);
    expect(css).toMatch(/\.od-sidebar-empty\s*{[^}]*padding:\s*8px var\(--sidebar-row-padding-x\);[^}]*font-size:\s*var\(--od-type-sub\);/s);
    expect(css).toMatch(/\.od-aim-card-main\s*{[^}]*padding:\s*0 2px 0 var\(--sidebar-row-padding-x\);/s);
    expect(css).toMatch(/\.od-aim-card\.selected\s*{[^}]*background:\s*var\(--field\);[^}]*border-color:\s*transparent;[^}]*box-shadow:\s*0 1px 3px rgba\(30, 40, 70, 0\.08\);[^}]*color:\s*var\(--od-fg\);/s);
    expect(css).toMatch(/\.od-aim-card-main:focus-visible\s*{[^}]*box-shadow:\s*var\(--od-focus\);/s);
    // The sidebar-row status dot marks only attention states.
    expect(css).toMatch(/\.od-aim-progress-dot\.is-needs_you\s*{\s*background:\s*var\(--acc\);\s*}/s);
    expect(css).toMatch(/\.od-aim-progress-dot\.is-blocked\s*{\s*background:\s*var\(--danger\);\s*}/s);
    expect(css).not.toContain(".od-aim-progress-dot.is-complete");
    expect(css).not.toContain(".od-aim-progress-dot.is-running");
    expect(css).not.toContain(".od-aim-progress-dot.is-planning");
    // Account menu: glass island popover anchored to the workspace trigger.
    expect(css).toMatch(/\.od-user-menu-anchor\s*{[^}]*width:\s*var\(--sidebar-content-width\);[^}]*justify-self:\s*center;/s);
    expect(css).toMatch(/\.od-user-menu-trigger\s*{[^}]*grid-template-columns:\s*var\(--sidebar-icon-column\) minmax\(0, 1fr\) 18px;[^}]*min-height:\s*46px;[^}]*border-radius:\s*12px;[^}]*padding:\s*6px 8px;/s);
    expect(css).toMatch(/\.od-user-menu-popover\s*{[^}]*border-radius:\s*14px;[^}]*background:\s*var\(--island\);[^}]*backdrop-filter:\s*blur\(30px\);[^}]*box-shadow:\s*var\(--sh-lg\), inset 0 0 0 1px var\(--ring\);/s);
    // The popover lives in a body portal — body must carry the app font stack or it falls
    // back to the UA serif face.
    expect(css).toMatch(/\nbody\s*{[^}]*font-family:\s*var\(--od-font-sans\);/s);
    expect(css).toMatch(/\.od-user-menu-item\s*{[^}]*min-height:\s*34px;[^}]*grid-template-columns:\s*18px minmax\(0, 1fr\) auto;[^}]*padding:\s*0 var\(--sidebar-row-padding-x\);/s);
    expect(css).toMatch(/\.od-user-menu-item span\s*{[^}]*font-size:\s*var\(--od-type-sub\);[^}]*line-height:\s*var\(--od-line-sub\);/s);
    expect(css).toMatch(/\.od-user-menu-value\s*{[^}]*justify-self:\s*end;[^}]*color:\s*var\(--faint\);[^}]*font-variant-numeric:\s*tabular-nums;/s);
    expect(css).toMatch(/\.od-user-menu-device\s*{[^}]*display:\s*flex;[^}]*align-items:\s*center;[^}]*gap:\s*7px;/s);
    expect(css).toMatch(/\.od-user-menu-device-dot\s*{[^}]*border-radius:\s*50%;[^}]*background:\s*var\(--ok\);/s);
    expect(css).toMatch(/\.od-user-menu-submenu-anchor\s*{[^}]*position:\s*relative;[^}]*display:\s*grid;/s);
    expect(css).toMatch(/\.od-user-menu-submenu-anchor::after\s*{[^}]*left:\s*100%;[^}]*width:\s*10px;/s);
    expect(css).toMatch(/\.od-user-language-menu\s*{[^}]*position:\s*absolute;[^}]*top:\s*-4px;[^}]*left:\s*calc\(100% \+ 8px\);[^}]*width:\s*180px;/s);
  });

  it("marks the saved aim row as current when a saved aim is open", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <CockpitShell
          goals={[savedGoal]}
          activeStage="aim"
          workspaceTarget={{ kind: "goal", id: savedGoal.id }}
          onHome={noop}
          onNewAim={noop}
          onOpenGoal={noop}
          onStage={noop}
          main={<div>Saved aim</div>}
        />
      </I18nProvider>,
    );

    expect(html).toContain('data-od-id="sidebar-new-aim-action"');
    expect(html).toContain('<button class="od-sidebar-plus" type="button" aria-label="New aim" title="New aim" data-od-id="sidebar-new-aim-action"');
    expect(html).toContain('<div class="od-aim-card selected">');
    expect(html).toContain('<button class="od-aim-card-main" type="button" aria-current="page"');
    expect(html).not.toContain('data-current=');
  });

  it("renders an invisible pinned sidebar resize hot zone with accessible controls", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <CockpitShell
          goals={[]}
          activeStage="aim"
          workspaceTarget={{ kind: "home" }}
          onHome={noop}
          onNewAim={noop}
          onOpenGoal={noop}
          onStage={noop}
          main={<div>New aim</div>}
        />
      </I18nProvider>,
    );
    const css = readFileSync(new URL("./cockpit.css", import.meta.url), "utf8");

    expect(html).toContain('style="--sidebar-width:224px"');
    expect(html).toContain('id="od-left-aim-sidebar"');
    expect(html).toContain('data-od-id="sidebar-resizer"');
    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-label="Resize left sidebar"');
    expect(html).toContain('aria-controls="od-left-aim-sidebar"');
    expect(html).toContain('aria-orientation="vertical"');
    expect(html).toContain('aria-valuemin="216"');
    expect(html).toContain('aria-valuemax="360"');
    expect(html).toContain('aria-valuenow="224"');
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

  it("keeps the palette and keyboard shortcuts free of workbench stage entries (collapsed model)", () => {
    const source = readFileSync(new URL("./CockpitShell.tsx", import.meta.url), "utf8");

    expect(source).not.toContain("WORKBENCH_STAGE_IDS");
    expect(source).not.toContain("stage-${item.stage}");
    expect(source).not.toMatch(/\["1", "2", "3", "4", "5"\]/);
    expect(source).toContain('{ id: "settings", label: t("os.settings")');
  });

  it("keeps workbench navigation clear of titlebar controls in every sidebar state", () => {
    const css = readFileSync(new URL("./cockpit.css", import.meta.url), "utf8");

    // Window-chrome clearance is geometric: the shell's --shell-top band frames every island
    // below the titlebar cluster, so no per-stage safe-area padding rules exist anymore.
    expect(css).toMatch(/\.od-app\s*{[^}]*--shell-top:\s*44px;/s);
    expect(css).toMatch(/\.od-app\s*{[^}]*padding:\s*var\(--shell-top\) var\(--shell-gutter\) var\(--shell-gutter\);/s);
    expect(css).not.toContain("--stage-nav-titlebar-safe-top");
    expect(css).not.toContain('.od-main:not(.od-main-aim):not(.od-main-settings)');
    expect(css).not.toContain(".od-stage-index");
  });

  it("swaps the aim list for the settings nav on the settings stage", () => {
    const settingsNav = (
      <SettingsSidebarNav activeSection="general" onSection={noop} onBack={noop} />
    );
    const html = renderToStaticMarkup(
      <I18nProvider>
        <CockpitShell
          goals={[savedGoal]}
          activeStage="settings"
          workspaceTarget={{ kind: "goal", id: savedGoal.id }}
          onHome={noop}
          onNewAim={noop}
          onOpenGoal={noop}
          onStage={noop}
          settingsSidebar={settingsNav}
          main={<div>Settings detail pane</div>}
        />
      </I18nProvider>,
    );
    const css = readFileSync(new URL("./cockpit.css", import.meta.url), "utf8");

    // Same aside, settings mode: brand row + account trigger stay; the aim list gives way
    // to the Back + Settings + category nav; the workspace holds only the detail pane.
    expect(html).toContain('data-od-id="left-aim-sidebar"');
    expect(html).toContain('data-mode="settings"');
    expect(html).toContain('data-od-id="sidebar-global-actions"');
    expect(html).toContain('data-od-id="settings-sidebar-nav"');
    expect(html).toContain(">Back</span>");
    expect(html).toContain('data-od-id="sidebar-user-menu-trigger"');
    expect(html).toContain('data-od-id="sidebar-toggle"');
    expect(html).toContain("Settings detail pane");
    expect(html).not.toContain("od-aim-card");
    expect(html).not.toContain("Ship a sidebar pass");
    expect(css).toMatch(/\.od-workspace-settings\s*{[^}]*width:\s*min\(100%, 1080px\);/s);
    expect(css).not.toContain(".od-settings-sidebar-content");
    expect(css).not.toContain(".od-settings-nav-item");
    expect(css).not.toContain(".od-settings-search");
  });

  it("keeps a stable top drag strip outside the dynamic sidebar layers", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <CockpitShell
          goals={[]}
          activeStage="aim"
          workspaceTarget={{ kind: "home" }}
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
    expect(css).toContain("--window-drag-strip-height: var(--shell-top);");
    expect(css).toMatch(
      /\.od-window-drag-strip\s*{[^}]*left:\s*calc\(var\(--titlebar-toggle-left\) \+ var\(--titlebar-toggle-size\) \+ 8px\);[^}]*height:\s*var\(--window-drag-strip-height\);/s,
    );
    expect(css).toMatch(/\.od-sidebar-toggle\s*{[^}]*app-region:\s*no-drag;[^}]*-webkit-app-region:\s*no-drag;/s);
    expect(css).toMatch(/\.od-user-menu-anchor,\s*\.od-user-menu-anchor \*,\s*\.od-user-menu-popover,\s*\.od-user-menu-popover \*,\s*\.od-action-menu-anchor,\s*\.od-action-menu-anchor \*\s*{[^}]*app-region:\s*no-drag;[^}]*-webkit-app-region:\s*no-drag;/s);
  });

  it("renders no scrollbar anywhere — scrolling is a gesture, not chrome", () => {
    // Founder 2026-08-02: no scroll bar at all in the whole app. Both halves are required —
    // `scrollbar-width: none` stops layout from reserving a gutter, the `::-webkit-scrollbar`
    // block stops the rail from painting — and no rule may quietly reintroduce either.
    const css = readFileSync(new URL("./cockpit.css", import.meta.url), "utf8");
    expect(css).toMatch(/^\*\s*{[^}]*scrollbar-width:\s*none;/ms);
    expect(css).toMatch(/::-webkit-scrollbar\s*{[^}]*display:\s*none;/s);
    expect(css).not.toMatch(/scrollbar-gutter/);
    expect(css).not.toMatch(/::-webkit-scrollbar-thumb/);
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
          activeStage="aim"
          workspaceTarget={{ kind: "home" }}
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
    // Settings no longer special-cases the sidebar — one collapse/peek behavior everywhere.
    expect(css).not.toContain("od-app-stage-settings");
    expect(css).toContain(".od-app[data-sidebar-state=\"collapsed\"],\n  .od-app[data-sidebar-state=\"peek\"] {");
    expect(css).toContain("grid-template-columns: 0 minmax(0, 1fr);");
    expect(css).toContain(".od-app[data-sidebar-state=\"peek\"] .od-sidebar");
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
