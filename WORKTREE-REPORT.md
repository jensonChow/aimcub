# Worktree report — quickstart-front-door

## What changed and why

- **`docs/quickstart.md` (new)** — canonical 5-minute, provider-free path:
  requirements + minimal build, bundle/run the deterministic seed into an
  isolated `AIMCUB_HOME`, what to expect in Desktop and the same store via
  the CLI, then a real `aimcub run` against an authenticated Codex/Claude CLI
  with the "done is derived, never claimed" truth, then where to go next.
- **`README.md`** — new front-door `## Quickstart` section (4 commands) right
  after the opening thesis, above `## Local Alpha`. Trimmed the `## Development`
  section's CLI examples (they duplicated Quickstart with a different example
  path) and one stale pointer in `## Local Alpha`; added one discovery link
  under `## Where To Start`. Architecture Map / Not-In-The-Local-Alpha /
  Hosted Surfaces / Roadmap Boundary / Contributing & Community left intact.
- **`examples/local-alpha/README.md`** — same commands and isolated-home path
  as quickstart.md, a precise one-line summary of what the seed creates, and
  a corrected description of what Desktop shows on launch (see discovery
  below). Added a pointer to quickstart.md.
- **`docs/open-source-local-alpha.md`** — one line near the top pointing at
  quickstart.md, no other changes (footprint: cross-links only).
- **`.changeset/quickstart-front-door.md`** — patch, `@core/types` anchor,
  matching the lockstep-group convention from the release-scaffolding batch.

## Decisions

- **Path convention**: chose `~/aimcub-quickstart` (data dir) and
  `~/aimcub-quickstart-seed.mjs` (bundled script) as the "stable example path,
  not /tmp jargon" the mission asked for, and aligned examples/local-alpha
  to match. Left `docs/open-source-local-alpha.md`'s existing `/tmp` example
  alone — out of footprint there (cross-links only).
- **Did not execute a live `aimcub run`**: Codex/Claude's own model calls need
  real network/API usage regardless of Aimcub's `--network`/`--read-only`
  flags (those scope the agent's shell access inside the sandbox, not whether
  the CLI itself can reach its provider) — running one for real would spend
  the user's actual quota. Verified the command's local validation instead
  (missing/relative `--workspace` errors, zero cost) and grounded the
  documented shape in `apps/cli/src/agent-run.ts` (auto-pick when
  `--milestone` is omitted) and the CLI's own `--help` text.
- **Desktop visual check**: `computer-use` screen-control access was denied
  by the user when requested; did not retry. Verified instead via clean
  main/preload/renderer build+boot logs against the seeded `AIMCUB_HOME`
  (zero errors) plus CLI reads (`board`, `context review`) proving the same
  store file is complete and correctly shaped. UI copy in quickstart.md and
  the examples README (station strip, "Context inbox", auto-open behavior)
  came from an Explore-agent source read, not a screenshot.
- **Minimal build**: confirmed empirically, not assumed — `@core/*` packages'
  `exports` point at `src/index.ts`, so esbuild/Vite bundle from source; only
  `pnpm --filter @app/cli build` is needed for this path (tested by clearing
  every package `dist/` and rebuilding just the CLI).

## Out-of-scope discoveries (flagged, not fixed)

- This worktree's `node_modules/electron` had no downloaded binary
  (`Error: Electron uninstall` from `pnpm desktop`) despite
  `pnpm-workspace.yaml` already pre-approving its build script — a one-off
  artifact of how this worktree's `node_modules` was materialized, not a real
  fresh-clone gap. Fixed locally (ran its `install.js` directly) to verify
  desktop boot; other batch worktrees may hit the same thing.
- `docs/open-source-local-alpha.md`'s existing "Desktop Role" text says the
  app shows the seeded aim "in Recent aims" — stale; current code auto-opens
  straight into the aim's Journey view when one aim exists and nothing is
  drafted. Out of footprint to fix there; examples/local-alpha/README.md
  already carries the corrected version.

## Verification

- Every quickstart.md command run verbatim, in order, against a fresh
  `~/aimcub-quickstart`: install, `pnpm --filter @app/cli build`, esbuild
  bundle, seed run (both `--target` and bare-`AIMCUB_HOME` forms), `aimcub
  ls`/`board`/`context review`/`agents`/`config`, `pnpm desktop` boot. Real
  output (1 aim, 4 sub-aims, 2 evidence items, 5 context rows, 1/4 done,
  Codex ready/Claude unauthenticated on this machine) is what's quoted in
  the docs. Cleaned up `~/aimcub-quickstart*` and killed the desktop process
  afterward.
- Full gate green: build 9/9, test 16 files / 1035 tests (desktop 283, domain
  187, llm 170, mcp 114, cli 89, store 88, api 40, db 36, local-agent 28 —
  matches main's existing baseline exactly, zero regressions since this is
  docs-only), typecheck 16/16, lint 10/10, `core:purity` clean.
- Every markdown link added/touched across the four files resolves (scripted
  check). `git diff --check` clean.
