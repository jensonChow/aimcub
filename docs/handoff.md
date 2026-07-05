# Aimcub Handoff

Last updated: 2026-07-05
Branch: `main`

## Current Session

- Updated `AGENTS.md` non-negotiables so every repo-changing session must run the full verification suite, refresh the root `Aimcub.app` from `pnpm desktop:pack`, commit, push, and merge completed branch work into `main` unless the user explicitly opts out.
- This follows the user's request to make the project-root app bundle refresh part of the mandatory closeout workflow.

## Current State

- `main` keeps the simplified Desktop shell: no full-width visible titlebar, left sidebar, center workspace, command-composer first-run Aim screen, and settings split-view.
- The sidebar toggle contract remains: manual click/keyboard toggle wins over hover/focus peek; fresh hover reveal still works from the button and left-edge rail; transient peek does not resize the workspace.
- The root packaged app at `/Users/jenson/Desktop/Aimcub/Aimcub.app` must be refreshed before ending any future repo-changing session.

## Verification

- Passed:
  - `pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm core:purity`
  - `pnpm desktop:pack`
  - copy `apps/desktop/dist/mac-arm64/Aimcub.app` to root `Aimcub.app`
  - `git diff --check`

Notes:
- MCP worker tests may log the expected missing-Supabase opaque-error path while passing.
- Because this session edits docs only, the app bundle refresh is procedural rather than code-visible, but it was still completed under the new root rule.
- Commit/push status: this closeout should be committed and pushed after the handoff update. Work happened directly on `main`, so no separate branch merge is needed.

## Next Session Prompt

```text
Continue from `main`. Start by reading AGENTS.md, docs/handoff.md, and docs/memory/README.md, then load only task-relevant module memory. For every repo-changing session, run the full verification suite, refresh root `Aimcub.app` from `pnpm desktop:pack`, commit, push, and merge completed branch work into `main` unless the user explicitly opts out.
```
