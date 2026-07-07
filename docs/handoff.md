# Aimcub Handoff

Last updated: 2026-07-08
Branch: detached worktree HEAD

## Current Session

- Added a deterministic local alpha demo seed for provider-free dogfooding and visual QA.
- Kept the Desktop shell/sidebar/window-chrome and local agent runtime untouched.
- Added deterministic ID/time injection to `createJsonFileStore` for seed/test builders; default store behavior still uses runtime UUIDs and current time.
- Added a reusable seed builder at `packages/store/src/local-alpha-demo.ts`.
- Added the runnable seed entry point and docs under `examples/local-alpha/`.
- Added focused store tests for idempotence, safe target refusal, routing coverage, matched trusted evidence, low-trust evidence, no-evidence states, pending context, accepted context, and `AimProgressReadModel` Execute/Eval state.

## Seed Usage

Build the runnable seed script from the repository root:

```bash
pnpm --filter @app/cli exec esbuild ../../examples/local-alpha/seed-local-alpha-demo.ts --bundle --platform=node --format=esm --target=node22 --outfile=/tmp/aimcub-local-alpha-demo-seed.mjs
```

Seed an isolated local store:

```bash
node /tmp/aimcub-local-alpha-demo-seed.mjs --target /tmp/aimcub-local-alpha-demo
```

Open Desktop against it:

```bash
AIMCUB_HOME=/tmp/aimcub-local-alpha-demo pnpm desktop
```

The seed replaces only `store.json` in the explicit target directory. It refuses `~`, `~/.aimcub`, paths under `~/.aimcub`, and filesystem root by default. It does not require provider keys, web research, hosted Supabase, or a real local agent run.

## Changed Files

- `packages/store/src/index.ts`
- `packages/store/src/local-alpha-demo.ts`
- `packages/store/src/store.test.ts`
- `examples/local-alpha/README.md`
- `examples/local-alpha/seed-local-alpha-demo.ts`
- `docs/handoff.md`

## Verification

Passed:

- `pnpm --filter @core/store test`
- `pnpm --filter @core/domain test`
- `pnpm --filter @core/store typecheck`
- `pnpm --filter @app/cli typecheck`
- `pnpm --filter @app/cli exec esbuild ../../examples/local-alpha/seed-local-alpha-demo.ts --bundle --platform=node --format=esm --target=node22 --outfile=/tmp/aimcub-local-alpha-demo-seed.mjs`
- `node /tmp/aimcub-local-alpha-demo-seed.mjs --target /tmp/aimcub-local-alpha-demo-smoke`
- `git diff --check`

Notes:

- The first `pnpm --filter @core/store test` hydrated `node_modules` from the lockfile because this worktree had no dependencies installed. No dependency manifests or lockfiles were changed.
- Direct `node --experimental-strip-types` execution of the TypeScript example was not used because the repo source uses extensionless ESM imports. The documented bundle-and-run path is verified.

## Commit And Push Status

- Commit to create: `Add local alpha demo seed`.
- Final commit hash will be reported in the Codex thread after commit creation; it cannot be self-recorded inside the same commit without changing the hash.
- This worktree is intentionally not pushed, merged, or packaged. Integration will handle push, merge, full verification, `desktop:pack`, and root `Aimcub.app` refresh.

## Open Items

- Integration should run the full repository verification and packaged Desktop visual QA against an isolated `AIMCUB_HOME`.
