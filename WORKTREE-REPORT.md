# WORKTREE-REPORT: publish-build-prep

## Mission
Give the six library packages (types, core, store, llm, local-agent, api) a
clean, publish-grade `dist` (JS + `.d.ts`, zero test artifacts) and kill the
vitest dist-double-count defect — without renaming packages or changing how
desktop/CLI consume workspace source.

## What changed (all six packages, uniformly)
- New `tsconfig.build.json` per package: extends `./tsconfig.json`, adds
  `"exclude": ["**/*.test.ts"]`. Each `package.json`'s `build` script now runs
  `tsc -p tsconfig.build.json`; `typecheck`/`purity` still run against the
  unchanged base `tsconfig.json`.
- New `vitest.config.ts` per package: `{ test: { include:
  ["src/**/*.test.ts"] } }` (same convention already used by `packages/db`).
  This is belt-and-suspenders: verified empirically that vitest 4.1.9 does
  **not** exclude `dist/**` by default in this setup, so the allowlist is
  what actually prevents double-collection, independent of dist's contents.
- `package.json`: added `"files": ["dist"]` and a `publishConfig` stub
  (`access: "restricted"`, `main`/`types`/`exports` pointing at `dist`,
  including llm's `./providers` subpath) to all six. Top-level
  `main`/`types`/`exports` are untouched — still resolve to `./src/index.ts`
  for workspace consumers (desktop's `bundleFromSource`, CLI's esbuild). Left
  `private: true` untouched everywhere.
- One changeset (`.changeset/publish-build-prep.md`, patch, `@core/types`,
  following the single-package-in-a-fixed-group precedent already in repo).
- `turbo.json`: left unchanged. `build.outputs` (`dist/**`) already matched
  reality; default (unrestricted) task `inputs` already pick up the new
  config files — confirmed by a full cache hit on the second `pnpm build`.

## Decision: did NOT remove the test-exclude from core/store/llm's base tsconfig.json
Tried it first, so `typecheck` would cover test files everywhere uniformly
(types/local-agent/api never excluded tests from typecheck; only
core/store/llm did). Reverted after finding it surfaces real, pre-existing
type errors in test files that had never actually been typechecked:
- `core/src/context.test.ts`, `plan-handoff.test.ts` (object shape drift vs.
  current types), `plan-quality.test.ts` (`structuredClone` unresolved, ~17x)
- `store/src/store.test.ts` (missing `routing_override`, possibly-undefined
  `summary`)
- `llm/src/clarify.test.ts`, `decompose.test.ts`, `intake.test.ts`,
  `openai-gateway.test.ts` (~20 errors, shape drift vs. current types)

Fixing these needs `src/**` edits, forbidden in this worktree. Core/store/llm
`tsconfig.json` are byte-identical to HEAD (confirmed via `git diff`) — their
build cleanliness comes entirely from the new `tsconfig.build.json`, so this
deliverable is still met; typecheck there just keeps its existing (pre-
existing, not-introduced-by-me) blind spot on test files. Flag for whichever
session next owns `packages/{core,store,llm}/src`.

## Out-of-scope discoveries
- **`packages/api` had the identical dist-double-count defect as
  local-agent** — not called out in the mission's bug report, found while
  baselining. Before: 4 files / 40 tests (2 real + 2 dist copies); the
  handoff's recorded "api 40" was already the inflated figure. `api` is in my
  footprint, so this batch fixes it too — now correctly 2/20.
- **`apps/mcp` has the same defect** (`dist/auth.test.js` +
  `dist/worker.test.js` collected alongside their `src` originals); its
  recorded "114" is likewise already inflated. `apps/**` is forbidden here —
  not fixed, flagging for whoever next owns `apps/mcp`.

## Verification
- Clean-dist rebuild: removed all six `dist/`, then `pnpm build` → 9/9 tasks
  green; desktop `verify-bundled-core.mjs` passed inside the build.
- `find packages/*/dist -name '*.test.*'` → empty.
- Corrected counts (fresh build, then `pnpm test`): local-agent 3 files/14
  tests (was 6/28); api 2 files/20 tests (was 4/40); core 15/187, store 2/88,
  llm 17/170, types 0 (`--passWithNoTests`) — all unchanged from the merged
  handoff baseline, confirming no regressions.
- Second `pnpm build` → `Cached: 9 cached, 9 total` / `FULL TURBO`.
- Full gate green: build, test, typecheck (16/16), lint (10/10),
  `pnpm core:purity`.

## Left for the rename batch
files/publishConfig are in place; at rename time it should just be: flip
`private` off, rename `@core/*` → `@aimcub/*` (also update
`updateInternalDependencies`/the fixed group in `.changeset/config.json`),
decide real npm `access` (public vs. restricted), pick a license, register
the `@aimcub` npm org.
