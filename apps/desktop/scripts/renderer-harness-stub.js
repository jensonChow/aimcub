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

  // Scenario flags, so a reload can pick a state: ?nopass, ?planready, ?live.
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
  const progress = {
    goal,
    milestones: [],
    actors: [],
    assignments: [],
    runs: [],
    sub_aim_relations: [],
    context_candidates: [],
    completion_recap: null,
    completed_milestones: 0,
    total_milestones: 0,
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

  let passLive = !flags.has("nopass");

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
    getAimProgress: () => progress,

    listGoals: () => [goal],
    listAimDrafts: () => [],
    listMemories: () => [],
    getAimJournal: () => [],
    getStoreDiagnostics: () => [],
    getAppInfo: () => ({ version: "0.0.0-harness", workspacePath: "~/.aimcub" }),
    listAimProgressSummaries: () => [{ goal_id: GOAL_ID, total: 0, completed: 0, blocked: 0, running: 0, status: "planning" }],

    getPlanningSessionState: () => (flags.has("live") ? liveSession : null),
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
