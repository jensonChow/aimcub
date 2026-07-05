# Aimcub Handoff

Last updated: 2026-07-05
Branch: `main` after merge from `codex/fix-traffic-light-size`

## Current Session

- Fixed the inactive macOS traffic-light overlay dots so inactive and active states keep the same visual size. The renderer overlay now uses 12 px dots with 8 px gaps, matching the native active control rhythm and the existing 52 px cluster width.
- Updated the Desktop shell tests to lock the traffic-light size/gap tokens and keep the inactive overlay non-interactive.
- Updated `docs/memory/design-system.md` and `docs/memory/desktop.md` with the durable rule that focus changes may alter traffic-light color/opacity, not visual dimensions.

## Current State

- `main` keeps the simplified Desktop shell: no full-width visible titlebar, left sidebar, center workspace, command-composer first-run Aim screen, and settings split-view.
- Settings still lock the primary sidebar open and omit the normal Aim workspace sidebar toggle, peek rail, and `Aimcub / Workbench` brand header.
- The sidebar toggle contract remains: manual click/keyboard toggle wins over hover/focus peek; fresh hover reveal still works from the button and left-edge rail; transient peek does not resize the workspace.
- In normal macOS window mode, the sidebar toggle keeps its existing 76 px left offset after traffic lights. In fullscreen, the renderer receives fullscreen state and moves the toggle to 16 px left, with the drag strip starting after the shifted control.
- Native macOS traffic lights remain visible when the app is inactive through three renderer inactive dots that hide while focused or fullscreen and do not intercept clicks. The inactive overlay dots are 12 px with 8 px gaps, so active and inactive traffic-light states have matching visual dimensions.
- The root packaged app at `/Users/jenson/Desktop/Aimcub/Aimcub.app` was refreshed from `pnpm desktop:pack`.

## Verification

- Passed:
  - `pnpm --filter @app/desktop test -- --runInBand`
  - `pnpm build`
  - `pnpm test`
  - `pnpm typecheck`
  - `pnpm lint`
  - `pnpm core:purity`
  - `pnpm desktop:pack`
  - `git diff --check`
  - `ditto apps/desktop/dist/mac-arm64/Aimcub.app Aimcub.app`
  - `sed -n '92,154p' apps/desktop/out/renderer/assets/index-54Kb9N_F.css`

Notes:
- MCP worker tests may log the expected missing-Supabase opaque-error path while passing.
- Root `Aimcub.app`, `apps/desktop/dist`, and `apps/desktop/out` are ignored build artifacts; they were refreshed locally but are not staged.
- Commit/push status: committed on `codex/fix-traffic-light-size`, pushed, merged into `main`, and `main` pushed.

## Next Session Prompt

```text
Continue from `main`. Start by reading AGENTS.md, docs/handoff.md, and docs/memory/README.md, then load only task-relevant module memory. For every repo-changing session, run the full verification suite, refresh root `Aimcub.app` from `pnpm desktop:pack`, update handoff, commit, push, and merge completed branch work into `main` unless the user explicitly opts out.
```
