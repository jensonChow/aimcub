import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createPlanningSession, type PlanningSession } from "@aimcub/llm";

import { startPlanningMcpBridge, type PlanningMcpBridge } from "./mcp-bridge";

/** Valid two-node plan (mirrors the llm protocol fixture; validated by the session). */
export function validPlanInput(): Record<string, unknown> {
  return {
    goal_summary: "Build the v1a evidence ingester.",
    domain: "software",
    rationale: "Set up ingestion, then prove it with CI.",
    nodes: [
      {
        key: "m1",
        title: "Implement the evidence webhook handler",
        description: "Normalize git/CI events into the append-only evidence stream.",
        est_effort: "m",
        xp_reward: 30,
        decomposition_contract: {
          why: "The ingester needs a separately verifiable implementation step before CI can prove it.",
          definition_of_done: "Git and CI events are normalized into the append-only evidence stream.",
          required_evidence: ["A commit touching the API evidence ingestion path."],
          likely_owner: "agent",
          context_gaps: [],
          eval_signal: "The milestone is done when trusted source events become idempotent evidence rows.",
        },
        acceptance_rule: {
          logic: "all",
          clauses: [
            {
              evaluator: "commit_pattern",
              auto_verifiable: true,
              match: { path_glob: "packages/api/**", min_files: 1, message_pattern: "evidence" },
            },
          ],
          threshold: 1,
          completion_mode: "auto_then_confirm",
        },
        routing_override: null,
      },
      {
        key: "m2",
        title: "Green CI for the ingester",
        description: "The ingestion test workflow passes on main.",
        est_effort: "s",
        xp_reward: 15,
        decomposition_contract: {
          why: "The implementation needs a dependent verification milestone so passing tests cannot be skipped.",
          definition_of_done: "The ingestion test workflow succeeds.",
          required_evidence: ["A successful CI status for the ingestion tests."],
          likely_owner: "agent",
          context_gaps: [],
          eval_signal: "The milestone is done when CI proves the ingester still works.",
        },
        acceptance_rule: {
          logic: "all",
          clauses: [
            { evaluator: "ci_status", auto_verifiable: true, match: { workflow: "test", conclusion: "success" } },
          ],
          threshold: 1,
          completion_mode: "auto",
        },
        routing_override: null,
      },
    ],
    edges: [{ from: "m1", to: "m2" }],
  };
}

async function until(condition: () => boolean, timeoutMs = 3_000): Promise<void> {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error("condition not reached in time");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function connectClient(bridge: PlanningMcpBridge): Promise<Client> {
  const client = new Client({ name: "test-brain", version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(bridge.url), {
    requestInit: { headers: { Authorization: `Bearer ${bridge.authToken}` } },
  });
  await client.connect(transport);
  return client;
}

function parseToolText(result: unknown): Record<string, unknown> {
  const content = (result as { content: Array<{ type: string; text: string }> }).content;
  const text = content.find((item) => item.type === "text")?.text ?? "{}";
  return JSON.parse(text) as Record<string, unknown>;
}

function makeSession(): PlanningSession {
  return createPlanningSession({
    aim: { title: "Ship the evidence ingester" },
    memories: [],
    now: () => new Date("2026-07-24T10:00:00.000Z"),
  });
}

describe("planning MCP bridge", () => {
  it("lists the projected tools and executes an immediate tool call", async () => {
    const session = makeSession();
    const bridge = await startPlanningMcpBridge({ session });
    try {
      const client = await connectClient(bridge);
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
        "ask_user",
        "propose_memory",
        "report_research",
        "search_memory",
        "submit_plan",
      ]);

      const reply = parseToolText(await client.callTool({
        name: "report_research",
        arguments: { findings: [{ summary: "A store-policy constraint applies.", source_urls: ["https://example.com/policy"] }] },
      }));
      expect(reply.recorded).toBe(true);
      await client.close();
    } finally {
      await bridge.close();
    }
  });

  it("parks ask_user until the answer arrives, then completes the same call", async () => {
    const session = makeSession();
    const bridge = await startPlanningMcpBridge({ session });
    try {
      const client = await connectClient(bridge);
      const pendingCall = client.callTool({
        name: "ask_user",
        arguments: {
          question: "Which platform should the first release target?",
          options: [{ label: "iOS", tradeoff: "Review gate" }, { label: "Web", tradeoff: "No review" }],
        },
      });
      await until(() => session.state().phase === "waiting_user");
      expect(bridge.pendingCount()).toBe(1);

      const question = session.state().pendingQuestion;
      expect(question).not.toBeNull();
      const body = session.provideAnswer(question!.id, { selected_labels: ["iOS"], other_text: null });
      expect(bridge.resolvePending(question!.id, body)).toBe(true);

      const reply = parseToolText(await pendingCall);
      expect(reply.answer).toMatchObject({ selected_labels: ["iOS"] });
      expect(bridge.pendingCount()).toBe(0);
      await client.close();
    } finally {
      await bridge.close();
    }
  });

  it("accepts a valid submit_plan and drives the session to draft_ready", async () => {
    const session = makeSession();
    const bridge = await startPlanningMcpBridge({ session });
    try {
      const client = await connectClient(bridge);
      const reply = parseToolText(await client.callTool({
        name: "submit_plan",
        arguments: { plan: validPlanInput(), research_summary: "Policy research shaped the plan." },
      }));
      expect(reply.accepted).toBe(true);
      expect(session.snapshot().phase).toBe("draft_ready");
      expect(session.snapshot().outcome?.research.summary).toBe("Policy research shaped the plan.");
      await client.close();
    } finally {
      await bridge.close();
    }
  });

  it("rejects requests without the session bearer token", async () => {
    const session = makeSession();
    const bridge = await startPlanningMcpBridge({ session });
    try {
      const response = await fetch(bridge.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      expect(response.status).toBe(401);
    } finally {
      await bridge.close();
    }
  });

  it("auto-skips a parked question when the brain's connection dies", async () => {
    const session = makeSession();
    const bridge = await startPlanningMcpBridge({ session });
    try {
      const client = await connectClient(bridge);
      const pendingCall = client.callTool({
        name: "ask_user",
        arguments: { question: "Which platform should the first release target?" },
      });
      pendingCall.catch(() => undefined);
      await until(() => bridge.pendingCount() === 1);

      // The client dies while the question is parked (tool timeout, crash…).
      await client.close();

      await until(() => session.state().pendingQuestion === null);
      expect(session.state().phase).toBe("researching");
      const skipped = session.snapshot().transcript.find((entry) => entry.kind === "answer");
      expect(skipped).toMatchObject({ answer: { skipped: true } });
      expect(bridge.pendingCount()).toBe(0);
    } finally {
      await bridge.close();
    }
  });

  it("close releases a parked call with an explicit session_closed error", async () => {
    const session = makeSession();
    const bridge = await startPlanningMcpBridge({ session });
    const client = await connectClient(bridge);
    const pendingCall = client.callTool({
      name: "ask_user",
      arguments: { question: "Which platform should the first release target?" },
    });
    await until(() => bridge.pendingCount() === 1);
    await bridge.close();
    const reply = parseToolText(await pendingCall);
    expect(reply.error).toBe("session_closed");
    await client.close();
  });
});
