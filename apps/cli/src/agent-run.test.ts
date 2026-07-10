import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createJsonFileStore } from "@core/store";
import type { DecompositionOutput } from "@core/types";
import type { LocalAgentRunResult } from "@core/local-agent";

import { runAimAgent } from "./agent-run";

const PLAN: DecompositionOutput = {
  goal_summary: "Run one ready local-agent sub-aim",
  domain: "software",
  rationale: "The first task is agent-ready and the second waits on it.",
  nodes: [
    {
      key: "first",
      title: "Create the artifact",
      description: "Create and verify one workspace artifact.",
      est_effort: "s",
      xp_reward: 10,
      decomposition_contract: {
        why: "A local agent can create the artifact.",
        definition_of_done: "The artifact exists and verification passes.",
        required_evidence: ["A trusted commit."],
        likely_owner: "agent",
        context_gaps: [],
        eval_signal: "A trusted commit matches the artifact path.",
      },
      routing_override: {
        owner: "agent",
        agent_id: "codex",
        agent_label: "Codex CLI",
        run_mode: "local_cli",
        model: "gpt-test",
        model_label: "GPT Test",
        reason: "Use the test Codex runtime.",
      },
      acceptance_rule: {
        logic: "all",
        threshold: 1,
        completion_mode: "auto",
        clauses: [{ evaluator: "commit_pattern", auto_verifiable: true, match: { path_glob: "artifact.txt" } }],
      },
    },
    {
      key: "second",
      title: "Verify the follow-up",
      description: "Wait for the first sub-aim.",
      est_effort: "s",
      xp_reward: 10,
      decomposition_contract: {
        why: "It depends on the first artifact.",
        definition_of_done: "The follow-up is verified.",
        required_evidence: ["A passing CI run."],
        likely_owner: "agent",
        context_gaps: [],
        eval_signal: "CI passes after the artifact exists.",
      },
      routing_override: null,
      acceptance_rule: {
        logic: "all",
        threshold: 1,
        completion_mode: "auto",
        clauses: [{ evaluator: "ci_status", auto_verifiable: true, match: { conclusion: "success" } }],
      },
    },
  ],
  edges: [{ from: "first", to: "second" }],
};

describe("CLI local-agent run orchestration", () => {
  it("runs one ready agent milestone and persists streamed events plus low-trust evidence", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "aimcub-cli-agent-run-"));
    const workspace = mkdtempSync(join(tmpdir(), "aimcub-cli-agent-workspace-"));
    const store = createJsonFileStore(dataDir);
    const { goal, milestones } = await store.createGoal({ title: "Ship an artifact", plan: PLAN });
    const sediment = vi.spyOn(store, "sedimentContextFromGoal");
    const fakeRun: LocalAgentRunResult = {
      ok: true,
      agentId: "codex",
      command: "/tmp/fake-codex",
      args: ["exec", "--json"],
      events: [
        { type: "agent.run.started", summary: "Codex started." },
        { type: "agent.tool.started", summary: "shell", toolName: "shell" },
        { type: "agent.tool.finished", summary: "shell", toolName: "shell" },
        { type: "agent.run.completed", summary: "Local agent run completed." },
      ],
      outputText: "Created artifact.txt and ran verification.",
      exitCode: 0,
      error: null,
      durationMs: 10,
    };

    const result = await runAimAgent(store, {
      goalId: goal.id,
      workspace,
      network: true,
      reasoning: "high",
    }, {
      async listLocalAgents() {
        return [{
          id: "codex",
          name: "Codex CLI",
          runMode: "local_cli",
          available: true,
          path: "/tmp/fake-codex",
          version: "codex-test",
          authStatus: "ok",
          authMessage: null,
          models: [{ id: "gpt-test", label: "GPT Test" }],
          modelsSource: "fallback",
          reasoningOptions: [{ id: "high", label: "High" }],
          diagnostics: [],
        }];
      },
      async runLocalAgent(request, options) {
        expect(request).toMatchObject({
          cwd: workspace,
          model: "gpt-test",
          reasoning: "high",
          permission: { sandbox: "workspace-write", network: true },
        });
        for (const event of fakeRun.events) await options?.onEvent?.(event);
        return fakeRun;
      },
    });

    expect(result.milestone.id).toBe(milestones[0]!.id);
    expect(result.completions).toEqual([]);
    expect(result.evidence).toMatchObject({
      milestone_id: milestones[0]!.id,
      kind: "mcp_report",
      trust_score: 0.6,
    });
    expect(sediment).toHaveBeenCalledWith(goal.id);

    const snapshot = await store.exportData();
    expect(snapshot.runs).toHaveLength(1);
    expect(snapshot.runs[0]).toMatchObject({
      milestone_id: milestones[0]!.id,
      status: "completed",
      workspace_root: workspace,
      sandbox: "workspace-write",
      network_enabled: true,
      reasoning: "high",
    });
    expect(snapshot.runEvents.map((event) => event.type)).toEqual(expect.arrayContaining([
      "run.started",
      "tool.started",
      "tool.finished",
      "run.completed",
    ]));
    expect(snapshot.evidenceAttributions[0]).toMatchObject({
      evidence_id: result.evidence.id,
      run_id: result.orchestrationRun.id,
    });
    expect(snapshot.completions).toEqual([]);
  });
});
