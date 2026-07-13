# Aimcub Handoff

Last updated: 2026-07-12
Branch: `main`. **The Glass design re-sync is COMPLETE and merged** (branch
`glass-design-resync`). Full gate + live packaged-app QA green; root `Aimcub.app` repacked.

## Glass design re-sync — DONE

The founder re-imported `Aimcub Glass.dc.html` from his claude.ai/design project
(`b99a9242-7164-4141-81e4-e6c363ecaf5f`, via the DesignSync MCP) and asked for it to be
implemented. A precision diff against the shipped Journey-first app showed the Journey, New Aim
composer, Memory page, and station sheets already matched the latest design; the real deltas were
the sidebar, Home cards, Settings IA, and a station-glyph policy. Implemented as five focused
commits, each independently full-gate green:

1. **Sidebar** — brand row ("A" mark + Aimcub → Home, compact "+" → New Aim) replaces the two
   action rows; sidebar search + all/active/paused filters + "Recent aims" label deleted (Cmd+K
   covers navigation; draft rows unchanged). The footer collapsed into the account trigger
   ("Local workspace / ~/.aimcub") whose glass popover holds Memory(+count), Settings, Language,
   an Appearance toggle, and the ok-dot on-device line. Sidebar dots now mark only needs-you
   (accent) and blocked (danger). Theme pref moved to a shared store (`renderer/theme.ts`);
   CockpitShell keeps the single native `setThemeSource` sync. Dead: `aimMatchesNavigationQuery`.
2. **Home** — dynamic sub ("{n} aims in motion. One needs you."); cards carry a status phrase
   sub-line + accent "your move" pill (needs_you) + 64×4 trailing bar; dot and `{done}/{total}`
   text removed; first-run "connected" line gains "· {model}" when a provider model is set.
3. **Settings re-IA** — aim sidebar stays; in-workspace "Settings" title + 196px rail with
   General / Planning brain / Workers / Research / About + ~600px detail pane. New validated IPC:
   `getAppInfo` (version + tilde-shortened workspace path) and `revealWorkspace` (no renderer
   input; opens the fixed workspace root). Provider chooser became pills; local agents became
   dot/name/meta/Test-run rows + an honest "You" row; Research holds the web form + a
   "{n} of 6 active" context-sources row toggling the full panel; About states version + on-device
   facts only (no fake updater). Deleted: SettingsPrimarySidebar/back/search/nav, the readiness
   Overview + `buildSettingsModel`, the aim-context return card, `od-app-stage-settings` sidebar
   locking, ~75 orphaned i18n keys. Section ids → `general|brain|workers|research|about`
   (focus remap provider→brain, local→workers, web/context→research). The settings-return stage
   is still recorded for draft persistence.
4. **Journey polish** — only the active station shows a (pulsing accent) dot; header meta reads
   as percent with the exact fraction on the accessible name (hidden on a plan-less shell).
5. **Live-QA fixes** — `os.settings` legacy value ("Aim helpers") → "Settings"; long
   `$AIMCUB_HOME` paths ellipsize in the Workspace row (tooltip keeps the full path); detail pane
   clips horizontal overflow.
6. **Founder-reported menu bug (post-merge fix)** — the account-menu **Language submenu rendered
   as a dead clipped sliver**: the sidebar's `backdrop-filter` makes the aside the containing
   block for the `position: fixed` popover, and the sidebar's `overflow: hidden auto` clipped
   everything past its edge (submenu unclickable → language switching broken from the menu). Fixed
   by rendering the popover through a **body portal**, positioned inline from the trigger rect
   (outside-click also checks the portaled panel). Verified live: popover anchors exactly above
   the trigger, the submenu is fully visible + hit-testable, and switching 中文 ⇄ English through
   it works.

## Verification

- **Full gate green per commit**: build (+ `@core` no-leak) + tests (**283 desktop** + store +
  llm + local-agent + 88 cli) + typecheck + lint + core:purity. en/zh parity kept (~75 dead keys
  pruned, ~40 added).
- **Live packaged-app QA via CDP** (isolated `AIMCUB_HOME` with real settings.json copied in;
  real `~/.aimcub/store.json` mtime verified unchanged): 35/35 scripted checks — brand row/menu
  contents/appearance toggle flip, Settings rail + all five tabs (segmented appearance, Reveal
  row, provider pills, You row, Manage expand, About version), composer sparks + circular submit,
  goal-first submit → Journey with one strip + active-only dot + no % meta on a shell, Home
  card state line/pill/bar, no horizontal overflow at 640px. Visual pass at 1180×780 in light +
  dark (screenshots in the session scratchpad).
- Repacked (`pnpm desktop:pack`) + refreshed root `Aimcub.app`.

## Invariants (still enforced)

- Native traffic lights; `data-od-id` anchors (memory action moved INTO the account menu but kept
  `data-od-id="sidebar-memory-action"`); glass-token 3-block mirror; AA overrides (`--faint`,
  light `--acc #0064cc`) untouched; type ramp guard (new 13.5/19px are non-guarded decimals);
  `@core` pure — the re-sync is renderer + thin validated IPC only.
- Honest UI: no flight-demo content, no fake updater, Journey secondary affordances
  (hand-to-agent/schedule/later) still render only when a real handler exists.

## Ops gotchas (reusable)

- Live packaged-app QA via CDP: repack + refresh root `Aimcub.app`, launch the binary with
  `AIMCUB_HOME=<isolated>` + `--remote-debugging-port=NNNN` + `--user-data-dir=<isolated>`; copy
  real `~/.aimcub/settings.json` (+ `context-sources.json`) in, empty store; drive
  `Runtime.evaluate` + `Page.captureScreenshot` from Node 22 (global WebSocket). **The default
  960×680 window auto-collapses the sidebar (`max-width: 1040px`)** — pin it via the toggle (or
  emulate ≥1180px width) before menu/sidebar assertions; a popover inside the collapsed aside is
  clickable in DOM but invisible. Always verify real `~/.aimcub/store.json` mtime unchanged.
- Design re-sync flow: `DesignSync get_file` → serve the `.dc.html` + project `support.js`
  locally (support.js pulls React/Babel from unpkg) → click through in a browser for the target
  visuals before diffing code.
- Pre-existing (carried): `com.aimcub.desktop` vs ASC `com.jensonchow.aimcub` bundle-id mismatch.
