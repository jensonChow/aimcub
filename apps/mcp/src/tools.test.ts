import { describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Evidence, Goal, Milestone } from "@core/domain";
import type { IngestEvidenceInput } from "@core/api-client";
import { buildServer } from "./server";
import type { EvidenceIngestPort, GoalPetReadPort, ToolDeps } from "./ports";
import { normalizeReport, toIngestInput, type ReportEvidenceInput } from "./evidence-input";
import { summarizeMilestones } from "./tools";

const OWNER = "11111111-1111-1111-1111-111111111111";
const GOAL = "22222222-2222-2222-2222-222222222222";
const MILE = "33333333-3333-3333-3333-333333333333";
const EMITTER = "44444444-4444-4444-4444-444444444444";
const T = "2026-06-09T12:00:00Z";

/** A spy ingest port: records the input and echoes back a persisted Evidence. */
function makeIngestSpy(): EvidenceIngestPort & { calls: IngestEvidenceInput[] } {
  const calls: IngestEvidenceInput[] = [];
  return {
    calls,
    async ingest(input) {
      calls.push(input);
      const evidence: Evidence = {
        id: "ev-00000000-0000-0000-0000-000000000001",
        owner_id: input.ownerId,
        goal_id: input.goalId,
        milestone_id: input.milestoneId ?? null,
        emitter_id: input.emitterId ?? null,
        kind: input.kind,
        source_event_id: input.sourceEventId,
        occurred_at: input.occurredAt,
        summary: input.summary ?? "",
        payload: input.payload ?? {},
        trust_score: input.trustScore ?? 1,
      };
      return evidence;
    },
  };
}

function makeRepoFake(milestones: Milestone[], goal: Goal | null): GoalPetReadPort {
  return {
    async getGoal() {
      return goal;
    },
    async listMilestones() {
      return milestones;
    },
    async listInbox() {
      return [];
    },
  };
}

async function connectedClient(deps: ToolDeps): Promise<Client> {
  const server = buildServer(deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

function parseToolJson(result: { content: unknown }): any {
  const content = result.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0]!.text);
}

// ── pure normalization ──────────────────────────────────────────────────────

describe("normalizeReport / toIngestInput (pure)", () => {
  it("maps a commit report to a git_commit envelope with the MCP trust ceiling", () => {
    const input: ReportEvidenceInput = {
      ownerId: OWNER,
      goalId: GOAL,
      milestoneId: MILE,
      emitterId: EMITTER,
      occurredAt: T,
      report: { type: "commit", sha: "abc123", message: "feat: add login\n\nbody", verified: true, files: ["a.ts"] },
    };
    const normalized = normalizeReport(input);
    expect(normalized.kind).toBe("git_commit");
    expect(normalized.source_event_id).toBe("abc123");
    expect(normalized.summary).toBe("feat: add login");
    // Even a self-reported "verified" commit over MCP is clamped to the ceiling.
    expect(normalized.trust_score).toBe(0.6);

    const ingest = toIngestInput(input, normalized);
    expect(ingest).toMatchObject({
      ownerId: OWNER,
      goalId: GOAL,
      milestoneId: MILE,
      emitterId: EMITTER,
      kind: "git_commit",
      sourceEventId: "abc123",
      trustScore: 0.6,
    });
  });

  it("maps a ci report to ci_passed / ci_failed", () => {
    const base: Omit<ReportEvidenceInput, "report"> = { ownerId: OWNER, goalId: GOAL, occurredAt: T };
    expect(normalizeReport({ ...base, report: { type: "ci", conclusion: "success", runId: "r1" } }).kind).toBe(
      "ci_passed",
    );
    expect(normalizeReport({ ...base, report: { type: "ci", conclusion: "failure", runId: "r2" } }).kind).toBe(
      "ci_failed",
    );
  });

  it("maps a free-form note to mcp_report", () => {
    const normalized = normalizeReport({
      ownerId: OWNER,
      goalId: GOAL,
      occurredAt: T,
      report: { type: "note", summary: "Refactored the auth module", payload: { lines: 42 } },
    });
    expect(normalized.kind).toBe("mcp_report");
    expect(normalized.summary).toBe("Refactored the auth module");
    expect(normalized.payload).toEqual({ lines: 42 });
    expect(normalized.trust_score).toBe(0.6);
  });
});

describe("summarizeMilestones", () => {
  it("computes counts, progress and the next-up milestone", () => {
    const m = (over: Partial<Milestone>): Milestone => ({
      id: over.id ?? "m",
      goal_id: GOAL,
      owner_id: OWNER,
      title: over.title ?? "t",
      description: "",
      status: over.status ?? "pending",
      order_index: over.order_index ?? 0,
      depends_on_id: null,
      acceptance_rule: { logic: "all", clauses: [{ evaluator: "commit_pattern", auto_verifiable: true, match: {} }], threshold: 1, completion_mode: "auto_then_confirm" },
      xp_reward: 10,
      rarity: "common",
      completed_at: null,
      metadata: {},
    });
    const summary = summarizeMilestones(GOAL, [
      m({ id: "1", status: "completed", order_index: 0, title: "done" }),
      m({ id: "2", status: "pending", order_index: 1, title: "next" }),
    ]);
    expect(summary.total).toBe(2);
    expect(summary.completed).toBe(1);
    expect(summary.progress).toBe(0.5);
    expect(summary.nextUp).toBe("next");
  });
});

// ── end-to-end through the MCP server + injected ports ────────────────────────

describe("report_evidence tool (end-to-end via in-memory transport)", () => {
  it("validates input, normalizes it, and calls the injected ingest port", async () => {
    const ingest = makeIngestSpy();
    const ingestSpy = vi.spyOn(ingest, "ingest");
    const client = await connectedClient({ repo: makeRepoFake([], null), ingest });

    const result = await client.callTool({
      name: "report_evidence",
      arguments: {
        ownerId: OWNER,
        goalId: GOAL,
        milestoneId: MILE,
        emitterId: EMITTER,
        occurredAt: T,
        report: { type: "commit", sha: "deadbeef", message: "fix: bug", files: ["x.ts"] },
      },
    });

    // The injected port was called exactly once with the normalized evidence.
    expect(ingestSpy).toHaveBeenCalledTimes(1);
    expect(ingest.calls[0]).toMatchObject({
      ownerId: OWNER,
      goalId: GOAL,
      milestoneId: MILE,
      emitterId: EMITTER,
      kind: "git_commit",
      sourceEventId: "deadbeef",
      summary: "fix: bug",
    });

    const ack = parseToolJson(result as { content: unknown });
    expect(ack).toMatchObject({ accepted: true, kind: "git_commit", evidenceId: expect.any(String) });

    await client.close();
  });

  it("rejects input that fails @core/types validation (bad uuid) without calling ingest", async () => {
    const ingest = makeIngestSpy();
    const client = await connectedClient({ repo: makeRepoFake([], null), ingest });

    const result = (await client.callTool({
      name: "report_evidence",
      arguments: {
        ownerId: "not-a-uuid",
        goalId: GOAL,
        occurredAt: T,
        report: { type: "note", summary: "hi" },
      },
    })) as { isError?: boolean; content: unknown };

    // SDK surfaces the zod parse failure as an error result; ingest is never reached.
    expect(result.isError).toBe(true);
    expect(ingest.calls).toHaveLength(0);

    await client.close();
  });
});

describe("goal_status / list_milestones tools (read path via repo port)", () => {
  const goal: Goal = {
    id: GOAL,
    owner_id: OWNER,
    title: "Ship v1a",
    description: "",
    domain: "software",
    status: "active",
    target_date: null,
    plan_json: null,
    metadata: {},
  };
  const milestone: Milestone = {
    id: MILE,
    goal_id: GOAL,
    owner_id: OWNER,
    title: "Wire MCP",
    description: "",
    status: "in_progress",
    order_index: 0,
    depends_on_id: null,
    acceptance_rule: {
      logic: "all",
      clauses: [{ evaluator: "commit_pattern", auto_verifiable: true, match: { message_pattern: "feat" } }],
      threshold: 1,
      completion_mode: "auto_then_confirm",
    },
    xp_reward: 20,
    rarity: "uncommon",
    completed_at: null,
    metadata: {},
  };

  it("goal_status returns a progress summary via the repo port", async () => {
    const client = await connectedClient({ repo: makeRepoFake([milestone], goal), ingest: makeIngestSpy() });
    const result = await client.callTool({ name: "goal_status", arguments: { goalId: GOAL } });
    const body = parseToolJson(result as { content: unknown });
    expect(body.goal).toMatchObject({ id: GOAL, title: "Ship v1a", status: "active" });
    expect(body.total).toBe(1);
    expect(body.nextUp).toBe("Wire MCP");
    await client.close();
  });

  it("list_milestones returns the milestone list via the repo port", async () => {
    const client = await connectedClient({ repo: makeRepoFake([milestone], goal), ingest: makeIngestSpy() });
    const result = await client.callTool({ name: "list_milestones", arguments: { goalId: GOAL } });
    const body = parseToolJson(result as { content: unknown });
    expect(body.milestones).toHaveLength(1);
    expect(body.milestones[0]).toMatchObject({ id: MILE, title: "Wire MCP", status: "in_progress", xpReward: 20 });
    await client.close();
  });

  it("get_inbox returns an empty list (v1a stub)", async () => {
    const client = await connectedClient({ repo: makeRepoFake([], goal), ingest: makeIngestSpy() });
    const result = await client.callTool({ name: "get_inbox", arguments: { ownerId: OWNER } });
    const body = parseToolJson(result as { content: unknown });
    expect(body.messages).toEqual([]);
    await client.close();
  });
});
