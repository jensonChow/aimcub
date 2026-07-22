# WORKTREE-REPORT: test-integrity

Two debts: (A) `apps/mcp` double-counted tests via a stale `dist/` mirror of
`src/`. (B) `packages/{core,store,llm}` excluded `*.test.ts` from the
tsconfig `typecheck` uses, so it never covered ~40 test files.

## A — apps/mcp dist double-count

`build` ran `tsc -p tsconfig.json` (no test exclusion) and no
`vitest.config.ts` existed, so `vitest run` picked up both `src/*.test.ts`
and the compiled `dist/*.test.js` mirror. Added `vitest.config.ts`
(`test.include: ["src/**/*.test.ts"]`) and `tsconfig.build.json` (excludes
`**/*.test.ts`), pointed `build` at the latter — mirrors the six-library
pattern from `publish-build-prep`. Deploy unaffected: `wrangler.toml` bundles
straight from `src/worker.ts`; `dist/` is a pure `tsc` side effect, unused at
runtime. Test count: **114 → 57** (exactly halved, confirming pure double-count).

## B — typecheck honesty (core/store/llm)

Removed `"exclude": ["**/*.test.ts"]` from the three base `tsconfig.json`.
`tsconfig.build.json` keeps its own `exclude` (TS doesn't merge `exclude`
across `extends`, so builds stay test-free — verified below).

`packages/core` also needed a lib fix: it's the one package with `"types": []`
(the purity tripwire behind `core:purity` — no `@types/node` means an
accidental `process`/`Buffer`/`require` fails to compile). Its
`plan-quality.test.ts` uses `structuredClone` (21x), which isn't an ES-spec
global — TS only ships it in `lib.dom.d.ts`/`lib.webworker.d.ts`. Added
`"WebWorker"` to `lib` (not `"DOM"`, not `types: ["node"]`): supplies
`structuredClone` without `document`/`window` or any Node ambient global, so
the Node/DOM purity tripwire stays intact. Confirmed no Node-specific
identifier exists anywhere in `core/src`, and `core:purity` passes after.

Every fix below is real, pre-existing shape drift the exclude was hiding —
none weaken an assertion or touch production `src`:

- `context.test.ts`: fixtures for `reviewContextProfile` carried an `id` the
  current `Pick<Memory,...>` param doesn't have and the function never
  reads. Removed from 3 fixtures.
- `plan-handoff.test.ts`, `store.test.ts` (`localAlphaNode`): node builders
  never set `routing_override`, now required (nullable) on `PlanNode`. Added
  `routing_override: null`, matching `run-queue.test.ts`'s own convention.
- `clarify.test.ts`: 5 `review:` fixtures carried excess `actions`/`guidance`
  not in `Pick<PlanReviewReport,"quality"|"context">` — removed. Separately,
  `validQuestions()` had no return-type annotation, so `kind`/`selection_mode`
  widened to `string`, failing 4 spreads into strict `ClarifyQuestion[]`
  positions. Annotated it `ClarifyOutput` (its `mockGateway(output: unknown)`
  call site is untyped, unaffected).
- `decompose.test.ts`: same widening on `validPlan()` (unannotated → `.match`
  lost `CommitPatternMatch`'s real optional fields). Annotated
  `DecompositionOutput`; added the two nodes' missing `routing_override:
  null`. One discriminated-union index access (`clauses[0].match.min_files`)
  still needed a narrowing cast even after annotating (indexing can't recall
  which union member a literal was) — cast to `CommitPatternMatch`, the type
  `evaluate.ts` uses for this exact shape.
- `intake.test.ts`: `AimIntakeReport` used as a return-type annotation but
  never imported (it exists, exported from `@core/domain`) — added the import.
- `openai-gateway.test.ts`: fetch mocks built via zero-arg
  `vi.fn(async (): Promise<...> => ...)` then force-cast to `OpenAiFetchPort`,
  so `.mock.calls[0]` typed as `[]` instead of `[url, init]`. Switched to
  `vi.fn<OpenAiFetchPort>(async () => ...)`, which types the mock correctly
  and let the redundant `as unknown as` cast be dropped.

## Out-of-scope (flagged, not fixed)

- `packages/store/src/run-queue.test.ts` (2 errors, forbidden to me):
  `likely_owner: string` widening on an unannotated fixture — same root
  cause/fix as the `decompose`/`clarify` cases above (annotate the fixture's
  return type). This is why `pnpm typecheck` isn't fully green from this
  worktree alone; every other package is clean. Owning worktree should apply
  the same pattern.
- Consistency sweep: `types`/`local-agent`/`api-client`/`db` already have no
  test-exclude and correct `src`-only vitest allowlists (honest counts
  unchanged: local-agent 14, api-client 20). `local-agent`/`api-client`
  `dist/` had stale pre-batch-2 compiled test files predating their
  `tsconfig.build.json` (harmless — vitest already ignores `dist/`); cleaned
  for an honest fresh-build check. `apps/desktop`/`apps/cli` (read-only,
  untouched): no exclude, no vitest.config.ts, structurally immune to
  dist-doubling (single bundled entry point never reaches test files).

## Verification

- `pnpm build`: 9/9. Fresh (`rm -rf` every `packages/*/dist apps/{mcp,cli}/dist`
  first): `find packages/*/dist apps/mcp/dist -name '*.test.*'` → empty.
- `pnpm test`: 16/16. Counts — db 36, domain 187, llm 170, **mcp 57** (was
  114), desktop 296, cli 99, store 95, api-client 20, local-agent 14. Total
  974 (= prior 1031 − 57 phantom mcp tests); every non-mcp count matches
  `docs/handoff.md`'s recorded baseline.
- `pnpm typecheck`: core/llm/mcp/types/api-client/local-agent/db/desktop/cli
  all clean (each confirmed standalone). Only `store` fails, solely on the 2
  flagged `run-queue.test.ts` errors above.
- `pnpm lint`: 10/10. `pnpm core:purity`: clean.
- Changeset: `.changeset/test-integrity.md` (patch, `@core/types` per the
  fixed-lockstep convention `publish-build-prep` already used).
