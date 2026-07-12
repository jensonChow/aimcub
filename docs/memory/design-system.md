# Design System Memory

Last updated: 2026-07-11

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
  backdrop-blurred "islands" (sidebar, workspace, cards, sheets), soft shadows, pill chips,
  14–24px radii, and full light+dark token sets.
- **A "Journey" information architecture** for the work surface — a 6-station strip
  (Aim · Research · Context · Plan · Run · Eval), a single "Your move" card (or an "Ambient"
  card when nothing is waiting on the human), a "Turns" roster, a "Journal" receipt/evidence
  timeline, and a read-only station drill-in **sheet**. Memory is promoted to a top-level page;
  Home / New / Settings are reworked in the same visual language.

**Shipped** (stages 0/A/B/C/D on `main`): the additive Glass token set in `cockpit.css`
(present identically in all three theme blocks), the gradient-desktop + translucent-island
shell, the `JourneyView` work surface, Glass Home / New / Memory / Settings pages, row/card
glassification, the sidebar Memory nav row + `~/.aimcub · local` footer + theme toggle, the
`listMemories` / `getAimJournal` / `listAimProgressSummaries` IPC, the real (`@core`) Research
station and run-lifecycle journal, and the batch per-aim progress dots. Before making desktop
visual changes, read `docs/handoff.md` and the loading order in `docs/memory/desktop.md`.

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
  is the single "Your move" card; secondary facts (Turns, Journal, stations) support it.
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
- Context stage workbench is stepwise and sparse. Keep provider setup, web capability, online
  connectors, and permission configuration in onboarding or Settings. While a blocking question
  or optional draft refinement is active, that question flow is the whole task surface: hide the
  Aim summary and edit action, automated activity, sufficiency, source controls, bundle review,
  and future questions. Show one reply lane plus one bottom primary action. After the question
  flow ends, restore aim-local attachments/notes and planning/review state with a single
  Continue to Plan action when no refinement panel is active.
- Context stage intake is an iterative context-building loop, not a dashboard or blocking form.
  Derive automated activity and sufficiency from live planning events, planning context/tools,
  intake, review buckets, answers, notes, and source status; show that overview only while
  collection runs without a user question or after the focused question flow. Activity copy
  summarizes tool/action state (local reads, linked context, web research, distillation,
  follow-up questions, access gaps) without exposing raw prompts, traces, or chain-of-thought.
  A question stays visible while the user selects choices or types a custom answer, and advances
  only through an explicit Next. After each answer, generate the next highest-value question
  from the same intake run and cumulative history; stop when no consequential unknown remains or
  the bounded limit is reached. Pending draft refinement survives current-tab clicks and stage
  re-entry; only a successful refinement or explicit accept/skip completes it. Do not show a
  question-specific custom answer and a general context note at once. If all intake paths are
  disabled, replace the question with one Settings recovery action.
- Choice-card controls render the normalized domain mode instead of inferring it from option
  count or question category. Expose single selection as a `radiogroup` of `radio` choices with
  one roving tab stop and Arrow/Home/End navigation; expose multiple selection as pressed toggle
  buttons. Keep the custom-answer lane available in both modes.
- Context bundle review is a default product surface before/inside planning: separate used
  context, skipped/unread context, permission/setup gaps, and unresolved decomposition risks
  without exposing raw prompts or traces, and omit empty buckets.
- Evidence is trustworthy UI: completion, progress, warnings, and quality claims show the
  evidence or review path behind them without exposing private chain-of-thought. The Journey's
  station sheets and Journal are read-only receipts derived from real orchestration state — bind
  them to real data with honest empty states; never fabricate rows.
- Eval is the trust center for an aim: its default view makes evidence, matched rule/evaluator,
  trust score, missing/low-trust proof, and learned-context review clear without sending users
  to Settings or debug surfaces. Empty Context Inbox states do not render a full review block.
- Completed aims use the Eval stage for a factual, compact completion recap (final outcome,
  completed sub-aims, passing evidence, eval result, learned context, future reuse). Not a
  celebration or marketing page.

## Desktop Information Architecture

- Default shell: no visible full-width top titlebar/status strip. A left aim sidebar island and
  a center workspace island float over the `--desk` gradient. macOS window controls sit in the
  sidebar-safe top area; the app must not reserve a full-width bar above the workbench. No
  default right inspector.
- **Native macOS traffic lights must stay native.** AppKit/Electron draws and owns the
  red/yellow/green controls; Aimcub's main process only positions them (`titleBarStyle:
  "hiddenInset"`, `trafficLightPosition`, `setWindowButtonPosition`, `setWindowButtonVisibility`).
  Desktop uses Electron 43; keep the fixed 46px titlebar-safe row with a 14px traffic-light
  metric, and keep the geometry constants (16/46/14 in `main/index.ts`) in sync with the CSS
  `--traffic-light-*`. **Do not draw red/yellow/green or inactive substitute dots in React/CSS.**
  Custom titlebar controls (sidebar toggle) sit beside the native controls, outside
  transform/zoom/filter containers, with `no-drag` hit targets and a separate drag region.
- **Theme toggle.** Desktop follows macOS system appearance by default. The Glass sidebar footer
  has an explicit light/dark toggle: a renderer-owned `themePref` ("system" default,
  `localStorage`-persisted) drives Glass tokens off `data-system-appearance`, and it is synced to
  the **native** window chrome through an IPC → `nativeTheme.themeSource` handler (which triggers
  the main process to repaint `win.setBackgroundColor` and re-emit chrome state), so an in-app
  override does not desync the native titlebar/traffic-light context from the visible content.
  "system" hands appearance back to the OS. Renderer dark tokens respond to both
  `prefers-color-scheme: dark` and `data-system-appearance="dark"`.
- Sidebar: the top-left area is app-level navigation (Home Panel, New Aim) as normal action
  rows — transparent rest, compact 32–36px height, substantial icons aligned to the list inset,
  normal-weight labels, Command-symbol hints revealed on hover/focus, and a stable selected
  state. Glass hover/selected states use translucent `--island2` / `--field` washes (not flat
  gray fills); selected rows show a quiet fill with no border/outline/selected-shadow. Below the
  recent-aims list, a Glass footer block holds a **Memory nav row**, a `~/.aimcub · local` line,
  and the theme toggle. Recent-aim rows carry a small trailing **status dot marker** (see
  Status markers) — a marker, never a status subtitle.
- Sidebar aim and draft rows are compact one-line navigation rows: prefer a concise generated
  `goal_summary`, else conservative intent-prefix cleanup with a grapheme-safe bound; keep the
  canonical title for editing/planning/search/CLI/agents. One 36px line with CSS ellipsis; the
  full cleaned summary is exposed from the focusable row tooltip. Do not show workflow status
  subtitles ("Context needed", "Plan ready", "active", …) under titles.
- Sidebar footer user menu: the lower-left account trigger opens an account-style popover with
  Settings and Language (Language as a Claude-like hover side submenu). Compact menu-like
  interior, no auto first-item focus ring on pointer open.
- Sidebar toggle: a top-left titlebar-cluster icon button (pinned / collapsed / peek). Clicking
  toggles pinned/collapsed; pinned reserves layout space and never covers the workspace; while
  collapsed, hovering the button or the 32px left-edge rail reveals a transient overlay peek
  sidebar without resizing the workspace. In fullscreen the product toggle moves left into
  traffic-light-safe space, but native traffic lights must remain in the revealed system titlebar.
- Center workspace: a constrained-max-width workbench. For a saved aim the default surface is
  the **Journey** work view (replacing the old `AimOverviewPanel`). **There is no top workbench
  stage switcher** — the old `.od-stage-nav` strip was removed (Stage 7) because it duplicated the
  Journey's own 6-station strip above every open goal. The heavier interactive stage panels
  (Context/Plan/Run/Eval) are unchanged and still reached through the epoch-safe
  `openCockpitStage(...)` — now via the Journey's own `onOpenStage`, the Cmd/Ctrl+1..5 shortcuts,
  and the Cmd+K command palette. `.od-main` is a single-row grid (`minmax(0,1fr)`); the
  `.od-workspace` child is the `overflow:auto` scroll container.
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
  `renderer/workflow/journey/` off the existing `AimProgressReadModel` (+ the run-event journal
  and the aim's memories): a 6-station strip (Aim · Research · Context · Plan · Run · Eval) with
  per-station status glyphs and one-line summaries; a single "Your move" card (reusing the
  Execute stage's `executePrimaryAction` mapping) or an "Ambient" card when an agent is running
  or the aim is idle/complete; a "Turns" roster of who is doing what now; and a "Journal" ledger
  merging appended evidence with run-lifecycle events, newest-first. Clicking a station opens a
  read-only **sheet** (local component state — it never touches the workspace/surface navigation
  epochs and clears on any real navigation); the sheet footer CTA routes into the interactive
  stage via `openCockpitStage`. Research is a real `@core`-derived station (gathered-context
  signal) shown as a read-only receipt; do not fabricate demo content.
- Status markers: per-aim rollup state on list surfaces (sidebar rows, Home cards) is a small
  colored **dot** with an accessible name — never a text subtitle. Dot semantics: complete
  (`--okdot`), running (`--acc`, gentle pulse), needs-you (`--warndot`), blocked (`--danger`),
  planning (hollow ring). Home cards additionally show a thin 6px progress bar + `{done}/{total}`.
  These read from the cheap batch `listAimProgressSummaries` endpoint, not N per-aim progress
  calls.
- Optional inspector: process/context/quality/activity/debug detail may exist as an opt-in
  overlay/drawer/developer surface — independently scrollable, never displacing the primary task.
- Stage model: Aim, Context, Plan/Contracts, Execute/Work, Eval/Review are iterative workbench
  surfaces, not a strict wizard. The Journey's own 6-station strip is the navigation surface
  (there is no separate top mode switcher); each full-page stage presents a single dominant action
  and is opened from the Journey / palette / keyboard, not a persistent segmented control.
- Existing aims open to the Journey (aim overview) first, not Run details; completed aims
  (`completion_recap.complete`) open Eval with the recap.
- Settings use a split-view IA: the primary left sidebar becomes settings-category navigation and
  the workspace becomes the selected detail pane. Do not add a second in-workspace settings nav
  or stack provider / local-agent / web-research / context-source forms into one long page.
  Settings mode locks its category sidebar (no Aim workspace toggle / peek rail / brand header);
  it uses quiet gray selected rows (no blue rail), thin bordered control groups with internal
  dividers, muted status text plus tiny readiness dots, and a wider ~1080px control panel with
  narrower readable header copy. Keep "next setup" guidance in Overview only. Command palette
  (Cmd/Ctrl+K) provides keyboard-first navigation; add entries when a workflow becomes top-level
  (Memory is a candidate follow-up).

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
- Sidebar width: default 280px, stable bounds ~216–360px, transparent resize hot zone with the
  native cursor (not a permanent divider). The normal Aim sidebar may auto-collapse before the
  workspace is squeezed below a usable width; a user-pinned sidebar reserves space and never
  covers the workspace. Settings keeps its always-visible category sidebar.
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

- Desktop font stack: `"SF Pro Text", "SF Pro Icons", "Helvetica Neue", Helvetica, Arial,
  sans-serif`. Display/title: `"SF Pro Display", …`. Mono: `"SF Mono", ui-monospace, Menlo,
  Monaco, Consolas, monospace`. Windows fallback: `"Segoe UI Variable", "Segoe UI", Arial,
  sans-serif`. One UI family per surface; no decorative fonts in product UI.
- Letter spacing is always `0` (no negative tracking). Do not scale fonts with viewport width;
  use the defined ramp.
- **Type ramp (capped at three visible sizes).** `--od-type-meta` 12px / 16px line-height for
  meta, captions, small labels, chips, keyboard hints; `--od-type-body` 13px / 18px for
  navigation, body, controls, rows, form copy; `--od-type-title` 16px / 22px for page/panel/
  section/composer/card titles. New CSS `font-size` must use a ramp token or a value outside the
  guarded integer set — a test forbids raw `font-size:` at {9,10,11,12,13,14,15,16,18,20,22,28,
  32}px, so non-listed decimals (13.5, 19) are the escape hatch for a one-off.
- Weights stay light and tokenized: regular and medium both 400, semibold 450, strong 500. Treat
  any heavier title/emphasis token as an alias of strong. Use regular/medium for navigation and
  body; reserve strong only for true hierarchy, selected actions, or primary commands. Avoid
  600+ in shell chrome, sidebar rows, compact labels, or Chinese UI text. Line icons use a 1.5–
  1.6px stroke unless a selected/primary state needs more. Avoid italics and all caps.
- Sentence case for labels and action text; short action verbs on buttons. Keep paragraph line
  length ~50–70 characters. Single-line rows use ellipsis; multi-line content wraps with a max
  line count when the surrounding layout is fixed.

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
  color, with no visible border/outline/selected-shadow.
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
- Journey drill-in controls follow the shared quiet idiom completely: station tiles and Home cards
  press with `transform: scale(0.99)` on `:active`; every focusable control (including the journal
  "view" links) carries the `--od-focus` ring and a ≥24px target. The station "sheet" is a real
  modal — on open it moves focus into the dialog (the close button), closes on Escape, and restores
  focus to the control that opened it. Not-started ("up") station names read one level quieter
  (`--mut`) than done/current ones.

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

- Does the screen expose one primary next action (on the Journey, the single "Your move")?
- Does the layout preserve the default two-column glass shell unless an opt-in surface is opened?
- Are type sizes, weights, line heights, and spacing from this file? Do new `font-size`s use ramp
  tokens (or non-listed decimals)?
- Do Glass tokens appear identically in all three theme blocks? Is text legible over the gradient
  and translucent islands in both light and dark?
- Are the 15 `data-od-id` anchors intact and the native macOS traffic lights native (no
  React/CSS-drawn dots)?
- Do hover, selected, focus, disabled, loading, error, and empty states exist? Do controls meet
  target-size, contrast, keyboard, and accessible-name expectations (including status dots)?
- Does the UI stay stable at 960×680 / 760×600 / 640×520 with no horizontal overflow?
- Are debug/process details outside the default product view; are Journal/sheet rows real (not
  fabricated)?
- Is business logic in `@core` (pure, tested) with the app only rendering/bridging?
- Did any new user design requirement get added back to this file?
