# Aimcub Handoff

Last updated: 2026-07-04
Branch: `main`

## Current Session

- Added `docs/memory/design-system.md` as the durable frontend and Desktop design-system memory.
- Updated `AGENTS.md`, `CLAUDE.md`, and `docs/memory/README.md` so future frontend or visual-design requests load and update the design-system memory.
- Linked `docs/memory/desktop.md` to the design system for all Desktop UI changes.
- Marked `docs/desktop-gui-research.md` as historical where it conflicts with current Desktop/design-system memory.

## Current State

- The active product direction remains the open-source local Aim OS agent harness first, with the online Aim platform and Aim Share later.
- Desktop remains the primary local orchestration surface. Do not reintroduce default debug rails, runtime strips, or stacked status panels.
- For future frontend or visual design work, load `docs/memory/design-system.md` and update it with any new user design requirements.

## Verification

Passed for this session:

```bash
/Users/jenson/.local/node/bin/pnpm build
/Users/jenson/.local/node/bin/pnpm test
/Users/jenson/.local/node/bin/pnpm typecheck
/Users/jenson/.local/node/bin/pnpm lint
PATH=/Users/jenson/.local/node/bin:$PATH /Users/jenson/.local/node/bin/pnpm core:purity
git diff --check
```

Commit/push status: this handoff is part of the design-system memory commit; use `git log -1` for the final hash after the session commits and pushes.

## Next Session Prompt

```text
Continue from the updated Aimcub design-system memory. Start by reading AGENTS.md, docs/handoff.md, and docs/memory/README.md. Then load only the module memory relevant to the task.

Keep AGENTS.md/CLAUDE.md under 50 lines and reserved for hard project rules. Put durable product/architecture/module decisions under docs/memory/. Keep docs/handoff.md short and session-scoped: completed work, verification, commit/push status, risks, and next steps.

Current product direction remains the local Aim OS agent harness, Desktop-first. Avoid default debug rails or stacked runtime/status panels in the Desktop shell. For any frontend or visual design request, load and update docs/memory/design-system.md.
```
