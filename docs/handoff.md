# Aimcub Handoff

Last updated: 2026-07-05
Branch: `main`

## Current Session

- Started a Desktop UI polish session from the user's request to remove the top title bar.
- Removed the visible full-width `CockpitShell` titlebar, including the top-right command trigger, while preserving the keyboard-first command palette behavior.
- Let the Desktop layout fill the full window height and moved macOS traffic lights into sidebar-safe space.
- Updated the settings-shell render test so the absence of the old titlebar is asserted.
- Promoted the no-visible-top-titlebar rule into `docs/memory/design-system.md` and `docs/memory/desktop.md`.
- Rebuilt and copied the local `Aimcub.app`, then restarted and visually inspected the real app window.
- Added a Claude Desktop-style sidebar toggle near the macOS traffic lights.
- Implemented the sidebar's three states: pinned, collapsed, and hover/focus peek overlay.
- Fixed collapsed layout so the main workbench remains centered/full-width while the sidebar is hidden.
- Hardened the toggle click path by making pointer down switch immediately from a fixed top-layer button while preserving accessibility click support.
- Updated Desktop/design memory with the new collapsible-sidebar behavior.
- After that commit, the user manually reported that the toggle still cannot be used. Treat the sidebar toggle as unresolved despite passing local automated/accessibility-style checks.

## Current State

- `main` supports the local Aim OS loop plus the primary-sidebar Settings surface, keyboard command palette navigation, and the command-composer first-run Aim screen.
- The primary sidebar has an attempted top-left toggle implementation for pinned/collapsed/peek states, but manual click usability is currently unresolved and must be debugged before further sidebar polish.
- Settings keeps helper setup product-focused: the primary left sidebar owns Overview, Planning model, Local CLI agents, Web research, and Context sources navigation; the center workspace owns the selected detail pane.
- The visual system now has stronger shell-level rules for no visible full-width top titlebar, collapsible/peek sidebars, stable sidebar rows, real command shortcuts, preference-style helper forms, quiet first-run chrome, and command-composer empty states, but a deeper pane/artifact system is still future work.
- Operations memory now explicitly says visible Desktop UI changes require `pnpm desktop:pack`, copying `apps/desktop/dist/mac-arm64/Aimcub.app` to root `Aimcub.app`, restarting/opening that exact bundle, and inspecting the real window.
- Context Sources still has one setup summary, compact planning readiness gates, and one editable control surface. The gates cover context bundle, research fusion, gap intake, scope guard, and sub-aim readiness.

## Verification

- Verification passed for the current desktop and memory-refresh state:
  - `pnpm build`
  - `pnpm test`
  - `pnpm typecheck`
  - `pnpm lint`
  - `pnpm core:purity`
  - `git diff --check`
- Additional desktop checks passed before the full run:
  - `pnpm --filter @app/desktop typecheck`
  - `pnpm --filter @app/desktop test`
  - `pnpm desktop:pack`
  - copied `apps/desktop/dist/mac-arm64/Aimcub.app` to root `Aimcub.app`
  - restarted and inspected `/Users/jenson/Desktop/Aimcub/Aimcub.app`

Notes:
- MCP worker tests intentionally log the expected missing-Supabase opaque-error path while passing.
- Real app visual verification confirmed the old top titlebar and top-right command trigger are absent. Computer Use/accessibility-style clicks toggled the sidebar, but the user subsequently reported normal manual clicking still fails.
- Commit: completed for the sidebar-toggle changes. Push is pending explicit user approval because the environment previously blocked pushing to an unverified external remote.
- Open risk: sidebar toggle manual pointer hit testing is not resolved. Next work must reproduce with real pointer input, inspect Electron draggable/titlebar regions and z-index/hit target behavior, and avoid claiming success until the user can click the control.

## Next Session Prompt

```text
Continue from `main`. Start by reading AGENTS.md, docs/handoff.md, and docs/memory/README.md, then load only task-relevant module memory. First fix the unresolved Desktop sidebar toggle: the code has pinned/collapsed/peek state, but the user reports normal manual clicking still fails despite Computer Use/accessibility clicks toggling it. Reproduce with real pointer input, inspect Electron draggable/titlebar regions and z-index/hit target behavior, and do not claim success until the user can click the control. Preserve the no-visible-full-width-titlebar direction, stable workbench shell, command-composer first-run Aim stage, Settings split view, Context Sources one-summary/one-control rule, and full required verification gates.
```
