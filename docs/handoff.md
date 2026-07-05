# Aimcub Handoff

Last updated: 2026-07-05
Branch: `main`

## Current Session

- Fixed the packaged Desktop sidebar toggle regression reported from the top-left control.
- Changed the macOS BrowserWindow title bar from `hiddenInset` to `hidden` so the renderer owns the toggle hit target while native traffic lights remain visible.
- Restored the toggle to standard click-driven behavior: pointer down only stops propagation, and manual collapse suppresses hover/focus peek until the pointer or focus exits.
- Removed the sidebar-wide Electron drag region and kept drag behavior on the sidebar header only, with the header action area explicitly non-draggable.
- Promoted the durable interaction rule into `docs/memory/design-system.md` and corrected `docs/memory/desktop.md` so future packaged Electron work keeps the toggle free of peek/drag-region regressions.
- Rebuilt and copied the local `Aimcub.app` bundle to the project root.

## Current State

- `main` keeps the simplified Desktop shell: no full-width titlebar, left sidebar, center workspace, command-composer first-run Aim screen, and settings split-view.
- Real packaged Electron inspection of `/Users/jenson/Desktop/Aimcub/Aimcub.app` confirmed the top-left sidebar toggle collapses and expands the sidebar. Accessibility state changed from `收起侧栏` / value `1` to `展开侧栏` / value `0`, then back again.
- During verification, the old running app process had to be terminated before copying the rebuilt bundle; copying over a still-running app produced a stale/corrupt renderer load in that old process.
- Commit/push status: the sidebar-toggle fix is expected to be committed and pushed in the commit containing this handoff update.

## Verification

- Passed:
  - `pnpm --filter @app/desktop typecheck`
  - `pnpm --filter @app/desktop test`
  - `pnpm build`
  - `pnpm test`
  - `pnpm typecheck`
  - `pnpm lint`
  - `pnpm core:purity`
  - `git diff --check`
  - `pnpm desktop:pack`
  - copied `apps/desktop/dist/mac-arm64/Aimcub.app` to root `Aimcub.app`
  - opened and inspected `/Users/jenson/Desktop/Aimcub/Aimcub.app`

Notes:
- MCP worker tests still log the expected missing-Supabase opaque-error path while passing.
- `kill 57741` was run with approval to terminate the stale local Aimcub process before relaunching the rebuilt bundle.

## Next Session Prompt

```text
Continue from `main`. Start by reading AGENTS.md, docs/handoff.md, and docs/memory/README.md, then load only task-relevant module memory. For Desktop shell work, preserve the top-left sidebar toggle contract: manual click/keyboard toggle must win over hover/focus peek, and Electron draggable regions must not cover the toggle hit target.
```
