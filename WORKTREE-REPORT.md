# Worktree report: release-scaffolding

Branch: `wt/release-scaffolding` (mission branch name; local git branch is
`claude/release-scaffolding-80bc1e`, the worktree's actual branch).

## What changed and why

Added a real release process without publishing anywhere and without
renaming any packages, per mission scope:

- **`package.json`**: added `@changesets/cli` devDependency, `changeset` and
  `release:version` scripts. **`pnpm-lock.yaml`**: updated accordingly (only
  this worktree touches the lockfile).
- **`.changeset/config.json`**: `baseBranch: "main"`, a single `fixed` group
  `["@core/*", "@app/*"]` (lockstep across all 10 real workspace packages),
  `privatePackages: { version: true, tag: true }` so private packages still
  version + tag without needing to publish, `commit: false`.
- **`.changeset/release-scaffolding.md`**: one sample patch changeset so the
  first real `pnpm release:version` run has content.
- **`CHANGELOG.md`** (root): Keep-a-Changelog style, Unreleased section
  noting pre-release status.
- **`.github/workflows/release.yml`**: `workflow_dispatch` (dry-run) +
  `push: tags: v*`. Jobs: `verify` (ci.yml steps duplicated, commented as a
  future composite-action dedup — ci.yml itself untouched), `artifacts`
  (macos-14: builds the CLI bundle + unsigned desktop dmg/zip, uploads both),
  `release` (tag-only: drafts a GitHub Release via `gh release create`
  attaching both artifacts, body linking CHANGELOG.md, plus a commented
  placeholder step explaining npm publish is not wired up).
- **`docs/releasing.md`**: founder-facing flow (changeset → release:version →
  commit → tag → push tag → workflow drafts the release), plus the
  "What's deferred" notes below.

## Decisions / discoveries

- **Root package is NOT in the lockstep group, by necessity, not choice.**
  Mission asked for a fixed group covering "`@core/*`, `@app/*`, and root."
  Empirically confirmed (`@manypkg/get-packages`, which changesets uses)
  that the workspace root is excluded from the packages list because
  `pnpm-workspace.yaml` doesn't glob it in — adding `"aimcub"` (root) to
  `fixed` hard-errors (`ValidationError`, tested directly). Fixing this would
  mean editing `pnpm-workspace.yaml`, which is outside this worktree's
  footprint and has side effects beyond this mission. Root `package.json`
  stays at `0.0.0` as a static placeholder; documented clearly in
  `docs/releasing.md` under "What's deferred" so this isn't a silent gap.
- **Verified, not just assumed, that filtered builds work standalone**:
  `pnpm --filter @app/cli build` and `pnpm --filter @app/desktop run dist`
  both bundle straight from `@core/*` raw TS source (their `main`/`exports`
  point at `./src/index.ts`), so neither needs a prior `turbo run build`
  across dependencies. Ran both locally; desktop `dist` produced
  `Aimcub-0.0.0-arm64.dmg`/`.zip` correctly unsigned (`identity: null`, no
  extra `CSC_IDENTITY_AUTO_DISCOVERY` env needed) via a scratch
  `ELECTRON_BUILDER_CACHE`. Test artifacts were deleted after (gitignored,
  never tracked).
- Release-drafting uses the runner's built-in `gh` CLI, not a third-party
  release-creation Action, to avoid a new external dependency.

## Out-of-scope / handoff items

- Root version-sync (if ever wanted) needs either adding `.` to
  `pnpm-workspace.yaml` or a small script under root `scripts/` — both
  outside this footprint. Left as a documented gap, not a workaround.
- `release.yml`'s `verify` job duplicates `ci.yml` on purpose (footprint
  forbids editing `ci.yml`); a follow-up could extract a shared composite
  action (commented inline as a TODO).

## Verification

- Full gate green: `pnpm build` (10 packages), `pnpm typecheck` (16 tasks),
  `pnpm lint` (10 packages), `pnpm test` (283 desktop + 88 cli + 170 llm +
  114 mcp, all passing), `pnpm core:purity` (types + domain).
- `pnpm changeset status` clean both before (no changesets) and after
  (sample changeset) adding content — lists all 10 packages bumping to
  `0.0.1` in lockstep.
- Both workflow YAML files (`release.yml`, `ci.yml`) parse successfully via
  `js-yaml` in Node.
- `git diff --check` clean (no whitespace errors).
- `git status` confirms only footprint paths changed: `package.json`,
  `pnpm-lock.yaml`, `.changeset/**`, `.github/workflows/release.yml`,
  `CHANGELOG.md`, `docs/releasing.md` — no `packages/*`/`apps/*`
  `package.json`, no `README.md`, no desktop build config touched.
