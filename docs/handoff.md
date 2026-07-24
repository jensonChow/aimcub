# Aimcub Handoff

Last updated: 2026-07-24
Branch: `main`, 8 commits ahead of `origin/main` (push NOT yet authorized this
session). **Planning-agent epic: all four stages MERGED and verified.** The aim
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

## Open items

1. **Founder: `claude /login`.** The standalone CLI on this machine is not
   authenticated (`loggedIn: false`), so a full model-driven session (real
   research → questions → submitted plan) has NOT been observed live. The
   mechanical layer (spawn, bridge handshake config, timeouts, honest
   failures) is live-verified; protocol + engine are covered by SDK-client
   tests acting as the brain. First real run after login is the next smoke.
2. Codex planning adapter (needs its MCP/stream posture verified) — follow-up.
3. Desktop chat while a question is parked reaches the brain right after the
   answer (stream queue) — acceptable; revisit if users expect instant reads.
4. Renderer keeps a local mirror of the capability gate (cannot import
   local-agent values into the renderer bundle) — keep in sync.
5. Push to origin pending founder authorization (8 commits ahead).

## Next session

Run the first authenticated end-to-end session (Desktop + `aimcub plan`),
then judge question quality/research depth against the founder's blueprint
(local+web research · temporary chat · multi-choice). The prior OSS-launch
checklist in git history (license → npm org → repo settings → gitleaks →
public flip) still stands, unchanged by this epic.
