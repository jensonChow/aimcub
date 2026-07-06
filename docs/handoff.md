# Aimcub Handoff

Last updated: 2026-07-06
Branch: `main`

## Current Session

- Simplified the Desktop Context stage workbench so it no longer dumps source setup, web capability, permission, gate, and review surfaces all at once.
- Context intake now shows one blocking question at a time, with progress text, and only enables plan generation after the step has enough current context.
- Added a workbench variant of `ContextSourcesPanel` that keeps the Context stage focused on aim-local files/folders plus a Settings handoff for advanced helpers.
- Kept the full context-source controls available in Settings, where online connectors, web research, and permission/setup configuration belong.
- Hid the Context bundle review on the Context stage until planning context, tool results, or relevant review items exist.
- Updated `docs/memory/design-system.md` with the durable stepwise Context workbench rule.
- Refreshed root `Aimcub.app` from the latest Electron 43 folder-style Desktop build.

## Current State

- Work was prepared directly on `main`; no separate feature branch merge is needed.
- A focused session commit was prepared on `main`; push to `origin/main` is the remaining repository step.
- Root `Aimcub.app`, `apps/desktop/out`, and `apps/desktop/dist` were refreshed locally and remain ignored build artifacts.
- A temporary Electron/Vite visual harness was attempted for desktop and narrow Context-stage screenshots, but Electron did not advance past app ready in this sandboxed run. Component tests and CSS/DOM assertions cover the simplified workbench structure; a live GUI smoke test remains useful if the next session changes this surface again.

## Verification

Passed:

- `COREPACK_HOME=/private/tmp/aimcub-corepack PATH=/Users/jenson/.local/node/bin:$PATH pnpm --filter @app/desktop test -- ContextSourcesPanel.test.tsx App.test.tsx`
- `COREPACK_HOME=/private/tmp/aimcub-corepack PATH=/Users/jenson/.local/node/bin:$PATH pnpm --filter @app/desktop typecheck`
- `COREPACK_HOME=/private/tmp/aimcub-corepack PATH=/Users/jenson/.local/node/bin:$PATH pnpm --filter @app/desktop lint`
- `git diff --check`
- `COREPACK_HOME=/private/tmp/aimcub-corepack PATH=/Users/jenson/.local/node/bin:$PATH pnpm build`
- `COREPACK_HOME=/private/tmp/aimcub-corepack PATH=/Users/jenson/.local/node/bin:$PATH pnpm test`
- `COREPACK_HOME=/private/tmp/aimcub-corepack PATH=/Users/jenson/.local/node/bin:$PATH pnpm typecheck`
- `COREPACK_HOME=/private/tmp/aimcub-corepack PATH=/Users/jenson/.local/node/bin:$PATH pnpm lint`
- `COREPACK_HOME=/private/tmp/aimcub-corepack PATH=/Users/jenson/.local/node/bin:$PATH pnpm core:purity`
- `git diff --check`
- `ELECTRON_BUILDER_CACHE=/private/tmp/aimcub-electron-builder-cache COREPACK_HOME=/private/tmp/aimcub-corepack PATH=/Users/jenson/.local/node/bin:$PATH pnpm desktop:pack`
- `ditto apps/desktop/dist/mac-arm64/Aimcub.app Aimcub.app`

Notes:

- MCP worker tests may log the expected missing-Supabase opaque-error path while passing.
- The failed temporary visual harness lived under `/private/tmp/aimcub-context-visual-check.mjs` and was not committed.

## Next Session Prompt

```text
Continue from `main`. Start by reading AGENTS.md, docs/handoff.md, and docs/memory/README.md, then load only task-relevant module memory. For repo-changing sessions, run the full verification suite, refresh root Aimcub.app from the packaged Desktop output, update docs/handoff.md, create a focused commit, push, and merge completed branch work into main unless the user explicitly opts out.
```
