/**
 * Aimcub MCP tool definitions, wired entirely through injected ports
 * ({@link ToolDeps}) so they are pure with respect to I/O and unit-testable.
 *
 * Tools:
 *  - report_evidence  — agent reports progress; validate → normalize → ingest.
 *  - goal_status      — summary of a goal's milestone progress (read path).
 *  - list_milestones  — raw milestone list for a goal (read path).
 *  - get_inbox        — proactive pet → user messages (empty until v1b ships the pet).
 *
 * Ownership: the Worker queries Supabase with service_role (RLS bypassed), so
 * every tool scopes by `deps.identity.ownerId` — the verified OAuth token `sub` —
 * here in the tool layer. Cross-user reads are indistinguishable from missing
 * data (no existence leak); writes always belong to the token owner AND may only
 * reference goals/milestones the token owner owns (pre-flight check before any
 * write — the DB triggers `evidence_emitter_owner_guard` /
 * `evidence_refs_owner_guard` stay a backstop, never the sole line of defense).
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

/** Register every Aimcub tool onto an McpServer using the injected ports. */
export function registerAimcubTools(server: McpServer, deps: ToolDeps): void {
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
      // Pre-flight ownership check (mirrors goal_status): the target goal — and
      // the milestone, when given — must belong to the verified caller BEFORE we
      // touch the write path. Denial reads exactly like missing data (no
      // existence leak), nothing is provisioned or enqueued, and the DB triggers
      // (migrations 0001/0005) remain defense-in-depth instead of the only guard.
      const goal = await deps.repo.getGoal(input.goalId);
      if (!goal || goal.owner_id !== deps.identity.ownerId) {
        return errorResult(`goal not found: ${input.goalId}`);
      }
      if (input.milestoneId != null) {
        const milestone = (await deps.repo.listMilestones(input.goalId)).find(
          (m) => m.id === input.milestoneId,
        );
        // Membership in the goal's list asserts milestone.goal_id === input.goalId;
        // the owner compare mirrors the evidence_refs_owner_guard trigger exactly.
        if (!milestone || milestone.owner_id !== deps.identity.ownerId) {
          return errorResult(`milestone not found: ${input.milestoneId}`);
        }
      }
      const normalized = normalizeReport(input);
      // Owner = the verified token subject. Tool input cannot influence identity.
      const ingestInput = toIngestInput(input, normalized, deps.identity.ownerId);
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
      // Service-role reads bypass RLS: a goal the caller does not own is
      // reported exactly like a missing one, so existence never leaks.
      if (!goal || goal.owner_id !== deps.identity.ownerId) {
        return errorResult(`goal not found: ${goalId}`);
      }
      // Defense-in-depth: even behind the goal gate above, scope the rows by
      // owner exactly like list_milestones does — a mislinked row never leaks.
      const milestones = (await deps.repo.listMilestones(goalId)).filter(
        (m) => m.owner_id === deps.identity.ownerId,
      );
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
      // Owner scoping without an extra goal read: every milestone row carries
      // owner_id, so another user's goal yields an empty list (denial, no leak).
      const milestones = (await deps.repo.listMilestones(goalId)).filter(
        (m) => m.owner_id === deps.identity.ownerId,
      );
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
      inputSchema: { since: z.string().optional() },
    },
    async ({ since }) => {
      // Always the token owner's inbox — there is no ownerId input to spoof.
      // v1a writes no notifications yet (the pet ships in v1b), so this is
      // empty in practice, but the read path is live and owner-scoped.
      const messages = await deps.repo.listInbox(deps.identity.ownerId, since);
      return jsonResult({
        messages: messages.map((n) => ({
          id: n.id,
          trigger: n.trigger,
          message: n.persona_msg,
          refGoalId: n.ref_goal_id,
          refMilestoneId: n.ref_milestone_id,
          createdAt: n.created_at ?? null,
        })),
      });
    },
  );
}
