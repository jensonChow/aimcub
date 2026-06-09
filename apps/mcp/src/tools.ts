/**
 * GoalPet MCP tool definitions, wired entirely through injected ports
 * ({@link ToolDeps}) so they are pure with respect to I/O and unit-testable.
 *
 * Tools:
 *  - report_evidence  — agent reports progress; validate → normalize → ingest.
 *  - goal_status      — summary of a goal's milestone progress (read path).
 *  - list_milestones  — raw milestone list for a goal (read path).
 *  - get_inbox        — proactive pet → user messages (stub in v1a).
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Milestone } from "@core/domain";
import type { ToolDeps } from "./ports.js";
import { ReportEvidenceInput, normalizeReport, toIngestInput } from "./evidence-input.js";

/** Helper: a single text-content MCP tool result carrying a JSON-serialized body. */
function jsonResult(body: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(body) }] };
}

/** Helper: an error MCP tool result (the SDK marks `isError` so clients can branch). */
function errorResult(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true as const };
}

/** Aggregate milestone counts into a compact status summary. */
export function summarizeMilestones(goalId: string, milestones: Milestone[]) {
  const counts = milestones.reduce<Record<string, number>>((acc, m) => {
    acc[m.status] = (acc[m.status] ?? 0) + 1;
    return acc;
  }, {});
  const completed = counts.completed ?? 0;
  const total = milestones.length;
  return {
    goalId,
    total,
    completed,
    progress: total === 0 ? 0 : Math.round((completed / total) * 100) / 100,
    counts,
    nextUp: milestones.find((m) => m.status === "pending" || m.status === "in_progress")?.title ?? null,
  };
}

/** Register every GoalPet tool onto an McpServer using the injected ports. */
export function registerGoalPetTools(server: McpServer, deps: ToolDeps): void {
  // ── report_evidence ──────────────────────────────────────────────────────
  server.registerTool(
    "report_evidence",
    {
      title: "Report evidence",
      description:
        "Report progress on a goal (a commit, a CI run, or a free-form note). The report is " +
        "validated, normalized into a trust-scored evidence envelope, and appended to the " +
        "append-only evidence stream that drives milestone completion.",
      inputSchema: ReportEvidenceInput.shape,
    },
    async (rawInput) => {
      // The SDK has already parsed against the zod shape; re-parse defensively to
      // get the fully-typed, defaulted object and to fail closed on bad input.
      const parsed = ReportEvidenceInput.safeParse(rawInput);
      if (!parsed.success) {
        return errorResult(`invalid report_evidence input: ${parsed.error.message}`);
      }
      const input = parsed.data;
      const normalized = normalizeReport(input);
      const ingestInput = toIngestInput(input, normalized);
      const evidence = await deps.ingest.ingest(ingestInput);
      return jsonResult({
        accepted: true,
        evidenceId: evidence.id,
        kind: evidence.kind,
        trustScore: evidence.trust_score,
      });
    },
  );

  // ── goal_status ──────────────────────────────────────────────────────────
  server.registerTool(
    "goal_status",
    {
      title: "Goal status",
      description: "Return a milestone-progress summary for a goal.",
      inputSchema: { goalId: z.string().uuid() },
    },
    async ({ goalId }) => {
      const goal = await deps.repo.getGoal(goalId);
      if (!goal) return errorResult(`goal not found: ${goalId}`);
      const milestones = await deps.repo.listMilestones(goalId);
      return jsonResult({
        goal: { id: goal.id, title: goal.title, status: goal.status, domain: goal.domain },
        ...summarizeMilestones(goalId, milestones),
      });
    },
  );

  // ── list_milestones ──────────────────────────────────────────────────────
  server.registerTool(
    "list_milestones",
    {
      title: "List milestones",
      description: "List the milestones of a goal with their status and acceptance rules.",
      inputSchema: { goalId: z.string().uuid() },
    },
    async ({ goalId }) => {
      const milestones = await deps.repo.listMilestones(goalId);
      return jsonResult({
        goalId,
        milestones: milestones.map((m) => ({
          id: m.id,
          title: m.title,
          status: m.status,
          orderIndex: m.order_index,
          dependsOnId: m.depends_on_id,
          xpReward: m.xp_reward,
          rarity: m.rarity,
        })),
      });
    },
  );

  // ── get_inbox ────────────────────────────────────────────────────────────
  server.registerTool(
    "get_inbox",
    {
      title: "Get inbox",
      description: "Pull proactive messages from the pet to the user (agent_inbox channel).",
      inputSchema: { ownerId: z.string().uuid(), since: z.string().optional() },
    },
    async () => {
      // TODO(v1b): wire to deps.repo.listInbox once the proactive companion ships.
      // v1a has no pet / nudges, so the inbox is intentionally empty.
      return jsonResult({ messages: [] as unknown[] });
    },
  );
}
