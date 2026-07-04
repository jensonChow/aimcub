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

The project declares `pnpm@9.15.0`; the Codex runtime may resolve another pnpm. Prefer the `/Users/jenson/.local/node/bin` PATH prefix on this machine.

## Desktop Runtime

Root desktop entry points are stable:

```bash
pnpm desktop
pnpm desktop:dev
```

The installed local app is `/Applications/Aimcub.app`. The app has launched successfully through both development and installed-app paths. In development macOS may label the Dock app as `Electron`, but the window title should be `Aimcub`.

Desktop release packaging uses:

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
