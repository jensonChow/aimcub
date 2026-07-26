# Aimcub Handoff

Last updated: 2026-07-25
Branch: `main`, **PUSHED to origin** (founder authorized; destination
jensonChow/aimcub; repo still PRIVATE). No unmerged branches.

## What shipped (2026-07-25)

Two sessions, one arc: the founder drove real aims on the collapsed Journey and
every report became a fix. Durable rules from all of it now live in
`docs/memory/design-system.md`, `desktop.md`, and `architecture.md` — this
handoff keeps only the transfer state.

1. **The UI collapse ("agent + plan")** — the Journey is the ONE work surface
   per aim. Stations, station sheets, Turns, the standalone stage pages, and
   Cmd+1..5 are deleted. What must not come back: design-system.md + desktop.md.
2. **Planning-lane clarity** — main emits structured activity only; the
   renderer owns every displayed word.
3. **Delete aim** — sidebar rows get menu-gated delete with inline confirm…
   which then silently did nothing: `.od-aim-card:active`'s pressed-scale
   created a stacking context that trapped the popover under the next row, so
   the sibling stole the pointerup. Pressed-scale is now suspended while a row's
   menu is open.
4. **Planning grounded** — aims were all silently stamped `domain: "software"`,
   which misled research. Domain is honest-only now (nullable; plan landing is
   the only writer). The mission prompt sorts unknowns by where the answer
   lives: world facts = research, personal facts = ask (2-4 opening questions
   for personal-life aims).
5. **Planning surfaces** — integrated composer, honest question dress ("Send
   answer", no 1/1 counter, no mode pill without options), card-in-card
   flattened, choice cards equalized.
6. **The live card thinks out loud** — the thought trace replaced the single
   "Researching" line (timeline nodes, durable-events-only history, transient
   verbs live only as the current line), and the standing input box became an
   on-demand "Add a note" lane.
7. **Re-entry re-attaches, never restarts** — attachment is now derived from
   the aim on screen, not a start-time flag. Verified 0 `startPlanningSession`
   calls across first entry, Home→back, and same-aim re-tap.

## Verification

Full gate green after every batch (build 9/9 · typecheck 17/17 · lint 11/11 ·
purity · desktop 358 · llm 197 · store 99 · core 191). Root `Aimcub.app`
repacked + boot-smoked after each batch with isolated `AIMCUB_HOME` (the real
`~/.aimcub` was only ever read).

**Method worth keeping:** UI behavior was verified by mounting the real
renderer in a browser against a Proxy-stubbed `window.aimcub` and clicking
through for real. Every bug this session (delete, restart) was invisible to the
353-test suite because nothing exercised a live pointer. When a change touches
CSS layering, pointer targets, or navigation state, drive it — a green gate is
not evidence the gesture works.

## Open items

1. **Founder drives one real aim end-to-end** (create → answer → adopt →
   run/proof → receipts) and flags what still feels heavy. Candidate
   follow-ups only if flagged: Settings pane merge, Memory palette entry,
   renaming `stages/execute|eval` dirs, archive-with-restore.
2. Founder `claude /login` → first Claude-brain live smoke (Codex is the
   live-verified path).
3. Settings → Brain effort/reasoning control (proposed follow-up).
4. Online linked-source connectors actually reading content.
5. OSS launch checklist (license → npm org → repo settings → gitleaks →
   public flip) — founder-owned, unchanged.
