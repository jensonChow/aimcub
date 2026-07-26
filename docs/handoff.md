# Aimcub Handoff

Last updated: 2026-07-26
Branch: `main`, committed locally, **NOT pushed** (push not authorized this session).
Previous state (2026-07-25 arc) is on origin at `7e50a898`'s parent line; the four
commits below are local-only.

## What shipped (2026-07-26): planning passes are durable

Founder report: an aim Aimcub had been planning greeted him the next day with
"Your move — start planning". The button was honest — the aim really had no plan, no
memories, no draft. The bug was underneath: the whole planning session lived in a
main-process Map, so quitting killed the brain and erased its research, its questions
and the founder's answers. A memory hole in the core loop, not a button bug.

Durable rules from all of it now live in `docs/memory/architecture.md`,
`desktop.md`, and `design-system.md` — this handoff keeps only transfer state.

1. **`c46513ee` — the pass becomes durable state.** `planningSessionDraftState` always
   could serialize any phase; it was only ever called at `draft_ready` and parked in
   memory. Now it is checkpointed to `Goal.metadata.planning_session` as the pass runs
   (coalesced ~1.5s, hard boundaries flush at once), and `before-quit` defers the quit
   once to checkpoint every live pass as `app_quit` BEFORE killing brains.
2. **`7e50a898` — a returning aim shows its paused pass.** New `PlanningPassPanel` lane
   with tested precedence (live session > checkpoint > start card; a planned aim ignores
   both). Found + fixed en route: a `draft_ready` pass did not persist the PLAN, so
   quitting one click before adopting still lost it; and `commitShellPlan` sourced Q&A
   only from a live session, so adopting a restored plan would have landed stripped of
   its interview.
3. **`e7da6a63` — resume continues the pass.** Runtime thread reopened (Claude
   `--resume`, Codex `exec resume`, with the read-only policy re-expressed as
   `-c sandbox_mode` because that subcommand rejects `--sandbox`), plus the pass's own
   history carried into the session machine. `ask_user` now REFUSES an already-answered
   question and hands the answer back — a guarantee, not a prompt instruction.
4. **`1054f694` — planning passes leave Journal receipts.** Derived from the pass, no
   new event table. The Journal's "every pass leaves a receipt" is now true for planning.

## Verification

Full gate green after every batch (build 9/9 · typecheck 17/17 · lint 11/11 · purity ·
desktop 382 · llm 204 · local-agent 48 · store 102 · core 191). Root `Aimcub.app`
repacked and boot-smoked under an isolated `AIMCUB_HOME` after each batch; because quit
is now deferred for the checkpoint, graceful quit was explicitly re-verified each time.

**Method:** UI behavior was driven in a browser against the real renderer bundle with a
Proxy-stubbed `window.aimcub` — clicking through paused pass, plan-ready pass (Review →
Adopt, asserting the interview reached `updateGoalPlan`), no-pass, Plan-from-scratch, and
opening the Journal disclosure to read its rows. Keep doing this: a green suite is not
evidence a gesture works.

That harness is now COMMITTED (`a7fc0e64`) instead of rebuilt from a scratchpad every
session: `pnpm build && pnpm desktop:harness`. Usage, the debugging entry points, and the
fixtures that are load-bearing are in `docs/memory/operations.md`.

## Open items

1. **NOT VERIFIED LIVE: a real brain continuing a real pass.** Everything above is unit-
   and renderer-verified; the resume arg forms were checked against the installed CLIs
   (including how a stale thread id fails), but no real planning run has been quit and
   resumed end-to-end. This is the founder's next drive: create an aim → quit mid-
   planning → reopen → Resume → confirm nothing already answered is asked again.
2. Push authorization for the four commits above.
3. Founder `claude /login` → first Claude-brain live smoke (Codex is the live-verified path).
4. Settings → Brain effort/reasoning control (proposed follow-up).
5. Online linked-source connectors actually reading content.
6. OSS launch checklist (license → npm org → repo settings → gitleaks → public flip) —
   founder-owned, unchanged.
