# Contributing to Aimcub

Thanks for your interest in Aimcub. This guide covers the mechanics of making a
change: environment setup, the verification gate every PR must pass, how the
monorepo is organized, and the conventions we follow.

## License Notice

Aimcub is open source under the [MIT License](LICENSE). By contributing, you
agree that your contributions are licensed under the same terms.

## Requirements

- Node `>=22.13`
- `pnpm@11.10.0`, enabled via [Corepack](https://nodejs.org/api/corepack.html)

```bash
corepack enable pnpm
pnpm install
```

## The Verification Gate

Every change must pass the full gate before it is proposed as a PR, and CI
(`.github/workflows/ci.yml`) enforces the same commands:

```bash
pnpm build
pnpm test
pnpm typecheck
pnpm lint
pnpm core:purity
```

`pnpm lint` includes the `@aimcub/*` purity `no-restricted-imports` rule, and
`pnpm core:purity` separately compiles `@aimcub/core` and `@aimcub/types` with no
DOM and no Node types available, so any platform dependency that leaks into the
kernel fails loudly. Run the full gate locally before opening a PR — do not
rely on CI alone to catch a red gate.

For docs-only changes, `git diff --check` is the minimum whitespace check; use
the full gate whenever a change touches code.

## Monorepo Orientation

See the [Architecture Map](README.md#architecture-map) in the README for the
full package/app table. The core contract that shapes where a change belongs:

- Business logic lives only in `@aimcub/*` pure TypeScript packages
  (`packages/types`, `packages/core`) — zero platform dependencies, unit-tested,
  and purity-guarded by `pnpm core:purity`.
- Everything under `apps/*` (`apps/desktop`, `apps/cli`, `apps/mcp`) is a shell:
  I/O, rendering, and platform bridging only. If you find yourself adding
  business logic to an app shell, it likely belongs in `@aimcub/*` instead.
- `packages/store`, `packages/llm`, `packages/local-agent`, and `packages/api`
  sit between the core and the app shells; see the Architecture Map for what
  each owns.

## Conventions

- **English only.** All committed content — code, comments, identifiers, commit
  messages, docs, and SQL — must be English. The only exception is `zh` i18n
  values.
- **Focused commits.** Keep commits scoped to one coherent change.
- **Never commit secrets or local data.** No API keys, no `.env` files, no
  contents of `~/.aimcub` (or a custom `AIMCUB_HOME`), and no packaged app
  artifacts (e.g. `Aimcub.app`, `dist/` output).
- **Isolate local data while developing.** Point `AIMCUB_HOME` at a scratch
  directory instead of touching your real `~/.aimcub` store:

  ```bash
  AIMCUB_HOME=/tmp/aimcub-local-alpha pnpm --filter @aimcub/cli exec aimcub config
  ```

## Where Project Memory Lives

Read [`AGENTS.md`](AGENTS.md) first — it is the root project contract (MUST/NEVER
rules only, kept short). From there:

- [`docs/memory/README.md`](docs/memory/README.md) maps durable module memory
  (product, architecture, desktop, design system, operations, history) — read
  the module relevant to the area you're changing.
- [`docs/handoff.md`](docs/handoff.md) is session-to-session transfer state,
  not a place for contributor PRs to add durable notes.
- [`docs/open-source-local-alpha.md`](docs/open-source-local-alpha.md) is the
  broader onboarding guide for the local alpha.

## Getting Help

If you're unsure whether a change fits the current product direction, see
[`docs/vision.md`](docs/vision.md) and [`docs/v1-spec.md`](docs/v1-spec.md), or
open a [discussion-style issue](.github/ISSUE_TEMPLATE/config.yml) before
starting substantial work.
