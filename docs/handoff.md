# Aimcub Handoff

Last updated: 2026-07-05
Branch: `main`

## Current Session

- Replaced the inactive macOS traffic-light capsule backing with Claude/Codex-style inactive dots: three separate same-color neutral gray circles aligned to the native controls.
- Kept the inactive dots non-interactive and hidden while focused or fullscreen, preserving native traffic-light clicks and the fullscreen toggle offset behavior.
- Updated renderer regression coverage and `docs/memory/design-system.md` so inactive traffic lights use dots rather than a pill/capsule backing surface.

## Current State

- `main` keeps the simplified Desktop shell: no full-width visible titlebar, left sidebar, center workspace, command-composer first-run Aim screen, and settings split-view.
- Settings still lock the primary sidebar open and omit the normal Aim workspace sidebar toggle, peek rail, and `Aimcub / Workbench` brand header.
- The sidebar toggle contract remains: manual click/keyboard toggle wins over hover/focus peek; fresh hover reveal still works from the button and left-edge rail; transient peek does not resize the workspace.
- In normal macOS window mode, the sidebar toggle keeps its existing 76 px left offset after traffic lights. In fullscreen, the renderer receives fullscreen state and moves the toggle to 16 px left, with the drag strip starting after the shifted control.
- Native macOS traffic lights remain visible when the app is inactive through three renderer inactive dots that hide while focused or fullscreen and do not intercept clicks.
- The root packaged app at `/Users/jenson/Desktop/Aimcub/Aimcub.app` was refreshed from `pnpm desktop:pack`.

## Verification

- Passed:
  - Electron CDP inactive chrome check against the built app: inactive state `focused=false`, `trafficLights=true`, dots `opacity=1`, `pointer-events=none`, three 14 px dots at x `16`, `37`, and `58` with neutral gray fill/border.
  - Captured and inspected `/private/tmp/aimcub-inactive-dots.png` to confirm the inactive chrome is three dots, not a capsule.
  - `PATH=/Users/jenson/.local/node/bin:$PATH pnpm --filter @app/desktop test`
  - `PATH=/Users/jenson/.local/node/bin:$PATH pnpm --filter @app/desktop typecheck`
  - `PATH=/Users/jenson/.local/node/bin:$PATH pnpm --filter @app/desktop lint`
  - `PATH=/Users/jenson/.local/node/bin:$PATH pnpm build`
  - `PATH=/Users/jenson/.local/node/bin:$PATH pnpm test`
  - `PATH=/Users/jenson/.local/node/bin:$PATH pnpm typecheck`
  - `PATH=/Users/jenson/.local/node/bin:$PATH pnpm lint`
  - `PATH=/Users/jenson/.local/node/bin:$PATH pnpm core:purity`
  - `PATH=/Users/jenson/.local/node/bin:$PATH pnpm desktop:pack`
  - `git diff --check`
  - `ditto apps/desktop/dist/mac-arm64/Aimcub.app Aimcub.app`

Notes:
- MCP worker tests may log the expected missing-Supabase opaque-error path while passing.
- Root `Aimcub.app` and `apps/desktop/dist/mac-arm64/Aimcub.app` both have `app.asar` timestamp `Jul 5 21:30:14 2026`.
- Commit/push status: committed and pushed directly on `main`; no separate branch merge was needed.

## Next Session Prompt

```text
Continue from `main`. Start by reading AGENTS.md, docs/handoff.md, and docs/memory/README.md, then load only task-relevant module memory. For every repo-changing session, run the full verification suite, refresh root `Aimcub.app` from `pnpm desktop:pack`, update handoff, commit, push, and merge completed branch work into `main` unless the user explicitly opts out.
```
