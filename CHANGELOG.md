# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Aimcub versions its workspace packages in lockstep using
[Changesets](https://github.com/changesets/changesets) — see
[docs/releasing.md](docs/releasing.md) for the release flow.

## [Unreleased]

Aimcub is pre-release: every workspace package is `"private": true` at
`0.0.0`, and nothing is published to npm (publish stays deferred pending a
license decision — see [docs/releasing.md](docs/releasing.md)). The first
public version target is `0.1.0`.

Per-release notes are generated from `.changeset/*` entries by
`pnpm release:version`, which writes them into each bumped package's own
`CHANGELOG.md` (for example `apps/cli/CHANGELOG.md`,
`apps/desktop/CHANGELOG.md`, `packages/*/CHANGELOG.md`) rather than this
file. This root changelog stays a hand-maintained overview of pre-release
status; once tagged releases start, add a dated summary line here per tag if
you want a single-file history.
