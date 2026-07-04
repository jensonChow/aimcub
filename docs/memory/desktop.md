# Desktop Memory

## Product Surface

Desktop is the primary product surface for the local Aim OS agent harness. CLI remains important for setup, scripting, debugging, and automation, but new orchestration UX should land in Desktop first.

Desktop must be product-first, not debug-first. Model calls, tool traces, prompt previews, runtime internals, and planning debug should be opt-in developer surfaces, not default layout columns.

The user rejected the prior over-stacked desktop direction. Do not add more default rails, debug cards, runtime strips, or status boxes to the main view.

## Current Shell

The default desktop shell is a simplified two-column product layout:

- Left sidebar: brand, language toggle, New Aim, search/filter, aim list, settings.
- Center workspace: lightweight workflow step pills plus the active task surface.
- No right inspector/debug rail in the default product shell.

Selecting an existing aim should open Aim overview first instead of jumping directly into Run details. Existing aims should not show an empty composer on the Context stage.

The renderer was reset from the old debug-heavy cockpit into a compact Aim OS cockpit MVP. It should keep one primary task per screen and avoid stacking unrelated status/debug/runtime panels.

## Design System

Desktop UI changes must follow `docs/memory/design-system.md` for layout, typography, spacing, color, controls, accessibility, and interaction states. If the user gives a new frontend design requirement, update that memory in the same change.

## Context Collection

Desktop context collection is a first-class setup layer. `context-sources.json` records linked local folders, explicit local files, online connector references, web/deep-research preference, dedicated context session toggle, and choice-question toggle.

Planning consumes context before decomposition through `context.linked_sources`, `local.read`, optional `web.search`/`web.fetch`, `context.distill`, and structured user questions. Connector references are locations or access gaps until a runtime can actually read them.

User-facing intake questions should come from `generateAimIntakeQuestions` grounded in available context. Do not surface template prompts like "Ask for..." directly to users.

## Local Agents

The local CLI agent harness lives in `apps/desktop/src/main/local-agents.ts`. It detects Codex and Claude CLIs through explicit env overrides, PATH, common install paths, version/auth/model probes, command construction, stdin prompt delivery, and JSONL/stream-json event normalization.

This harness is an Aimcub runtime layer, not MCP. Aimcub owns aim decomposition, context, permissions, evidence, and eval; local CLIs are execution runtimes when no API provider is configured or when the user chooses local execution.

Desktop settings include a thin "Local CLI agents" panel with detection and explicit read-only smoke tests. Keep it thin until milestone execution and evidence capture are deeper.

## Next Desktop Direction

Continue screen-by-screen product cleanup, starting with Aim overview and Context collection. Keep the single best next action visible. If debug trace is needed, expose it behind developer mode with bounded summaries and independent scrolling.
