import { describe, expect, it } from "vitest";

import type { DecompositionOutput } from "@aimcub/types";

import { createPlanningSession, type PlanningSessionConfig, type PlanningSessionEvent } from "./planning-session";
import { buildPlanningSessionPrompt } from "./planning-session-prompt";
import { PLANNING_SESSION_TOOL_DEFINITIONS } from "./planning-session-tools";
import { DECOMPOSITION_PLAN_RULES } from "./decompose";

// ──────────────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────────────

/** A valid two-node plan exercising both v1 evaluators + a dependency edge. */
function validPlan(): DecompositionOutput {
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
            {
              evaluator: "ci_status",
              auto_verifiable: true,
              match: { workflow: "test", conclusion: "success" },
            },
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

/** Valid shape, but its only auto evidence is a weak commit pattern → `weak_commit_pattern` warning. */
function weakQualityPlan(): DecompositionOutput {
  const plan = validPlan();
  plan.nodes[0]!.acceptance_rule.clauses = [
    { evaluator: "commit_pattern", auto_verifiable: true, match: { message_pattern: "done" } },
  ];
  return plan;
}

/** Structurally broken plan: the edge references a node that does not exist. */
function invalidPlan(): Record<string, unknown> {
  const plan = validPlan() as unknown as Record<string, unknown>;
  return { ...plan, edges: [{ from: "m1", to: "missing" }] };
}

function makeSession(overrides: Partial<PlanningSessionConfig> = {}) {
  const events: PlanningSessionEvent[] = [];
  const session = createPlanningSession({
    aim: { title: "Launch the tarot practice app", description: "A calm consumer app." },
    memories: [
      { content: "Prefers WCAG AA contrast over exact palette fidelity", category: "preference", kind: "user_stated" },
      { content: "Ships English UI with zh i18n values", category: "constraint", kind: "user_stated" },
    ],
    onEvent: (event) => events.push(event),
    now: () => new Date("2026-07-24T10:00:00.000Z"),
    ...overrides,
  });
  return { session, events };
}

async function expectReply(disposition: Promise<unknown> | unknown): Promise<Record<string, unknown>> {
  const resolved = (await disposition) as { kind: string; body?: Record<string, unknown> };
  expect(resolved.kind).toBe("reply");
  return resolved.body ?? {};
}

// ──────────────────────────────────────────────────────────────────────────
// Happy path
// ──────────────────────────────────────────────────────────────────────────

describe("planning session · happy path", () => {
  it("research → question → answer → accepted submit produces a full outcome", async () => {
    const { session, events } = makeSession();

    const research = await expectReply(session.handleToolCall("report_research", {
      findings: [
        { summary: "Apple review requires an entertainment disclaimer for tarot apps.", source_urls: ["https://developer.apple.com/app-store/review/guidelines/"], lane: "authoritative_requirements" },
      ],
      gaps: [],
    }));
    expect(research.recorded).toBe(true);

    const memory = await expectReply(session.handleToolCall("search_memory", { query: "contrast palette" }));
    expect((memory.memories as unknown[]).length).toBeGreaterThan(0);

    const asked = await session.handleToolCall("ask_user", {
      question: "Which platform should the first release target?",
      kind: "scope",
      why_high_impact: "Platform changes distribution, review, and evidence milestones.",
      options: [
        { label: "iOS", tradeoff: "App Store review, but reaches the core audience." },
        { label: "Web", tradeoff: "No review gate, weaker retention." },
      ],
      selection_mode: "single",
      selection_mode_reason: "primary_choice_requested",
    });
    expect(asked.kind).toBe("pending_user");
    if (asked.kind !== "pending_user") throw new Error("expected pending question");
    expect(session.state().phase).toBe("waiting_user");
    expect(asked.question.allow_other).toBe(true);
    expect(asked.question.selection_mode).toBe("single");

    const answerBody = session.provideAnswer(asked.requestId, { selected_labels: ["iOS"], other_text: null });
    expect(answerBody.answer).toMatchObject({ selected_labels: ["iOS"] });
    expect(session.state().phase).toBe("researching");

    // First submission is valid but does not apply the known context memories:
    // the session bounces it once with quality critique, like the funnel's retry.
    const bounced = await expectReply(session.handleToolCall("submit_plan", { plan: validPlan() }));
    expect(bounced.accepted).toBe(false);
    expect((bounced.quality as { issues: string[] }).issues.length).toBeGreaterThan(0);

    const submit = await expectReply(session.handleToolCall("submit_plan", {
      plan: validPlan(),
      assumptions: [{ statement: "Single-language launch", default_value: "English UI" }],
      research_summary: "Store policy and audience research shaped the plan.",
      open_questions: ["Is a paid tier planned for v1?"],
    }));
    expect(submit.accepted).toBe(true);

    const snapshot = session.snapshot();
    expect(snapshot.phase).toBe("draft_ready");
    expect(snapshot.outcome?.plan.nodes.map((node) => node.key)).toEqual(["m1", "m2"]);
    expect(snapshot.outcome?.acceptedAtSessionEnd).toBe(false);
    expect(snapshot.outcome?.acceptedAttempt).toBe(2);
    expect(snapshot.outcome?.assumptions).toEqual([{ statement: "Single-language launch", default_value: "English UI" }]);
    expect(snapshot.outcome?.openQuestions).toEqual(["Is a paid tier planned for v1?"]);
    expect(snapshot.outcome?.research.findings).toHaveLength(1);
    expect(snapshot.outcome?.research.summary).toBe("Store policy and audience research shaped the plan.");
    expect(snapshot.outcome?.answers).toHaveLength(1);
    expect(snapshot.outcome?.answers[0]?.answer.selected_labels).toEqual(["iOS"]);

    const kinds = snapshot.transcript.map((entry) => entry.kind);
    expect(kinds).toEqual(["research", "question", "answer", "plan_attempt", "plan_attempt"]);
    expect(events.some((event) => event.type === "plan_accepted")).toBe(true);

    // The snapshot must survive JSON persistence (draft storage) unchanged.
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  it("rejects further tool calls after the session is over", async () => {
    const { session } = makeSession({ memories: [] });
    await expectReply(session.handleToolCall("submit_plan", { plan: validPlan() }));
    const late = await expectReply(session.handleToolCall("report_research", { findings: [{ summary: "late" }] }));
    expect(late.error).toBe("session_over");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Temporary chat + directives
// ──────────────────────────────────────────────────────────────────────────

describe("planning session · temporary chat", () => {
  it("delivers queued user messages on the next tool reply exactly once", async () => {
    const { session } = makeSession();
    session.postUserMessage("Budget is 200 USD, keep it lean.");

    const first = await expectReply(session.handleToolCall("report_research", { findings: [{ summary: "a finding" }] }));
    expect(first.user_notes).toEqual(["Budget is 200 USD, keep it lean."]);

    const second = await expectReply(session.handleToolCall("report_research", { findings: [{ summary: "another" }] }));
    expect(second.user_notes).toBeUndefined();

    const snapshot = session.snapshot();
    const chat = snapshot.transcript.find((entry) => entry.kind === "user_message");
    expect(chat).toMatchObject({ delivered: true });
  });

  it("delivers chat sent while a question is pending along with the answer", async () => {
    const { session } = makeSession();
    const asked = await session.handleToolCall("ask_user", { question: "Which platform should the first release target?" });
    if (asked.kind !== "pending_user") throw new Error("expected pending question");
    session.postUserMessage("Actually my sister will co-own this aim.");
    const body = session.provideAnswer(asked.requestId, { selected_labels: [], other_text: "iOS first" });
    expect(body.user_notes).toEqual(["Actually my sister will co-own this aim."]);
  });

  it("stream-capable hosts can drain messages so replies do not double-deliver", async () => {
    const { session } = makeSession();
    session.postUserMessage("note one");
    expect(session.takeQueuedUserMessages()).toEqual(["note one"]);
    const reply = await expectReply(session.handleToolCall("report_research", { findings: [{ summary: "x" }] }));
    expect(reply.user_notes).toBeUndefined();
  });

  it("finish_now rides the next reply and blocks further questions", async () => {
    const { session } = makeSession();
    session.requestFinishNow();
    const reply = await expectReply(session.handleToolCall("report_research", { findings: [{ summary: "x" }] }));
    expect(reply.directives).toEqual(["finish_now"]);

    const refused = await expectReply(session.handleToolCall("ask_user", { question: "One more thing?" }));
    expect(refused.asked).toBe(false);
    expect(refused.reason).toBe("user_requested_finish");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Question protocol
// ──────────────────────────────────────────────────────────────────────────

describe("planning session · questions", () => {
  it("enforces the question budget with guidance instead of a hard error", async () => {
    const { session } = makeSession({ budgets: { maxQuestions: 1 } });
    const first = await session.handleToolCall("ask_user", { question: "Which platform should the first release target?" });
    if (first.kind !== "pending_user") throw new Error("expected pending question");
    session.provideAnswer(first.requestId, { selected_labels: [], other_text: "web" });

    const second = await expectReply(session.handleToolCall("ask_user", { question: "What budget applies?" }));
    expect(second.asked).toBe(false);
    expect(second.reason).toBe("question_budget_exhausted");
    expect(String(second.guidance)).toContain("assumptions");
  });

  it("refuses a second question while one is pending", async () => {
    const { session } = makeSession();
    const first = await session.handleToolCall("ask_user", { question: "Which platform should the first release target?" });
    expect(first.kind).toBe("pending_user");
    const second = await expectReply(session.handleToolCall("ask_user", { question: "And the budget?" }));
    expect(second.asked).toBe(false);
    expect(second.reason).toBe("another_question_pending");
  });

  it("normalizes options and overrides an unjustified single-select", async () => {
    const { session } = makeSession();
    const asked = await session.handleToolCall("ask_user", {
      question: "Which capabilities should the app include?",
      options: [
        { label: "Daily draw", tradeoff: "Retention" },
        { label: "daily draw", tradeoff: "duplicate casing" },
        { label: "Journal", tradeoff: "Depth" },
      ],
      selection_mode: "single",
    });
    if (asked.kind !== "pending_user") throw new Error("expected pending question");
    expect(asked.question.options.map((option) => option.label)).toEqual(["Daily draw", "Journal"]);
    // "capabilities" is an additive set: the shared cardinality layer keeps multiple.
    expect(asked.question.selection_mode).toBe("multiple");
  });

  it("answering an unknown request id reports no_pending_question", () => {
    const { session } = makeSession();
    expect(session.provideAnswer("ask_404", { selected_labels: [] }).error).toBe("no_pending_question");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Submit / repair / quality
// ──────────────────────────────────────────────────────────────────────────

describe("planning session · submit and repair", () => {
  it("returns validation errors and accepts the repaired resubmission", async () => {
    const { session, events } = makeSession({ memories: [] });
    const rejected = await expectReply(session.handleToolCall("submit_plan", { plan: invalidPlan() }));
    expect(rejected.accepted).toBe(false);
    expect((rejected.validation_errors as string[]).length).toBeGreaterThan(0);
    expect(rejected.attempts_remaining).toBe(3);

    const accepted = await expectReply(session.handleToolCall("submit_plan", { plan: validPlan() }));
    expect(accepted.accepted).toBe(true);
    expect(session.snapshot().phase).toBe("draft_ready");
    expect(events.filter((event) => event.type === "plan_rejected")).toHaveLength(1);
  });

  it("bounces once on quality issues and keeps the better submission", async () => {
    const { session } = makeSession();
    const bounced = await expectReply(session.handleToolCall("submit_plan", { plan: weakQualityPlan() }));
    expect(bounced.accepted).toBe(false);
    expect((bounced.quality as { issues: string[] }).issues.join(" ")).toContain("commit message pattern");

    const accepted = await expectReply(session.handleToolCall("submit_plan", { plan: validPlan() }));
    expect(accepted.accepted).toBe(true);
    const outcome = session.snapshot().outcome;
    expect(outcome?.acceptedAttempt).toBe(2);
    expect(outcome?.attempts).toBe(2);
  });

  it("keeps the earlier, better plan when the post-bounce resubmission is worse", async () => {
    const { session } = makeSession();
    const bounced = await expectReply(session.handleToolCall("submit_plan", { plan: weakQualityPlan() }));
    expect(bounced.accepted).toBe(false);

    // Strictly worse: BOTH nodes now rely on weak commit patterns.
    const worse = weakQualityPlan();
    worse.nodes[1]!.acceptance_rule.clauses = [
      { evaluator: "commit_pattern", auto_verifiable: true, match: { message_pattern: "fix" } },
    ];
    const accepted = await expectReply(session.handleToolCall("submit_plan", { plan: worse }));
    expect(accepted.accepted).toBe(true);
    expect(String(accepted.note)).toContain("better quality");
    expect(session.snapshot().outcome?.acceptedAttempt).toBe(1);
  });

  it("fails honestly when every submission is invalid and no candidate exists", async () => {
    const { session, events } = makeSession({ budgets: { maxSubmitAttempts: 1 } });
    const reply = await expectReply(session.handleToolCall("submit_plan", { plan: invalidPlan() }));
    expect(reply.accepted).toBe(false);
    expect(reply.session).toBe("failed");
    const snapshot = session.snapshot();
    expect(snapshot.phase).toBe("failed");
    expect(snapshot.failure?.code).toBe("no_valid_plan");
    expect(snapshot.failure?.lastErrors.length).toBeGreaterThan(0);
    expect(events.some((event) => event.type === "session_failed")).toBe(true);
  });

  it("keeps the stored valid candidate when the final attempt is invalid", async () => {
    const { session } = makeSession({ budgets: { maxSubmitAttempts: 2 } });
    const bounced = await expectReply(session.handleToolCall("submit_plan", { plan: weakQualityPlan() }));
    expect(bounced.accepted).toBe(false);

    const last = await expectReply(session.handleToolCall("submit_plan", { plan: invalidPlan() }));
    expect(last.accepted).toBe(true);
    expect(String(last.note)).toContain("earlier valid submission");
    expect(session.snapshot().outcome?.acceptedAttempt).toBe(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Finalize / cancel
// ──────────────────────────────────────────────────────────────────────────

describe("planning session · finalize and cancel", () => {
  it("finalize honors the best valid submission and skips a pending question", async () => {
    const { session } = makeSession();
    await expectReply(session.handleToolCall("submit_plan", { plan: weakQualityPlan() }));
    const asked = await session.handleToolCall("ask_user", { question: "Which platform should the first release target?" });
    expect(asked.kind).toBe("pending_user");

    const snapshot = session.finalize();
    expect(snapshot.phase).toBe("draft_ready");
    expect(snapshot.outcome?.acceptedAtSessionEnd).toBe(true);
    expect(snapshot.outcome?.quality.grade).not.toBe("pass");
    const skipped = snapshot.transcript.find((entry) => entry.kind === "answer");
    expect(skipped).toMatchObject({ answer: { skipped: true } });
  });

  it("finalize without any submission fails with no_plan_submitted", () => {
    const { session } = makeSession();
    const snapshot = session.finalize();
    expect(snapshot.phase).toBe("failed");
    expect(snapshot.failure?.code).toBe("no_plan_submitted");
  });

  it("cancel is terminal and idempotent", async () => {
    const { session, events } = makeSession();
    session.cancel();
    session.cancel();
    expect(session.snapshot().phase).toBe("canceled");
    expect(events.filter((event) => event.type === "session_canceled")).toHaveLength(1);
    const late = await expectReply(session.handleToolCall("submit_plan", { plan: validPlan() }));
    expect(late.error).toBe("session_over");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Memory candidates + prompt + tool surface
// ──────────────────────────────────────────────────────────────────────────

describe("planning session · surface", () => {
  it("collects proposed memory candidates into the outcome", async () => {
    const { session } = makeSession({ memories: [] });
    const proposed = await expectReply(session.handleToolCall("propose_memory", {
      content: "User already has an Apple Developer account",
      category: "capability",
      scope: "global",
    }));
    expect(proposed.proposed).toBe(true);
    await expectReply(session.handleToolCall("submit_plan", { plan: validPlan() }));
    expect(session.snapshot().outcome?.memoryCandidates).toEqual([
      { content: "User already has an Apple Developer account", category: "capability", scope: "global" },
    ]);
  });

  it("unknown tools get a structured error reply", async () => {
    const { session } = makeSession();
    const reply = await expectReply(session.handleToolCall("write_file", { path: "/etc/passwd" }));
    expect(String(reply.error)).toContain("unknown planning tool");
  });

  it("the mission prompt carries the shared plan rules, context, and doctrines", () => {
    const prompt = buildPlanningSessionPrompt({
      aim: { title: "Launch the tarot practice app", outputLanguage: "simplified_chinese" },
      memories: [{ content: "Prefers WCAG AA contrast", category: "preference", kind: "user_stated" }],
      workspaceRoots: ["/Users/someone/project"],
      webResearch: { enabled: false, required: false },
    });
    expect(prompt).toContain(DECOMPOSITION_PLAN_RULES);
    expect(prompt).toContain("Launch the tarot practice app");
    expect(prompt).toContain("Prefers WCAG AA contrast");
    expect(prompt).toContain("/Users/someone/project");
    expect(prompt).toContain("Web research is DISABLED");
    expect(prompt).toContain("Simplified Chinese");
    expect(prompt).toContain("ask_user");
    expect(prompt).toContain("submit_plan");
  });

  it("briefs a resumed brain with what the earlier pass settled", () => {
    const prompt = buildPlanningSessionPrompt({
      aim: { title: "我想做一个塔罗的AI产品" },
      webResearch: { enabled: true, required: false },
      priorPass: {
        answers: [{
          question: {
            id: "q1",
            question: "谁是你的第一批用户？",
            kind: "scope",
            why_high_impact: "",
            allow_other: true,
            selection_mode: "single",
            selection_mode_reason: "mutually_exclusive",
            capture_scope: "current_aim",
            options: [],
          },
          answer: { selected_labels: ["小红书上的塔罗爱好者"], other_text: null },
        }],
        research: {
          findings: [{ summary: "Tarot apps cluster around daily-draw retention", source_urls: ["https://a.example"] }],
          gaps: ["pricing unknown"],
          summary: "Two lanes covered.",
        },
        assumptions: [{ statement: "English-only launch", default_value: "en" }],
        openQuestions: ["Pricing?"],
        notes: ["先做 iOS，别做网页"],
        planDrafted: false,
        truncated: false,
      },
    });

    expect(prompt).toContain("You are resuming an unfinished pass");
    expect(prompt).toContain("CONTINUES it");
    // The user's own answer, verbatim, under an instruction that cannot be misread.
    expect(prompt).toContain("NEVER ask these again");
    expect(prompt).toContain("谁是你的第一批用户？");
    expect(prompt).toContain("小红书上的塔罗爱好者");
    // Research already done, gaps to pick up at, and mid-pass instructions that still bind.
    expect(prompt).toContain("do not redo it");
    expect(prompt).toContain("Tarot apps cluster around daily-draw retention");
    expect(prompt).toContain("pricing unknown");
    expect(prompt).toContain("先做 iOS，别做网页");
    expect(prompt).toContain("English-only launch");
    // The briefing lands before the research/question doctrine it modifies.
    expect(prompt.indexOf("resuming an unfinished pass")).toBeLessThan(prompt.indexOf("## How to research"));

    // A pass that already drafted a plan is refined, not restarted.
    const drafted = buildPlanningSessionPrompt({
      aim: { title: "x" },
      webResearch: { enabled: false, required: false },
      priorPass: {
        answers: [],
        research: { findings: [], gaps: [], summary: "" },
        assumptions: [],
        openQuestions: [],
        notes: [],
        planDrafted: true,
        truncated: true,
      },
    });
    expect(drafted).toContain("refine and resubmit, do not start over");
    expect(drafted).toContain("this record is partial");
    expect(drafted).toContain("(no questions were answered before the pass stopped)");
  });

  it("omits the resume briefing entirely for a first pass", () => {
    const prompt = buildPlanningSessionPrompt({
      aim: { title: "x" },
      webResearch: { enabled: false, required: false },
    });
    expect(prompt).not.toContain("resuming an unfinished pass");
    expect(prompt).not.toContain("NEVER ask these again");
  });

  it("states the aim's domain only when actually known", () => {
    const known = buildPlanningSessionPrompt({
      aim: { title: "Ship the beta", domain: "software" },
      webResearch: { enabled: true, required: false },
    });
    expect(known).toContain("Domain: software");

    // A guessed domain misleads research ("plan my London trip" is not a software goal):
    // when unset, the prompt says so and routes the brain's own classification into
    // submit_plan, which plan landing writes back onto the goal.
    const unknown = buildPlanningSessionPrompt({
      aim: { title: "Plan a trip to London", domain: null },
      webResearch: { enabled: true, required: true },
    });
    expect(unknown).toContain("Domain: not set — infer it from the aim itself");
    expect(unknown).not.toContain("Domain: software");
  });

  it("exempts personal facts from question suppression and sanctions an opening set", () => {
    const prompt = buildPlanningSessionPrompt({
      aim: { title: "Plan a trip to London" },
      webResearch: { enabled: true, required: true },
    });
    // Personal facts are the one class research can never answer — the doctrine must
    // order them asked, not defaulted into assumptions.
    expect(prompt).toContain("research can NEVER answer them — ask, do not guess");
    expect(prompt).toContain("open with the 2-4 personal-fact questions that most shape the plan");
    expect(prompt).toContain("A personal fact that shapes the plan's structure is never low-impact.");
  });

  it("serializes a snapshot into the AimDraft planning_session shape", async () => {
    const { session } = makeSession({ memories: [] });
    await expectReply(session.handleToolCall("report_research", {
      findings: [{ summary: "Finding A", source_urls: ["https://a.example"] }],
      gaps: ["no web access"],
    }));
    await expectReply(session.handleToolCall("propose_memory", {
      content: "Has an Apple Developer account",
      category: "capability",
      scope: "global",
    }));
    await expectReply(session.handleToolCall("submit_plan", {
      plan: validPlan(),
      assumptions: [{ statement: "English-only launch", default_value: "en" }],
      open_questions: ["Pricing?"],
      research_summary: "Two lanes covered.",
    }));

    const { planningSessionDraftState } = await import("./planning-session");
    const state = planningSessionDraftState(session.snapshot(), "claude", new Date("2026-07-24T12:00:00.000Z"));
    expect(state.agent_id).toBe("claude");
    expect(state.phase).toBe("draft_ready");
    expect(state.updated_at).toBe("2026-07-24T12:00:00.000Z");
    expect(state.research_findings).toEqual([{ summary: "Finding A", source_urls: ["https://a.example"] }]);
    expect(state.research_gaps).toEqual(["no web access"]);
    expect(state.research_summary).toBe("Two lanes covered.");
    expect(state.assumptions).toEqual([{ statement: "English-only launch", default_value: "en" }]);
    expect(state.open_questions).toEqual(["Pricing?"]);
    expect(state.memory_candidates).toEqual([
      { content: "Has an Apple Developer account", category: "capability", scope: "global" },
    ]);
    expect(state.transcript.map((entry) => entry.kind)).toEqual(["research", "memory_candidate", "plan_attempt"]);
    // Round-trips through the persistence schema unchanged.
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    // The drafted plan rides along, so quitting before adopting does not discard it.
    expect(state.draft_plan).toEqual(validPlan());
    // Provenance defaults: no model claimed, the pass starts now, still live, never resumed.
    expect(state.model).toBe("");
    expect(state.started_at).toBe("2026-07-24T12:00:00.000Z");
    expect(state.stopped_reason).toBe("");
    expect(state.resumed_count).toBe(0);
    expect(state.truncated).toBe(false);
  });

  it("serializes a MID-FLIGHT pass, so a checkpoint does not need an outcome", async () => {
    const { session } = makeSession({ memories: [] });
    await expectReply(session.handleToolCall("report_research", {
      findings: [{ summary: "Finding A", source_urls: ["https://a.example"] }],
      gaps: ["no web access"],
    }));

    const { planningSessionDraftState } = await import("./planning-session");
    const pass = planningSessionDraftState(session.snapshot(), "codex", new Date("2026-07-26T09:00:00.000Z"), {
      model: "gpt-5.6-sol",
      startedAt: "2026-07-25T14:03:09.714Z",
      stoppedReason: "app_quit",
      resumedCount: 2,
    });
    // No `submit_plan` yet: research still has to survive the quit, which is the whole point.
    expect(pass.phase).toBe("researching");
    expect(pass.draft_plan).toBeNull();
    expect(pass.research_findings).toEqual([{ summary: "Finding A", source_urls: ["https://a.example"] }]);
    expect(pass.research_gaps).toEqual(["no web access"]);
    expect(pass.model).toBe("gpt-5.6-sol");
    // A resumed pass keeps its ORIGINAL start; only `updated_at` moves.
    expect(pass.started_at).toBe("2026-07-25T14:03:09.714Z");
    expect(pass.updated_at).toBe("2026-07-26T09:00:00.000Z");
    expect(pass.stopped_reason).toBe("app_quit");
    expect(pass.resumed_count).toBe(2);
  });

  it("restores a draft_ready pass into an adoptable plan without a brain", async () => {
    const { session } = makeSession({ memories: [] });
    // A question the user answered, and one they never got to.
    const asked = await session.handleToolCall("ask_user", {
      question: "What is your budget?",
      why_high_impact: "It sets the whole scope.",
      options: [{ label: "Under 200", tradeoff: "tight" }, { label: "Over 200", tradeoff: "roomy" }],
    });
    const requestId = asked.kind === "pending_user" ? asked.requestId : "";
    expect(requestId).not.toBe("");
    session.provideAnswer(requestId, { selected_labels: ["Under 200"], other_text: null });
    await expectReply(session.handleToolCall("report_research", {
      findings: [{ summary: "Finding A", source_urls: ["https://a.example"] }],
      gaps: ["no web access"],
    }));
    await expectReply(session.handleToolCall("propose_memory", {
      content: "Has an Apple Developer account",
      category: "capability",
      scope: "global",
    }));
    await expectReply(session.handleToolCall("submit_plan", {
      plan: validPlan(),
      assumptions: [{ statement: "English-only launch", default_value: "en" }],
      open_questions: ["Pricing?"],
      research_summary: "Two lanes covered.",
    }));

    const { planningSessionDraftState, restorePlanningPass } = await import("./planning-session");
    const pass = planningSessionDraftState(session.snapshot(), "codex", new Date("2026-07-26T09:00:00.000Z"), {
      stoppedReason: "app_quit",
    });
    // Through disk and back: persistence is JSON, so the restore must survive a round-trip.
    const restored = restorePlanningPass(JSON.parse(JSON.stringify(pass)));

    expect(restored).not.toBeNull();
    expect(restored!.plan).toEqual(validPlan());
    // Quality is recomputed, never read from disk.
    expect(restored!.quality).toBeTruthy();
    expect(restored!.assumptions).toEqual([{ statement: "English-only launch", default_value: "en" }]);
    expect(restored!.openQuestions).toEqual(["Pricing?"]);
    expect(restored!.research.findings).toEqual([{ summary: "Finding A", source_urls: ["https://a.example"] }]);
    expect(restored!.research.gaps).toEqual(["no web access"]);
    expect(restored!.memoryCandidates).toEqual([
      { content: "Has an Apple Developer account", category: "capability", scope: "global" },
    ]);
    // The answered question is paired back up, with the user's own selection intact.
    expect(restored!.answers).toHaveLength(1);
    expect(restored!.answers[0]!.question.question).toBe("What is your budget?");
    expect(restored!.answers[0]!.question.options.map((option) => option.label)).toEqual(["Under 200", "Over 200"]);
    expect(restored!.answers[0]!.answer.selected_labels).toEqual(["Under 200"]);
  });

  it("refuses to restore a pass that never drafted a plan, and tolerates junk on disk", async () => {
    const { session } = makeSession({ memories: [] });
    await expectReply(session.handleToolCall("report_research", { findings: [], gaps: ["no web"] }));

    const { planningSessionDraftState, restorePlanningPass } = await import("./planning-session");
    const midFlight = planningSessionDraftState(session.snapshot(), "codex", new Date("2026-07-26T09:00:00.000Z"));
    // No plan yet: the aim must resume planning, not be offered something to adopt.
    expect(restorePlanningPass(midFlight)).toBeNull();

    // The transcript is permissive on disk; garbage entries drop instead of being trusted.
    const finished = planningSessionDraftState(session.snapshot(), "codex", new Date("2026-07-26T09:00:00.000Z"));
    const tampered = {
      ...finished,
      draft_plan: { nodes: "not a plan" },
      transcript: [{ kind: "question" }, { kind: "answer", request_id: "missing" }, { kind: "???" }],
    };
    expect(restorePlanningPass(tampered as never)).toBeNull();
  });

  it("resumes a pass: history carried, and an answered question can no longer be re-asked", async () => {
    // Pass one: the user answers a question, research is recorded, then the app "closes".
    const first = makeSession({ memories: [] });
    const asked = await first.session.handleToolCall("ask_user", {
      question: "谁是你的第一批用户？",
      why_high_impact: "It sets the whole scope.",
      options: [{ label: "小红书上的塔罗爱好者", tradeoff: "" }],
    });
    const requestId = asked.kind === "pending_user" ? asked.requestId : "";
    first.session.provideAnswer(requestId, { selected_labels: ["小红书上的塔罗爱好者"], other_text: null });
    await expectReply(first.session.handleToolCall("report_research", {
      findings: [{ summary: "Finding A", source_urls: ["https://a.example"] }],
      gaps: ["pricing unknown"],
    }));

    const { planningSessionDraftState, createPlanningSession } = await import("./planning-session");
    const pass = planningSessionDraftState(first.session.snapshot(), "codex", new Date("2026-07-26T09:00:00.000Z"), {
      stoppedReason: "app_quit",
    });

    // Pass two resumes it, exactly as main does: transcript + questions-asked carried across.
    const resumed = createPlanningSession({
      aim: { title: "我想做一个塔罗的AI产品" },
      memories: [],
      resume: {
        transcript: JSON.parse(JSON.stringify(pass.transcript)),
        questionsAsked: 1,
      },
    });

    // The pass continues rather than restarting: prior history is present from the first breath.
    const snapshot = resumed.snapshot();
    expect(snapshot.questionsAsked).toBe(1);
    expect(snapshot.transcript.map((entry) => entry.kind)).toEqual(["question", "answer", "research"]);

    // Asking the same thing again is REFUSED, and the answer is handed straight back.
    const again = await expectReply(resumed.handleToolCall("ask_user", {
      question: "谁是你的第一批用户？",
      why_high_impact: "I forgot.",
      options: [],
    }));
    expect(again.asked).toBe(false);
    expect(again.reason).toBe("already_answered");
    expect(again.answer).toEqual({ selected_labels: ["小红书上的塔罗爱好者"], other_text: null });

    // Punctuation, case and spacing differences do not sneak a re-ask through.
    const reworded = await expectReply(resumed.handleToolCall("ask_user", {
      question: "  谁是你的第一批用户  ？ ",
      why_high_impact: "I really forgot.",
      options: [],
    }));
    expect(reworded.reason).toBe("already_answered");

    // A genuinely NEW question still gets through — the guard must not silence the plan.
    const fresh = await resumed.handleToolCall("ask_user", {
      question: "你的预算是多少？",
      why_high_impact: "Budget shapes the whole build.",
      options: [{ label: "Under 200", tradeoff: "tight" }, { label: "Over 200", tradeoff: "roomy" }],
    });
    expect(fresh.kind).toBe("pending_user");
    // And it counts against the pass's remaining budget, not a fresh one.
    expect(resumed.snapshot().questionsAsked).toBe(2);

    // Research from the earlier pass is part of this session's log, so it need not be redone.
    const finalPass = planningSessionDraftState(resumed.snapshot(), "codex", new Date("2026-07-26T10:00:00.000Z"), {
      resumedCount: 1,
    });
    expect(finalPass.research_findings).toEqual([{ summary: "Finding A", source_urls: ["https://a.example"] }]);
    expect(finalPass.research_gaps).toEqual(["pricing unknown"]);
    expect(finalPass.resumed_count).toBe(1);
  });

  it("bounds an oversized pass oldest-first and declares the trim", async () => {
    const { session } = makeSession({ memories: [] });
    for (let i = 0; i < 6; i += 1) {
      session.postUserMessage(`note ${i}`);
    }

    const { planningSessionDraftState } = await import("./planning-session");
    const bounded = planningSessionDraftState(session.snapshot(), "claude", new Date("2026-07-26T09:00:00.000Z"), {
      bounds: { maxTranscriptEntries: 2 },
    });
    expect(bounded.truncated).toBe(true);
    expect(bounded.transcript).toHaveLength(2);
    // The NEWEST turns survive — they are what a resumed pass needs most.
    expect(bounded.transcript.map((entry) => entry.text)).toEqual(["note 4", "note 5"]);

    // A byte budget too small for even one entry still leaves history behind, never nothing.
    const squeezed = planningSessionDraftState(session.snapshot(), "claude", new Date("2026-07-26T09:00:00.000Z"), {
      bounds: { maxSerializedBytes: 1 },
    });
    expect(squeezed.truncated).toBe(true);
    expect(squeezed.transcript).toHaveLength(1);

    // Within budget nothing is trimmed and the pass does not claim it was.
    const whole = planningSessionDraftState(session.snapshot(), "claude", new Date("2026-07-26T09:00:00.000Z"));
    expect(whole.truncated).toBe(false);
    expect(whole.transcript).toHaveLength(6);
  });

  it("every projected tool has a schema and matching definition lookup", () => {
    expect(PLANNING_SESSION_TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual([
      "ask_user",
      "search_memory",
      "report_research",
      "propose_memory",
      "submit_plan",
    ]);
    for (const tool of PLANNING_SESSION_TOOL_DEFINITIONS) {
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.inputSchema.type).toBe("object");
    }
    const submit = PLANNING_SESSION_TOOL_DEFINITIONS.find((tool) => tool.name === "submit_plan");
    const planSchema = (submit?.inputSchema.properties as Record<string, unknown>).plan as Record<string, unknown>;
    expect(planSchema.type).toBe("object");
  });
});
