# Aimcub Handoff

Last updated: 2026-07-05
Branch: `main`

## Current Session

- Fixed packaged Desktop drag-region instability after window focus/activation cycles.
- Added a stable invisible top drag strip outside the dynamic sidebar peek/toggle layers.
- Reset transient sidebar peek state on window blur or document hide so activation cycles cannot leave stale hover state behind.
- Removed the sidebar-wide `no-drag` override so the sidebar header drag region is not nested under a parent no-drag region.
- Added a focused renderer regression test for the stable drag strip and toggle no-drag contract.
- Updated `docs/memory/design-system.md` and `docs/memory/desktop.md` with the durable drag-region stability requirement.
- Ran the `memory-refresh` audit after the drag-region fix commit; root memory files remain within the 50-line budget and no root-memory expansion was needed.

## Current State

- `main` keeps the simplified Desktop shell: no full-width visible titlebar, left sidebar, center workspace, command-composer first-run Aim screen, and settings split-view.
- The root local app bundle at `/Users/jenson/Desktop/Aimcub/Aimcub.app` has been refreshed from `apps/desktop/dist/mac-arm64/Aimcub.app`.
- The packaged app was quit and reopened before inspection to avoid testing a stale Electron process.
- Real packaged-window verification confirmed the drag surface moves the window initially, after an app interaction, and after switching to Finder and back to Aimcub.

## Verification

- Passed:
  - `pnpm --filter @app/desktop test`
  - `pnpm --filter @app/desktop typecheck`
  - `pnpm --filter @app/desktop lint`
  - `pnpm build`
  - `pnpm test`
  - `pnpm typecheck`
  - `pnpm lint`
  - `pnpm core:purity`
  - `git diff --check`
  - `pnpm desktop:pack`
  - copied the packaged bundle to root `Aimcub.app` with `ditto`
  - opened `/Users/jenson/Desktop/Aimcub/Aimcub.app`
  - verified real window movement by reading macOS window coordinates:
    - initial drag moved `(185, 0)` to `(325, 0)`
    - after clicking inside the app, drag moved `(325, 0)` to `(465, 0)`
    - after Finder -> Aimcub activation cycle, drag moved `(465, 0)` to `(325, 0)`
    - final cleanup moved the window back to `(185, 0)`

Notes:
- MCP worker tests still log the expected missing-Supabase opaque-error path while passing.
- Commit/push status: drag-region fix commit `0a7cbff` is local on `main`; this memory-refresh closeout should be committed and pushed with the session closeout.

## Next Session Prompt

```text
Continue from `main`. Start by reading AGENTS.md, docs/handoff.md, and docs/memory/README.md, then load only task-relevant module memory. For Desktop shell work, preserve the top-left sidebar toggle contract: manual click/keyboard toggle wins over hover/focus peek, fresh hover reveal still works from the button and left-edge rail, Electron draggable regions must not cover the toggle/reveal hit targets, and the window drag surface must stay stable across focus/activation cycles.
```
