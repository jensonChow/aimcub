import { describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { AUTO_VERIFY_MIN_TRUST, type Evidence, type Goal, type Milestone, type Notification } from "@core/domain";
import type { IngestEvidenceInput } from "@core/api-client";
import { buildServer } from "./server";
import type { EvidenceIngestPort, AimcubReadPort, ToolDeps } from "./ports";
import {
  MCP_TRUST_CEILING,
  ReportEvidenceInput,
  normalizeReport,
  toIngestInput,
} from "./evidence-input";
import { summarizeMilestones } from "./tools";

const OWNER = "11111111-1111-1111-1111-111111111111";
const INTRUDER = "99999999-9999-9999-9999-999999999999";
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

/** A repo fake that also records the ownerId every listInbox call was scoped to. */
function makeRepoFake(
  milestones: Milestone[],
  goal: Goal | null,
  inbox: Notification[] = [],
): AimcubReadPort & { inboxCalls: Array<{ ownerId: string; since?: string }> } {
  const inboxCalls: Array<{ ownerId: string; since?: string }> = [];
  return {
    inboxCalls,
    async getGoal() {
      return goal;
    },
    async listMilestones() {
      return milestones;
    },
    async listInbox(ownerId, since) {
      inboxCalls.push({ ownerId, since });
      return inbox.filter((n) => n.owner_id === ownerId);
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

/** Deps wired as the Worker wires them: ports + the token-derived identity. */
function depsFor(
  repo: AimcubReadPort,
  ingest: EvidenceIngestPort,
  ownerId: string = OWNER,
): ToolDeps {
  return { repo, ingest, identity: { ownerId } };
}

function parseToolJson(result: { content: unknown }): any {
  const content = result.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0]!.text);
}

// ── shared fixtures (owned by OWNER) ─────────────────────────────────────────

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

// ── pure normalization ──────────────────────────────────────────────────────

describe("normalizeReport / toIngestInput (pure)", () => {
  it("maps a commit report to a git_commit envelope with the MCP trust ceiling", () => {
    const input: ReportEvidenceInput = {
      goalId: GOAL,
      milestoneId: MILE,
      occurredAt: T,
      report: { type: "commit", sha: "abc123", message: "feat: add login\n\nbody", verified: true, files: ["a.ts"] },
    };
    const normalized = normalizeReport(input);
    expect(normalized.kind).toBe("git_commit");
    expect(normalized.source_event_id).toBe("abc123");
    expect(normalized.summary).toBe("feat: add login");
    // Even a self-reported "verified" commit over MCP is clamped to the ceiling:
    // the content is self-attested, so it must stay below the auto-verify floor.
    expect(normalized.trust_score).toBe(MCP_TRUST_CEILING);

    const ingest = toIngestInput(input, normalized, OWNER);
    expect(ingest).toMatchObject({
      ownerId: OWNER,
      goalId: GOAL,
      milestoneId: MILE,
      kind: "git_commit",
      sourceEventId: "abc123",
      trustScore: MCP_TRUST_CEILING,
    });
    // The emitter is resolved by the ingest adapter from ownerId, never input.
    expect(ingest.emitterId).toBeUndefined();
  });

  it("maps a ci report to ci_passed / ci_failed", () => {
    const base: Omit<ReportEvidenceInput, "report"> = { goalId: GOAL, occurredAt: T };
    expect(normalizeReport({ ...base, report: { type: "ci", conclusion: "success", runId: "r1" } }).kind).toBe(
      "ci_passed",
    );
    expect(normalizeReport({ ...base, report: { type: "ci", conclusion: "failure", runId: "r2" } }).kind).toBe(
      "ci_failed",
    );
  });

  it("clamps an unverified commit to the MCP ceiling too", () => {
    const normalized = normalizeReport({
      goalId: GOAL,
      occurredAt: T,
      report: { type: "commit", sha: "fff", message: "wip" },
    });
    // @core gives unverified commits 0.7 — still above the MCP ceiling (0.6).
    expect(normalized.trust_score).toBe(MCP_TRUST_CEILING);
  });

  it("anti-spoofing invariant: no self-reported evidence can reach the auto-verify floor", () => {
    // The ceiling itself sits strictly below AUTO_VERIFY_MIN_TRUST, so an MCP
    // report can NEVER satisfy an `auto_verifiable` clause on its own — only
    // signature-verified sources (e.g. the GitHub webhook, trust 1.0) can.
    expect(MCP_TRUST_CEILING).toBeLessThan(AUTO_VERIFY_MIN_TRUST);

    const base: Omit<ReportEvidenceInput, "report"> = { goalId: GOAL, occurredAt: T };
    const fabricated: ReportEvidenceInput["report"][] = [
      // A "verified" commit that was never pushed anywhere (@core would score it 1.0).
      { type: "commit", sha: "anything", message: "feat: x", files: ["src/auth.ts"], verified: true },
      // A "green CI run" that never ran (@core scores webhook CI 1.0).
      { type: "ci", conclusion: "success", runId: "r-fake" },
      { type: "note", summary: "I totally did it" },
    ];
    for (const report of fabricated) {
      expect(normalizeReport({ ...base, report }).trust_score).toBeLessThan(AUTO_VERIFY_MIN_TRUST);
    }
  });

  it("maps a free-form note to mcp_report", () => {
    const normalized = normalizeReport({
      goalId: GOAL,
      occurredAt: T,
      report: { type: "note", summary: "Refactored the auth module", payload: { lines: 42 } },
    });
    expect(normalized.kind).toBe("mcp_report");
    expect(normalized.summary).toBe("Refactored the auth module");
    expect(normalized.payload).toEqual({ lines: 42 });
    expect(normalized.trust_score).toBe(MCP_TRUST_CEILING);
  });
});

describe("ReportEvidenceInput bounds (flood guard)", () => {
  const base = { goalId: GOAL, occurredAt: T };

  it("rejects a note summary above 4000 chars", () => {
    const res = ReportEvidenceInput.safeParse({
      ...base,
      report: { type: "note", summary: "x".repeat(4001) },
    });
    expect(res.success).toBe(false);
  });

  it("rejects an oversized commit message, file list, or file path", () => {
    const commit = (over: Record<string, unknown>) =>
      ReportEvidenceInput.safeParse({
        ...base,
        report: { type: "commit", sha: "abc", message: "feat: x", ...over },
      }).success;
    expect(commit({ message: "m".repeat(10001) })).toBe(false);
    expect(commit({ files: Array.from({ length: 501 }, (_, i) => `f${i}.ts`) })).toBe(false);
    expect(commit({ files: ["p".repeat(1001)] })).toBe(false);
    // The same shapes at the bound still parse.
    expect(commit({ message: "m".repeat(10000), files: ["p".repeat(1000)] })).toBe(true);
  });

  it("rejects a note payload whose serialized size exceeds 32 KiB", () => {
    const res = ReportEvidenceInput.safeParse({
      ...base,
      report: { type: "note", summary: "ok", payload: { blob: "x".repeat(32 * 1024) } },
    });
    expect(res.success).toBe(false);
    expect(
      ReportEvidenceInput.safeParse({
        ...base,
        report: { type: "note", summary: "s".repeat(4000), payload: { note: "small" } },
      }).success,
    ).toBe(true);
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
  it("validates input, normalizes it, and calls the injected ingest port with the token owner", async () => {
    const ingest = makeIngestSpy();
    const ingestSpy = vi.spyOn(ingest, "ingest");
    const client = await connectedClient(depsFor(makeRepoFake([milestone], goal), ingest));

    const result = await client.callTool({
      name: "report_evidence",
      arguments: {
        goalId: GOAL,
        milestoneId: MILE,
        occurredAt: T,
        report: { type: "commit", sha: "deadbeef", message: "fix: bug", files: ["x.ts"] },
      },
    });

    // The injected port was called exactly once with the normalized evidence,
    // owned by the verified token subject.
    expect(ingestSpy).toHaveBeenCalledTimes(1);
    expect(ingest.calls[0]).toMatchObject({
      ownerId: OWNER,
      goalId: GOAL,
      milestoneId: MILE,
      kind: "git_commit",
      sourceEventId: "deadbeef",
      summary: "fix: bug",
    });

    const ack = parseToolJson(result as { content: unknown });
    expect(ack).toMatchObject({ accepted: true, kind: "git_commit", evidenceId: expect.any(String) });

    await client.close();
  });

  it("ignores spoofed ownerId/emitterId in tool input — the token identity wins", async () => {
    const ingest = makeIngestSpy();
    const client = await connectedClient(depsFor(makeRepoFake([milestone], goal), ingest));

    const result = (await client.callTool({
      name: "report_evidence",
      arguments: {
        // A malicious client claims to be someone else; neither field exists in
        // the schema anymore, so both are stripped before the handler runs.
        ownerId: INTRUDER,
        emitterId: EMITTER,
        goalId: GOAL,
        occurredAt: T,
        report: { type: "note", summary: "spoof attempt" },
      },
    })) as { isError?: boolean; content: unknown };

    expect(result.isError).not.toBe(true);
    expect(ingest.calls).toHaveLength(1);
    expect(ingest.calls[0]!.ownerId).toBe(OWNER);
    expect(ingest.calls[0]!.emitterId).toBeUndefined();

    await client.close();
  });

  it("denies evidence against another user's goal exactly like a missing one — before any write", async () => {
    const ingest = makeIngestSpy();
    // The caller is INTRUDER; the goal (and milestone) belong to OWNER. Without
    // the tool-layer pre-flight, the only thing stopping this cross-tenant write
    // would be the evidence_refs_owner_guard DB trigger (migration 0005).
    const client = await connectedClient(depsFor(makeRepoFake([milestone], goal), ingest, INTRUDER));

    const result = (await client.callTool({
      name: "report_evidence",
      arguments: {
        goalId: GOAL,
        milestoneId: MILE,
        occurredAt: T,
        report: { type: "commit", sha: "deadbeef", message: "feat: cuckoo evidence" },
      },
    })) as { isError?: boolean; content: unknown };

    expect(result.isError).toBe(true);
    // Same not-found convention as goal_status: denial never leaks existence.
    expect((result.content as Array<{ text: string }>)[0]!.text).toContain(`goal not found: ${GOAL}`);
    // The ingest port is never reached: no emitter provisioning side effect,
    // no evidence insert, no judge job enqueued.
    expect(ingest.calls).toHaveLength(0);

    await client.close();
  });

  it("denies a milestoneId that does not belong to the target goal", async () => {
    const ingest = makeIngestSpy();
    const foreignMilestone = "66666666-6666-6666-6666-666666666666";
    // The caller owns the goal, but points the evidence at a milestone outside it.
    const client = await connectedClient(depsFor(makeRepoFake([milestone], goal), ingest));

    const result = (await client.callTool({
      name: "report_evidence",
      arguments: {
        goalId: GOAL,
        milestoneId: foreignMilestone,
        occurredAt: T,
        report: { type: "note", summary: "misdirected" },
      },
    })) as { isError?: boolean; content: unknown };

    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0]!.text).toContain(
      `milestone not found: ${foreignMilestone}`,
    );
    expect(ingest.calls).toHaveLength(0);

    await client.close();
  });

  it("surfaces an ingest failure (e.g. a revoked emitter) as the tool's error result", async () => {
    // The live adapter throws RepoError("MCP evidence reporting was revoked…")
    // when the emitter is revoked; the MCP SDK must turn that into isError.
    const ingest: EvidenceIngestPort = {
      async ingest() {
        throw new Error("MCP evidence reporting was revoked for this account");
      },
    };
    const client = await connectedClient(depsFor(makeRepoFake([milestone], goal), ingest));

    const result = (await client.callTool({
      name: "report_evidence",
      arguments: { goalId: GOAL, occurredAt: T, report: { type: "note", summary: "blocked" } },
    })) as { isError?: boolean; content: unknown };

    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0]!.text).toContain(
      "revoked for this account",
    );

    await client.close();
  });

  it("rejects input that fails validation (bad goalId uuid) without calling ingest", async () => {
    const ingest = makeIngestSpy();
    const client = await connectedClient(depsFor(makeRepoFake([], null), ingest));

    const result = (await client.callTool({
      name: "report_evidence",
      arguments: {
        goalId: "not-a-uuid",
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

describe("goal_status / list_milestones / get_inbox tools (owner-scoped read path)", () => {
  const notification: Notification = {
    id: "55555555-5555-5555-5555-555555555555",
    owner_id: OWNER,
    trigger: "milestone_done",
    channels: ["agent_inbox"],
    dedup_key: null,
    ref_goal_id: GOAL,
    ref_milestone_id: MILE,
    persona_msg: "Milestone done!",
    status: "sent",
    created_at: T,
  };

  it("goal_status returns a progress summary via the repo port", async () => {
    const client = await connectedClient(depsFor(makeRepoFake([milestone], goal), makeIngestSpy()));
    const result = await client.callTool({ name: "goal_status", arguments: { goalId: GOAL } });
    const body = parseToolJson(result as { content: unknown });
    expect(body.goal).toMatchObject({ id: GOAL, title: "Ship v1a", status: "active" });
    expect(body.total).toBe(1);
    expect(body.nextUp).toBe("Wire MCP");
    await client.close();
  });

  it("goal_status excludes milestone rows the caller does not own (defense-in-depth)", async () => {
    // The goal gate passes (OWNER owns it), but the repo hands back a stray
    // foreign-owned row; the summary must scope it out like list_milestones.
    const foreign: Milestone = {
      ...milestone,
      id: "77777777-7777-7777-7777-777777777777",
      owner_id: INTRUDER,
    };
    const client = await connectedClient(
      depsFor(makeRepoFake([milestone, foreign], goal), makeIngestSpy()),
    );
    const result = await client.callTool({ name: "goal_status", arguments: { goalId: GOAL } });
    const body = parseToolJson(result as { content: unknown });
    expect(body.total).toBe(1);
    expect(body.nextUp).toBe("Wire MCP");
    await client.close();
  });

  it("goal_status denies another user's goal exactly like a missing one", async () => {
    // The caller is INTRUDER; the goal belongs to OWNER. Service-role reads
    // bypass RLS, so the tool layer must turn this into not-found.
    const client = await connectedClient(
      depsFor(makeRepoFake([milestone], goal), makeIngestSpy(), INTRUDER),
    );
    const result = (await client.callTool({
      name: "goal_status",
      arguments: { goalId: GOAL },
    })) as { isError?: boolean; content: unknown };
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0]!.text;
    expect(text).toContain("goal not found");
    await client.close();
  });

  it("list_milestones returns the milestone list via the repo port", async () => {
    const client = await connectedClient(depsFor(makeRepoFake([milestone], goal), makeIngestSpy()));
    const result = await client.callTool({ name: "list_milestones", arguments: { goalId: GOAL } });
    const body = parseToolJson(result as { content: unknown });
    expect(body.milestones).toHaveLength(1);
    expect(body.milestones[0]).toMatchObject({ id: MILE, title: "Wire MCP", status: "in_progress", xpReward: 20 });
    await client.close();
  });

  it("list_milestones denies another user's goal with an empty list", async () => {
    const client = await connectedClient(
      depsFor(makeRepoFake([milestone], goal), makeIngestSpy(), INTRUDER),
    );
    const result = await client.callTool({ name: "list_milestones", arguments: { goalId: GOAL } });
    const body = parseToolJson(result as { content: unknown });
    expect(body.milestones).toEqual([]);
    await client.close();
  });

  it("get_inbox returns the token owner's messages", async () => {
    const repo = makeRepoFake([], goal, [notification]);
    const client = await connectedClient(depsFor(repo, makeIngestSpy()));
    const result = await client.callTool({ name: "get_inbox", arguments: { since: T } });
    const body = parseToolJson(result as { content: unknown });
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]).toMatchObject({ trigger: "milestone_done", message: "Milestone done!" });
    expect(repo.inboxCalls).toEqual([{ ownerId: OWNER, since: T }]);
    await client.close();
  });

  it("get_inbox ignores a spoofed ownerId argument — the inbox is always the token owner's", async () => {
    const repo = makeRepoFake([], goal, [notification]);
    // The caller is INTRUDER but claims to be OWNER via a (no longer existing) arg.
    const client = await connectedClient(depsFor(repo, makeIngestSpy(), INTRUDER));
    const result = await client.callTool({ name: "get_inbox", arguments: { ownerId: OWNER } });
    const body = parseToolJson(result as { content: unknown });
    // listInbox was scoped to the intruder's own (empty) inbox, not OWNER's.
    expect(repo.inboxCalls).toEqual([{ ownerId: INTRUDER, since: undefined }]);
    expect(body.messages).toEqual([]);
    await client.close();
  });
});
