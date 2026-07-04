# Aimcub Handoff

Last updated: 2026-07-04
Branch: `main`

## Current Session

- Fixed the root `pnpm desktop:pack` script so it runs the Desktop package script instead of pnpm's built-in pack command.
- Built an openable macOS app bundle and copied it to the project root at `Aimcub.app`. The bundle is an ignored local artifact and is not committed.
- Removed inactive product surfaces from the active workspace: `apps/web`, `apps/ios`, `apps/extension`, and the old `docs/charters/web.md`.
- Removed unused `packages/ui-tokens`; Desktop token direction now lives in `docs/memory/design-system.md` and current renderer CSS.
- Replaced broad workspace globs with explicit active packages in `pnpm-workspace.yaml`: Desktop, CLI, MCP, and core packages only.
- Updated root/docs memory to state that v1 is Desktop-first local Aim OS, with hosted web/iOS/extension deferred until a real product trigger.
- Cleaned local ignored remnants for the removed surfaces, including old Vercel metadata and local package caches.

## Current State

- Active app surfaces are `apps/desktop`, `apps/cli`, and `apps/mcp`.
- Active packages are `packages/core`, `packages/types`, `packages/store`, `packages/llm`, `packages/api`, and `packages/db`.
- `pnpm desktop:pack` produces the local folder-style app bundle under `apps/desktop/dist/mac-arm64/Aimcub.app`; copy it to root `Aimcub.app` when the user wants the app directly inside the project folder.
- Hosted Supabase remains the online source of truth for MCP evidence and the future platform; the hosted web app should not be reintroduced until sync/collaboration needs it.

## Verification

Passed for this session:

```bash
PATH=/Users/jenson/.local/node/bin:$PATH pnpm build
PATH=/Users/jenson/.local/node/bin:$PATH pnpm test
PATH=/Users/jenson/.local/node/bin:$PATH pnpm typecheck
PATH=/Users/jenson/.local/node/bin:$PATH pnpm lint
PATH=/Users/jenson/.local/node/bin:$PATH pnpm core:purity
git diff --check
```

Packaging command also passed:

```bash
PATH=/Users/jenson/.local/node/bin:$PATH pnpm desktop:pack
```

Commit/push status: this handoff is part of the Desktop packaging script fix commit; use `git log -1` for the final hash after the session commits and pushes.

## Next Session Prompt

```text
Continue from the simplified Aimcub workspace. Start by reading AGENTS.md, docs/handoff.md, and docs/memory/README.md. Then load only the module memory relevant to the task.

Treat Desktop, CLI, MCP, and the core packages as the active code hierarchy. Do not reintroduce hosted web, iOS, browser-extension, or cross-platform token packages without a concrete product trigger and matching memory update.
```
