# Aimcub Handoff

Last updated: 2026-07-11
Branch: `glass-redesign` (feature branch off `main`)

## Current Session

- Request: import the founder's `Aimcub Glass.dc.html` design (via the DesignSync MCP)
  and implement it as a **full "Journey" desktop redesign** (chosen scope: full rebuild).
- Glass = a glassmorphism visual system (gradient "desktop", translucent blurred islands,
  soft shadows, pill chips, light+dark tokens) **plus** a new information architecture: a
  6-station Journey strip (Aim · Research · Context · Plan · Run · Eval), a "Your move" card,
  an "Ambient" card, a "Turns" roster, a "Journal" receipt timeline with a station-sheet
  modal, Memory promoted to a top-level page, and reworked Home / New / Settings.
- This is an authorized change of direction that supersedes much of the current locked
  `docs/memory/design-system.md`; that file must be rewritten to the Glass system in Stage E.
- Approved plan: `~/.claude/plans/giggly-herding-pine.md`. Reference design imported to a
  session tool-result file (`Aimcub Glass.dc.html` source).

## Completed Work (this session)

- **Stage 0 — tokens + pure helpers** (commit `f245cbc9`). Added the Glass token set
  (`--desk/--island/--ink/--acc/--sh-*/...`) additively to all three `cockpit.css` theme
  blocks without repointing any `--od-*` value (a guard test keeps the two hand-duplicated
  dark blocks in sync). Added pure, unit-tested Journey derivations under
  `apps/desktop/src/renderer/workflow/journey/` (`stationModel`, `yourMove`/ambient,
  `turnsRoster`, `journal`, `stationSheet`), each derived from the existing
  `AimProgressReadModel` and reusing `executePrimaryAction`. Added the `glass.*` i18n keys
  (en + zh) the helpers reference.
- **Stage A — Glass shell containers** (commit `3905c691`). `.od-window` now paints the
  `--desk` gradient; `.od-app`/`.od-main` go transparent; `.od-sidebar` is a translucent,
  backdrop-blurred island. Scoped to container surfaces only (none test-pinned), so the
  tuned sidebar peek/collapse/resize geometry, native traffic lights, the 15 `data-od-id`
  anchors, and every exact-string interaction-state test are untouched.

## Verification

- Full gate green after each stage: `pnpm build`, `pnpm test` (237 desktop tests),
  `pnpm typecheck`, `pnpm lint`, `pnpm core:purity`; `git diff --check` clean.
- Packaged visual QA of Stage A: built `apps/desktop/dist/mac-arm64/Aimcub.app`, launched
  with an **isolated HOME** (`/private/tmp/glass-qa-home`) + Electron user-data dir so real
  `~/.aimcub` was never touched (confirmed: real store mtime unchanged, no isolated store
  written). Dark-mode screenshots confirmed: gradient desktop, translucent blurred sidebar
  island, native macOS traffic lights preserved (no React-drawn dots), sidebar toggle
  expand/collapse works. Light-mode packaged QA still pending (system was in dark mode).

## Remaining Work (per the approved plan)

- **Stage B** — Rebuild Home / New / Memory / Settings in Glass. Memory is a net-new
  top-level page: add a `listMemories` IPC over the existing `store.listMemories`
  (`AimcubApi` + `IPC` in `shared/ipc.ts`, handler in `main/ipc.ts`, preload passthrough);
  "Forget" reuses `archiveContextMemory`. Add the sidebar Memory nav row + `~/.aimcub · local`
  footer + theme toggle here. Preserve the compose→summary invariant on New aim. Delete the
  dead `HomeView.tsx`. Row/card glassification (repointing the test-pinned `--od-*`
  interaction rules) also happens here — update those exact-string tests deliberately.
- **Stage C** — Journey work surface: replace the `AimOverviewPanel` branch at
  `App.tsx:1701-1713` with `<JourneyView>` using the Stage-0 helpers. Station sheet + receipt
  are **local overlay state** (like `CommandPalette`) — must not touch workspace/surface
  epochs. Your-move CTA reuses `runAgent`/`confirmMilestone`/`openCockpitStage`; the manual-
  proof lock stays inside `ExecutePanel`/`EvidenceSubmissionForm` reached via the Run station.
- **Stage D** — Net-new core: `store.listRunEvents` + a separate `getAimJournal` IPC for the
  full run-lifecycle journal; a real vs synthetic Research station; a batch per-aim progress
  summary for the sidebar/home "needs you" dot. Keep `@core` purity.
- **Stage E** — Rewrite `docs/memory/design-system.md` to the Glass system; update
  `docs/memory/desktop.md` and `docs/desktop-polish-audit.md`; full gate + `pnpm desktop:pack`
  + refresh root `Aimcub.app`; light-mode packaged QA at 960×680 / 760×600 / 640×520.

## Commit And Push Status

- Two focused commits on `glass-redesign` (`f245cbc9`, `3905c691`), both green. Branch is
  not merged to `main` (rebuild is mid-feature).
- `main` still carries one earlier unpushed commit (`8455cc09 Center draft workspace
  surfaces`) from the prior session. Nothing has been pushed; fresh explicit user approval is
  required before pushing.

## Open Risks / Notes

- Bundle-id mismatch surfaced during QA: the dist build identifies as `com.aimcub.desktop`
  (package.json `appId`) while App Store Connect memory records `com.jensonchow.aimcub`.
  Reconcile before store distribution (independent of the Glass work).
- Stage A is a container-level restyle: sidebar rows and aim cards still use the old quiet
  `--od-*` grays over the new translucent island. Full row/card glassification is scheduled
  for Stage B (it requires rewriting the pinned interaction-state tests).

## Next Session Prompt

```text
Continue the Aimcub Glass redesign on branch glass-redesign. Read docs/handoff.md and the
approved plan at ~/.claude/plans/giggly-herding-pine.md. Stage 0 (tokens + Journey helpers)
and Stage A (Glass shell containers) are committed and green. Continue with Stage B
(Home/New/Memory/Settings + listMemories IPC + row/card glassification), then Stage C
(JourneyView), Stage D (core surface), Stage E (design-system.md rewrite + repack). Keep each
stage green on the full gate and preserve the draft/navigation/proof invariants and native
traffic lights. Do not push without explicit approval.
```
