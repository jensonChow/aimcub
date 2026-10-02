# Releasing

Aimcub versions its workspace packages (`@aimcub/*`) in lockstep using
[Changesets](https://github.com/changesets/changesets), configured in
[.changeset/config.json](../.changeset/config.json). This is the
founder-facing flow for cutting a release. Publishing to npm is **not** part
of this flow yet — see "What's deferred" below.

## Day to day: recording a change

Whenever you land a change worth calling out in a release, add a changeset:

```bash
pnpm changeset
```

This walks you through picking a bump type (patch/minor/major) and writing a
one-line summary. Because all packages sit in a single lockstep (`fixed`)
group, you only need to select one package in the prompt — `changeset
version` bumps every package in the group to the same new version regardless
of which one(s) you picked. Changesets accumulate as small files under
`.changeset/` until someone runs a release; commit them alongside the change
that motivated them.

To see what a release would currently contain without doing anything:

```bash
pnpm changeset status --verbose
```

## Cutting a release (founder-owned)

1. **Bump versions:**

   ```bash
   pnpm release:version
   ```

   This runs `changeset version`, which consumes every pending
   `.changeset/*.md` file, bumps every `@aimcub/*` package to the same
   new version, and writes the release notes into each bumped package's own
   `CHANGELOG.md` (e.g. `apps/cli/CHANGELOG.md`, `apps/desktop/CHANGELOG.md`,
   `packages/*/CHANGELOG.md`) — not the root [CHANGELOG.md](../CHANGELOG.md),
   which stays a hand-maintained overview.

2. **Review and commit** the resulting diff (package.json version bumps, new
   per-package CHANGELOG.md entries, and pnpm-lock.yaml if any internal
   dependency ranges moved).

3. **Tag** the commit with the new version, e.g.:

   ```bash
   git tag v0.1.0
   ```

4. **Push the tag** (this is the outward-facing, founder-owned step):

   ```bash
   git push origin v0.1.0
   ```

Pushing a `v*` tag triggers [.github/workflows/release.yml](../.github/workflows/release.yml):
it re-runs the full verify gate, builds the CLI bundle and an unsigned
desktop dmg+zip on macOS, and drafts a GitHub Release for the tag with those
artifacts attached and its body pointing at CHANGELOG.md. The draft is not
published automatically — review and publish it by hand from the GitHub UI.

### Dry-running the pipeline

The same workflow can be triggered manually (Actions tab → Release → **Run
workflow**) at any time via `workflow_dispatch`. This runs verify and builds
artifacts exactly like a tagged release, but skips the release-drafting job
entirely — nothing is created on the Releases page, so it's safe to run
against any commit to sanity-check the build.

## What's deferred

- **The root `package.json` ("aimcub", currently `0.0.0`) is not part of the
  lockstep group.** Changesets only versions actual workspace packages
  (the globs listed in `pnpm-workspace.yaml`), and the repo root isn't one of
  them — including it in the `fixed` group errors out (`@manypkg/get-packages`
  excludes the workspace root by design). The root version is a static
  placeholder; the version that actually moves — in lockstep across every
  `@aimcub/*` package — plus the git tag you cut, is the
  meaningful "current version" of the project.
- **The macOS bundle version follows along automatically.** Electron-builder
  derives `CFBundleShortVersionString` (the version shown in Finder/About)
  from `apps/desktop/package.json`'s `"version"` field at pack/dist time, so
  once step 1 above bumps that package, the next `pnpm desktop:pack` or
  `pnpm --filter @aimcub/desktop run dist` picks up the new version with no
  extra step.
- **`npm publish` is intentionally not wired up anywhere** — the release
  workflow has a clearly-commented placeholder step instead of a real publish
  call. It's blocked on registering the `@aimcub` npm org.
- **First public version target is `0.1.0`.** Until then, treat `0.0.x`
  bumps as internal/dry-run traffic — nothing is published anywhere it can
  be publicly installed from.
