# Design System Memory

Last updated: 2026-07-13

## Scope

This is the durable visual and interaction design system for Aimcub frontends, with Desktop
as the primary product surface. Future Desktop work must follow this document unless the user
explicitly changes the design direction.

When the user gives any frontend or visual-design requirement, update this file in the same
change. Keep the requirement durable here, then implement it in the relevant app.

## Active Direction: Aimcub Glass

The founder chose **Aimcub Glass** (imported from his claude.ai/design project via the
DesignSync MCP) as the desktop direction and asked for a full rebuild. Glass is now the
system this document describes — it supersedes the earlier "calm-flat" direction, whose
"no glass / no gradients / no atmospheric backgrounds / no style churn" guidance no longer
applies. The durable cross-cutting rules that Glass still honors (the type ramp, layout rails,
target sizes, accessibility, native macOS chrome, Electron engineering) are retained below.

Glass is two things at once:

- **A glassmorphism visual system** — a gradient "desktop" background behind translucent,
  backdrop-blurred "islands" (sidebar, workspace, cards), soft shadows, pill chips,
  14–24px radii, and full light+dark token sets.
- **A collapsed "agent + plan" information architecture** for the work surface (founder
  direction 2026-07-25: "the UI is too complicated" → structural collapse). One aim surface —
  the Journey — holds the whole loop: a header (title · rename · completion %), exactly ONE
  live lane (planning session / build-plan / "Your move" / ambient), **the plan as the
  object** (one row per sub-aim, expanding in place to the full work detail), an inline
  context-candidate review band only when candidates exist, and a quiet closed-by-default
  Journal disclosure. The earlier 6-station strip, station drill-in sheets, Turns roster,
  and the standalone Context/Plan/Run/Eval stage pages are REMOVED — do not reintroduce
  them. Memory stays a top-level page; Home / New / Settings share the visual language.

**Shipped** (stages 0/A/B/C/D on `main`): the additive Glass token set in `cockpit.css`
(present identically in all three theme blocks), the gradient-desktop + translucent-island
shell, the `JourneyView` work surface, Glass Home / New / Memory / Settings pages, row/card
glassification, the `listMemories` / `getAimJournal` / `listAimProgressSummaries` IPC, the
real (`@core`) Research station and run-lifecycle journal, and the batch per-aim progress
dots. A **2026-07-12 design re-sync** (branch `glass-design-resync`, from the updated
`Aimcub Glass.dc.html`) then rebuilt the sidebar (brand row + account-menu popover), Home
cards, and the Settings IA to the latest reference. A **2026-07-13 sidebar + typography
re-sync** (branch `glass-sidebar-type-resync`) finished the job the founder flagged as still
off: the sidebar became the reference's floating island (44/22 shell band + gutters, 224px,
32px muted rows) and the whole app's typography was reorganized onto the tokenized Glass type
ramp below. The sections below describe the re-synced state. Before making desktop visual
changes, read `docs/handoff.md` and the loading order in `docs/memory/desktop.md`.

## Design Tokens

The source of truth for Desktop is `apps/desktop/src/renderer/cockpit.css`. Glass tokens are
additive over the legacy `--od-*` operational palette (which still backs un-migrated
selectors); surfaces adopt Glass tokens as they are restyled. **Every Glass token must appear
identically in all three theme blocks** — `:root` (light), `@media (prefers-color-scheme: dark)`,
and `:root:has(...[data-system-appearance="dark"])` (native/toggle-driven dark). A guard test
asserts the hand-duplicated dark blocks match.

Core Glass tokens (light values shown; each has a dark counterpart):

- **Desktop / islands** — `--desk` (the gradient backdrop), `--island` / `--island2` (translucent
  fills, ~0.62 / ~0.42 white in light, low-alpha white in dark), `--field` (input/selected fill),
  `--ring` (inner hairline highlight), `--edge` (structural hairline), `--dim` (scrim).
- **Ink** — `--ink` (primary text), `--ink2` (secondary), `--mut` (muted), `--faint` (meta/idle).
- **Accent** — `--acc`, `--acc-on`, `--acc-soft` (tinted wash).
- **Status** — `--ok` / `--okdot` (success), `--warn` / `--warndot` (attention), `--danger`.
- **Elevation** — `--sh-lg`, `--sh-md` (soft ambient shadows), `--sh-btn` (accent button glow).

Migration is surface-by-surface, not a blanket `--od-*` rename (`--od-bg` is opaque; `--island`
is translucent — a blind remap breaks un-migrated panels and the dark-token tests). Each
surface adopts Glass tokens when its stage restyles it, and that stage updates the matching
CSS-string assertion. `styles.ts` keeps the token indirection for its inline `card()` /
`inputStyle()` / `primaryButton()` helpers.

## Research Inputs

- Microsoft Windows app design principles: calm, coherent, familiar, accessible, clear
  hierarchy, predictable navigation, task-first commands, consistent typography.
- Microsoft typography: system fonts, few type styles, left alignment, minimum readable UI
  sizes, concise strings, semibold emphasis over excessive bold/italic.
- GNOME HIG: design for people, keep each view simple and focused, reduce user effort, avoid
  interruptions and deep navigation, adapt smoothly across window sizes.
- GNOME styling/accessibility: support high contrast, avoid color-only meaning, prefer
  system/component style variables, test with keyboard and screen readers.
- W3C WCAG 2.2: 4.5:1 contrast for normal text, 3:1 for large text/state icons; visible
  keyboard focus; pointer targets at least 24×24 CSS px or with enough spacing.
- Electron security/performance: keep Electron current, isolate renderers, avoid remote code
  with Node integration, define a CSP, validate IPC senders, avoid blocking main/renderer,
  defer expensive work, profile real bottlenecks.
- Apple HIG remains a macOS-feel reference: native-feeling behavior, restrained chrome, system
  typography, predictable window/menu conventions.

Reference links:

- Apple HIG: https://developer.apple.com/design/human-interface-guidelines/
- Microsoft Windows design overview: https://learn.microsoft.com/en-us/windows/apps/design/
- Microsoft Windows design principles: https://learn.microsoft.com/en-us/windows/apps/design/design-principles
- Microsoft Windows typography: https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/typography
- Microsoft Windows navigation: https://learn.microsoft.com/en-us/windows/apps/design/basics/navigation-basics
- Microsoft Windows writing style: https://learn.microsoft.com/en-us/windows/apps/design/style/writing-style
- GNOME HIG: https://developer.gnome.org/hig/
- GNOME principles: https://developer.gnome.org/hig/principles.html
- GNOME typography: https://developer.gnome.org/hig/guidelines/typography.html
- GNOME navigation: https://developer.gnome.org/hig/guidelines/navigation.html
- GNOME scaling and adaptiveness: https://developer.gnome.org/hig/guidelines/adaptive.html
- GNOME accessibility: https://developer.gnome.org/hig/guidelines/accessibility.html
- W3C WCAG contrast: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- W3C WCAG focus visible: https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html
- W3C WCAG target size: https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
- Electron security: https://www.electronjs.org/docs/latest/tutorial/security
- Electron performance: https://www.electronjs.org/docs/latest/tutorial/performance

## Product Principles

- Aim-first: the aim, next action, current stage, context quality, and evidence state are the
  product. Glass surface treatment must dramatize the aim's state, never decorate for its own
  sake — the glassmorphism is a material, not an ornament.
- Product-first, debug-second: the default Desktop shell must not show model calls, prompt
  previews, runtime logs, trace streams, or stacked debug panels. Developer diagnostics belong
  behind an explicit developer surface. The run-lifecycle Journal shows product-facing receipts
  (run started/finished, evidence, artifacts), never raw `run.log` / `tool.*` traces.
- One primary task per screen: a view should make one user action obvious. On the Journey that
  is the single live-lane card ("Your move" / planning / ambient); the plan rows and the
  journal disclosure support it without competing.
- Desktop quality bar: Aimcub should feel like a focused desktop workbench, not a web dashboard
  inside Electron. Prefer stable panes, compact command surfaces, native-feeling shortcuts,
  complete control states, and strict row/spacing rhythm.
- Calm glass: the gradient + blur are a quiet backdrop, not a light show. Avoid heavy or
  animated gradients, decorative orbs, bokeh, or motion loops. One desktop gradient, restrained
  translucency, soft shadows. Reserve the accent color for the current step, primary actions,
  and selected emphasis; do not flood whole islands with accent.
- First-run quality bar: an empty Aimcub workspace must not auto-render a chat or intake
  composer in the main area. First-run Home is a quiet glass hero with an explicit "Set your
  first aim" action and a planning-runtime setup card — no composer until New Aim is chosen.
- First-run shell chrome stays quiet while no aim has started: no idle status text, duplicate
  product labels, heavy focus rings, or oversized empty surfaces.
- Home draft recovery and recovered-Aim summary surfaces sit vertically centered in the
  available workspace, keep their constrained horizontal rails, and use safe centering so
  taller content stays reachable from the scrollable start edge.
- Aim creation, reading, and editing are distinct product states. New Aim and unsent child
  breakdown may use the composer; after the first submit or draft recovery, the Aim surface
  defaults to a readable summary with explicit Edit and Continue actions. Persist the
  compose-versus-summary distinction explicitly; recover legacy drafts into summary. Runtime
  setup gaps, autosave, navigation, and restart must never reopen a captured Aim as an input.
  Re-enter the composer only through Edit, keep edits in a separate buffer until Update, explain
  when Update regenerates a plan, and block normal navigation until the user updates or cancels.
- User-entered aim-building work must be auto-saved as recoverable local product data or made
  explicitly discardable before navigation hides it. Draft recovery UI calls the work a draft,
  not a saved aim.
- Context is a substrate: show context health as concise status, setup controls, and review
  affordances. Do not turn memory/context into a profile page or a decorative feed. Memory is a
  top-level page that lists what Aimcub has learned (grouped by category, with provenance and a
  Forget action) and an honest empty state — not a dashboard.
- Context source setup keeps one clear summary plus one editable control surface; do not repeat
  local, online, web, deep-research, context-session, or questionnaire controls as separate
  card, table, and toggle representations. Planning-readiness gates may sit under the summary as
  compact rows when they explain why planning can proceed or what remains blocked.
- Context collection has no page of its own: the planning brain (or funnel) asks through the
  Journey's live lane. While a blocking question or optional draft refinement is active, that
  question flow is the whole live-lane surface — one question visible, one reply lane, one
  bottom primary action; advance only through an explicit Next. Keep provider setup, web
  capability, online connectors, and permission configuration in Settings. Questions stay
  adaptive and bounded; a question-specific custom answer and the general context note never
  appear together. If all intake paths are disabled, show one Settings recovery action.
- Choice-card controls render the normalized domain mode instead of inferring it from option
  count or question category. Expose single selection as a `radiogroup` of `radio` choices with
  one roving tab stop and Arrow/Home/End navigation; expose multiple selection as pressed toggle
  buttons. Keep the custom-answer lane available in both modes.
- Context provenance stays honest without a dedicated review page: the planning session's
  landing carries disclosed assumptions and open gaps in product language; raw prompts and
  traces stay behind developer mode.
- Evidence is trustworthy UI: completion, progress, warnings, and quality claims show the
  evidence or review path behind them without exposing private chain-of-thought. The Journey's
  plan-row receipts (evidence review + evaluator matches) and Journal are read-only receipts
  derived from real orchestration state — bind them to real data with honest empty states;
  never fabricate rows.
- Eval is trust shown in place: each plan row carries its eval verdict and opens its evidence
  review and evaluator matches inline behind closed disclosures. Pending context candidates
  render as an inline review band on the Journey only when they exist; an empty inbox renders
  nothing.
- Completed aims lead the Journey with a factual, compact completion recap (final outcome,
  completed sub-aims, passing evidence, eval result, learned context, future reuse) in place
  of the live lane and plan rows. Not a celebration or marketing page.

## Desktop Information Architecture

- Default shell (2026-07-13 sidebar re-sync): the `.od-app` grid is padded like the reference —
  a 44px titlebar-safe top band plus 22px side/bottom gutters (`--shell-top` / `--shell-gutter`),
  with an 18px `--shell-gap` between columns — so the sidebar reads as a **floating island** with
  the desk gradient visible on all sides, not an edge-attached pane. No visible full-width top
  titlebar/status strip; macOS window controls live in the top band; the workspace column is
  transparent (its cards are the islands). No default right inspector. Window-chrome clearance is
  purely geometric via the top band — there are no per-stage titlebar-safe padding rules.
- **Native macOS traffic lights must stay native.** AppKit/Electron draws and owns the
  red/yellow/green controls; Aimcub's main process only positions them (`titleBarStyle:
  "hiddenInset"`, `trafficLightPosition`, `setWindowButtonPosition`, `setWindowButtonVisibility`).
  Desktop uses Electron 43; keep the fixed 46px titlebar-safe row with a 14px traffic-light
  metric, and keep the geometry constants (16/46/14 in `main/index.ts`) in sync with the CSS
  `--traffic-light-*`. **Do not draw red/yellow/green or inactive substitute dots in React/CSS.**
  Custom titlebar controls (sidebar toggle) sit beside the native controls, outside
  transform/zoom/filter containers, with `no-drag` hit targets and a separate drag region.
- **Theme preference.** Desktop follows macOS system appearance by default. The preference is a
  shared renderer store (`renderer/theme.ts`, `localStorage`-persisted, "system" default) with two
  writers: the account-menu **Appearance** row (toggles light/dark; the value label shows
  Light / Dark / System) and **Settings → General**'s segmented Light / Dark / System control.
  CockpitShell reads it, drives Glass tokens off `data-system-appearance`, and keeps the single
  IPC → `nativeTheme.themeSource` sync (main repaints `win.setBackgroundColor` and re-emits chrome
  state), so an in-app override never desyncs the native titlebar/traffic-light context. "system"
  hands appearance back to the OS. Renderer dark tokens respond to both
  `prefers-color-scheme: dark` and `data-system-appearance="dark"`.
- Sidebar (re-synced 2026-07-13, exact reference geometry): the aside is a rounded island —
  radius 18px, `--island` fill, blur(30px), `box-shadow: var(--sh-md), inset 0 0 0 1px var(--ring)`,
  padding `18px 12px 12px`, 16px gap between its three zones (brand row / aim list / account
  trigger), `overflow: hidden` with the aim list scrolling inside. The top-left is a **brand
  row** — an accent "A" mark (26px, radius 8, 700 weight glyph) + "Aimcub" (body size, 600) going
  Home, padding `0 6px`, and a compact trailing "+" icon button for New Aim (26px, quiet `--field`
  hover) — followed by a plain aim list (no search field, no filter pills, no section label; Cmd+K
  covers navigation, drafts keep their labelled rows). Empty list shows one quiet line ("Your aims
  will live here.", sub size, `--faint`). Aim rows carry a small trailing **status dot marker**
  (see Status markers) — a marker, never a status subtitle.
- Aim rows carry a trailing More Actions menu (founder 2026-07-25: an aim needs a way off the
  list). The trigger reveals on row hover/focus (and stays while its popover is open); the menu
  holds one destructive **Delete aim** behind an inline confirmation that names the consequence
  (plan, runs, evidence, receipts leave the workspace) — never visible row text, never a native
  dialog. The row body only opens the aim. Archive-with-restore is the designed follow-up if
  shelving (not destroying) real aims becomes the need.
- Sidebar aim and draft rows are compact one-line navigation rows: prefer a concise generated
  `goal_summary`, else conservative intent-prefix cleanup with a grapheme-safe bound; keep the
  canonical title for editing/planning/search/CLI/agents. One **32px** line (radius 10, padding
  `0 10px`, 3px list gap) with CSS ellipsis; the full cleaned summary is exposed from the
  focusable row tooltip. Rows read **quiet at rest — `--mut` text at regular weight**; hover is a
  translucent `--island2` wash; the open aim is an ink-on-`--field` pill at medium (500) weight
  with the soft row shadow `0 1px 3px rgba(30,40,70,.08)` (the one sanctioned selected-shadow).
  Do not show workflow status subtitles ("Context needed", "Plan ready", "active", …) under titles.
- Sidebar footer account menu (re-synced): the lower-left trigger is the workspace identity —
  a person-icon avatar tile (28px, radius 9) + "Local workspace" (sub size, 600) over "~/.aimcub"
  (meta, `--faint`) + up-down chevron, on a 46px min-height radius-12 row (padding `6px 8px`;
  open/hover = `--island2`). Its glass popover (island fill, blur 30, `--ring` inset, 14px radius,
  6px padding) holds **Memory** (with a trailing count and `aria-current` while the Memory page is
  open), **Settings**, **Language** (Claude-like hover side submenu — an Aimcub addition the
  reference frame doesn't show; keep it), a separator (1px `--ring`, margin 5px 8px), an
  **Appearance** row (icon + current value; click toggles light/dark), and a non-interactive
  ok-dot `~/.aimcub · on device` line. Menu items are 34px min-height, radius 9, sub size at
  regular weight, `0 10px` padding. There is no separate footer Memory row / path line /
  theme-toggle button. No auto first-item focus ring on pointer open.
- Sidebar toggle: a top-left titlebar-cluster icon button (pinned / collapsed / peek). Clicking
  toggles pinned/collapsed; pinned reserves layout space and never covers the workspace; while
  collapsed, hovering the button or the 32px left-edge rail reveals a transient overlay peek
  sidebar without resizing the workspace. In fullscreen the product toggle moves left into
  traffic-light-safe space, but native traffic lights must remain in the revealed system titlebar.
- Center workspace: a constrained-max-width workbench. For a saved aim the ONLY surface is
  the **Journey** work view. There are no standalone stage pages, no stage switcher, no
  station strip, and no Cmd+1..5 stage shortcuts — `CockpitStage` is just
  `aim | settings | memory` and the palette carries Home / New aim / Settings. `.od-main` is
  a single-row grid (`minmax(0,1fr)`); the `.od-workspace` child is the `overflow:auto`
  scroll container.
- **Goal-first front door (shipped, Stage 6–7).** Submitting a New Aim mints a plan-less Goal
  *shell* immediately (`createAim` → `createAimShell`) and mounts its Journey — it never routes
  through an unsaved-aim intake funnel. The shell shows a "Turn this aim into a plan" card;
  research / adaptive clarify Q&A / plan review all happen **in the Journey**, and the plan lands
  on the SAME goal (`updateGoalPlan`, no fork). The Plan drill-in sheet edits in place (buffered
  commit) and "Re-plan with AI" re-runs planning on the same goal. **Child breakdown** is
  goal-first too: it mints a linked child shell (`createAim` with `parentGoalId`/`parentMilestoneId`)
  that opens on its own build-plan Journey. **Aim rename** is an inline editor in the Journey
  header (`onRenameAim` → `renameGoal`, title/description only, no plan change) — the old edit-mode
  funnel is gone. A composer draft is autosaved while typing but discarded when the shell is
  created; resuming any older draft lands back in the composer, never a funnel.
- **The Journey work surface** renders from pure, unit-tested helpers under
  `renderer/workflow/journey/` (yourMove, journal) off the existing `AimProgressReadModel` +
  the run-event journal. Top to bottom: the header (title · inline rename · completion
  **percent**, exact fraction on the accessible name; "N turns elsewhere" jump chip);
  exactly ONE live-lane card (planning session ▸ build-plan ▸ "Your move" via the
  `executePrimaryAction` mapping ▸ ambient); the **plan band** (`JourneyPlanBand`) — one row
  per sub-aim (pulsing dot only while its work is in flight, title, route + evidence meta,
  owner chip, status pill) that expands IN PLACE to the full work detail: blocker, live run
  line with Stop, stranded-run recovery, per-session run-permission consent, one primary
  action, secondary run/proof/break-down actions, eval receipts (evidence review + evaluator
  matches) behind closed disclosures, and the run timeline. The "Your move" CTA lands on its
  own plan row (proof opens that row's evidence form in place; review/blocked expand the
  row). Below: the inline context-candidate band (only when candidates exist) and the Journal
  as a quiet closed-by-default `<details>` disclosure merging evidence with run-lifecycle
  events, newest-first. A completed aim replaces the live lane + plan band with the
  completion recap. Re-plan is a quiet control on the plan band head.
- Status markers (re-synced): sidebar aim rows mark only the states that ask for the user's
  attention — needs-you (`--acc` accent dot) and blocked (`--danger`) — with accessible names;
  running/planning/complete rows stay unmarked so the strip reads calm. Home cards carry the
  full state instead: an honest status phrase under the title ("waiting on you" / "quietly in
  motion" / "shaping the plan" / "blocked — needs a look" / "complete"), an accent **"your move"
  pill** for needs-you, and a fixed 64×4px trailing progress bar (ink-mix fill on `--island2`,
  fraction on the accessible name) — no dot, no `{done}/{total}` counter text. The Home subtitle
  is the live rollup ("{n} aims in motion. One needs you."). All of it reads from the cheap batch
  `listAimProgressSummaries` endpoint, not N per-aim progress calls.
- Optional inspector: process/context/quality/activity/debug detail may exist as an opt-in
  overlay/drawer/developer surface — independently scrollable, never displacing the primary task.
- Stage model (collapsed): `aim | settings | memory`. The Journey IS the work model — planning,
  answering, plan review, dispatching, proof, and eval receipts all happen on it in place.
  Settings and Memory are overlay detours that return to it. Existing aims open to the Journey;
  completed aims lead it with the completion recap.
- Settings (re-synced IA, sidebar-nav revision): while Settings is open the SIDEBAR swaps its aim
  list for the settings navigation — the brand row and the bottom account trigger stay; between
  them sit a quiet **Back** row (chevron + label, sub size at 500, `--mut` → `--ink` on hover;
  returns to the recorded pre-settings surface), a **"Settings"** title (title-l 19px, 600, title
  tracking), and the icon category nav (**General / Planning brain / Workers / Research / About**;
  16px line icons; rest = `--ink` at 500, selected = `--acc-soft` wash with accent text at 600).
  The workspace holds ONE centered detail pane (max ~620px, 40px top padding)
  — no in-workspace rail. One glass island per control group (18px radius, `--island` + blur +
  `--ring` inset), rows divided by `--edge` hairlines. General = Appearance segmented
  (Light/Dark/System) + Workspace row (real tilde-shortened path via `getAppInfo`, Reveal via the
  no-input `revealWorkspace` IPC). Planning brain = provider **pills** (selected = accent,
  description shown only for the selected provider) + model select + key + Test/Save. Workers =
  an honest "You" row ("judgment, approvals, anything with your card") + local-agent rows
  (ok/warn dot · name · version/auth/models meta · Test run). Research = web-research form + a
  Context-sources summary row ("{n} of 6 active") whose Manage toggles the full sources panel
  inline. About = version + on-device data row only — no fabricated updater. There is no
  readiness Overview; each form carries its own status copy. Command palette (Cmd/Ctrl+K)
  provides keyboard-first navigation; add entries when a workflow becomes top-level (Memory is a
  candidate follow-up).

## Layout Rules

- UI cleanup passes are layout-stability work: fix missing grid/flex/gap constraints, stray
  margin/padding, inconsistent row/control heights, mobile overflow, and drift — not restyling.
- Use a 4px base grid; converge touched spacing to 4, 8, 12, 16, 24, 32px. Older 6/10/14/18/40/
  56/72px values are legacy allowances until their local layout is touched.
- Page/workspace padding: 24px minimum on desktop, up to ~32px for dense workbench views, 16px on
  narrow desktop and mobile windows.
- Content width: writing/intake surfaces max ~760px; operational grids/review surfaces ~940px.
  Use explicit shared rails — 560px composition/compact draft lists, 760px reading/focused
  questions, 940px operational workbench, 1080px Settings control groups. Related headings, rows,
  and actions keep one visible left-edge system. The Journey is a workbench surface, not a reading
  column: it uses the wider 820px rail (`.od-workspace-aim:has(> .od-journey)`), not the 760 cap.
- Any centered, scrollable workspace must center **safely** (`align-content: safe center`) so tall
  content (a full Journey, a long saved-aims Home) anchors to the scrollable start edge instead of
  being clipped above `scrollTop: 0` and made unreachable at small window heights. The aim-stage
  workspace base (`.od-workspace-aim`) centers safely for this reason; verify at 640×520.
- Sidebar width: default **224px** (the reference island width; the persisted-width storage key
  was bumped to `aimcub.sidebarWidth.v2` so pre-island widths don't mask it), stable bounds
  ~216–360px, transparent resize hot zone with the native cursor (not a permanent divider). The
  normal Aim sidebar may auto-collapse before the workspace is squeezed below a usable width; a
  user-pinned sidebar reserves space and never covers the workspace. The collapsed/peek overlay
  keeps the same floating-island geometry (gutter-inset, rounded, `--sh-lg` while peeking) — it
  never reverts to a full-height edge pane. Settings keeps its always-visible category sidebar.
- Window sizing stays compact: default ~960×680px, minimum ~640×520px. The Journey's 6-station
  strip must degrade gracefully (wrap/stack) at 760×600 and 640×520 with no horizontal overflow.
- Vertical rhythm: 22–24px between major page bands, 12–16px between controls in a group, 6–10px
  inside compact repeated items.
- Cards (including Glass cards) are for repeated items, forms, modals, and genuinely framed
  tools. Do not nest cards or turn whole page sections into floating cards. Glass islands use
  `minmax(0, 1fr)` grid tracks so long text truncates/wraps intentionally.
- Responsive: start from the smallest viable window and scale up — collapse the sidebar, wrap
  stage controls, stack multi-column grids, preserve all functionality. Workbench navigation must
  respect the native titlebar/sidebar-toggle safe area at compact widths; solve overlap from stage
  content (`.od-main`, `.od-stage-nav`, `.od-workspace`), not shell/sidebar/window-chrome
  selectors. Window-chrome clearance is geometric, never stage-name-specific.

## Typography

Reorganized 2026-07-13 to the reference design's scale (the founder asked for the app's font
sizes/weights to be organized to match `Aimcub Glass.dc.html`; this supersedes the earlier
three-size / ≤500-weight policy).

- Font stacks are tokens: `--od-font-sans: -apple-system, "SF Pro Text", "SF Pro Icons",
  "Helvetica Neue", Helvetica, Arial, sans-serif` (`-apple-system` gives SF Pro with automatic
  optical sizing, so there is no separate Display stack) and `--od-font-mono: "SF Mono",
  ui-monospace, Menlo, Monaco, Consolas, monospace`. The sans stack is applied on **`body`** (not
  only `.od-window`) so body-portaled layers (the account-menu popover) inherit the app face —
  a popover regression once shipped serif because only `.od-window` carried the family; a test
  now guards the `body` rule. One UI family per surface; no decorative fonts in product UI.
- **Type ramp (10 tokenized steps — every `font-size` in cockpit.css routes through one; a test
  forbids any raw numeric font-size/font-weight/letter-spacing outside the token definitions):**
  - `--od-type-tag` 10.5px/14 — ALL-CAPS kickers and chip labels (journal time, station line).
  - `--od-type-meta` 11.5px/16 — counts, timestamps, footnotes, ok-dot lines, micro buttons.
  - `--od-type-sub` 12.5px/17 — descriptions/sub-lines, menu items, compact controls, seg buttons.
  - `--od-type-body` 13.5px/19 — the default: navigation rows, forms, content text, brand label.
  - `--od-type-title-s` 14.5px/20 — row/card titles, primary action labels, lead paragraphs.
  - `--od-type-title` 15.5px/21 — surface titles (Journey aim header, ambient title).
  - `--od-type-title-m` 17.5px/23 — pane/section titles (Settings pane head, first-run mark).
  - `--od-type-title-l` 19px/25 — spotlight titles (your-move title, sidebar "Settings" title).
  - `--od-type-display` 24px/30 — page titles (Welcome back, Memory).
  - `--od-type-hero` 27px/34 — first-run hero and the composer headline input.
- **Weights (tokens): regular 400, medium 500, semibold 600, heavy 700; `strong` is an alias of
  semibold.** Body/nav rest text is regular; medium marks active nav rows, segmented/primary
  button labels, and quiet emphasis; semibold is for true titles and selected hierarchy; heavy is
  ONLY for the brand "A" marks and ALL-CAPS kicker tags. Avoid heavier-than-600 running text and
  avoid 600+ on Chinese UI text where 500 reads better.
- **Tracking (tokens):** `--od-ls-title` −0.01em on title/title-m/title-l, `--od-ls-display`
  −0.015em on display/hero, `--od-ls-caps` +0.06em on ALL-CAPS tags (with CSS
  `text-transform: uppercase` so `zh` strings are unaffected). Everything else stays at 0. Do not
  scale fonts with viewport width.
- Caps-kicker idiom (move tag, TURNS/JOURNAL eyebrows, NEW AIM, sheet title, memory group
  labels): meta size + heavy (or semibold for quiet group labels) + caps tracking + uppercase.
- Line icons use a 1.5–1.6px stroke unless a selected/primary state needs more. Avoid italics.
- Sentence case for labels and action text (the caps idiom above is the exception); short action
  verbs on buttons. Keep paragraph line length ~50–70 characters. Single-line rows use ellipsis;
  multi-line content wraps with a max line count when the surrounding layout is fixed.

## Color, Surfaces, and Materials

- Desktop supports light and dark and follows macOS system appearance by default, with the
  in-app theme toggle as an explicit override synced to native chrome (see IA → Theme toggle).
- The visible material is Glass: the `--desk` gradient backdrop, translucent backdrop-blurred
  `--island` / `--island2` / `--field` surfaces, an inner `--ring` highlight, and structural
  `--edge` hairlines. Blur is applied on islands/cards/sheets (`backdrop-filter: blur(...)`).
  Keep translucency restrained enough that text meets contrast over the gradient in both themes.
- The legacy operational palette still backs `--od-*` tokens for un-migrated selectors:
  light bg `#ffffff`, surface `#f5f5f7`, text `#1d1d1f`, accent `#0071e3`, success `#16a34a`,
  danger `#dc2626`; dark bg `#1c1c1e`, text `#e8e8ed`, accent `#0a84ff`. Prefer Glass tokens for
  new surfaces; do not reintroduce a separate flat theme.
- Use the accent for primary actions, the current step, focused progress, and selected emphasis.
  Do not flood whole islands with accent. Semantic state must never rely on color alone — pair
  color with label text, icon, position, or shape (status dots carry an accessible name/tooltip).
- Avoid dominant one-note palettes, purple/purple-blue gradients, dark slate themes, beige/brown
  themes, decorative orbs, bokeh, and purely atmospheric imagery. Glass uses one restrained
  desktop gradient, not a themed wallpaper.
- Glass color tokens are tuned to meet WCAG AA over the gradient and translucent islands; this
  takes precedence over exact fidelity to the imported reference palette. Concretely: `--faint`
  is `#61616a` (light) / `#9b9ba5` (dark) and the light `--acc` is `#0064cc` so meta text clears
  4.5:1; the you/agent actor chips keep the `--acc-soft` tint but use `--ink2` text (not `--acc`)
  to clear the floor on the pill. Do not revert these to the lower-contrast reference values.

## Radius, Borders, and Elevation

- Radii: Glass islands and large soft containers use 14–24px; cards/sheets ~16–22px; compact
  controls use 8–12px; chips are pill. Do not make tools feel childish with oversized radii on
  small controls.
- Structure comes from hairlines and translucency, not heavy borders: use the `--ring` inner
  highlight + `--edge` hairline on islands, and 1px borders where a control genuinely needs one.
  Active/selected list items change background (translucent `--field`) rather than only text
  color, with no visible border/outline; the only sanctioned selected-shadow is the sidebar row's
  soft `0 1px 3px rgba(30,40,70,.08)` lift from the reference design.
- Elevation is soft and shallow: `--sh-md` for resting cards, `--sh-lg` on hover/overlays,
  `--sh-btn` for the accent primary. Reserve stronger elevation for overlays, popovers, the
  station sheet, and modal-like layers. Non-primary controls converge on the shared quiet
  interaction state: transparent rest, subtle translucent hover, slight shadow only on
  hover/keyboard-focus, plus the accent focus ring. Reserve persistent fills/borders for
  selected/current, active, disabled, primary, or destructive states.

## Controls

- Primary buttons: min-height 40–44px, pill or 8px radius per surface, ~14px semibold text,
  accent background with `--sh-btn`, distinct disabled state.
- Secondary buttons: min-height 32–44px, translucent surface, 12–14px semibold text.
- Icon buttons: recognizable icons with accessible names and tooltips for universal commands.
  Text buttons where language adds clarity. Segmented controls for mode switching with a clear
  active state. Toggles/checkboxes for binary settings.
- Content-entry and navigation rows use one primary row action; secondary/destructive actions go
  behind a trailing More Actions menu (Escape/outside-close, keyboard nav, focus return,
  destructive item states). Review rows may show Accept/Reject; editor rows Submit/Cancel.
- Inputs: 36px minimum for compact search, 44–56px for main task forms; labels above inputs, not
  only placeholders (command-composer is the one exception — accessible label + clear
  placeholder). Textareas ≥140–160px for aim/context input. Static values use static semantics
  (text/output/selectable code), not inert buttons or disabled inputs.
- Progress: thin **6px** bars for passive progress plus explicit text for milestone/evidence
  status. Chips/pills for compact status, filters, and lightweight commands — avoid long labels
  and stacked chip rows in the main task area.
- Command-composer: a Claude-inspired prompt-well — one rounded input container, dominant outcome
  text, a bottom icon toolbar, optional context revealed from the toolbar, an icon-only submit.
  Compact, centered, bounded below the task width; effectively borderless at rest with only a
  subtle hover/focus outline; no heavy launch focus ring or floating-card shadow.
- Planning brain configuration (founder arc 2026-07-24, final form: "the polish should happen in
  the settings and as a main item" + "the UI and aim process now should be simplified"): the ONE
  configuration surface is Settings → Brain — the pane leads with the embedded-brain choice
  (radio rows with readiness dots; Auto shows what it currently resolves to; signed-out rows
  disabled with a humanized reason, raw JSON auth output never reaches the UI), then the
  effective brain's model Select built from its LIVE-advertised list (a fallback catalog never
  becomes a menu; Auto names the model it means), then the API provider form under an ALL-CAPS
  "fallback planning path" subheading (`.od-settings-subheading`). In the Journey, planning
  shows only ONE quiet status chip (`.od-model-chip`: hairline pill, "Brain · model" label) that
  OPENS Settings → Brain — no popovers in the flow. Earlier popover-chip iterations were removed;
  do not reintroduce menu chips beside the primary action. Renderer capability facts come from
  main's `planningCapable` flag on each detection — never a renderer-side mirror. A running
  session shows its actual model as a neutral Pill on the live panel head.

## Interaction and State

- Every interactive element needs visible hover, active, focus-visible, disabled,
  selected/current, loading, and error states where applicable.
- Desktop navigation has exactly one primary current content target: Home, transient New Aim, one
  persisted draft, or one saved aim. Drafts expose Aim/Context/Contracts; saved aims add
  Work/Review. Memory and Settings are overlays/detours that return to the same content target
  and workbench surface without disturbing the workspace/surface navigation epochs. Never render
  one surface's content under another surface's active label.
- Sidebar peek is transient and hover/focus driven with symmetric enter/exit motion; manual
  toggle actions take precedence over peek. Draggable chrome must not cover the toggle or reveal
  hit targets; window drag surfaces stay stable across focus/activation cycles.
- Keyboard focus stays visible (a 4px accent-tinted ring). Core commands are keyboard-first; add
  command-palette entries alongside visible controls for top-level or frequent actions. Pointer
  targets ≥24×24 CSS px (practically 32–44px). Do not interrupt recoverable actions with modal
  dialogs — prefer inline banners, undo, or a review surface.
- Manual proof confirmation opens an evidence submission surface before recording confirmation
  (proof note, URL, local files, required-evidence checklist). Normal navigation must not silently
  discard an open proof draft: block navigation with concise recovery copy until submit or cancel,
  and retain the form + values on failure. Treat evidence confirmation and the follow-up progress
  refresh as separate outcomes.
- Motion is fast, direct, functional (~120–180ms). The only sanctioned loop is the gentle
  running-status dot pulse; avoid decorative animation. Text must never overlap, clip without
  intentional ellipsis, or occlude neighbors at supported sizes and Chinese/English lengths.
- Journey controls follow the shared quiet idiom completely: plan rows and Home cards press with
  `transform: scale(0.99)` on `:active`; every focusable control carries the `--od-focus` ring and
  a ≥24px target. A plan row is a disclosure button (`aria-expanded`); while a proof draft is open
  the other rows disable and normal navigation blocks until submit or cancel (the Execute stage's
  invariant, kept). The journal summary is a real `<details>` summary with a visible focus ring.
- Pressed-scale never goes on a container that hosts an open popover. `:active` bubbles to
  ancestors, and any transform on the popover's ancestor (even scale≈1 mid-transition) creates a
  stacking context that traps the popover under later sibling rows — the sibling steals the
  pointerup and the popover's click silently never fires (2026-07-25 "aims could not be deleted").
  Scale the row's body button (draft-row pattern), or gate the container rule with
  `:not(:has(... [aria-expanded="true"]))` (aim-card pattern). In-sidebar popover cards also cap
  their width to `--sidebar-content-width` so the island's rounded clip never cuts them.

## Voice and Wording

Founder direction 2026-07-24 ("polish the wording of the whole product"): Aimcub's copy speaks
as a working agent, not as a form the user operates.

- Division of verbs. Aimcub's verbs: research, ask, draft, route, verify, remember. The user's
  verbs: start, answer, adopt, confirm, stop. Never give the user a machine verb — "Build the
  plan" is wrong (the brain builds); "Start planning" is right.
- Working states name what Aimcub is doing right now, in one concrete clause, agent-first:
  "Aimcub is researching and drafting…", never mechanism narration ("Checking required context
  before decomposition…").
- Decision moments get decision verbs: adopting a plan is "Adopt this plan", not "Save plan" —
  saving is a file gesture, adopting sets work in motion.
- No dev-speak on product surfaces: "planning brain", never "runtime"; "break down"/"plan",
  never "decompose/decomposition"; raw ids, schema names, and provider internals stay behind
  Developer details.
- Honesty stays in the copy: gaps, fallbacks, and failures are stated plainly ("Use standard
  planning") with the recovery in the same breath. No euphemism, no ceremony.
- zh copy is native product voice, not translationese; user-facing surfaces use 目标 for the
  aim, 规划大脑 for the planning brain; enum values, ids, and technical identifiers stay
  untranslated.
- Kickers/tags stay short and quiet ("Your move — start planning"); bodies may carry one line
  of product differentiation (what Aimcub actually does: local + web research, asks only what
  research can't answer).
- **Status streams: main emits structure, the renderer owns every displayed word** (founder
  2026-07-25, after raw "brain started"/"tool" reached the live planning card). Any main→renderer
  activity/status feed carries machine fields only (kind, code, tool id, count); the renderer
  maps them to localized agent-voice lines and silently DROPS anything it cannot say in product
  language — a raw event type or tool id must never render. Known tools become concrete verbs
  ("Searching the web", "Reading local files"); an UNKNOWN tool id renders as the generic
  "Researching…" line, never humanized-and-interpolated (Codex once emitted an id that read as
  the junk line "Using tool" — founder screenshot).
- The live planning card reads top-down as one thought: pulsing dot + working title, the model
  as one quiet pill, the THOUGHT TRACE, counts only once at least one is non-zero, and quiet
  Add-a-note/Draft-now/Stop controls. While a session runs, the Journey header sub states the
  deal ("Aimcub researches first, and asks only what research can't answer") instead of the
  motto. Never stack zero-counters or multiple mottos on a working surface.
- **The trace, not a status word** (founder 2026-07-25: "show a tree of thoughts instead of
  just 'Researching'", then "polish it"). The card shows the brain's steps as a timeline —
  a quiet node per line with hairline segments between, the current line at body/ink with an
  accent node echoing the header pulse, history receded to meta/faint. HISTORY KEEPS ONLY
  DURABLE EVENTS (findings recorded, questions, answers, notes, plan beats); transient
  working verbs ("Searching the web", "Researching…") appear only as the living last line and
  drop once passed — never "Researching… / … / Researching…" interleaving. Unsayable rows
  drop, duplicates collapse, cap ~6 (`planningActivityTrace`), 160ms entry fade under
  prefers-reduced-motion. The session receipt is plural-proof label-first metadata
  ("Findings 8 · Gaps 4 · Questions 1") on the footer's LEFT, balancing the quiet actions.
- **A paused pass must not imitate a working one** (2026-07-26). The stopped-pass card
  (`PlanningPassPanel`) reuses the live card's shape deliberately — same island, same trace, same
  label-first receipt — so returning reads as the same lane at rest. Exactly two things change, and
  both are honesty, not decoration: the dot is STATIC and muted (`od-journey-dot-idle`, no pulse,
  no accent), and the last trace line carries NO `data-current` / `role="status"`. Nothing is
  happening, so nothing may look like it is. Copy owns what happened without alarm ("Planning
  paused — everything it found is still here"); a closed app is ordinary, not an error. A pass that
  finished a plan leads with the plan ("A plan is waiting for you" + a success pill), never with an
  offer to redo research that already succeeded.
- **No standing input on a watching surface** (same feedback: "doesn't need an input box").
  The mid-research note composer is closed at rest and opens from a quiet "Add a note" action
  (Escape closes, send closes, a non-empty draft keeps it open). The interjection CHANNEL
  stays — only the permanent box goes.
- **Elements integrate; they never stack as separate blocks** (founder 2026-07-25: "not simple
  enough / not integrated"). The mid-research chat is ONE composer: the bordered container IS
  the field, the quiet Send sits inside it, one line at rest (Enter sends, Shift+Enter breaks),
  never a tall empty textarea with a floating primary pill. Card footers stay transparent — an
  opaque full-width bar reads as a slab stuck under the glass card.
- **One card per moment — never card-in-card** (founder 2026-07-25: "too many layers"). The
  Journey's planning island is the ONE chromed surface; everything mounted inside it (session
  live/failed/landed states, the question flow) renders as a `plain` panel directly on the
  island. The only bordered element inside a card is a functional field (the composer, an
  input). Layer budget for a working surface: desk gradient → island → field. Full stop.
- Blocking questions dress for their actual shape: a lone question shows NO "1/1" counter
  (counters only when a flow really has multiple queued questions); the single/multi pill only
  when options exist; an options-less question labels its field "Your answer" ("Add a custom
  answer" only against real options). A planning-session answer submits as "Send answer" —
  never the funnel's "Generate plan", which promises the wrong outcome mid-research.
- Question choice cards are THE SAME SIZE (founder 2026-07-25): the option grid equalizes every
  row to the tallest card (`grid-auto-rows: 1fr`, cards fill their cell) and content reads from
  the top edge — uneven tradeoff copy must never produce a ragged grid or mid-card floating text.

## Accessibility and Localization

- Meet WCAG AA contrast (4.5:1 normal text, 3:1 large text / state icons) — verify Glass text and
  chips over the gradient and over translucent islands in both themes.
- Test high contrast, large text, keyboard-only navigation, and screen-reader accessible names for
  any significant UI change. Every icon-only control and status dot needs an accessible name and
  tooltip. Preserve focus order matching reading order: sidebar → stage nav → workspace → overlays.
- English repo prose is required; Chinese only in `zh` i18n values. Every user-facing string routes
  through `t(...)` (no literals); keep en+zh parity (the `satisfies` guard + a parity test enforce
  it). Dynamic i18n keys (e.g. `glass.journal.event.*`, `glass.station.line.*`,
  `glass.station.meta.*`, `glass.turns.*`, `glass.progress.*`) must all exist — `translate()`
  throws on a missing key. The station-sheet meta status tokens (plan/run/eval milestone and run
  statuses) and the Turns relative-time labels route through `t(...)`; unmapped free-text metas
  (e.g. an eval row's `next_action`) fall through verbatim so `translate()` is never called with an
  unknown key. Design labels to wrap or truncate predictably in both languages.

## Electron Desktop Engineering Details

- Keep the renderer isolated from Node; use preload + typed IPC. New IPC lives in one place across
  `shared/ipc.ts` (channel + `AimcubApi` type), `main/ipc.ts` (handler, validating sender input),
  and `preload/index.ts` (passthrough). Validate privileged operations (file access, agent
  execution, provider settings, external opening, `setThemeSource`).
- Native-system-first appearance: the main process sets `nativeTheme.themeSource` (default
  "system"), paints a matching `BrowserWindow` background, and emits the current `colorScheme` with
  chrome state. The theme toggle overrides `themeSource` via IPC; the `nativeTheme` "updated"
  listener repaints the background and re-emits chrome state.
- `@core` purity is the hard boundary: business logic and pure derivations live in
  `packages/core` / `packages/types` (pure TS, zero platform deps, unit-tested — enforced by
  ESLint `no-restricted-imports` and `types: []`). App shells only render, bridge I/O, and call
  IPC. Keep an incremental, cheap read path: batch list rollups (`listAimProgressSummaries`) over
  N per-item calls; a separate `getAimJournal` rather than bloating the hot `getAimProgress`.
- Keep a restrictive CSP; avoid remote content with Node integration; avoid blocking the main or
  renderer process (defer noncritical work); do not add dependencies for simple UI behavior
  without measuring size/startup/maintenance cost; bundle fonts/assets locally.
- **Popovers must not live inside a blurred, overflow-clipped ancestor.** `backdrop-filter` (the
  sidebar island) makes that ancestor the containing block for `position: fixed` descendants, so
  the ancestor's `overflow` clips them — the account-menu popover renders through a **body
  portal** (geometry captured from its trigger at open time; outside-click checks the portaled
  panel too). Follow the same pattern for any future flyout that must escape an island.

## Implementation Guardrails

- Prefer shared CSS classes and Glass tokens over new inline style islands. Current inline styles
  in renderer files are legacy debt; do not expand the pattern.
- Before adding a component, check whether an existing `od-*` pattern or shared primitive
  (`renderer/ui/`) can be reused or generalized. Pure renderer transforms shared by App
  orchestration live under `renderer/workflow/` (side-effect-free, directly unit-tested).
- If a layout needs repeated values, promote them to CSS custom properties. Paste every Glass
  token identically into both hand-duplicated dark blocks (the guard test catches drift).
- Do not add new default rails, runtime strips, status stacks, or debug cards to the main shell.
  Keep developer/debug surfaces opt-in, bounded, and separately scrollable.
- For frontend changes, inspect the rendered UI at desktop and narrow widths, in **both light and
  dark**, before claiming completion — check text fit over the gradient, focus states, empty
  states, loading states, native traffic lights (drawn by macOS, not in DOM), and CN/EN strings.

## Review Checklist

- Does the screen expose one primary next action (on the Journey, the single live-lane card)?
- Does the layout preserve the default two-column glass shell unless an opt-in surface is opened?
- Are type sizes, weights, line heights, and spacing from this file? Every `font-size`,
  `font-weight`, and `letter-spacing` must use a ramp token — no raw numeric values (a test
  enforces it).
- Do Glass tokens appear identically in all three theme blocks? Is text legible over the gradient
  and translucent islands in both light and dark?
- Are the 15 `data-od-id` anchors intact and the native macOS traffic lights native (no
  React/CSS-drawn dots)?
- Do hover, selected, focus, disabled, loading, error, and empty states exist? Do controls meet
  target-size, contrast, keyboard, and accessible-name expectations (including status dots)?
- Does the UI stay stable at 960×680 / 760×600 / 640×520 with no horizontal overflow?
- Are debug/process details outside the default product view; are Journal and receipt rows real
  (not fabricated)?
- Is business logic in `@core` (pure, tested) with the app only rendering/bridging?
- Did any new user design requirement get added back to this file?
