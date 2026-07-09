# Aimcub Handoff

Last updated: 2026-07-09
Branch: `main`

## Current Session

- Request: integrate the real-use product bug batch by merging the non-linear workbench navigation, Context research loop, and planning/error hardening worktrees into `main`.
- Objective source: `/Users/jenson/.codex/attachments/81d210d1-ec67-4b6f-af24-dc79d39f8402/goal-objective.md`.
- Integration constraints: preserve the tuned Desktop shell/sidebar/window-chrome framework, use isolated visual-test data under `/tmp/aimcub-local-alpha-demo`, refresh root `Aimcub.app` only after verification, and push `main` only after the full suite, seed smoke test, and visual notes are complete.

## Merge Progress

- Merged `f3458963 Replace linear stage pills with workbench navigation`.
- Merged `f67db11c Make context intake an iterative research loop`.
- Pending: `b4901979 Harden desktop planning errors and state transitions`.

## Conflict Notes

- `docs/handoff.md` conflicted between parallel worktree handoff reports and was rewritten as this integration-session handoff.
- Final conflict-resolution notes will be completed after the planning/error hardening merge.

## Verification

- Pending full required suite:
  - `PATH=/Users/jenson/.local/node/bin:$PATH pnpm build`
  - `PATH=/Users/jenson/.local/node/bin:$PATH pnpm test`
  - `PATH=/Users/jenson/.local/node/bin:$PATH pnpm typecheck`
  - `PATH=/Users/jenson/.local/node/bin:$PATH pnpm lint`
  - `PATH=/Users/jenson/.local/node/bin:$PATH pnpm core:purity`
  - `git diff --check`
- Pending isolated local-alpha seed smoke check.
- Pending Desktop packaging, root `Aimcub.app` refresh, and visual inspection.

## Shell And Sidebar Preservation

- Workbench navigation changes in `CockpitShell.tsx` are accepted.
- Protected sidebar/window-chrome behavior has not yet been final-verified after all merges.

## Seeded Visual Inspection Notes

- Pending.

## Commit And Push Status

- Local `main` is mid-integration and ahead of `origin/main`.
- Final commit/push status is pending verification and visual inspection.

## Open Items

- Finish planning/error hardening merge.
- Verify no horizontal overflow at 960x680, 760x600, and 640x520.
- Verify Context activity, chat-like question flow, sufficiency signal, and friendly planning errors in the refreshed root app bundle.

## Next Session Prompt

```text
Continue the Aimcub real-use product bug integration from main. Read AGENTS.md, docs/handoff.md, docs/memory/README.md, and the objective file first, then inspect git status. Preserve Desktop shell/sidebar/window-chrome behavior, use AIMCUB_HOME=/tmp/aimcub-local-alpha-demo for visual testing, and do not write to the real ~/.aimcub store.
```
