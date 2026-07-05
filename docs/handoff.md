# Aimcub Handoff

Last updated: 2026-07-06
Branch: `codex/compatible-dependency-upgrades`

## Current Session

- Upgraded dependencies to the newest mutually compatible set: Electron 43.0.0, electron-builder 26.15.3, electron-vite 5.0.0, Vite 7.3.6, React 19.2.7, TypeScript 6.0.3, Vitest 4.1.9, ESLint 10.6.0, Zod 4.4.3, Supabase JS 2.110.0, Anthropic SDK 0.110.0, Wrangler 4.107.0, and Turbo 2.10.3.
- Kept `@vitejs/plugin-react` at 5.2.0 and Vite at 7.3.6 because `@vitejs/plugin-react` 6 requires Vite 8 while `electron-vite` 5 supports Vite 5-7.
- Kept `@types/node` on the latest Node 22 line, 22.20.0, because the project runtime baseline is Node `>=22.13`.
- Updated pnpm build-script allowlist for `@swc/core` and `electron-winstaller`, both required by the upgraded desktop toolchain.
- Adapted code for Zod 4 and TypeScript 6: shared ID validation now uses Zod 4 GUID semantics to preserve existing database UUID-string behavior, record schemas use explicit string keys, CSS imports use Vite ambient declarations, and new ESLint 10 findings are fixed.
- Refreshed root `Aimcub.app` from a new Electron 43 folder-style build.

## Current State

- `pnpm outdated -r` only reports intentional compatibility boundaries: `@types/node` 22.20.0 vs 26.1.0, `@vitejs/plugin-react` 5.2.0 vs 6.0.3, and Vite 7.3.6 vs 8.1.3.
- `pnpm desktop:pack` may still fail inside the sandbox because electron-builder 26 invokes `@electron/get`'s macOS cache under `~/Library/Caches/electron`; use the documented split build plus `--config.electronDownload.cache=/private/tmp/aimcub-electron-cache` workaround in `docs/memory/operations.md`.
- Root `Aimcub.app`, `apps/desktop/dist`, and `apps/desktop/out` are ignored build artifacts and are not staged.
- Commit/push/merge status is pending closeout from this branch.

## Verification

Passed:

- `COREPACK_HOME=/private/tmp/aimcub-corepack PATH=/Users/jenson/.local/node/bin:$PATH pnpm install --lockfile-only --store-dir /private/tmp/aimcub-pnpm-store`
- `COREPACK_HOME=/private/tmp/aimcub-corepack PATH=/Users/jenson/.local/node/bin:$PATH pnpm install --frozen-lockfile --store-dir /private/tmp/aimcub-pnpm-store --fetch-timeout 300000 --fetch-retries 5`
- `COREPACK_HOME=/private/tmp/aimcub-corepack PATH=/Users/jenson/.local/node/bin:$PATH pnpm build`
- `COREPACK_HOME=/private/tmp/aimcub-corepack PATH=/Users/jenson/.local/node/bin:$PATH pnpm test`
- `COREPACK_HOME=/private/tmp/aimcub-corepack PATH=/Users/jenson/.local/node/bin:$PATH pnpm typecheck`
- `COREPACK_HOME=/private/tmp/aimcub-corepack PATH=/Users/jenson/.local/node/bin:$PATH pnpm lint`
- `COREPACK_HOME=/private/tmp/aimcub-corepack PATH=/Users/jenson/.local/node/bin:$PATH pnpm core:purity`
- `git diff --check`
- `COREPACK_HOME=/private/tmp/aimcub-corepack PATH=/Users/jenson/.local/node/bin:$PATH pnpm --filter @app/desktop run build`
- `ELECTRON_BUILDER_CACHE=/private/tmp/aimcub-electron-builder-cache COREPACK_HOME=/private/tmp/aimcub-corepack PATH=/Users/jenson/.local/node/bin:$PATH pnpm --filter @app/desktop exec electron-builder --mac --dir --config.electronDownload.cache=/private/tmp/aimcub-electron-cache`
- `ditto apps/desktop/dist/mac-arm64/Aimcub.app Aimcub.app`

Notes:

- MCP worker tests may log the expected missing-Supabase opaque-error path while passing.

## Next Session Prompt

```text
Continue from `main`. Start by reading AGENTS.md, docs/handoff.md, and docs/memory/README.md, then load only task-relevant module memory. For repo-changing sessions, run the full verification suite, refresh root Aimcub.app from the packaged Desktop output, update docs/handoff.md, create a focused commit, push, and merge completed branch work into main unless the user explicitly opts out.
```
