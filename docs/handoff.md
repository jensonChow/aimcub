# Aimcub Handoff

Last updated: 2026-08-08
Branch: `main`, TWO local commits ahead of origin/main (`09b4bb2e` focus/cursor fix +
this session's follow-up sweep — **push NOT yet authorized for either**; everything
through `a220f5bf` was pushed under the 2026-08-02 authorizations). Ask before pushing;
destination protocol unchanged (`jensonChow/aimcub`, ADMIN, PRIVATE, default `main`).

## What shipped 2026-08-08: the same-class sweep

Founder: "check if there is any similar problem and solve it." Swept the whole app for
the 2026-08-06 class (UA defaults leaking through the surface) and fixed four more:

1. **Fields with no focus chrome at all.** The base halo used to be the only focus
   indicator for fields outside the `od-ui-*` primitives; removing it left them with
   nothing. A late `cockpit.css` fallback now gives EVERY text-entry control the accent
   hairline on `:focus-visible` (kept last in the file; wins over element-level rest
   rules by order, loses to component focus rules) — covers the proof form's textareas
   and the bare plan/context `<select>`s. Verified live: the "Current contract" select
   now shows the hairline on click where it previously haloed.
2. **The one inline-styled field.** WebResearchForm's key input was the app's only
   `style={inputStyle()}` field — inline styles block every stylesheet focus rule, so
   it could never show focus chrome. Migrated to `od-ui-input`; a guard bans the
   pattern from returning.
3. **UA rings on non-button focus targets.** The base `outline: 0` reset only covers
   buttons. The contract-card summaries ("Contract details" / routing / structure) and
   the error notice's summary had NO ring of their own → raw UA rectangle on keyboard
   focus; the acceptance-rule `pre[tabindex=0]` had the halo WITHOUT the reset → both
   painted. All now pair `outline: 0` with the sanctioned ring.
4. Confirmed non-issues, checked live or by cascade: `ContextSourcesPanel` inputs
   already use `od-ui-input`; scrollers with focusable children don't get Chromium's
   implicit keyboard focus; evidence URLs only exist in editable fields (nothing
   copyable was lost to `user-select: none`); the composer-details textarea keeps its
   own inset-ring focus (later in cascade than the halo carve-out).

Durable rules: two new bullets in design-system.md (the fallback contract + the
outline-reset pairing rule). Guards extended in App.test.tsx (rule presence AND the
fallback's position after the last field rest rule). Full gate green (desktop 411),
root `Aimcub.app` repacked + boot-smoked (graceful quit re-verified).

## What shipped 2026-08-06: web defaults stop leaking through the glass

Founder screenshot of the planning question card ("Plan a trip to Tokyo") + two symptoms,
one problem class — browser defaults reaching the product surface:

1. **"A weird blue shadow when I chose the input box."** Chromium grants every editable
   field `:focus-visible` on ANY focus — a pointer click included — so the 4px `--od-focus`
   keyboard halo fired on every click into a field (the base cockpit rule applied it to all
   `input/textarea/select`). Now a `:where()` carve-out strips the halo from text entry
   (checkbox-likes keep it; buttons/summaries never changed), and a field says "focused"
   with its own chrome: full-accent hairline + `--od-bg` fill + caret — the idiom the
   New-Aim headline and rename editor had already chosen individually while the base rule
   stomped them. The session chat composer's `:focus-within` follows. Two adjacent leaks
   fixed in the same class: the primitives' hover rule OUTRANKED focus, so a focused
   field's border flashed gray↔accent as the pointer crossed it (hover now excludes
   `:focus-visible`); and the arriving question's `tabindex="-1"` h2 caught the UA ring
   under keyboard modality (script-focused headings now carry no outline).
2. **"The cursor would always blink and flash."** The whole app had web-page pointer
   behavior: I-beam + text selection over every label and title, so the pointer flickered
   arrow↔I-beam constantly and a drag painted selection across chrome. New policy:
   `body { cursor: default; user-select: none }`; fields restored to `user-select: text`
   (UA text cursor survives; typing, caret, in-field drag/double-click selection all
   verified); `pre`/`code` stay selectable + I-beam — they are the app's static VALUES
   (workspace path, error details, rule code) per the static-semantics rule.

Durable rules + guards: two new bullets in `docs/memory/design-system.md` (Interaction
and State) and one App.test.tsx guard ("keeps web defaults off the desktop surface").
Harness gained a `?question` scenario (free-text pending question — the founder's exact
surface) in `renderer-harness-stub.js`.

**Verification:** full gate green (desktop 411 tests). Driven in the real renderer via
`pnpm desktop:harness` at `/?question` and `/?live`: real pointer click into the answer
field (accent hairline, no halo, border stable while hovered), h2 focus under keyboard
modality (no UA ring), static text arrow-cursor/unselectable, in-field selection intact,
note composer focus-within accent, light AND dark, `__harnessErrors` empty. Root
`Aimcub.app` repacked and boot-smoked under isolated `AIMCUB_HOME` (main + renderer
alive, clean quit).

## What shipped 2026-08-02 (afternoon): the desk stays clean

Two founder screenshots of the plan review, two global rules — both are token/rule-level
fixes, both recorded as durable rules in `docs/memory/design-system.md`:

1. **No scrollbar anywhere** ("no scroll bar at all in the whole app"). Global in
   `cockpit.css`: `* { scrollbar-width: none }` (layout never reserves a gutter) plus
   `::-webkit-scrollbar { display: none }` (no rail paints in any overlay mode). Scrolling
   itself is untouched. The old thumb styling, its `--od-scrollbar-thumb` token (all three
   theme blocks), and the now-inert `scrollbar-gutter` reservations are deleted; an
   App.test.tsx guard bans them from returning. Harness-verified on the exact surface: 78px
   of overflow, 0px of gutter, still scrolls (Layout Rules).
2. **Elevation hugs the card** ("unproper shadow which is not clean"). The band under the
   island was its own `--sh-lg` — `0 10px 28px` at 10% navy is a wide gray smudge under an
   820px card. Both surface-shadow tokens now carry a negative spread that pulls the
   silhouette inside the element (`--sh-lg: 0 16px 36px -16px`, `--sh-md: 0 6px 16px -8px`,
   dark alphas retuned to match), so only soft falloff escapes. A/B'd live in the harness
   before baking, then re-verified from source in light AND dark on the exact founder crop
   (island bottom + JOURNAL). A glassTokens.test.ts guard asserts the negative-spread shape
   in all three theme blocks — values may be retuned, the hug must stay (Radius, Borders,
   and Elevation). Overrides the imported reference values, like the AA contrast decision.
3. **Typography/layout pass on the planning card + Journey header** (founder screenshot of
   his real paused pass: 优化排版布局 — font, size, weight, layout, alignment). Four fixes,
   all system-level: (a) head pills CLUSTER right — the title owns the head's free space
   (`flex: 1 1 auto`); `space-between` had floated "Plan ready" detached mid-card; heads
   that carry a sub-line (ready/failed states) now stack instead of rowing. (b) Trace rows
   meta → sub: on a stopped pass the trace is the card's content, and zh question text at
   11.5px was squint material; the current row still steps to body, the receipt stays meta.
   (c) The document now says its real language — `I18nProvider` stamps
   `document.documentElement.lang` (index.html's `lang="en"` was permanent before) — which
   enables (d) `:root:lang(zh) { --od-font-weight-semibold: 500 }`: the ramp's "Chinese
   reads better at 500" note made structural; verified live (title weight 600 → 500 on
   switching the document to zh). Journey subtitle also moved meta → sub per the ramp's
   role table. Guards in App.test.tsx; durable rules in design-system.md (Typography + the
   live-card contract).
4. **Same pass on the plan-review surface** (founder's follow-up screenshot: Execution
   contracts). Root find: bare `h2`/`strong` fell back to UA-700 — a weight the ramp
   reserves for brand/caps marks — so "Execution contracts" and the stat values shipped
   heavier than every deliberate title in the app. New BASE rules pin `h1–h4` to semibold
   and `strong`/`b` to the strong token (class rules still win; the zh relax flows
   through). On the contract card: field labels semibold → medium (kickers had the
   title's volume), label/value rows share a baseline, stat values get tabular-nums, and
   the three `<details>` summaries ("Contract details" etc.) get a quiet caret — a
   disclosure with no affordance read as a dead label. All measured from source in the
   harness (h2/stat 700 → 600, labels 500, baseline, caret transform). Guards in
   App.test.tsx; rules in design-system.md (Typography + the contract-card bullet).

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
