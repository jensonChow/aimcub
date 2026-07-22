# WORKTREE-REPORT: rename-aimcub-scope

Branch: `claude/rename-aimcub-scope-f17b19` (nominal mission name: `rename-aimcub-scope`).
Ran alone, no parallel worktree in flight. No merge to `main`, no push.

## What changed

Renamed every workspace package from the internal `@core/*` / `@app/*` scopes
to the public `@aimcub/*` scope. Directories did not move; only package
identity changed. Name map applied exactly as specified:

| Old name | New name | Directory |
| --- | --- | --- |
| `@core/types` | `@aimcub/types` | `packages/types` |
| `@core/domain` | `@aimcub/core` | `packages/core` |
| `@core/store` | `@aimcub/store` | `packages/store` |
| `@core/llm` | `@aimcub/llm` | `packages/llm` |
| `@core/local-agent` | `@aimcub/local-agent` | `packages/local-agent` |
| `@core/api-client` | `@aimcub/api-client` | `packages/api` |
| `@core/db` | `@aimcub/db` | `packages/db` |
| `@app/cli` | `@aimcub/cli` | `apps/cli` (bin stays `aimcub`) |
| `@app/desktop` | `@aimcub/desktop` | `apps/desktop` |
| `@app/mcp` | `@aimcub/mcp` | `apps/mcp` |

`examples/eval-moat` and `examples/local-alpha` have no `package.json` (not
workspace packages, not in `pnpm-workspace.yaml`) — nothing to rename there;
their doc/CLI-invocation references to renamed packages were updated.

218 files touched (`git status --short | wc -l`, includes 1 new file:
this report's sibling changeset).

## Mechanical completeness — zero-hit grep

Exact command from the mission, run at the end of the session:

```
grep -rn "@core/\|@app/" --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' --include='*.json' --include='*.yaml' --include='*.yml' --include='*.md' . \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.turbo --exclude-dir=docs/memory --exclude-dir=.claude --exclude-dir=worktrees --exclude=pnpm-lock.yaml \
  | grep -v 'docs/handoff.md'
```

Result: **zero hits** (grep exit code 1). `docs/handoff.md` and
`docs/memory/**` were left untouched per rule 4 (they still say `@core/*` /
`@app/*` — that's the integrator's job, see "Handoff" below).

### Beyond the exact grep: bare-token audit

The exact grep is slash-anchored (`@core/`, `@app/`), so I additionally
audited for bare `@core\b` / `@app\b` mentions (no trailing slash) that the
anchored grep would miss. This surfaced two categories:

1. **Real logic, not prose** — `apps/desktop/scripts/verify-bundled-core.mjs`
   had its regex written as `["']@core\/` (backslash-escaped slash inside a
   JS regex literal), which doesn't literally contain the substring `@core/`
   and so slipped past the anchored grep. Left unfixed, this safety check
   (which fails the build if a raw-TypeScript `@core` package leaks into the
   compiled Electron bundle instead of being inlined) would have silently
   become a no-op post-rename — it would only ever look for a prefix nothing
   is named anymore. Fixed to check for `@aimcub/`; confirmed still firing
   correctly (see gate output below: "Verified Electron runtime bundles
   contain no external @aimcub imports").
2. **Architecture prose/comments using bare `@core` as shorthand** (no
   package literally named that) — e.g. `README.md`'s "`@core` kernel",
   `docs/vision.md`, `docs/charters/evidence.md`, package descriptions in
   `apps/cli/package.json` / `apps/desktop/package.json`, and doc-comments in
   `packages/types/src/index.ts`, `packages/llm/src/{anthropic,openai}-gateway.ts`,
   `packages/db/supabase/functions/_shared/{worker,ingest}.ts` +
   its `__tests__/worker.test.ts`, `apps/desktop/src/{main/ipc.ts,
   renderer/workflow/progressSummary.ts, renderer/workflow/journey/stationModel.ts}`,
   `apps/cli/src/index.ts`, `apps/mcp/src/tools.test.ts` (comments only).
   Fixed all of these to `@aimcub/core` specifically (not bare `@aimcub`) —
   after the rename `@aimcub/*` spans **both** the pure kernel packages and
   the `apps/*` shells, so bare `@aimcub` would no longer mean "the pure
   kernel" the way bare `@core` used to.

### Deliberately left unchanged: test-fixture sample content

Six test files contain bare `@core` inside literal string **content** used
as simulated user-written "constraint" text for context-reuse /
plan-quality-scoring tests (e.g. `"Constraint: Keep @core pure."`):
`packages/core/src/{aim-intake,context,plan-quality}.test.ts`,
`packages/llm/src/{context-workflow,planning-context}.test.ts`,
`packages/store/src/store.test.ts`. These are not package specifiers — they
are arbitrary sample prose the tests use to verify the app's own
context-matching logic, self-contained within each file (no cross-file
string equality). I left them as-is: the mission's own zero-hit criterion is
slash-anchored and doesn't reach them, changing them is not required for
correctness, and touching ~20 occurrences across paired input/assertion
sites for a purely cosmetic concern carried more test-breakage risk than
benefit. Flagging so the integrator can make a different call if desired.

## Purity guard survives with meaning intact

- `eslint.config.js`: the `no-restricted-imports` rule is keyed by
  **directory glob** (`packages/core/**/*.ts`, `packages/types/**/*.ts`), not
  by package name, so it needed no rule change — only the doc-comment above
  it (`@core/domain, @core/types` → `@aimcub/core, @aimcub/types`).
- Root `package.json`: `"core:purity": "pnpm --filter @aimcub/core --filter @aimcub/types run purity"`.
- `apps/desktop/electron.vite.config.ts`: `bundleFromSource` now lists
  `@aimcub/core`, `@aimcub/local-agent`, `@aimcub/llm`, `@aimcub/store`,
  `@aimcub/types`.
- `apps/desktop/scripts/verify-bundled-core.mjs`: regex + messages now check
  for `@aimcub/` (see bare-token audit above).
- `apps/desktop/src/main/packaging.test.ts`: `.filter((name) =>
  name.startsWith("@core/"))` → `.startsWith("@aimcub/")`; test still passes
  (asserts `bundleFromSource` exactly equals desktop's `@aimcub/*` deps).
- `apps/mcp/wrangler.toml` checked — the Worker's own deploy `name` is
  `aimcub-mcp` (Cloudflare resource name, unrelated to the npm scope); no
  package-name references present, no change needed.
- `turbo.json`, `tsconfig.base.json`, `pnpm-workspace.yaml`, `.npmrc` checked
  — no package-name references, no changes needed.

## Changesets

- `.changeset/config.json` `fixed` group: `["@core/*", "@app/*"]` →
  `["@aimcub/*"]`.
- All 9 pre-existing pending changesets (`artifact-capture-errors.md`,
  `desktop-packaging-identity.md`, `eval-moat-benchmark.md`,
  `permissions-inspection.md`, `publish-build-prep.md`, `queue-streaming.md`,
  `quickstart-front-door.md`, `release-scaffolding.md`, `test-integrity.md`)
  had their frontmatter package keys renamed to match (they were all still
  pending/unreleased, so this is safe — no CHANGELOG has been cut yet).
- Added `.changeset/aimcub-scope-rename.md` naming `@aimcub/types` (patch),
  following this repo's existing convention of anchoring fixed-group,
  multi-package changes on `types`. Its prose deliberately avoids
  reconstructing literal `@core/xxx` / `@app/xxx` tokens (describes the
  mapping without slash-joining old scope + name) so it doesn't trip the
  zero-hit grep against itself.
- `pnpm changeset status --verbose`: clean, all 10 `@aimcub/*` packages bump
  together to `0.0.1` in lockstep, pulling in all 7 pending changesets
  correctly. Re-verified after the final changeset-prose edit.

## `private`/publish invariants unchanged

- `"private": true` present in all 10 package.json files (verified by
  direct grep, not just diff absence).
- `publishConfig.access: "restricted"` unchanged in all 6 publishable
  packages (types, core, api, llm, store, local-agent).
- No `npm` command run at any point. `.github/workflows/release.yml`'s
  blocked npm-publish placeholder step was reworded (it previously described
  "renaming from `@core/*` + `@app/*` to `@aimcub/*`" as separate future
  work — now that this batch **is** that work, the comment was updated to
  drop the stale forward reference; the still-true blockers, OSS license +
  `@aimcub` npm org registration, are kept).
- `docs/releasing.md`: removed the "What's deferred" bullet describing the
  `@aimcub/*` rename as a separate later batch (it's this batch); the other
  deferred items (npm publish, first `0.1.0` target) are untouched.

## `pnpm-lock.yaml`

Regenerated via `pnpm install`. Diff is workspace-link renames only (27
insertions / 27 deletions, purely `@core/xxx` → `@aimcub/xxx` importer
entries resorting); zero external dependency version changes.

## Full gate — all green

```
pnpm build      → Tasks: 9 successful, 9 total
pnpm test       → Tasks: 16 successful, 16 total (1028 tests: desktop 339,
                  core 187, llm 170, cli 103, store 95, mcp 57, db 36,
                  local-agent 21, api 20 — identical counts to the last
                  integrated baseline in docs/handoff.md; no regressions)
pnpm typecheck  → Tasks: 16 successful, 16 total
pnpm lint       → Tasks: 10 successful, 10 total
pnpm core:purity→ packages/types purity: Done; packages/core purity: Done
```

Desktop build step included `scripts/verify-bundled-core.mjs`, which printed
`Verified Electron runtime bundles contain no external @aimcub imports.`

## CLI verification

```
pnpm --filter @aimcub/cli build
node apps/cli/dist/index.js --help
```

Builds clean (esbuild, 1.1mb bundle) and `--help` prints the full command
reference. Bin name is still `aimcub`.

## Desktop pack + boot verification

Per `docs/memory/operations.md`'s documented sandboxed-cache workaround
(read-only reference, not edited):

```
ELECTRON_BUILDER_CACHE=/private/tmp/aimcub-electron-builder-cache pnpm --filter @aimcub/desktop run pack
```

Completed clean: electron-vite build → `verify-bundled-core.mjs` passed →
electron-builder produced `apps/desktop/dist/mac-arm64/Aimcub.app` (unsigned,
`identity: null`, no code signing attempted, as expected).

Booted that exact bundle directly (never the repo-root `Aimcub.app` — there
isn't one in this worktree) with an isolated `AIMCUB_HOME` under this
session's scratchpad and an isolated `ELECTRON_USER_DATA`. Confirmed alive
via `ps`: main process (`Aimcub`) + 2 `Aimcub Helper` processes + 1 `Aimcub
Helper (Renderer)` process, no errors in stdout/stderr. Killed cleanly after
the check. Real `~/.aimcub` confirmed untouched (mtime unchanged, predates
this session).

## Handoff items for the integrator

1. **`docs/handoff.md` and `docs/memory/**`** still reference `@core/*` /
   `@app/*` by design (rule 4 forbade editing them from this worktree). They
   need a pass to point at the new `@aimcub/*` names and to mark this batch
   done — in particular `docs/handoff.md`'s "SOLO-rename.md staged" line and
   `docs/memory/operations.md`'s Release Scaffolding / Desktop Packaging
   Identity sections (which still show `@core/*`/`@app/*` command examples).
2. **Test-fixture bare-`@core` sample content** (6 files, listed above) was
   deliberately left as-is — see rationale above. Low priority; a follow-up
   could reword the sample constraint strings to `@aimcub/core` for
   consistency if desired, keeping each file's paired input/assertion
   occurrences in sync.
3. Nothing else found outside the FILE FOOTPRINT that needed a change.
