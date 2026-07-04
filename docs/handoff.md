# Aimcub Handoff

Last updated: 2026-07-04
Branch: `main`

## Current Session

- Reworked the project memory mechanism around three layers:
  - root contract: `AGENTS.md` and compatibility mirror `CLAUDE.md`, both kept under 50 lines and limited to MUST/NEVER project rules;
  - durable module memory: `docs/memory/`;
  - session transfer: this `docs/handoff.md`.
- Added `docs/memory/README.md` as the memory map and loading guide.
- Added module memories for product, architecture, desktop, operations, and history.
- Moved long-lived product, architecture, desktop, verification, and legacy notes out of the handoff into the relevant module memories.
- Kept the handoff intentionally short so the next session can read current state without historical noise.

## Current State

- The active product direction remains the open-source local Aim OS agent harness first, with the online Aim platform and Aim Share later.
- Desktop remains the primary local orchestration surface. Do not reintroduce default debug rails, runtime strips, or stacked status panels.
- For future work, load `docs/memory/README.md` and then the relevant module memory before editing a module.

## Verification

Passed for this session:

```bash
PATH=/Users/jenson/.local/node/bin:$PATH pnpm build
PATH=/Users/jenson/.local/node/bin:$PATH pnpm test
PATH=/Users/jenson/.local/node/bin:$PATH pnpm typecheck
PATH=/Users/jenson/.local/node/bin:$PATH pnpm lint
PATH=/Users/jenson/.local/node/bin:$PATH pnpm core:purity
git diff --check
```

Commit/push status: this handoff is part of the memory-mechanism commit; use `git log -1` for the final hash after the session commits and pushes.

## Next Session Prompt

```text
Continue from the updated Aimcub memory mechanism. Start by reading AGENTS.md, docs/handoff.md, and docs/memory/README.md. Then load only the module memory relevant to the task.

Keep AGENTS.md/CLAUDE.md under 50 lines and reserved for hard project rules. Put durable product/architecture/module decisions under docs/memory/. Keep docs/handoff.md short and session-scoped: completed work, verification, commit/push status, risks, and next steps.

Current product direction remains the local Aim OS agent harness, Desktop-first. Avoid default debug rails or stacked runtime/status panels in the Desktop shell.
```
