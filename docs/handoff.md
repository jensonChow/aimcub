# Aimcub Handoff

Last updated: 2026-07-11
Branch: `main` (Stage B merged to `main` and pushed to origin; built on branch `glass-stage-b`)

## Current Session

Continued the **Aimcub Glass** desktop redesign (glassmorphism visual system + a "Journey"
information architecture, imported from the founder's `Aimcub Glass.dc.html` design). Stages 0
(tokens + pure Journey helpers), A (gradient desktop + translucent shell islands), and C
(JourneyView work surface) were already merged to `main` and green. This session delivered
**Stage B** on a fresh branch off `main`.

Approved plan: `~/.claude/plans/giggly-herding-pine.md`.

## Completed This Session — Stage B (Home / New / Memory / Settings + sidebar IA)

- **`listMemories` IPC** end-to-end over the existing `store.listMemories` (active-only,
  newest-first): `AimcubApi` + `IPC` channel in `apps/desktop/src/shared/ipc.ts`, handler in
  `apps/desktop/src/main/ipc.ts`, passthrough in `apps/desktop/src/preload/index.ts`. "Forget"
  reuses the already-wired `archiveContextMemory`.
- **Memory** — net-new top-level page (`stages/memory/MemoryView.tsx`): active memories grouped
  by `category`, provenance line (`source` + aim/global scope), Forget action, honest empty
  state. Added as a new non-workbench `CockpitStage` `"memory"` (mirrors `settings`; excluded
  from `WorkbenchStage`), driven by `stageOverride` via a lightweight `openMemory()` overlay
  handler that bumps the surface epoch + interrupts planning (like `openContextSettings`) so a
  resolving planning run can't clobber the overlay. App owns a `memories` state (loaded on mount
  + after Forget); `memoryCount` feeds the sidebar row.
- **Home** — rebuilt as Glass (`stages/home/HomeView.tsx`), replacing `InitialWorkspacePanel`
  (removed from `App.tsx`): drafts → existing recovery surface; else saved aims → "Welcome back"
  glass card list; else first-run → glass hero + "Set your first aim" + a planning-runtime setup
  card bound to `planningRuntimeReady`. The empty/first-run state still renders **no composer**
  (invariant preserved); the `.od-initial-workspace` + `data-has-drafts` anchors and the pinned
  draft-recovery centering CSS are kept.
- **New aim** — kept `AimIntakePanel` + the whole compose→summary invariant chain untouched
  (`startDraft`/`aimSurfaceAfterSubmit`/`checkpointSubmittedAim`); only glassified the
  `.od-aim-composer` container (translucent `--island2` fill + blur), which is test-safe.
- **Settings** — Glass reskin via `styles.ts` (`card()`/`inputStyle()`/`primaryButton()` radii +
  `--sh-*` shadows, token indirection kept). The split-view IA + all forms preserved.
- **Sidebar IA** — added a Glass footer block above the user menu: a **Memory nav row**
  (`.od-sidebar-action`, active when `activeStage==="memory"`), a `~/.aimcub · local` line, and a
  **theme toggle** (OS-follow default). Row/card glassification: `.od-sidebar-action`,
  `.od-aim-card`, `.od-content-entry` hover/selected states repointed from the flat `--od-*`
  grays to translucent `--island2`/`--field` washes; the matching exact-string assertions in
  `App.test.tsx` were updated deliberately. All 15 `data-od-id` anchors preserved (+ 3 new
  ones); native macOS traffic lights untouched.
- **Theme toggle** — renderer-owned `themePref` ("system" default, `localStorage`-persisted)
  drives `data-system-appearance` off an `effectiveAppearance`. The dark `@media
  (prefers-color-scheme: dark)` block now yields to an explicit light override
  (`:root:not(:has(.od-app[data-system-appearance="light"]))`) so the toggle can force light on a
  dark-mode OS. The visible surface (the `.od-window` `--desk` gradient + content) follows the
  toggle. **Deferred to Stage E:** syncing the *native* window background on an in-app override
  (needs an IPC → `nativeTheme.themeSource` / `win.setBackgroundColor`, per the plan).
- **Deleted** the dead `renderer/HomeView.tsx` (whole file — verified zero references).
- **i18n** — added `glass.home.*`, `glass.memory.*`, `glass.shell.*` keys (en + zh); parity holds
  via the `satisfies` typecheck guard.

## Verification

- Full gate green: `pnpm build && pnpm test` (241 desktop tests) `&& pnpm typecheck && pnpm lint
  && pnpm core:purity`; `git diff --check` clean.
- **Adversarial multi-agent review** of the diff before commit found and fixed 4 real issues:
  (1) theme toggle couldn't force light on a dark OS [HIGH]; (2) `openMemory` didn't bump the
  surface epoch / interrupt planning, letting a resolving plan yank the user off Memory [MED];
  (3) `.od-main-memory` lacked `grid-template-rows: minmax(0,1fr)`, so tall Memory lists
  overflowed and were clipped with no scroll [MED]; (4) the Forget button was ~22px tall (< 24px
  target) [LOW]. Two other findings were adversarially verified as false positives.
- Packaged the app (`pnpm desktop:pack` → `apps/desktop/dist/mac-arm64/Aimcub.app`) and launched
  it with an **isolated HOME** — real `~/.aimcub/store.json` mtime unchanged, zero isolated
  writes. **Interactive computer-use visual QA was declined by the user this session**, so the
  on-screen light+dark / multi-size inspection is still pending (rolls into the Stage E packaged
  QA). The root `Aimcub.app` was NOT repacked (still reflects `main`; that is a Stage E step).

## Remaining Work (per the approved plan)

- **Stage D** — Net-new core (the only boundary-crossing work): a real vs synthetic Research
  station; `store.listRunEvents` + a separate `getAimJournal` IPC for the full run-lifecycle
  journal; a batch per-aim progress summary so the Home cards / sidebar can show a real
  "needs you" dot + progress (currently deferred as an honest placeholder). Keep `@core` purity.
- **Stage E** — Rewrite `docs/memory/design-system.md` to the Glass system; update
  `docs/memory/desktop.md` and `docs/desktop-polish-audit.md`; wire the theme-toggle native-bg
  sync via IPC; `pnpm desktop:pack` + refresh root `Aimcub.app`; light+dark packaged QA at
  960×680 / 760×600 / 640×520.

### Possible follow-ups noted this session
- A Cmd/Ctrl+K command-palette entry for Memory (only the sidebar row exists today).
- Home aim cards + sidebar carry no per-aim progress yet (Stage D batch summary is the real fix).

## Commit And Push Status

- Stage B (`f0ffee10`) is committed, green on the full gate, merged to `main`, and **pushed to
  origin** (user-authorized this session). Stages 0/A/C were already on origin/main.
- The root `Aimcub.app` was NOT repacked (Stage E step). Future pushes still require explicit
  per-session approval.

## Open Risks / Notes

- Bundle-id mismatch (independent of Glass): dist builds as `com.aimcub.desktop` while App Store
  Connect records `com.jensonchow.aimcub`. Reconcile before store distribution.
- Theme toggle native-titlebar-bg desync on an in-app override is a known, plan-sanctioned Stage E
  follow-up (the visible content already follows the toggle).

## Next Session Prompt

```text
Continue the Aimcub Glass redesign. Read docs/handoff.md and the approved plan at
~/.claude/plans/giggly-herding-pine.md. Stages 0/A/C are on main; Stage B (Home/New/Memory/
Settings + sidebar IA + listMemories IPC + row/card glassification + theme toggle) is committed
on branch glass-stage-b and green on the full gate. Do Stage D (net-new core: Research station,
run-event journal via listRunEvents + getAimJournal IPC, batch per-aim progress summary), then
Stage E (rewrite design-system.md to Glass, theme-toggle native-bg IPC sync, repack + refresh
root Aimcub.app + light+dark packaged QA). Keep each stage green on the full gate; preserve the
draft/navigation/proof/compose-summary invariants, data-od-id anchors, and native traffic lights.
Do not push without explicit approval.
```
