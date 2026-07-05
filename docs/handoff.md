# Aimcub Handoff

Last updated: 2026-07-05
Branch: `main`

## Current Session

- Fixed the packaged Desktop sidebar toggle placement and hover-reveal regression reported from the top-left control area.
- Researched Electron's official custom titlebar and custom window interaction guidance: `titleBarStyle: "hidden"` keeps macOS traffic lights while removing the default titlebar, and any overlapping draggable region must be excluded with `app-region: no-drag` or pointer events will not fire.
- Moved the sidebar toggle into a titlebar control cluster immediately after the macOS traffic lights instead of leaving it stranded farther into the canvas.
- Restored hover reveal with two hit targets while collapsed: the titlebar toggle and a 32 px left-edge reveal rail. The rail intentionally bypasses the manual-collapse guard because it represents a fresh pointer entry.
- Kept Electron drag behavior scoped away from the toggle and reveal rail by marking interactive controls and sidebar surfaces as non-draggable, with only the sidebar header retaining drag behavior.
- Promoted the durable interaction and placement rule into `docs/memory/design-system.md` and `docs/memory/desktop.md`.
- Rebuilt and copied the local `Aimcub.app` bundle to the project root.

## Current State

- `main` keeps the simplified Desktop shell: no full-width titlebar, left sidebar, center workspace, command-composer first-run Aim screen, and settings split-view.
- Real packaged Electron inspection of `/Users/jenson/Desktop/Aimcub/Aimcub.app` confirmed the top-left sidebar toggle collapses and expands the sidebar. Accessibility state changed from `收起侧栏` / value `1` to `展开侧栏` / value `0`, then back again.
- Chrome DevTools Protocol hit-testing confirmed `document.elementFromPoint(22, 120)` resolves to `data-od-id="sidebar-peek-trigger"`, and dispatching a real mouse move at that point changes `.od-app.dataset.sidebarState` to `peek`.
- A packaged-app screenshot after that CDP hover showed the overlay sidebar revealed over the workspace, matching the requested hover-reveal behavior.
- During verification, old running app processes had to be terminated before copying the rebuilt bundle; copying over a still-running app can leave stale renderer state in the old process.
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
  - CDP hit-test and hover dispatch against `/Users/jenson/Desktop/Aimcub/Aimcub.app`

Notes:
- MCP worker tests still log the expected missing-Supabase opaque-error path while passing.
- Local packaged app processes were terminated with approval before recopying the rebuilt bundle.

## Next Session Prompt

```text
Continue from `main`. Start by reading AGENTS.md, docs/handoff.md, and docs/memory/README.md, then load only task-relevant module memory. For Desktop shell work, preserve the top-left sidebar toggle contract: manual click/keyboard toggle must win over hover/focus peek, and Electron draggable regions must not cover the toggle hit target.
```
