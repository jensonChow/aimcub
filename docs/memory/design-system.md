# Design System Memory

Last updated: 2026-07-07

## Scope

This is the durable visual and interaction design system for Aimcub frontends, with Desktop as the primary product surface. Future Desktop work must follow this document unless the user explicitly changes the design direction.

When the user gives any frontend or visual-design requirement, update this file in the same change. Keep the requirement durable here, then implement it in the relevant app.

## Research Inputs

- Microsoft Windows app design principles and guidelines: calm, coherent, familiar, accessible, clear hierarchy, predictable navigation, task-first commands, consistent typography.
- Microsoft typography guidance: system fonts, few type styles, left alignment, minimum readable UI sizes, concise strings, semibold emphasis instead of excessive bold/italic.
- GNOME HIG: design for people, make each view simple, reduce user effort, avoid interruptions, keep each view focused, avoid deep navigation, adapt smoothly across window sizes.
- GNOME styling and accessibility guidance: default light style unless content demands dark, support high contrast, avoid color-only meaning, prefer system/component style variables, test with keyboard and screen readers.
- W3C WCAG 2.2: text contrast should meet 4.5:1 for normal text and 3:1 for large text; keyboard focus must be visible; pointer targets should be at least 24 by 24 CSS pixels or have enough spacing.
- Electron security and performance guidance: keep Electron current, isolate renderers, avoid remote code with Node integration, define CSP, validate IPC senders, avoid blocking main/renderer processes, defer expensive work, and profile real bottlenecks.
- Apple Human Interface Guidelines remain a platform reference for macOS feel, but the current public HIG page requires JavaScript in the research environment. Treat stable macOS principles as native-feeling behavior, restrained chrome, system typography, and predictable window/menu conventions, not as permission to chase every visual trend.

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

- Aim-first: the aim, next action, current stage, context quality, and evidence state are the product. Decorative or avatar-like surfaces must not compete with the aim.
- Product-first, debug-second: the default Desktop shell must not show model calls, prompt previews, runtime logs, trace streams, or stacked debug panels. Developer diagnostics belong behind an explicit developer surface.
- One primary task per screen: a view should make one user action obvious. Secondary facts can be visible only when they support that action.
- Desktop quality bar: Aimcub should feel like a focused desktop workbench, not a web dashboard inside Electron. Prefer stable panes, compact command surfaces, native-feeling shortcuts, complete control states, and strict row/spacing rhythm over page-by-page component stacks.
- Calm density: Aimcub is an operational desktop tool. Prefer compact, scannable, quiet layouts over marketing-like hero sections, decorative cards, large illustrations, or expressive gradients.
- First-run quality bar: an empty Aimcub workspace must not auto-render a chat or intake composer in the main area. Keep the initial main workspace as a quiet placeholder until the user explicitly starts a New Aim; the future default main content is intentionally undecided.
- First-run shell chrome must stay quiet while no aim has started. Do not show idle status text, duplicate product labels, heavy focus rings, large helper copy, or oversized empty surfaces in the initial empty workspace.
- Context is a substrate: show context health as concise status, setup controls, and review affordances. Do not turn memory/context into a profile page or a decorative feed.
- Context source setup must keep one clear summary plus one editable control surface; do not repeat local, online, web, deep research, context-session, or questionnaire controls as separate card, table, and toggle representations. Planning readiness gates may sit under the summary as compact rows when they explain why planning can proceed or what remains blocked.
- Context stage workbench must be stepwise and sparse. Keep provider setup, web capability, online connectors, and permission configuration in onboarding or Settings; the default Context stage should show one blocking question at a time, with compact current-aim context and source material as a secondary disclosure during that blocking state, then aim-local attachments or notes, then planning/review state only after it is relevant, with a single Continue to Plan action when no question or refinement panel is active.
- Context bundle review is a default product surface before/inside planning. It should separate used context, skipped or unread context, permission/setup gaps, and unresolved decomposition risks without exposing raw prompts, model traces, or chain-of-thought, and it should omit empty buckets so setup gaps and risks appear only when they exist.
- Evidence is trustworthy UI: completion, progress, warnings, and quality claims must show the evidence or review path behind them without exposing private chain-of-thought.
- Eval is the trust center for an aim: its default view should make evidence, matched rule/evaluator, trust score, missing or low-trust proof, and learned context review clear without sending users to Settings or debug surfaces.
- No style churn: do not adopt platform fashion changes, glass effects, 3D depth, or animation-heavy treatments unless they improve Aimcub's actual workflow.

## Desktop Information Architecture

- Default shell: no visible top titlebar/status strip, left aim sidebar, center workspace. macOS window controls may sit in the sidebar-safe top area, but the app must not reserve a full-width bar above the workbench. No default right inspector.
- Native macOS traffic lights must stay native and standard-feeling. Follow Claude/Codex's shell pattern: AppKit/Electron draws and owns the red/yellow/green controls, while Aimcub's main process manages their position with Electron window APIs such as `titleBarStyle`, `trafficLightPosition`, `setWindowButtonPosition`, and `setWindowButtonVisibility`. Desktop currently uses Electron 43.0.0. Electron 33 rendered 12 pt traffic lights on this machine while the current desktop toolchain matches Claude/Finder at 14 pt, measured as 28 physical pixels in active window screenshots. Use a fixed 46 px titlebar-safe row with a 14 px traffic-light metric, and keep the invisible top drag strip broad enough for comfortable window movement. Do not draw red/yellow/green or inactive traffic-light substitutes in React/CSS; active/inactive appearance belongs to macOS. Custom titlebar controls such as the sidebar toggle must sit beside the native controls, outside transform/zoom/filter containers, with button hit targets marked `no-drag` and the background drag region kept separate. Fullscreen product content may move custom controls left because traffic lights are not part of the product page, but the app must not hide native traffic lights from the macOS fullscreen titlebar when that titlebar is revealed.
- Sidebar: the top-left area is app-level/workspace navigation for global sidebar actions, currently Home Panel plus a Codex Desktop-like New Aim navigation item. Home Panel returns to the main initial workspace panel. These actions must behave like normal sidebar action rows, not cards or CTAs: transparent ghost/default background, compact 32 to 36 px height, visually substantial icons, normal sidebar text weight, Command-symbol keyboard hints that are visually revealed only on hover or keyboard focus, and a stable selected/current state for the active Home Panel or New Aim surface. Selected sidebar rows use a quiet gray fill and normal text weight with no visible border, inset outline, or selected-state shadow; avoid primary-button colors, large card treatment, strong borders, or an elevated CTA feel. The action rows' hover/focus rounded rectangles must be centered in the sidebar with equal left and right inset, even when the sidebar reserves a scrollbar gutter. Keep each icon and label tightly grouped while aligning the icon's visual left edge to the sidebar list inset, not just centering it inside a loose slot. Hover/focus may use a very subtle background plus slight shadow elevation. Future global actions can join this group, while aim search/filter, recent aim list, and footer user menu trigger remain separate. Do not repeat the Aimcub brand or Workbench label in the normal top-left sidebar chrome.
- Sidebar alignment should feel Claude-like: app action rows and the footer user trigger share one icon column and one text baseline, while recent-aim section labels, search/filter controls, aim rows, and empty states share one consistent list inset. Do not show a `0` count beside the Recent aims label in an empty sidebar.
- Sidebar footer user menu: the lower-left account/user trigger opens an account-style popover menu. Put Settings and Language inside this menu; do not scatter these global controls across the sidebar header and footer. The popover interior should stay compact and menu-like: small meta-sized labels, tighter 32 px rows, consistent icon/text/action columns, and no automatic first-item focus ring when opened by pointer. Language options should use a Claude-like side submenu: hovering or focusing Language opens options beside the menu without requiring a click, and the pointer path into the option list must remain stable.
- Sidebar toggle: provide a Claude Desktop-like icon button as part of the top-left titlebar control cluster, immediately after the macOS traffic lights with an 8 px gap in normal window mode. In macOS fullscreen, move the product-page toggle left into the traffic-light-safe space instead of preserving the normal window offset, while leaving the native traffic lights available in the revealed system titlebar. It must support three states: pinned sidebar, collapsed sidebar, and peek sidebar. Clicking toggles pinned/collapsed; pinned must reserve layout space and never cover the workspace, while hovering the button or the 32 px left-edge reveal rail while collapsed reveals a temporary overlay sidebar without resizing the workspace.
- Center workspace: workflow step navigation, then the active stage surface. The workspace should sit in a constrained max width so text lines and controls do not stretch across large windows.
- New/empty Aim stage: hide workflow step navigation until there is an Aim or the user moves into later stages. The initial empty workspace should be a quiet placeholder without chat, textarea, or continue controls. Only show the concise command-composer workbench after the user explicitly starts a New Aim, with one outcome input, optional supporting context, and one primary continue action.
- Empty sidebar state: when there are no aims, do not show search, filters, or a large dashed empty card. Show a compact history placeholder under Recent aims. Add search/filter only after aim history exists.
- Explicit new-aim composer should follow a Claude-inspired prompt-well pattern when opened: one rounded input container, outcome text as the dominant prompt area, a bottom toolbar with icon buttons, optional context revealed from the toolbar instead of always occupying vertical space, and an icon-only submit affordance. Keep it compact, visually centered within the workspace, bounded below the main task width when the workspace is wide, avoid automatic heavy focus rings on launch, avoid visible top titlebar or titlebar "ready" text competing with the input, and avoid large shadow that makes the surface feel like a floating card. The composer border should be effectively absent at rest and appear only as a subtle light hover/focus-visible outline; do not leave a persistent bright border around the input. Composer placeholder text should sit slightly lower than the top edge, matching Claude's relaxed prompt-well alignment. The empty composer toolbar should not show redundant instructional text; the placeholder carries that guidance. Composer icon controls must use fixed square targets with centered SVGs so plus and submit affordances do not drift when sharing generic button classes.
- Command palette: Desktop must provide a Cmd/Ctrl+K command surface for common navigation and actions. Keyboard shortcuts should be real, visible where useful, and not merely decorative labels.
- Optional inspector: process, context, quality, activity, and debug details may exist as an opt-in overlay, drawer, popover, or developer-mode surface. It must be independently scrollable and cannot displace the primary task by default.
- Stage model: Aim -> Context -> Plan/Contracts -> Execute -> Eval. Stage navigation may be visible, but each stage must still present a single dominant action.
- New aim title and description belong to the Aim stage. The Context stage should confirm the captured aim and collect answers, attachments, and sources; it must not show a second title/description composer unless the user explicitly opens child-aim breakdown or an unsaved-aim edit path.
- Context and Plan/Contracts stages should show the context bundle review as part of the default workflow, using compact buckets and clear empty states rather than a hidden inspector or debug trace.
- Plan/Contracts defaults to execution contract review, not a JSON/debug editor. Each sub-aim card should be summary-first by default: title, selected owner or agent route, validation state when present, definition of done, required evidence, and routing rationale. Description/body, why this exists, full eval signal, detailed routing override controls, and structure edits belong behind secondary disclosures. Raw `acceptance_rule` JSON belongs only behind an explicit per-sub-aim Developer details disclosure, while Save Aim remains the obvious primary action.
- Execute and Eval are distinct stages. Execute answers "Who/what should do the next work?" with assignments, agent run, human proof, and child-breakdown actions. Eval answers "What evidence exists, did it satisfy the rule, and what needs review?" with evidence counts/details, evaluator status, trust/explanation, and pending context candidates when present.
- Execute and Eval must be evidence-detail-first. Counts alone are insufficient: evidence rows should show summaries, trust, matched acceptance rule indexes/evaluators, pass/fail reasoning, and actionable missing/low-trust states from the core read model.
- Local agent execution summaries must stay inside the Execute stage and show the selected sub-aim, selected local agent, model/reasoning/workspace when recorded, run state, produced or low-trust evidence, and the next required human/eval action. Use clear placeholders when the current read model lacks a field, and keep raw run events out of the default view except for compact user-facing activity summaries.
- Context Inbox belongs in the Eval review flow, not Settings or developer/debug surfaces. Candidate rows should use compact review cards with provenance chips, editable text, explicit aim/global scope controls, and primary accept plus secondary reject actions. Copy must make clear that accepted global context is reused for future aim planning.
- Completed aims use the Eval stage for a completion recap. The recap should stay factual and compact: final outcome, completed sub-aims, passing evidence, eval result, learned context, and future reuse. Do not turn this into celebration, marketing copy, or a decorative success page. Pending context candidates must remain reviewable from Eval after the recap appears.
- Existing aims open to Aim overview first. Do not jump users into Run details or show an empty composer on the Context stage.
- Settings are an aim-helper setup surface, not a flat runtime control panel. Frame provider setup, local CLI agent detection, web research, and context sources as helpers needed to complete aims; keep their configuration clear and thin unless setup is the user's current task.
- Settings must use a split-view information architecture where the primary left app sidebar becomes the settings category navigation and the center workspace becomes the selected detail pane. Do not add a second settings navigation inside the workspace, and do not stack provider, local CLI agent, web research, and context-source forms into one long settings page.
- Settings must feel like a control panel, not a status report or onboarding checklist. The settings sidebar uses compact 32 to 36 px icon-plus-label navigation rows with a quiet Codex-like selected background, no blue active rail, and at most tiny status dots; the detail pane uses Codex-like wider control-group width around 1080 px while keeping headers and explanatory copy on narrower readable line lengths. Settings row groups can use Codex-like thin bordered rounded control panels with internal dividers, but they must stay functional and sparse rather than becoming decorative cards. Settings sidebar controls must follow the same strict left-alignment discipline as the main sidebar: shared content width, shared row inset, one icon column, one text baseline, and no per-control padding drift. The Settings search field should follow the Codex pattern with an inline magnifying-glass icon in the shared icon column and placeholder text aligned to nav labels. Keep "next setup" guidance in Overview only; detail row controls should be quiet gray surfaces, with status rendered as muted text plus a tiny readiness dot instead of colored pills. Reserve green for real success, and avoid large helper cards, progress bars, repeated green rails, and stacked bordered containers.
- Settings mode has a locked, always-visible category sidebar. Do not show the normal Aim workspace sidebar toggle, peek rail, or Aimcub/workspace brand header inside Settings; Settings starts with its own back control and category navigation.
- First-run with no provider or local CLI agent must stay aim-first. Capture the aim before helper setup, then explain the required helper capability from that aim and link to contextual Aim helpers settings.

## Layout Rules

- UI cleanup passes should be layout-stability work, not visual restyling. Fix missing grid/flex/gap constraints, stray margin/padding positioning, inconsistent row/control heights, mobile overflow, and CSS that lets elements drift, while avoiding new gradients, shadows, decoration, or feature work.
- Use a 4 px base grid. UI cleanup work should converge touched layout spacing to 4, 8, 12, 16, 24, and 32 px. Older 6, 10, 14, 18, 40, 56, and 72 px values are legacy allowances only until their local layout is touched.
- Page/workspace padding: 24 px minimum on desktop, expanding to a restrained max such as 32 px for dense workbench views. Use 16 px on narrow desktop and mobile windows.
- Content width: main task surfaces should generally max at 760 px for writing/intake and 940 px for operational grids or review surfaces.
- Sidebar width: default 280 px. Fixed sidebars need a transparent resize hot zone and native resize cursor at the sidebar edge, not a permanently visible divider. Keep stable bounds around 216 to 360 px and auto-collapse the normal Aim sidebar before it squeezes the main workspace below a usable width.
- Desktop window sizing should stay compact by default. Avoid launching a large window that dominates the desktop; current default bounds are about 960 by 680 px with minimum bounds around 640 by 520 px.
- Vertical rhythm: 22 to 24 px between major page bands, 12 to 16 px between controls inside a group, 6 to 10 px inside compact repeated items.
- Lists: use stable row heights and predictable alignment. Aim cards and context rows should not resize dramatically on hover, loading, selection, or locale changes.
- Sidebar rows should behave like desktop navigation rows: stable 36 to 48 px rhythm, subtle hover, clear selected state, compact status badge or marker, and no card-like stacking unless the row contains genuinely multi-line content.
- Cards: use cards only for repeated items, forms, modals, and genuinely framed tools. Do not put cards inside cards, and do not turn whole page sections into floating cards.
- Tables/grids: use explicit grid tracks with `minmax(0, 1fr)` so long text truncates or wraps intentionally.
- Responsive behavior: start from the smallest viable window and scale up. At narrow widths, collapse the sidebar, wrap stage controls, stack multi-column grids, and preserve all functionality.
- Workflow stage navigation must respect the native titlebar/sidebar-toggle safe area at compact desktop widths. Solve overlap from stage/workspace layout (`.od-main`, `.od-stage-nav`, `.od-workspace`) by centering on normal widths and wrapping or compressing labels at narrow widths, without changing shell/sidebar/window-chrome selectors.
- Large windows: do not let controls drift apart. Use max-width containers and local alignment groups so related labels, inputs, and actions remain visually connected.

## Typography

- Desktop font stack: `"SF Pro Text", "SF Pro Icons", "Helvetica Neue", Helvetica, Arial, sans-serif`.
- Display/title stack: `"SF Pro Display", "SF Pro Icons", "Helvetica Neue", Helvetica, Arial, sans-serif`.
- Monospace stack: `"SF Mono", ui-monospace, Menlo, Monaco, Consolas, monospace`.
- Windows fallback, when needed: `"Segoe UI Variable", "Segoe UI", Arial, sans-serif`.
- Use one UI type family per app surface. Do not mix decorative fonts into product UI.
- Letter spacing is always `0`. Do not use negative letter spacing.
- Do not scale fonts directly with viewport width. Use defined text styles. Existing `clamp()` hero-like sizing should be replaced when the next visual pass touches it.
- Desktop type ramp is capped at three visible sizes. Use `--od-type-meta` 12 px / 16 px line-height for meta text, captions, small labels, chips, and keyboard hints; `--od-type-body` 13 px / 18 px line-height for navigation, body, controls, rows, and form copy; and `--od-type-title` 16 px / 22 px line-height for page, panel, section, composer, and card titles.
- Desktop font weights must stay light and tokenized: regular and medium both resolve to 400, semibold resolves to 450, and strong resolves to 500. Treat any heavier title/emphasis token as an alias of strong unless the user explicitly asks for a bolder surface.
- Use regular or medium weight for navigation and body text, and reserve strong weight only for true hierarchy, selected actions, or primary commands. Avoid defaulting to 600+ weights in shell chrome, sidebar rows, compact labels, or Chinese UI text. Desktop line icons should generally use a refined 1.5 to 1.6 px stroke unless a selected/primary state needs more emphasis. Avoid italics and all caps.
- Use sentence case for UI labels and action text. Buttons should use short action verbs such as "Save", "Review", "Continue", "Add files".
- Keep paragraph line length roughly 50 to 70 characters. Use tighter widths for explanatory copy and summaries.
- Truncation: single-line rows use ellipsis; multi-line content should wrap deliberately with a maximum line count when the surrounding layout is fixed.

## Color, Surfaces, and Materials

- Desktop supports light and dark appearances and must follow the macOS system appearance by default. Use Electron `nativeTheme` and CSS `prefers-color-scheme`/`data-system-appearance` tokens; do not add an in-app theme switch until there is a concrete product reason.
- Current desktop palette:
  - Background: `#ffffff`
  - Surface: `#f5f5f7`
  - Warm surface: `#fbfbfd`
  - Text: `#1d1d1f`
  - Secondary text: `#424245`
  - Muted text: `#6e6e73`
  - Meta text: `#86868b`
  - Border: `#d2d2d7`
  - Soft border: `#e8e8ed`
  - Accent: `#0071e3`
  - Success: `#16a34a`
  - Warning: `#b7791f`
  - Danger: `#dc2626`
- Current dark desktop palette:
  - Background: `#1c1c1e`
  - Surface: `#2c2c2e`
  - Warm surface: `#242426`
  - Text: `#e8e8ed`
  - Secondary text: `#c9c9cf`
  - Muted text: `#a8a8af`
  - Meta text: `#8f8f99`
  - Border: `#4a4a4f`
  - Soft border: `#38383d`
  - Accent: `#0a84ff`
  - Success: `#32d74b`
  - Warning: `#ffd60a`
  - Danger: `#ff453a`
- Use accent for primary actions, current step indicators, focused progress, and selected command emphasis. Do not flood whole panels with accent color.
- Semantic states must not rely on color alone. Pair color with label text, icon, position, or shape.
- Borders should do most separation work. Shadows are rare and shallow, reserved for overlays, popovers, floating restore controls, or modal-like layers.
- Avoid dominant one-note palettes, purple/purple-blue gradients, dark slate themes, beige/brown themes, decorative orbs, bokeh backgrounds, and purely atmospheric images in app UI.
- The old cross-platform `@ui/tokens` package was removed. Future token work should start from this light operational system and only add a shared package when multiple active surfaces need it.

## Radius, Borders, and Elevation

- Radius tokens: 8 px small, 12 px medium, 16 px large, pill for compact rounded controls.
- Cards and fixed tool surfaces should generally use 8 px or 12 px radius. Use 16 px only for larger, soft containers where it does not make the tool feel childish.
- Use 1 px borders for structure. Prefer soft borders for normal containers and stronger borders for selection, focus-adjacent states, and active rows.
- Active/selected list items should change background and border, not only text color.
- Hover and focus states for non-primary desktop controls should converge on the New Aim treatment: transparent/default rest state, a subtle shared hover background, and slight shadow elevation only while hovered or keyboard-focused. Avoid hover states that turn controls into white bordered cards. Focus must keep the visible accent focus ring plus the subtle elevation. Reserve persistent filled backgrounds or borders for selected/current, active, disabled, primary, or destructive semantic states.

## Controls

- Primary buttons: min-height 40 to 44 px, pill or 8 px radius depending on local surface, 14 px semibold/heavy text, accent background, disabled state visually distinct.
- Secondary buttons: min-height 32 to 44 px, surface background, border, 12 to 14 px semibold text.
- Icon buttons: use recognizable icons with accessible names and tooltips. Prefer an icon for universal commands like search, close, collapse, settings, folder, file, refresh, save, download, and undo.
- Text buttons: use when the command needs language for clarity, especially primary task actions and destructive decisions.
- Segmented controls: use for mode switching and mutually exclusive filters. Keep labels short and ensure active state has border/background distinction.
- Toggles/checkboxes: use for binary settings. Do not use pills as toggles unless the state is explicit.
- Menus/popovers: use for option sets and overflow commands. They must not hide the primary next action.
- Inputs: 36 px minimum for compact search, 44 to 56 px for main task forms. Labels sit above inputs, not only as placeholders.
- Command-composer inputs are the one exception to visible label placement: when the composer is the primary task surface, use accessible labels plus clear placeholder text, and keep supporting context visually subordinate.
- Textareas: use at least 140 to 160 px height for aim/context input, with clear resize or fixed growth behavior.
- Progress: use thin 6 px bars for passive progress and explicit text for milestone/evidence status.
- Pills/chips: use for compact status, filters, and lightweight commands. Avoid long chip labels and do not stack many chip rows in the main task area.

## Interaction and State

- Every interactive element needs visible hover, active, focus-visible, disabled, selected/current, loading, and error states where applicable.
- Sidebar peek must be transient and hover/focus driven: it should open after a short hover delay, stay open while the pointer is over the toggle, reveal rail, revealed sidebar, or brief transition path between them, and close without changing the pinned/collapsed preference only after the pointer leaves that whole hover zone.
- Hover-revealed overlays, including sidebar peek, must have symmetric enter and exit motion. Keep the overlay rendered and visible until the collapse transition finishes; do not hide or unmount it instantly on pointer leave.
- Manual sidebar toggle actions take precedence over peek behavior: clicking or keyboard-toggling collapsed must not immediately reopen from the same pointer/focus state, but a fresh hover over the button or left-edge rail must still reveal the overlay sidebar. Draggable chrome must not cover the toggle or reveal hit targets, and window drag hit areas must stay stable across window focus and activation cycles instead of depending only on transient hover/peek sidebar DOM.
- Keyboard focus must remain visible. Current focus token is a 4 px accent-tinted ring; keep or improve it, do not remove it.
- Core desktop commands should be available through keyboard-first flows. Add command palette entries alongside visible controls when a workflow becomes top-level navigation or a frequent action.
- Pointer targets should be at least 24 by 24 CSS px, with practical Aimcub targets usually 32 to 44 px.
- Do not interrupt the user with modal dialogs for recoverable actions. Prefer inline banners, undo, or a review surface.
- Planning question surfaces must distinguish blocking pre-draft context from optional post-draft refinements. Pre-draft intake should make the blocked next step explicit; post-draft clarification should keep accepting the draft available without implying the user is stuck.
- Generated plan review must support direct pre-save editing of sub-aim text, eval/acceptance rules, routing overrides, merge/split, and reorder without leaving the Plan/Contracts stage, even when those controls are in secondary disclosures. Validation issues should be inline and must disable saving until the plan is executable.
- Manual proof confirmation must open an evidence submission surface before recording confirmation. The surface should collect proof note, URL, local file references when available, and required-evidence checklist mapping; Eval should show the submitted evidence details.
- Destructive actions need undo when possible. If undo is not possible, require explicit confirmation with action-specific button labels.
- Loading states should preserve layout dimensions. Avoid spinners that replace large content areas without a stable skeleton, label, or status.
- Motion should be fast, direct, and functional. Keep transitions around 120 to 180 ms. Avoid decorative animation loops.
- Text must never overlap, clip inside buttons without intentional ellipsis, or occlude neighboring content at supported window sizes and Chinese/English locale lengths.

## Accessibility and Localization

- Meet WCAG AA contrast: 4.5:1 for normal text and 3:1 for large text or icons conveying state.
- Test high contrast, large text, keyboard-only navigation, and screen reader accessible names for any significant UI change.
- Do not hard-code font sizes in ways that block OS text scaling when native platform support is available.
- Preserve visible focus order that matches reading order: sidebar controls, stage navigation, workspace content, optional overlays.
- Every icon-only control needs an accessible label and tooltip.
- English repo prose is required. Chinese can appear only in `zh` i18n values. Design for both languages by allowing labels to wrap or truncate predictably.
- Avoid abbreviations unless already introduced and useful. User-facing errors should state what happened, what Aimcub preserved, and the next action.

## Electron Desktop Engineering Details

- Renderer should stay isolated from Node. Use preload and typed IPC for allowed operations.
- Desktop window appearance should stay native-system-first: main process sets `nativeTheme.themeSource = "system"`, applies a matching `BrowserWindow` background color, and emits the current `colorScheme` with window chrome state. Renderer dark tokens must respond to both `prefers-color-scheme: dark` and `data-system-appearance="dark"` so native theme changes are reflected without local UI preferences.
- Do not load remote content with Node integration. Prefer local packaged UI and trusted HTTPS resources only when needed.
- Validate IPC senders for privileged operations such as file access, agent execution, provider settings, and external opening.
- Keep or add a restrictive Content Security Policy for renderer HTML.
- Avoid blocking the Electron main process. Long-running CPU work should move to workers, child processes, or the existing local-agent runtime boundary.
- Avoid blocking renderer interaction. Defer noncritical work with idle scheduling, workers, or staged loading.
- Do not add dependencies for simple UI behavior without measuring size, startup cost, and maintenance risk.
- Bundle static fonts/assets locally if the app depends on them. A desktop app should not wait on network resources for core UI.

## Implementation Guardrails

- Prefer shared CSS classes and tokens over new inline style islands. Current inline styles in renderer files are legacy debt; do not expand the pattern.
- Before adding a component, check whether an existing `od-*` pattern can be reused or generalized.
- If a layout needs repeated values, promote them to CSS custom properties or token exports instead of copying literal values.
- Do not add new default rails, runtime strips, status stacks, or debug cards to the main Desktop shell.
- Keep developer/debug surfaces opt-in, bounded, and separately scrollable.
- For frontend changes, inspect the rendered UI at desktop and narrow widths before claiming completion. Check text fit, focus states, empty states, loading states, and Chinese/English strings when relevant.

## Current Desktop Token Direction

- The source of truth for Desktop today is `apps/desktop/src/renderer/cockpit.css`.
- `apps/desktop/src/renderer/styles.ts` contains older shared inline-style helpers and should gradually converge toward the CSS token system.
- The removed `packages/ui-tokens` package represented an older dark cross-platform palette. Do not recreate it unless it matches this document or is split into platform-specific token sets.

## Review Checklist

- Does the screen expose one primary next action?
- Does the layout preserve the default two-column shell unless an opt-in surface is explicitly opened?
- Are type sizes, weights, line heights, and spacing from this file?
- Are labels concise, action-oriented, and sentence case?
- Do hover, selected, focus, disabled, loading, error, and empty states exist?
- Do controls meet target-size, contrast, keyboard, and accessible-name expectations?
- Does the UI remain stable at narrow and wide window sizes?
- Are debug/process details outside the default product view?
- Did any new user design requirement get added back to this file?
