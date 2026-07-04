# Design System Memory

Last updated: 2026-07-04

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
- Calm density: Aimcub is an operational desktop tool. Prefer compact, scannable, quiet layouts over marketing-like hero sections, decorative cards, large illustrations, or expressive gradients.
- Context is a substrate: show context health as concise status, setup controls, and review affordances. Do not turn memory/context into a profile page or a decorative feed.
- Evidence is trustworthy UI: completion, progress, warnings, and quality claims must show the evidence or review path behind them without exposing private chain-of-thought.
- No style churn: do not adopt platform fashion changes, glass effects, 3D depth, or animation-heavy treatments unless they improve Aimcub's actual workflow.

## Desktop Information Architecture

- Default shell: native-feeling titlebar/status strip, left aim sidebar, center workspace. No default right inspector.
- Sidebar: brand, language toggle, New Aim, aim search/filter, recent aim list, settings entry. Keep it narrow enough to preserve work area, currently around 280 px.
- Center workspace: workflow step navigation, then the active stage surface. The workspace should sit in a constrained max width so text lines and controls do not stretch across large windows.
- Optional inspector: process, context, quality, activity, and debug details may exist as an opt-in overlay, drawer, popover, or developer-mode surface. It must be independently scrollable and cannot displace the primary task by default.
- Stage model: Aim -> Context -> Plan/Contracts -> Execute -> Eval. Stage navigation may be visible, but each stage must still present a single dominant action.
- Existing aims open to Aim overview first. Do not jump users into Run details or show an empty composer on the Context stage.
- Settings are a utility surface. Keep provider setup, local CLI agent detection, web research settings, and context sources clear and thin unless they become the user's current task.

## Layout Rules

- Use a 4 px base grid. Preferred spacing tokens: 4, 6, 8, 10, 12, 14, 16, 18, 24, 32, 40, 56, 72.
- Page/workspace padding: 24 px minimum on desktop, expanding to a restrained max such as 72 px. Use 18 px on narrow desktop windows.
- Content width: main task surfaces should generally max at 760 px for writing/intake and 940 px for operational grids or review surfaces.
- Sidebar width: default 280 px. Avoid widths below 240 px or above 320 px unless a user-resizable sidebar is implemented with stable min/max bounds.
- Vertical rhythm: 22 to 24 px between major page bands, 12 to 16 px between controls inside a group, 6 to 10 px inside compact repeated items.
- Lists: use stable row heights and predictable alignment. Aim cards and context rows should not resize dramatically on hover, loading, selection, or locale changes.
- Cards: use cards only for repeated items, forms, modals, and genuinely framed tools. Do not put cards inside cards, and do not turn whole page sections into floating cards.
- Tables/grids: use explicit grid tracks with `minmax(0, 1fr)` so long text truncates or wraps intentionally.
- Responsive behavior: start from the smallest viable window and scale up. At narrow widths, collapse the sidebar, wrap stage controls, stack multi-column grids, and preserve all functionality.
- Large windows: do not let controls drift apart. Use max-width containers and local alignment groups so related labels, inputs, and actions remain visually connected.

## Typography

- Desktop font stack: `"SF Pro Text", "SF Pro Icons", "Helvetica Neue", Helvetica, Arial, sans-serif`.
- Display/title stack: `"SF Pro Display", "SF Pro Icons", "Helvetica Neue", Helvetica, Arial, sans-serif`.
- Monospace stack: `"SF Mono", ui-monospace, Menlo, Monaco, Consolas, monospace`.
- Windows fallback, when needed: `"Segoe UI Variable", "Segoe UI", Arial, sans-serif`.
- Use one UI type family per app surface. Do not mix decorative fonts into product UI.
- Letter spacing is always `0`. Do not use negative letter spacing.
- Do not scale fonts directly with viewport width. Use defined text styles. Existing `clamp()` hero-like sizing should be replaced when the next visual pass touches it.
- Type ramp:
  - Caption/meta: 11 px, line-height 16 px, weight 600 to 750.
  - Small UI/labels: 12 px, line-height 16 px, weight 600 to 750 for labels; 400 to 500 for secondary text.
  - Sidebar/item titles: 13 px, line-height 16 to 18 px, weight 650.
  - Body/control text: 14 px, line-height 20 px, weight 400 to 500.
  - Form body/editing text: 15 px, line-height 22 px, weight 400.
  - Body large/explanatory text: 17 to 18 px, line-height 25 to 28 px, weight 400.
  - Section title: 20 px, line-height 28 px, weight 650 to 750.
  - Page title: 28 px, line-height 36 px, weight 700 to 750.
  - Large title: 34 to 38 px, line-height 42 px, weight 700 to 750, only for the New Aim or overview lead surface with enough surrounding whitespace.
- Use regular weight for body text and semibold/heavy only for structure or selected actions. Avoid italics and all caps.
- Use sentence case for UI labels and action text. Buttons should use short action verbs such as "Save", "Review", "Continue", "Add files".
- Keep paragraph line length roughly 50 to 70 characters. Use tighter widths for explanatory copy and summaries.
- Truncation: single-line rows use ellipsis; multi-line content should wrap deliberately with a maximum line count when the surrounding layout is fixed.

## Color, Surfaces, and Materials

- Default Desktop theme is light. Dark mode can be added later, but every token must support high contrast and system preference.
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
- Hover states should be subtle: background, border, or text color changes within 160 ms. Pressed state can use `transform: scale(0.99)` only on compact controls where it does not blur text or shift layout.

## Controls

- Primary buttons: min-height 40 to 44 px, pill or 8 px radius depending on local surface, 14 px semibold/heavy text, accent background, disabled state visually distinct.
- Secondary buttons: min-height 32 to 44 px, surface background, border, 12 to 14 px semibold text.
- Icon buttons: use recognizable icons with accessible names and tooltips. Prefer an icon for universal commands like search, close, collapse, settings, folder, file, refresh, save, download, and undo.
- Text buttons: use when the command needs language for clarity, especially primary task actions and destructive decisions.
- Segmented controls: use for mode switching and mutually exclusive filters. Keep labels short and ensure active state has border/background distinction.
- Toggles/checkboxes: use for binary settings. Do not use pills as toggles unless the state is explicit.
- Menus/popovers: use for option sets and overflow commands. They must not hide the primary next action.
- Inputs: 36 px minimum for compact search, 44 to 56 px for main task forms. Labels sit above inputs, not only as placeholders.
- Textareas: use at least 140 to 160 px height for aim/context input, with clear resize or fixed growth behavior.
- Progress: use thin 6 px bars for passive progress and explicit text for milestone/evidence status.
- Pills/chips: use for compact status, filters, and lightweight commands. Avoid long chip labels and do not stack many chip rows in the main task area.

## Interaction and State

- Every interactive element needs visible hover, active, focus-visible, disabled, selected/current, loading, and error states where applicable.
- Keyboard focus must remain visible. Current focus token is a 4 px accent-tinted ring; keep or improve it, do not remove it.
- Pointer targets should be at least 24 by 24 CSS px, with practical Aimcub targets usually 32 to 44 px.
- Do not interrupt the user with modal dialogs for recoverable actions. Prefer inline banners, undo, or a review surface.
- Destructive actions need undo when possible. If undo is not possible, require explicit confirmation with action-specific button labels.
- Loading states should preserve layout dimensions. Avoid spinners that replace large content areas without a stable skeleton, label, or status.
- Motion should be fast, direct, and functional. Keep transitions around 120 to 180 ms. Avoid decorative animation loops.
- Text must never overlap, clip inside buttons without intentional ellipsis, or occlude neighboring content at supported window sizes and Chinese/English locale lengths.

## Accessibility and Localization

- Meet WCAG AA contrast: 4.5:1 for normal text and 3:1 for large text or icons conveying state.
- Test high contrast, large text, keyboard-only navigation, and screen reader accessible names for any significant UI change.
- Do not hard-code font sizes in ways that block OS text scaling when native platform support is available.
- Preserve visible focus order that matches reading order: titlebar/status, sidebar controls, stage navigation, workspace content, optional overlays.
- Every icon-only control needs an accessible label and tooltip.
- English repo prose is required. Chinese can appear only in `zh` i18n values. Design for both languages by allowing labels to wrap or truncate predictably.
- Avoid abbreviations unless already introduced and useful. User-facing errors should state what happened, what Aimcub preserved, and the next action.

## Electron Desktop Engineering Details

- Renderer should stay isolated from Node. Use preload and typed IPC for allowed operations.
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
