# Aimcub Handoff

Last updated: 2026-07-08
Branch: detached HEAD at `e2dcf08e`

## Current Session

- Goal: make the open-source local alpha understandable to a new developer or
  contributor without changing product behavior or expanding scope.
- Updated `README.md` into a concise local-alpha orientation:
  - what Aimcub is
  - what the local alpha is
  - what is local/open-source now
  - what is future/hosted/not in the local alpha
  - where contributors should start
  - current architecture map and dev commands
- Added `docs/open-source-local-alpha.md` as the focused onboarding guide for the
  local alpha path:
  - local-first aim/context/eval/evidence loop
  - package map, Desktop role, CLI role, and hosted boundary
  - local data location, `AIMCUB_HOME`, privacy expectations, provider/local
    agent optionality, deterministic demo seed placeholder, limitations, and
    non-goals
- Confirmed this worktree does not contain a dedicated deterministic demo seed
  path. The guide includes a placeholder section for the integration session to
  connect when that path exists.
- `apps/mcp/README.md` was listed in the goal pre-read but is absent in this
  worktree; checked `apps/mcp/package.json` and source file layout instead.

## Files Changed

- `README.md`
- `docs/open-source-local-alpha.md`
- `docs/handoff.md`

## Verification

- Passed docs-only check: `git diff --check`

Notes:

- This was intentionally docs-only.
- Did not run `pnpm install`, `pnpm desktop`, `pnpm desktop:dev`, any long-lived
  dev server, `pnpm desktop:pack`, or packaged app copy/refresh.
- Did not write to the real `~/.aimcub` directory.
- Did not use GUI or computer-use.

## Commit And Push Status

- Planned local commit message: `Document local alpha open-source path`
- Final commit hash will be reported in the session final response. Recording the
  final hash inside this same commit would change the hash.
- Intentionally not pushed or merged from this parallel worktree; integration
  will handle push, merge, full verification, packaging, and root `Aimcub.app`
  refresh.

## Open Items

- Integration session should connect the deterministic demo seed path if/when
  the parallel branch provides one.
- Public open-source release still needs license, `CONTRIBUTING.md`,
  `SECURITY.md`, and secrets/env example review.

## Next Session Prompt

```text
Continue from the local-alpha docs commit. Start by reading AGENTS.md,
docs/handoff.md, docs/memory/README.md, and docs/open-source-local-alpha.md.
Do not touch Desktop shell/sidebar/window-chrome files unless explicitly
approved. This parallel worktree intentionally did not push, merge, package, or
refresh root Aimcub.app.
```
