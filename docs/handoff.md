# Aimcub Handoff

Last updated: 2026-07-24
Branch: `main`, 10 commits ahead of `origin/main` (push NOT yet authorized this
session). **Planning-agent epic: all four stages MERGED and verified, plus the
Codex brain — and the FIRST LIVE model-driven end-to-end session succeeded on
the founder's ChatGPT subscription (gpt-5.5).** The aim
research/breakdown engine changed shape: from a fixed collector funnel to an
embedded planning-agent session (the local agent as the aim-breaking brain).

## What merged (four stage branches, in order)

1. `c20a3b71` **planning-session-protocol** — pure session layer in
   `@aimcub/llm`: phase machine, five projected tools (`ask_user`,
   `search_memory`, `report_research`, `propose_memory`, `submit_plan`),
   temporary-chat queue (exactly-once delivery), finish_now, submit/repair
   with one quality bounce + best-candidate acceptance, honest `finalize()`.
   `DECOMPOSITION_PLAN_RULES` shared verbatim with the funnel prompt.
2. `7bb76f8b` **embedded-planning-brain** — `packages/local-agent/planning/`:
   per-session loopback MCP bridge (bearer token; parked ask_user = held
   tool response; connection-loss auto-skip; drain-then-close teardown) +
   embedded session engine (bidirectional stream-json, chat injection,
   waiting_user pauses the active clock, idle-grace stdin close). Claude
   adapter implements planning invocations; Codex declines → funnel.
   Three live-only bugs found by real-CLI smokes and fixed: giant
   `MCP_TIMEOUT` (startup gate) caused silent hangs; dead `MultiEdit` tool
   name; stream-json runtimes never exit on their own.
3. `46548c8b` **desktop-live-planning** — "Build the plan" runs the embedded
   session when an authenticated Claude CLI exists (funnel = automatic
   fallback). Context stage mounts the live surface through the existing
   focused-panel slot; questions render through `ContextClarifyPanel`
   unchanged; landing mirrors `refinePlan` and commits through
   `commitShellPlan`; `metadata.planning_session` + pending `agent_inferred`
   candidates recorded at `updateGoalPlan`; sessions survive navigation and
   die at `before-quit`. Store carries `planning_session` through draft
   upserts (clobber regression-tested).
4. (this branch) **cli-plan-session** — `aimcub plan` runs the same session
   in the terminal: streamed activity, inline numbered questions, temporary
   chat lines, `/finish`, `/cancel`; non-TTY runs get a zero-question budget;
   `--network` grants the brain's web tools (mirrors `aimcub run`);
   `--funnel` forces the old path; explicit `--agent` never silently falls
   back. `planningCapableAgentId` is the shared registry-aware gate.

## Verification

- Full gate green after every stage: build 9/9 · typecheck 17/17 · lint 11/11
  · purity clean · tests: llm 195, local-agent 42, cli 112, desktop 367,
  store 96 (+ unchanged others).
- Root `Aimcub.app` repacked + boot-smoked after stages 3 and 4.
- Live CLI smokes: spawn shape + MCP config registration verified against
  claude 2.1.191; honest failure paths verified end-to-end.

## Codex brain + live verification (post-epic, same day)

5. **codex-planning-brain** — Codex (ChatGPT login) is now a planning brain:
   `exec --json --sandbox read-only`, streamable-HTTP MCP with the session
   token as a `token` query param (codex MCP configs cannot set headers),
   `tool_timeout_sec` raised for parked questions, one-shot stdin (engine
   closes the pipe after the prompt for non-stream runtimes; chat rides tool
   replies). `preferredPlanningModel` falls back to the first LIVE-advertised
   model when the caller names none — the founder's codex default pointed at
   a server-gated model (`gpt-5.6-sol` → 400) that its installed CLI cannot
   drive; live lists are the truth, fallback catalogs are not. `aimcub plan`
   gained `--model`/`--reasoning`.
6. **LIVE END-TO-END VERIFIED (2026-07-24)**, twice on gpt-5.5:
   engine-level with a blocking question (research → parked ask_user →
   answer → quality bounce → repaired accept, 181s, warn 90/100) and via the
   real `aimcub plan` binary non-interactively (0 questions by budget →
   disclosed assumptions + open questions, bounce → accept). Honest gaps
   named exactly what web-disabled research could not verify.

## Open items

1. **Founder: `claude /login`** — the Claude brain path is still only
   mechanically live-verified (CLI not authenticated); the Codex path is
   fully live-verified. First Claude-brain run after login is the remaining
   smoke.
3. Desktop chat while a question is parked reaches the brain right after the
   answer (stream queue) — acceptable; revisit if users expect instant reads.
4. Renderer keeps a local mirror of the capability gate (cannot import
   local-agent values into the renderer bundle) — keep in sync.
5. Push to origin pending founder authorization (8 commits ahead).

## Next session

Run the first authenticated end-to-end session (Desktop + `aimcub plan`),
then judge question quality/research depth against the founder's blueprint
(local+web research · temporary chat · multi-choice). Judge question quality and research depth against the blueprint
(try `--network` for live web research). Desktop Settings surface for the
planning brain's model/effort is a proposed follow-up. The prior OSS-launch
checklist in git history (license → npm org → repo settings → gitleaks →
public flip) still stands, unchanged by this epic.
