# Desktop Memory

## Product Surface

Desktop is the primary product surface for the local Aim OS agent harness. CLI remains important for setup, scripting, debugging, and automation, but new orchestration UX should land in Desktop first.

Desktop must be product-first, not debug-first. Model calls, tool traces, prompt previews, runtime internals, and planning debug should be opt-in developer surfaces, not default layout columns.

The user rejected the prior over-stacked desktop direction. Do not add more default rails, debug cards, runtime strips, or status boxes to the main view.

## Current Shell

The default desktop shell is a simplified two-column product layout:

- Left sidebar: brand, language toggle, New Aim, recent aim list, settings. Search/filter appears only after aim history exists; an empty first-run state uses a compact Recent aims placeholder.
- Sidebar toggle: a top-left icon button controls pinned/collapsed sidebar state. When collapsed, hovering or focusing the button reveals a temporary overlay peek sidebar without changing the main workspace width. At narrow mobile-sized widths, the sidebar auto-collapses and any opened sidebar remains an overlay so the workspace does not shrink.
- Center workspace: the empty Aim stage is a quiet command-composer surface with no workflow step pills. Context, Plan/Contracts, Execute, and Eval may show lightweight workflow step pills above the active task surface.
- No visible full-width titlebar above the workbench. Keep macOS window controls in sidebar-safe space and keep command palette access keyboard-first.
- No right inspector/debug rail in the default product shell.

The first-run Aim stage must stay calmer than the composer: no idle titlebar status text, no duplicate "New Aim" eyebrow in the main surface, no automatic heavy focus ring, and no large form-like blank textarea. The primary action is naming the outcome; context is secondary until the next stage.

Selecting an existing aim should open Aim overview first instead of jumping directly into Run details. Existing aims should not show an empty composer on the Context stage.

Completed aims are the exception to the overview default: if `AimProgressReadModel.completion_recap.complete` is true, Desktop should open the Eval stage and show the completion recap.

The renderer was reset from the old debug-heavy cockpit into a compact Aim OS cockpit MVP. It should keep one primary task per screen and avoid stacking unrelated status/debug/runtime panels.

## Design System

Desktop UI changes must follow `docs/memory/design-system.md` for layout, typography, spacing, color, controls, accessibility, and interaction states. If the user gives a new frontend design requirement, update that memory in the same change.

## Context Collection

Desktop context collection is a first-class setup layer. `context-sources.json` records linked local folders, explicit local files, online connector references, web/deep-research preference, dedicated context session toggle, and choice-question toggle.

Planning consumes context before decomposition through `context.linked_sources`, `local.read`, optional `web.search`/`web.fetch`, `context.distill`, and structured user questions. Connector references are locations or access gaps until a runtime can actually read them.

Context Sources shows one setup summary, compact planning readiness gates, and one editable control surface. The gates cover context bundle, research fusion, gap intake, scope guard, and sub-aim readiness; they should explain planning readiness without duplicating the local/online/web/deep/session/questionnaire controls as separate cards or tables.

The Context and Sub-aims stages show a default context bundle review before/inside planning. It classifies used context, skipped/unread context, permission/setup gaps, and unresolved decomposition risks from planning context reports, tool traces, intake questions, review gaps, and plan contract gaps.

User-facing intake questions should come from `generateAimIntakeQuestions` grounded in available context. Do not surface template prompts like "Ask for..." directly to users.

The main Desktop loop reaches Context Inbox from the Eval stage. Pending context candidates render as editable review rows with source, category, confidence, and scope; accept/reject uses the existing context-candidate IPC. Accepting global context makes it active memory for future aim planning, while accepting aim scope keeps it tied to the current aim.

## Local Agents

The local CLI agent harness lives in `apps/desktop/src/main/local-agents.ts`. It detects Codex and Claude CLIs through explicit env overrides, PATH, common install paths, version/auth/model probes, command construction, stdin prompt delivery, and JSONL/stream-json event normalization.

This harness is an Aimcub runtime layer, not MCP. Aimcub owns aim decomposition, context, permissions, evidence, and eval; local CLIs are execution runtimes when no API provider is configured or when the user chooses local execution.

Desktop settings use the app's primary left sidebar as category navigation and the center workspace as the selected detail pane. Provider setup, local CLI agent detection, web research, and context sources stay separated by category instead of stacked into one long page or nested behind a second workspace sidebar. The "Local CLI agents" detail pane includes detection and explicit read-only smoke tests; keep it thin until milestone execution and evidence capture are deeper.

## Next Desktop Direction

The sidebar toggle manual click risk was resolved and verified in the packaged Electron app after the responsive layout cleanup. Continue screen-by-screen layout stabilization from the smallest viable window upward: explicit grid/flex containers, gap-based spacing, bounded widths, consistent control heights, mobile overlay sidebar behavior, and no decorative restyling unless explicitly requested. Keep the single best next action visible. If debug trace is needed, expose it behind developer mode with bounded summaries and independent scrolling.
