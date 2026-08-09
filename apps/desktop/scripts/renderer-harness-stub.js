/**
 * Bridge stub for the renderer harness (`pnpm desktop:harness`).
 *
 * Loaded BEFORE the renderer bundle, so `window.aimcub` exists by the time React mounts. Every
 * call is recorded and answered from the fixture table below; the real main process is not involved.
 *
 * WHY this exists: the unit suite cannot see pointer targets, CSS layering, or navigation state.
 * Every founder-reported Desktop bug so far (delete silently dead, planning restarting on
 * re-entry, the paused-pass lane) was invisible to a fully green run. See docs/memory/operations.md.
 *
 * EXPECT TO EDIT THIS FILE. The fixtures cover a plan-less aim with a stopped planning pass —
 * enough to mount the shell and the Journey. Whatever surface you are verifying, add its fixture
 * and, if it needs a distinct state, a scenario flag. Do not try to reimplement main here.
 *
 * This is the repo's only plain-JS file that runs in a PAGE rather than in Node, so its globals are
 * declared here instead of through the shared lint config.
 */
/* global window, location, URLSearchParams */
(() => {
  // First, before anything can throw: a render failure otherwise shows only as a blank page with
  // no console history, which costs an hour of guessing.
  window.__harnessErrors = [];
  window.addEventListener("error", (event) => {
    window.__harnessErrors.push(`${event.message} @ ${event.filename}:${event.lineno}`);
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    window.__harnessErrors.push(`rejection: ${String((reason && reason.stack) || reason)}`);
  });

  /** Every bridge call, in order: `[{ name, args }]`. Assert against this after clicking. */
  const calls = [];
  window.__harnessCalls = calls;

  // Scenario flags: ?nopass, ?planready, ?live, ?question, ?inbox, ?parallel.
  const flags = new URLSearchParams(location.search);
  window.__harnessFlags = Object.fromEntries([...flags.keys()].map((key) => [key, true]));

  const GOAL_ID = "82e331b1-4ed7-47f5-9a1b-18dd098d265a";
  const OWNER = "00000000-0000-4000-8000-000000000001";

  const goal = {
    id: GOAL_ID,
    owner_id: OWNER,
    title: "Ship an AI tarot product",
    description: "",
    domain: null,
    status: "active",
    target_date: null,
    plan_json: null,
    metadata: {},
    created_at: "2026-07-25T14:03:09.714Z",
  };

  /**
   * A FULL `AimProgressReadModel`. Every array matters: a partial object crashes the Journey on
   * `progress.runs.some(...)`, which surfaces only as a blank page.
   */
  /**
   * `?parallel`: a DIAMOND plan — a finished root, two independent branches ready at the same
   * time, and a join that waits for both. The shape the product could not express before.
   */
  const MS = (n) => `00000000-0000-4000-8000-0000000000${n}`;
  function planRow(input) {
    return {
      milestone: {
        id: input.id,
        goal_id: GOAL_ID,
        owner_id: OWNER,
        title: input.title,
        description: "",
        status: input.completed ? "completed" : "pending",
        order_index: input.order,
        depends_on_ids: input.dependsOn ?? [],
        acceptance_rule: { logic: "all", threshold: 1, completion_mode: "manual", clauses: [] },
        xp_reward: 10,
        completed_at: null,
        metadata: {},
      },
      assignment: {
        id: `a-${input.id}`, owner_id: OWNER, goal_id: GOAL_ID, milestone_id: input.id,
        actor_kind: input.human ? "human" : "agent", actor_id: null,
        status: "assigned", source: "routing", reason: "", capability_tags: [],
      },
      latest_run: null,
      child_relations: [],
      eval_review: { passed: Boolean(input.completed), matched_evidence_ids: [], trust_score: 0, reason: "", next_action: "" },
      evaluator_results: [],
      evidence: [],
      evidence_count: 0,
      completed: Boolean(input.completed),
      blocked: false,
      ready: (input.waitingOn ?? []).length === 0,
      waiting_on: input.waitingOn ?? [],
      next_action: "",
    };
  }
  const parallelMilestones = [
    planRow({ id: MS("c1"), title: "Agree the comparison criteria", order: 0, completed: true }),
    planRow({ id: MS("c2"), title: "Survey Cursor Router", order: 1, dependsOn: [MS("c1")] }),
    planRow({ id: MS("c3"), title: "Survey Not Diamond Code", order: 2, dependsOn: [MS("c1")] }),
    planRow({
      id: MS("c4"),
      title: "Write the comparison matrix",
      order: 3,
      human: true,
      dependsOn: [MS("c2"), MS("c3")],
      waitingOn: [MS("c2"), MS("c3")],
    }),
  ];

  const progress = {
    goal,
    milestones: flags.has("parallel") ? parallelMilestones : [],
    actors: [],
    assignments: [],
    runs: [],
    sub_aim_relations: [],
    context_candidates: [],
    completion_recap: null,
    completed_milestones: flags.has("parallel") ? 1 : 0,
    total_milestones: flags.has("parallel") ? 4 : 0,
    blocked_count: 0,
    next_action: "Aim is complete.",
  };

  /** A planning pass that stopped when the app closed (`?nopass` removes it). */
  const pass = {
    goalId: GOAL_ID,
    agentId: "codex",
    model: "gpt-5.6-sol",
    phase: "waiting_user",
    stoppedReason: "app_quit",
    resumedCount: 0,
    startedAt: "2026-07-25T14:03:09.714Z",
    updatedAt: "2026-07-25T14:31:00.000Z",
    truncated: false,
    questionsAsked: 2,
    researchFindingCount: 12,
    researchGapCount: 2,
    transcript: [
      { at: "2026-07-25T14:04:00.000Z", kind: "research", findings: [{ summary: "a" }, { summary: "b" }], gaps: ["no web key"] },
      { at: "2026-07-25T14:06:00.000Z", kind: "question", question: { id: "q1", question: "Who are your first users?" } },
      { at: "2026-07-25T14:12:00.000Z", kind: "answer", request_id: "q1", answer: { selected_labels: ["Tarot hobbyists"], other_text: null } },
      { at: "2026-07-25T14:26:00.000Z", kind: "user_message", text: "iOS first, no web app", delivered: true },
    ],
    landing: null,
  };

  /** A session with a brain still working on it (`?live`), mid-trace. */
  let liveSession = {
    goalId: GOAL_ID,
    agentId: "codex",
    model: "gpt-5.6-sol",
    active: true,
    phase: "researching",
    pendingQuestion: null,
    questionsAsked: 1,
    researchFindingCount: 5,
    researchGapCount: 1,
    activity: [
      { at: "2026-07-26T08:04:00.000Z", kind: "status", code: "started", label: "" },
      { at: "2026-07-26T08:06:00.000Z", kind: "research", label: "", count: 5 },
      { at: "2026-07-26T08:08:00.000Z", kind: "tool", label: "", tool: "web.search" },
    ],
    landing: null,
    failure: null,
  };

  /** `?inbox`: pending context candidates on the Journey (mirrors the founder's 2026-08-09
      screenshot — planning assumptions turned into project-fact candidates). Accept/reject
      mutate the list so the refresh loop can be exercised for real. */
  const candidateStatements = [
    "核心研究对象 (优先 Cursor Router、Not Diamond Code、Weave Router、Tokenless、Conifer 与 ACRouter；TwinRouterBench 作为评测框架。)",
    "实验范围 (48 小时内不把新跑完整付费 benchmark 设为必需项，依赖一手公开证据、动态页复核和严格缺口标注。)",
    "报告语言 (正文中文，术语与产品名保留英文原文。)",
    "评测口径 (对每个 router 记录路由策略、支持模型池、定价与已公开的质量信号。)",
    "交付格式 (一份对比矩阵加一页结论摘要，Markdown。)",
  ];
  let contextCandidates = !flags.has("inbox") ? [] : candidateStatements.map((statement, index) => ({
    id: `c0000000-0000-4000-8000-00000000000${index + 1}`,
    owner_id: OWNER,
    goal_id: GOAL_ID,
    kind: "semantic",
    category: "project_fact",
    content: `Project fact: Planning assumption for "我想要研究coding agent related router": ${statement}`,
    confidence: 0.65,
    source: "agent_inferred",
    status: "pending",
    superseded_by: null,
    created_at: "2026-08-09T08:00:00.000Z",
  }));

  /** `?question`: the brain is blocked on a free-text question (the focused answer surface). */
  const pendingQuestion = {
    id: "q-travel-window",
    question: "What is your intended Tokyo travel window—exact departure/return dates if known, or the month/season plus approximate trip length?",
    kind: "context",
    why_high_impact: "Dates and duration determine seasonal risks, booking deadlines, opening calendars, and how many geographic areas fit without overpacking the itinerary.",
    allow_other: true,
    selection_mode: "single",
    selection_mode_reason: "default",
    capture_scope: "current_aim",
    options: [],
  };

  let passLive = !flags.has("nopass") && !flags.has("parallel");

  function currentPass() {
    if (!passLive) return null;
    if (!flags.has("planready")) return pass;
    // `?planready`: the pass finished a plan before stopping, so it can be adopted as-is.
    return { ...pass, phase: "draft_ready", landing: { plan: PLAN, quality: null, review: null, questions: [], answers: [], assumptions: [] } };
  }

  /** A structurally valid plan — `validateExecutablePlan` rejects a sloppier one, which reads as a bug. */
  const PLAN = {
    goal_summary: "Ship an AI tarot product.",
    domain: "software",
    rationale: "Prove the reading loop, then prove it holds in CI.",
    nodes: [
      {
        key: "m1",
        title: "Implement the reading loop",
        description: "Draw, interpret, and record a reading end to end.",
        est_effort: "m",
        xp_reward: 30,
        decomposition_contract: {
          why: "The loop needs a separately verifiable implementation step before tests can prove it.",
          definition_of_done: "A reading can be drawn and interpreted end to end.",
          required_evidence: ["A commit touching the reading path."],
          likely_owner: "agent",
          context_gaps: [],
          eval_signal: "The milestone is done when a reading round-trips.",
        },
        acceptance_rule: {
          logic: "all",
          clauses: [{ evaluator: "commit_pattern", auto_verifiable: true, match: { path_glob: "packages/**", min_files: 1, message_pattern: "reading" } }],
          threshold: 1,
          completion_mode: "auto_then_confirm",
        },
        routing_override: null,
      },
      {
        key: "m2",
        title: "Green CI for the reading loop",
        description: "The reading test workflow passes on main.",
        est_effort: "s",
        xp_reward: 15,
        decomposition_contract: {
          why: "The implementation needs a dependent verification milestone so passing tests cannot be skipped.",
          definition_of_done: "The reading test workflow succeeds.",
          required_evidence: ["A successful CI status for the reading tests."],
          likely_owner: "agent",
          context_gaps: [],
          eval_signal: "The milestone is done when CI proves the loop still works.",
        },
        acceptance_rule: {
          logic: "all",
          clauses: [{ evaluator: "ci_status", auto_verifiable: true, match: { workflow: "test", conclusion: "success" } }],
          threshold: 1,
          completion_mode: "auto",
        },
        routing_override: null,
      },
    ],
    edges: [{ from: "m1", to: "m2" }],
  };

  /**
   * Fixtures. The first block is load-bearing: without any one of these the app renders NOTHING,
   * because the shell reads them before it can paint.
   */
  const answers = {
    getWindowChromeState: () => ({ fullscreen: false, colorScheme: "light" }),
    getProviderConfig: () => ({ configured: false, provider: null, baseURL: null, model: null, hasApiKey: false }),
    getWebResearchConfig: () => ({ configured: false, provider: "brave", enabled: false, fetchPages: false, hasApiKey: false, keySource: null }),
    getContextSourceConfig: () => ({
      version: 1,
      local: { enabled: false, filePaths: [], configured: false, source: null, resolvedWorkspaceRoot: null, resolvedFilePaths: [] },
      online: { enabled: false, sources: [], configuredCount: 0, enabledCount: 0 },
      research: { webEnabled: false, deepResearch: false },
      session: { enabled: false },
      questions: { choiceQuestions: true },
    }),
    getDesktopPreferences: () => ({ planningBrain: "codex", planningModel: null, developerMode: false }),
    listLocalAgents: () => [{
      id: "codex", name: "Codex CLI", runMode: "local_cli", available: true, path: "/bin/codex",
      version: "0.145.0", authStatus: "ok", authMessage: null, planningCapable: true,
      models: [{ id: "gpt-5.6-sol", label: "gpt-5.6-sol" }], modelsSource: "live",
      reasoningOptions: [], diagnostics: [],
    }],
    getGoal: () => ({ goal, milestones: [] }),
    getAimProgress: () => ({ ...progress, context_candidates: contextCandidates }),
    acceptContextCandidate: (req) => {
      contextCandidates = contextCandidates.filter((row) => row.id !== req.id);
    },
    rejectContextCandidate: (id) => {
      contextCandidates = contextCandidates.filter((row) => row.id !== id);
    },

    listGoals: () => [goal],
    listAimDrafts: () => [],
    listMemories: () => [],
    getAimJournal: () => [],
    getStoreDiagnostics: () => [],
    getAppInfo: () => ({ version: "0.0.0-harness", workspacePath: "~/.aimcub" }),
    listAimProgressSummaries: () => [{ goal_id: GOAL_ID, total: 0, completed: 0, blocked: 0, running: 0, status: "planning" }],

    getPlanningSessionState: () => {
      if (flags.has("question")) return { ...liveSession, phase: "waiting_user", pendingQuestion };
      return flags.has("live") ? liveSession : null;
    },
    getPlanningPass: () => currentPass(),
    discardPlanningPass: () => {
      passLive = false;
    },
    startPlanningSession: () => {
      // No brain to spawn in a harness; the renderer's fallback path is what gets exercised.
      throw new Error("harness: no planning brain");
    },
    // `?live` drives the running card: the note lane, the attach control, the thought trace.
    pickLocalContextFiles: () => ({ canceled: false, paths: ["/Users/harness/notes/pricing.md"] }),
    attachPlanningFiles: () => {
      liveSession = {
        ...liveSession,
        activity: [
          ...liveSession.activity,
          { at: "2026-07-26T08:12:00.000Z", kind: "status", code: "files_attached", label: "pricing.md", count: 1 },
        ],
      };
      return liveSession;
    },
  };

  /**
   * Anything unlisted answers `null` rather than throwing: the harness exists to exercise one
   * surface, and an unrelated call must not blank the page. If a surface misbehaves, check
   * `window.__harnessErrors` first — a missing fixture usually shows up there.
   */
  window.aimcub = new Proxy({}, {
    get(_target, prop) {
      if (prop === "then") return undefined;
      const name = String(prop);
      // Push-event subscriptions: return an unsubscribe function, as the real preload does.
      if (name.startsWith("on")) return () => () => undefined;
      return async (...args) => {
        calls.push({ name, args });
        const answer = answers[name];
        return typeof answer === "function" ? answer(...args) : null;
      };
    },
  });
})();
