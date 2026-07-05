# Operations Memory

## Verification

Before claiming repository work is done, keep these gates green:

```bash
PATH=/Users/jenson/.local/node/bin:$PATH pnpm build
PATH=/Users/jenson/.local/node/bin:$PATH pnpm test
PATH=/Users/jenson/.local/node/bin:$PATH pnpm typecheck
PATH=/Users/jenson/.local/node/bin:$PATH pnpm lint
PATH=/Users/jenson/.local/node/bin:$PATH pnpm core:purity
git diff --check
```

The project declares `pnpm@11.10.0` and Node `>=22.13`; the Codex runtime may resolve another pnpm. Prefer the `/Users/jenson/.local/node/bin` PATH prefix on this machine.

Every repository-changing session must finish by running the full verification suite above, refreshing the project-root `Aimcub.app` with `pnpm desktop:pack`, updating `docs/handoff.md`, creating a focused commit, pushing it, and merging completed branch work into `main` unless the user explicitly opts out. If work happens directly on `main`, record that no separate merge was needed.

## Dependency Compatibility

As of 2026-07-06, the newest mutually compatible dependency set keeps Electron 43.0.0, electron-builder 26.15.3, electron-vite 5.0.0, Vite 7.3.6, React 19.2.7, TypeScript 6.0.3, Vitest 4.1.9, ESLint 10.6.0, Zod 4.4.3, Supabase JS 2.110.0, Anthropic SDK 0.110.0, Wrangler 4.107.0, and Turbo 2.10.3.

`pnpm outdated -r` is expected to report only intentional compatibility boundaries: `@types/node` 22.20.0 versus npm latest 26.1.0, `@vitejs/plugin-react` 5.2.0 versus 6.0.3, and Vite 7.3.6 versus 8.1.3. Keep `@types/node` on the Node 22 line while the repo engine remains Node `>=22.13`. Keep Vite on 7 until `electron-vite` supports Vite 8; `@vitejs/plugin-react` 6 also requires Vite 8.

## Desktop Runtime

Root desktop entry points are stable:

```bash
pnpm desktop
pnpm desktop:dev
```

The user-facing local app bundle should live directly in the project root as `Aimcub.app` when the user asks for an openable app folder. It is an ignored local artifact and must not be committed.

Folder-style Desktop packaging uses:

```bash
pnpm desktop:pack
```

This creates `apps/desktop/dist/mac-arm64/Aimcub.app`; copy that bundle to root `Aimcub.app` for the current local handoff. In development macOS may label the Dock app as `Electron`, but the window title should be `Aimcub`.

Desktop currently uses Electron 43.0.0. If sandboxed packaging cannot write Electron's default cache under `~/Library/Caches/electron`, run the build and builder steps with a writable Electron download cache, for example:

```bash
pnpm --filter @app/desktop run build
ELECTRON_BUILDER_CACHE=/private/tmp/aimcub-electron-builder-cache pnpm --filter @app/desktop exec electron-builder --mac --dir --config.electronDownload.cache=/private/tmp/aimcub-electron-cache
```

For any repo-changing session, `pnpm build` is not enough because it updates build output but not the project-root `Aimcub.app` bundle. Run `pnpm desktop:pack`, copy `apps/desktop/dist/mac-arm64/Aimcub.app` to root `Aimcub.app`, and restart/open that exact bundle when the user needs to inspect visible app behavior.

Desktop release packaging for distributable DMG/zip artifacts uses:

```bash
pnpm --filter @app/desktop run dist
```

macOS DMG generation requires `hdiutil`, so it may need to run outside the sandbox.

## Local Data

Local desktop state is not held in project memory. The current local store path is `~/.aimcub/store.json`; provider and context-source settings live beside it under `~/.aimcub/`.

If the local store grows too large, the intended compaction behavior is: back up `store.json`, remove or truncate long debug traces and rejected/obsolete context candidates, and preserve goals, milestones, evidence, accepted context, assignments, runs, and eval state.

## Handoff Protocol

At the end of a repo-changing session, update `docs/handoff.md` with:

- Date and branch.
- Completed work.
- Verification commands and result.
- Commit and push status, if known.
- Open risks or intentionally deferred work.
- A short next-session prompt.

Move durable decisions into the relevant file under `docs/memory/` instead of leaving them in handoff.

## Public Release Readiness

Before public open-source release, choose the license, add `CONTRIBUTING.md` and `SECURITY.md`, audit secrets/env examples, and separate public local-first docs from hosted online-platform deployment notes.
