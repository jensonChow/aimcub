import { describe, expect, it } from "vitest";

import type { Evidence, Goal, Milestone, MilestoneCompletion } from "@aimcub/types";

import {
  extractMemoryCandidatesFromAssumptions,
  extractMemoryCandidatesFromEvidence,
  isPromptLikeContextCandidate,
  presentContextCandidateContent,
  recommendContextScope,
  reviewContextHealth,
  reviewContextProfile,
} from "./context";

const goal = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Ship Aimcub CLI",
} as Pick<Goal, "id" | "title">;

const milestone = {
  id: "22222222-2222-4222-8222-222222222222",
  title: "Add context review",
} as Pick<Milestone, "id" | "title">;

function evidence(overrides: Partial<Evidence>): Evidence {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    owner_id: "44444444-4444-4444-8444-444444444444",
    goal_id: goal.id,
    milestone_id: milestone.id,
    emitter_id: null,
    kind: "mcp_report",
    source_event_id: null,
    occurred_at: "2026-06-30T00:00:00.000Z",
    summary: "",
    payload: {},
    trust_score: 1,
    ...overrides,
  };
}

describe("extractMemoryCandidatesFromEvidence", () => {
  it("extracts explicit context fields from evidence payloads", () => {
    const candidates = extractMemoryCandidatesFromEvidence({
      goal,
      milestones: [milestone],
      evidence: evidence({
        payload: {
          preference: "User prefers CLI-first workflows.",
          constraints: ["Keep @core packages platform-free."],
          procedure: { statement: "Run the full green-gate before calling work done." },
        },
      }),
    });

    expect(candidates.map((c) => c.content)).toEqual([
      "Preference: User prefers CLI-first workflows.",
      "Constraint: Keep @core packages platform-free.",
      "Procedure: Run the full green-gate before calling work done.",
    ]);
    expect(candidates[0]!.source).toBe("evidence_derived");
    expect(candidates[0]!.category).toBe("preference");
    expect(candidates[1]!.category).toBe("constraint");
    expect(candidates[2]!.kind).toBe("procedural");
    expect(candidates[2]!.category).toBe("procedure");
  });

  it("turns manual confirmation into a pending eval signal", () => {
    const completion = {
      decided_by: "user_confirm",
      milestone_id: milestone.id,
    } as Pick<MilestoneCompletion, "decided_by" | "milestone_id">;

    const candidates = extractMemoryCandidatesFromEvidence({
      goal,
      milestones: [milestone],
      evidence: evidence({ kind: "manual_check", summary: "I verified the CLI smoke path." }),
      completions: [completion],
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.content).toBe(
      'Eval signal: User considered "Add context review" complete after: I verified the CLI smoke path.',
    );
    expect(candidates[0]!.category).toBe("eval_signal");
    expect(candidates[0]!.confidence).toBeLessThan(1);
  });
});

describe("reviewContextProfile", () => {
  it("summarizes context coverage by category and highlights thin gaps", () => {
    const report = reviewContextProfile({
      memories: [
        {
          content: "Eval signal: Done means smoke tests pass.",
          category: "eval_signal",
          confidence: 0.9,
          goal_id: null,
          status: "active",
        },
        {
          content: "Procedure: Run pnpm build before shipping.",
          category: "procedure",
          confidence: 0.65,
          goal_id: goal.id,
          status: "active",
        },
        {
          content: "Capability: Codex can implement CLI tasks.",
          category: "capability",
          confidence: 0.8,
          goal_id: null,
          status: "pending",
        },
      ] as const,
    });

    expect(report.totalActive).toBe(2);
    expect(report.totalPending).toBe(1);
    expect(report.rows.find((row) => row.category === "eval_signal")).toMatchObject({
      strength: "ready",
      recommendation: "capture_completion_criteria",
    });
    expect(report.rows.find((row) => row.category === "procedure")).toMatchObject({
      strength: "thin",
      recommendation: "capture_workflows_and_verification_steps",
    });
    expect(report.rows.find((row) => row.category === "capability")).toMatchObject({
      strength: "thin",
      recommendation: "review_pending_candidates",
    });
    expect(report.gaps.map((row) => row.category)).toContain("procedure");
    expect(report.coverageScore).toBeGreaterThan(0);
  });
});

describe("isPromptLikeContextCandidate", () => {
  it("detects context-gap prompts that must be edited before acceptance", () => {
    expect(
      isPromptLikeContextCandidate(
        'Eval signal: For "Ship Aimcub CLI", pending answer needed: Ask what would make this aim count as complete.',
      ),
    ).toBe(true);
    expect(
      isPromptLikeContextCandidate(
        'Eval signal: For "Ship Aimcub CLI", confirm whether this constraint context should shape the aim: Keep @core pure.',
      ),
    ).toBe(true);
    expect(isPromptLikeContextCandidate("Eval signal: Done means tests pass and screenshots prove the flow.")).toBe(false);
  });
});

describe("question-shaped content never becomes a context candidate", () => {
  it("drops prompt-like content at the composition layer — questions belong to the clarify flow", () => {
    // The plan review's open gaps used to be parked in the inbox as pseudo-facts
    // ("pending answer needed: ..."). That composition path is deleted, and this shared guard
    // makes the class unrepeatable: no extractor can emit a question-shaped candidate.
    const candidates = extractMemoryCandidatesFromEvidence({
      goal,
      milestones: [milestone],
      evidence: evidence({
        payload: {
          constraints: [
            'Constraint: For "Ship Aimcub CLI", pending answer needed: Ask for non-negotiable constraints.',
          ],
          preference: "User prefers CLI-first workflows.",
        },
      }),
    });

    expect(candidates.map((c) => c.content)).toEqual(["Preference: User prefers CLI-first workflows."]);
  });
});

describe("extractMemoryCandidatesFromAssumptions", () => {
  it("stores the assumption itself — category, source, and aim stay structured fields", () => {
    const candidates = extractMemoryCandidatesFromAssumptions({
      goal,
      assumptions: [
        { statement: "Assumed GitHub + CI as the evidence source.", default_value: "github" },
        { statement: "Assumed TypeScript.", default_value: "typescript" },
        { statement: "Assumed a single workspace.", default_value: "" },
      ],
    });

    // The old composed prefix ("Project fact: Planning assumption for "<aim>": …")
    // duplicated the structured fields into durable text and followed the candidate into
    // accepted memory (founder, 2026-08-09) — content must carry no provenance.
    expect(candidates.map((c) => c.content)).toEqual([
      "Assumed GitHub + CI as the evidence source. (github)",
      "Assumed TypeScript. (typescript)",
      "Assumed a single workspace.",
    ]);
    expect(candidates.every((c) => c.category === "project_fact")).toBe(true);
    expect(candidates.every((c) => c.source === "agent_inferred")).toBe(true);
    expect(candidates.every((c) => c.reason === "clarify.assumption")).toBe(true);
  });

  it("does not duplicate assumptions that only restate already-known context", () => {
    const candidates = extractMemoryCandidatesFromAssumptions({
      goal,
      assumptions: [
        {
          statement: "Answered from known constraint context: Which language?",
          default_value: "Constraint: Use TypeScript.",
        },
      ],
    });

    expect(candidates).toEqual([]);
  });
});

describe("presentContextCandidateContent", () => {
  it("strips the legacy composed prefix from stored candidates", () => {
    expect(presentContextCandidateContent(
      'Project fact: Planning assumption for "我想要研究coding agent related router": 核心研究对象 (优先 Cursor Router)',
    )).toBe("核心研究对象 (优先 Cursor Router)");
    expect(presentContextCandidateContent(
      'Constraint: Planning assumption for "Ship it": Ship dark mode first.',
    )).toBe("Ship dark mode first.");
  });

  it("passes clean content through unchanged and never strips to empty", () => {
    expect(presentContextCandidateContent("Assumed TypeScript. (typescript)"))
      .toBe("Assumed TypeScript. (typescript)");
    // A question-shaped gap candidate keeps its prompt shape (the edit gate depends on it).
    const gap = 'Procedure: For "Ship it", pending answer needed: Which registry?';
    expect(presentContextCandidateContent(gap)).toBe(gap);
    expect(presentContextCandidateContent('Project fact: Planning assumption for "X": '))
      .toBe('Project fact: Planning assumption for "X":');
  });
});

describe("recommendContextScope", () => {
  it("recommends global scope for stable reusable context categories", () => {
    expect(recommendContextScope({ goal_id: "goal-1", category: "preference" }).scope).toBe("global");
    expect(recommendContextScope({ goal_id: "goal-1", category: "constraint" }).scope).toBe("global");
    expect(recommendContextScope({ goal_id: "goal-1", category: "capability" }).scope).toBe("global");
    expect(recommendContextScope({ goal_id: "goal-1", category: "eval_signal" }).scope).toBe("global");
  });

  it("keeps project-specific context scoped to the aim by default", () => {
    expect(recommendContextScope({ goal_id: "goal-1", category: "project_fact" }).scope).toBe("aim");
    expect(recommendContextScope({ goal_id: "goal-1", category: "procedure" }).scope).toBe("aim");
  });

  it("keeps already-global context global", () => {
    expect(recommendContextScope({ goal_id: null, category: "project_fact" })).toEqual({
      scope: "global",
      reason: "already_global",
    });
  });
});

describe("reviewContextHealth", () => {
  const memoryBase = {
    owner_id: "owner",
    kind: "semantic",
    source: "user_stated",
    status: "active",
    superseded_by: null,
  } as const;

  it("marks repeatedly unrelated aim-scoped context as an archive candidate", () => {
    const memories = [
      {
        ...memoryBase,
        id: "11111111-0000-4000-8000-000000000001",
        goal_id: "old-goal",
        category: "project_fact",
        content: "Project fact: The billing dashboard uses Stripe.",
        confidence: 0.9,
      },
      {
        ...memoryBase,
        id: "11111111-0000-4000-8000-000000000002",
        goal_id: null,
        category: "constraint",
        content: "Constraint: Keep @core packages platform-free.",
        confidence: 1,
      },
    ] as const;

    const rows = reviewContextHealth({
      memories,
      traces: [
        {
          selected: [{ memoryId: memories[1]!.id, content: memories[1]!.content, reason: "global_context" }],
          ignored: [{ memoryId: memories[0]!.id, content: memories[0]!.content, reason: "unrelated_goal_context" }],
        },
        {
          selected: [],
          ignored: [{ memoryId: memories[0]!.id, content: memories[0]!.content, reason: "unrelated_goal_context" }],
        },
      ],
    });

    expect(rows[0]).toMatchObject({
      memoryId: memories[0]!.id,
      action: "archive_candidate",
      reason: "aim_scoped_context_repeatedly_unrelated",
      ignoredCount: 2,
      unrelatedCount: 2,
    });
    expect(rows.find((row) => row.memoryId === memories[1]!.id)).toMatchObject({
      action: "keep",
      selectedCount: 1,
    });
  });

  it("falls back to content matching for legacy traces without memory ids", () => {
    const memories = [
      {
        ...memoryBase,
        id: "11111111-0000-4000-8000-000000000003",
        goal_id: null,
        category: "preference",
        content: "Preference: Use concise CLI output.",
        confidence: 0.5,
      },
    ] as const;

    const rows = reviewContextHealth({
      memories,
      traces: [
        {
          selected: [],
          ignored: [
            {
              content: "Preference: Use concise CLI output.",
              category: "preference",
              goalId: null,
              reason: "low_confidence",
            },
          ],
        },
      ],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      memoryId: memories[0]!.id,
      action: "review",
      reason: "memory_confidence_below_planning_threshold",
      lowConfidenceCount: 1,
    });
  });
});
