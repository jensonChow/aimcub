# Desktop Memory

## Product Surface

Desktop is the primary product surface for the local Aim OS agent harness. CLI remains important for setup, scripting, debugging, and automation, but new orchestration UX should land in Desktop first.

Desktop must be product-first, not debug-first. Model calls, tool traces, prompt previews, runtime internals, and planning debug should be opt-in developer surfaces, not default layout columns.

The user rejected the prior over-stacked desktop direction. Do not add more default rails, debug cards, runtime strips, or status boxes to the main view.

Planning, draft, refine, and save failures must show concise product language and a recovery action by default. Raw schema paths, Zod messages, validator dumps, and provider internals belong only behind an explicit Developer details disclosure or debug surface.

Unfinished New Aim work is product data, not a temporary form. Desktop must persist recoverable Aim drafts under the selected local Aimcub data directory before navigation can hide user-entered title, context, answers, generated plan, or save-blocked state. Resume/discard affordances should be quiet and explicit, and drafts must not appear as saved aims until `saveGoal` succeeds.

## Current Shell

The default desktop shell is a simplified two-column product layout:

- Left sidebar: top-left app/workspace navigation holds global sidebar actions, currently Home Panel and a Codex Desktop-like New Aim navigation item. Home Panel returns to the main initial workspace panel. Both are normal sidebar action rows, not cards or CTAs: transparent ghost/default state, compact 32 to 36 px height, visually substantial icons with their visual left edges strictly aligned to the sidebar list inset, normal sidebar label weight from the Desktop type ramp, Command-symbol keyboard hints that are visually revealed only on hover or keyboard focus, and a stable selected state for the current Home Panel or New Aim surface. Selected state uses only a quiet gray fill and normal label weight, with no visible border, inset outline, or selected-state shadow; avoid primary-button color, visible borders, or large rounded-card treatment. Their hover/focus rounded rectangles must be centered in the sidebar with equal left and right inset, even when the sidebar reserves a scrollbar gutter. Hover/focus uses the app-wide quiet interaction state: subtle shared background plus slight shadow elevation, with no white bordered-card treatment. The sidebar toggle, footer user trigger, and other secondary desktop controls should follow the same hover/focus treatment unless they are selected/current, primary, disabled, or destructive. Future app-level actions can join this group. Recent aim rows use the same selected-state language when a saved aim is open. Recent aim list and footer user menu trigger remain separate. Do not show redundant `Aimcub` / `Workbench` text in the normal top-left sidebar chrome. Action rows and the footer user trigger share an icon column plus text baseline; Recent aims labels, search/filter controls, aim rows, and empty states share one list inset and do not show an empty `0` count. Search/filter appears only after aim history exists; an empty first-run state uses a compact Recent aims placeholder.
- Pinned left sidebars expose a transparent resize hot zone with the native resize cursor, not a visible divider, and stable width bounds. The normal Aim sidebar may auto-collapse before medium-width windows squeeze the main workspace, but a user-pinned sidebar must reserve layout space and never cover the workspace; Settings keeps its always-visible category sidebar.
- Footer user menu: the lower-left account trigger owns global controls such as Settings and Language through an account-style popover/menu rather than separate header/footer controls. Keep the popover interior compact and aligned with small labels, tight rows, stable icon/text/action columns, and pointer-open behavior that does not automatically show a first-item focus ring. Language opens as a Claude-like side submenu on hover or keyboard focus, not as an inline click-expanded section.
- Sidebar toggle: outside Settings, a top-left titlebar-cluster icon button controls pinned/collapsed sidebar state. When collapsed, hovering or focusing the button, or hovering the 32 px left-edge reveal rail, reveals a temporary overlay peek sidebar without changing the main workspace width. Clicking to expand creates a pinned sidebar that pushes the workspace instead of covering it.
- Window chrome: normal macOS window mode uses native Electron/macOS traffic lights only, with a Claude/Codex-like main-process shell that positions the native controls. Desktop currently uses Electron 43.0.0; after Electron changes, visually verify that native traffic lights still match the 14 pt Claude/Finder sizing on this machine. Electron 33 rendered them at 12 pt. Renderer code must not draw red/yellow/green or inactive substitute dots. Keep the sidebar toggle after the native traffic-light safe area in normal mode; fullscreen product content moves it left into traffic-light-safe space, but Aimcub must not hide native traffic lights from the macOS fullscreen titlebar when that titlebar is revealed. Desktop follows macOS system light/dark appearance through Electron `nativeTheme`, matching BrowserWindow background colors, and renderer appearance tokens. Detailed visual requirements live in `docs/memory/design-system.md`.
- Center workspace: the initial empty Aim stage is a quiet placeholder with no chat, textarea, continue control, or workflow navigation. The command-composer appears only after the user explicitly starts a New Aim. Saved aim overview and later stage surfaces use compact non-linear workbench navigation above the active task surface: a current-surface label plus a quiet segmented switcher for Aim, Context, Contracts, Work, and Review. Do not render numbered step pills or imply that the surfaces must be completed in order.
- No visible full-width titlebar above the workbench. Keep macOS window controls in sidebar-safe space and keep command palette access keyboard-first.
- The app should launch in a compact desktop footprint, currently around 960 by 680 px, and allow resizing down to roughly 640 by 520 px.
- No right inspector/debug rail in the default product shell.

The first-run Aim stage must stay calmer than an intake surface: no idle titlebar status text, no duplicate "New Aim" eyebrow in the main surface, no automatic heavy focus ring, and no large form-like blank textarea before the user starts a New Aim. Once the composer is explicitly opened, the primary action is naming the outcome; context is secondary until the next stage.

Selecting an existing aim should open Aim overview first instead of jumping directly into Run details. Existing aims should not show an empty composer on the Context stage.

Completed aims are the exception to the overview default: if `AimProgressReadModel.completion_recap.complete` is true, Desktop should open the Eval stage and show the completion recap.

The renderer was reset from the old debug-heavy cockpit into a compact Aim OS cockpit MVP. It should keep one primary task per screen and avoid stacking unrelated status/debug/runtime panels.

## Design System

Desktop UI changes must follow `docs/memory/design-system.md` for layout, typography, spacing, color, controls, accessibility, and interaction states. If the user gives a new frontend design requirement, update that memory in the same change.

## Renderer Structure

`apps/desktop/src/renderer/App.tsx` should stay orchestration-focused: state, IPC calls, stage routing, and handoffs between stage surfaces. Stage-owned view structure lives under `apps/desktop/src/renderer/stages/<stage>/`, currently `context`, `plan`, `eval`, and `execute`. Do not reintroduce large inline Context, Plan/Contracts, Eval, or Execute component bodies into `App.tsx`.

Pure renderer workflow transforms shared by App orchestration live under `apps/desktop/src/renderer/workflow/`. Keep these helpers side-effect-free and directly unit-tested; leave IPC calls and visible state transitions in `App.tsx` unless a behavior-specific test covers the abstraction.

Shared renderer primitives live under `apps/desktop/src/renderer/ui/`. Reuse or extend those primitives for low-risk workbench/helper surfaces before adding new one-off control styling, while keeping the protected shell/sidebar/window-chrome framework unchanged.

## Stage Polish Defaults

The 2026-07-09 Desktop real-use integration keeps the stage loop product-first without expanding scope. Context should omit empty review surfaces in the default ready flow and show a single Continue to Plan action only when no intake question or refinement panel is active. When context collection is active, show activity and sufficiency derived from existing renderer signals: planning live events, planning context/tool traces, intake, review buckets, answers, notes, and source status. Blocking Context intake should read as one assistant/user exchange with source material secondary, not as a setup table or debug form.

Plan/Contracts should keep contract review primary with summary-first sub-aim cards: title, selected route, validation state when present, definition of done, required evidence, and routing rationale stay visible by default, while description/body, why, full eval signal, detailed routing controls, and structure edits stay behind secondary disclosures. Raw `acceptance_rule` JSON belongs only under Developer details. Draft/refine/save planning failures should use product-facing language and recovery routes; raw validation/provider details belong behind Developer details. Validation failures must disable Save until the plan is executable, but must not disable the contract-edit controls needed for repair.

Execute should prioritize selected sub-aim, selected owner/local agent, run state, evidence state, and next human/eval action; runtime metadata stays secondary, and raw `agent.raw` or `agent.message.delta` events stay out of default activity. Eval should lead with trust overview metrics and summary-first milestone cards, with evidence rows and evaluator details behind secondary disclosures while Context Inbox remains part of the Eval flow only when pending candidates exist.

The Execute stage durable default is a selected-work pattern: a compact sub-aim selector, one selected execution detail surface, and one state-dependent primary action. Run agent is primary only for agent-routed incomplete work, Submit proof is primary only for human-routed incomplete work, Review in Eval is primary for completed or low-trust work, and blocked work must show the blocker plus next recovery action. Break Down and alternate run/proof actions stay visually secondary, detailed evidence/evaluator reasoning belongs in Eval, and the local CLI runtime behavior should not change for this polish layer.

## Context Collection

Desktop context collection is a first-class setup layer. `context-sources.json` records linked local folders, explicit local files, online connector references, web/deep-research preference, dedicated context session toggle, and choice-question toggle.

Planning consumes context before decomposition through `context.linked_sources`, `local.read`, optional `web.search`/`web.fetch`, `context.distill`, and structured user questions. Connector references are locations or access gaps until a runtime can actually read them.

The default Context stage workbench is sparse and stepwise: show one blocking intake question at a time, then aim-local file/folder attachment, then planning/review state only after tool context or review items exist, and a single Continue to Plan action when no question or refinement panel is active. During a blocking intake question, keep the current aim summary compact and put source material behind a secondary disclosure so the question is the dominant surface. Do not put provider setup, web capability, online connector setup, permission setup, or planning gate tables in the default workbench. Omit empty context-review buckets so skipped/unread context, permission/setup gaps, and decomposition risks appear only when they exist.

`ContextSourcesPanel` has two intentional surfaces. The workbench variant is for current-aim local material plus a Settings handoff. The settings variant keeps the full context-source setup summary, compact readiness gates, and one editable control surface for local paths, online references, web/deep-research preference, context session, and choice-question controls.

The Context and Sub-aims stages show a default context bundle review before/inside planning. It classifies used context, skipped/unread context, permission/setup gaps, and unresolved decomposition risks from planning context reports, tool traces, intake questions, review gaps, and plan contract gaps.

User-facing intake questions should come from `generateAimIntakeQuestions` grounded in available context. Do not surface template prompts like "Ask for..." directly to users.

The main Desktop loop reaches Context Inbox from the Eval stage. Pending context candidates render as editable review rows with source, category, confidence, and scope; accept/reject uses the existing context-candidate IPC. Accepting global context makes it active memory for future aim planning, while accepting aim scope keeps it tied to the current aim.

## Local Agents

The local CLI agent harness lives in `apps/desktop/src/main/local-agents.ts`. It detects Codex and Claude CLIs through explicit env overrides, PATH, common install paths, version/auth/model probes, command construction, stdin prompt delivery, and JSONL/stream-json event normalization.

This harness is an Aimcub runtime layer, not MCP. Aimcub owns aim decomposition, context, permissions, evidence, and eval; local CLIs are execution runtimes when no API provider is configured or when the user chooses local execution.

Desktop settings use the app's primary left sidebar as category navigation and the center workspace as the selected detail pane. Settings mode locks that sidebar open and does not show the normal Aim workspace sidebar toggle, peek rail, or `Aimcub / Workbench` brand header. Settings sidebar controls, including Back, search, section labels, nav rows, and the footer trigger, must share the main sidebar's content width, row inset, icon column, and text baseline. The Settings search field uses a Codex-like inline magnifying-glass icon in that shared icon column. Selected Settings nav rows use a quiet Codex-like gray fill without a blue active rail; status dots may remain as readiness signals. Settings detail rows use Codex-like thin bordered rounded control groups with internal dividers, without turning helper setup into decorative cards. Detail row status reads as muted text plus a tiny readiness dot, and row actions use quiet gray control surfaces so the settings pane does not read like a colored status report. The Settings workspace may use a wider Codex-like control panel width around 1080 px while keeping header copy narrower. Provider setup, local CLI agent detection, web research, and context sources stay separated by category instead of stacked into one long page or nested behind a second workspace sidebar. The "Local CLI agents" detail pane includes detection and explicit read-only smoke tests; keep it thin until milestone execution and evidence capture are deeper.

## Next Desktop Direction

The non-settings sidebar toggle must remain protected in packaged Electron: manual click/keyboard toggles should not be undone by the same pointer/focus state, fresh hover reveal must still work from the button and left-edge rail, draggable chrome should not cover either hit target, and the window drag surface must remain stable after focus/activation cycles instead of depending only on transient sidebar DOM. Continue screen-by-screen layout stabilization from the smallest viable window upward: explicit grid/flex containers, gap-based spacing, bounded widths, consistent control heights, mobile overlay sidebar behavior, and no decorative restyling unless explicitly requested. Keep the single best next action visible. Use `docs/desktop-polish-audit.md` as the current polish backlog; fix stage/workspace safe-area issues from stage content rather than shell/sidebar selectors. If debug trace is needed, expose it behind developer mode with bounded summaries and independent scrolling.
