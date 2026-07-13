# Aimcub Handoff

Last updated: 2026-07-13
Branch: `main`. **The Glass sidebar + typography re-sync is COMPLETE and merged**
(branch `glass-sidebar-type-resync`). Full gate + live packaged-app QA green; root
`Aimcub.app` repacked. No open threads.

## Sidebar + typography re-sync — DONE

The founder re-checked `Aimcub Glass.dc.html` (project `b99a9242-…`, via DesignSync) and said
the sidebar still didn't match the design, and asked for the app's font/weight/size typography
to be organized. Root causes found and fixed:

1. **Floating-island shell** — the app drew the sidebar as an edge-attached full-height pane
   (280px, `border-right`, 56px top pad). The reference floats a **224px rounded island**
   inside a padded desk: `.od-app` now has `padding: 44px 22px 22px` (`--shell-top` /
   `--shell-gutter`) + 18px `--shell-gap`; the aside gets radius 18, `--sh-md` + `--ring`
   inset, `padding: 18px 12px 12px`, gap 16, `overflow: hidden` (list scrolls inside).
   Collapsed/peek keeps island geometry (abspos within the grid — horizontal insets resolve
   against the **grid-column-1 area**, so `left: 0`, not the gutter again). The drag strip
   spans the 44px band; the old per-stage titlebar-safe padding rules were deleted (clearance
   is geometric now). `DEFAULT_SIDEBAR_WIDTH` 280→224 and the width storage key bumped to
   `aimcub.sidebarWidth.v2` so persisted pre-island widths don't mask the new default.
2. **Row + menu metrics to reference spec** — aim rows 36→32px, radius 10, `0 10px` padding,
   3px list gap, **rest = `--mut` at 400**, hover `--island2`, selected = `--field` + ink +
   500 + `0 1px 3px rgba(30,40,70,.08)`; draft rows follow (32px). Brand row: home button
   radius 10 / `0 6px`, name 13.5/600, mark 700. Account trigger 46px/radius 12/`6px 8px`,
   label sub/600. Menu items sub-size/400, `0 10px`; separator margin 5px 8px. Settings-mode:
   back = sub/500, title = title-l 19/600 + title tracking, rail rest 500 / active 600.
3. **Organized Glass type ramp** — cockpit.css now has 10 size tokens (tag 10.5 / meta 11.5 /
   sub 12.5 / body 13.5 / title-s 14.5 / title 15.5 / title-m 17.5 / title-l 19 / display 24 /
   hero 27, each with a line token), weights regular 400 / medium 500 / semibold 600 / heavy
   700 (strong = semibold alias), and tracking tokens (title −0.01em, display −0.015em, caps
   +0.06em with CSS uppercase so zh is unaffected). Every `font-size` / `font-weight` /
   `letter-spacing` in cockpit.css routes through tokens — the old three-size/450-weight guard
   test was REWRITTEN to enforce exactly this (no raw numerics anywhere). All ~270 size and
   ~135 weight sites were swept to the design mapping (titles 600, buttons/active 500, caps
   kickers 700+tracking+uppercase, descriptions promoted meta→sub, etc.). `styles.ts`
   TYPE/WEIGHT fallbacks updated and extended.
4. **Serif-portal bug (real founder-visible defect)** — the body-portaled account-menu popover
   rendered in the UA serif because only `.od-window` carried the font family. Font stacks are
   now tokens (`--od-font-sans` with `-apple-system` first for optical sizing — the separate
   "SF Pro Display" declarations were dropped; `--od-font-mono`) and the sans stack is applied
   on **`body`**; a test guards it.

## Verification

- **Full gate green**: build (+ `@core` no-leak) + tests (**283 desktop**, incl. rewritten
  typography guard + updated sidebar metric assertions) + typecheck + lint + core:purity.
- **Live packaged-app QA via CDP** (isolated `AIMCUB_HOME`, real settings.json copied in; real
  `~/.aimcub/store.json` mtime verified unchanged): computed-style probes matched the reference
  spec exactly (shell 44/22/22, island 224/18px/18-12-12/blur30, brand 13.5·600 / mark 700,
  rows 32px rest mut·400 / selected field+ink+500+shadow, trigger 46/12, popover portal font
  `-apple-system`, items 12.5·400, settings title 19·600 / pane title 17.5·600 / rail active
  acc-soft·600); screenshots of composer, Journey, Home (first-run + with-aims), account menu
  (+ Language submenu open and hit-testable), Settings, Memory in **light + dark**; 640×520 no
  horizontal overflow, auto-collapse works, hover-peek overlays as a floating island at exact
  gutters (22/44/22, width clamps to 216).
- Repacked (`pnpm desktop:pack`) + refreshed root `Aimcub.app`.

## Invariants (still enforced)

- Native traffic lights (untouched main-process geometry 16/46/14); `data-od-id` anchors
  intact; glass-token 3-block mirror; AA overrides (`--faint`, light `--acc #0064cc`)
  untouched; `@core` pure — this re-sync is renderer CSS + CockpitShell constants + tests only.
- New guard: no raw numeric font-size/font-weight/letter-spacing in cockpit.css (tokens only);
  `body` must carry `--od-font-sans` (portal font).

## Ops gotchas (reusable)

- Live packaged-app QA via CDP: launch the packaged binary with isolated `AIMCUB_HOME` +
  `--remote-debugging-port` + isolated `--user-data-dir`; drive `Runtime.evaluate` +
  `Page.captureScreenshot` from Node 22. Use `Emulation.setDeviceMetricsOverride` (≥1180 wide)
  to keep the sidebar pinned. React synthetic `onPointerEnter` fires from dispatched
  `pointerover` (not `pointerenter`). `Emulation.setEmulatedMedia` prefers-color-scheme does
  NOT flip the app's theme (native-first via `data-system-appearance`) — toggle dark through
  the in-app Appearance row instead. Always verify real `~/.aimcub/store.json` mtime unchanged.
- Design re-sync flow: `DesignSync get_file` → serve the `.dc.html` + project `support.js`
  locally → click through in a browser for target visuals before diffing code.
- Abspos children of the `.od-app` grid resolve horizontal insets against their grid-column
  area, not the padding box — mind this for any future overlay pinned to the shell.
- Pre-existing (carried): `com.aimcub.desktop` vs ASC `com.jensonchow.aimcub` bundle-id
  mismatch.
