# Aimcub Handoff

Last updated: 2026-08-02
Branch: `main`, **PUSHED to origin/main through `44477185`** plus this docs commit
(founder authorized 2026-08-02: "refresh memory, push, merge"). Destination re-verified
per the push protocol before pushing: `jensonChow/aimcub`, ADMIN, PRIVATE, default
branch `main`, and `origin` matches. No merge was needed — all remote branches
(`codex/*`, `v0-foundation`) are 0 commits ahead of `main`.

## What shipped after that (2026-07-26): the planning lane reads honestly

Two founder observations on the live planning card, from one screenshot.

1. **`df304e49` — a finished step reads as finished.** "Reading the aim and your context"
   sat under a grey, finished tick while the brain had long moved on. Tense is now derived
   from the row's POSITION rather than baked into each string: only the last row of a live
   trace speaks in progress, a tool line refuses to render as history at all, and a stopped
   pass gets no current row. Rules in `docs/memory/desktop.md`.
2. **`44477185` — the user can hand files to a running brain.** Founder asked whether a
   step for adding local attachments was missing. It was. The capability existed end-to-end
   but the only way in was Settings → Research → Manage sources: global, shared by every aim,
   never offered at the moment you want it. "Attach files" now sits beside "Add a note" on the
   live card (his chosen placement); the global list stays as a standing default that per-aim
   attachments add to (also his call). The hard part was that the brain's file sandbox is fixed
   at SPAWN, so a mid-pass attachment cannot work by naming a path — each session now stages
   into an empty directory granted before spawn, and a resumed pass re-stages from the original
   paths recorded on it.

## What shipped earlier (2026-07-26): planning passes are durable

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

It gained a `?live` scenario for the RUNNING planning card, which is what verified both
items above: `http://127.0.0.1:5599/?live` showed the trace reading "Read the aim and your
context / Recorded 5 research findings / Searching the web", and a real click on "Attach
files" drove `pickLocalContextFiles` → `attachPlanningFiles` → "You attached pricing.md"
with `window.__harnessErrors` empty.

## Open items

1. **NOT VERIFIED LIVE: a real brain actually READING an attachment.** Staging, granting,
   re-staging and every failure path are unit-tested, and the gesture is verified in the
   real renderer — but no live brain has been handed a file and observed reading it. Fold
   this into the resume drive below: attach a file mid-pass, watch the trace, then quit and
   resume and confirm it still has it.
2. **NOT VERIFIED LIVE: a real brain continuing a real pass.** Everything above is unit-
   and renderer-verified; the resume arg forms were checked against the installed CLIs
   (including how a stale thread id fails), but no real planning run has been quit and
   resumed end-to-end. This is the founder's next drive: create an aim → quit mid-
   planning → reopen → Resume → confirm nothing already answered is asked again.
3. Two commit messages (`e7da6a63`, `1054f694`) quote Chinese, which the English-only
   non-negotiable covers. Now pushed, so a rewrite is no longer free — founder's call
   whether to leave them.
4. Founder `claude /login` → first Claude-brain live smoke (Codex is the live-verified path).
5. Settings → Brain effort/reasoning control (proposed follow-up).
6. Online linked-source connectors actually reading content.
7. `docs/local-agent-adapters.md` predates planning sessions entirely — it documents
   `buildInvocation`/`parseLine` but not the optional `buildPlanningSessionInvocation`
   capability or its new `resumeSessionId`. A third-party adapter author would not know
   the planning path exists. Worth a section before the OSS flip.
8. OSS launch checklist (license → npm org → repo settings → gitleaks → public flip) —
   founder-owned, unchanged.
