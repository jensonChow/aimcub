# Aimcub Handoff

Last updated: 2026-07-04
Branch: `codex/context-bundle-review`

## Current Session

- Added a default Desktop context bundle review surface in the Context and Sub-aims stages.
- The review classifies used context, skipped or unread context, permission/setup gaps, and unresolved decomposition risks.
- The review uses existing planning context reports, planning tool traces, live planning events, saved goal metadata, intake questions, plan review gaps, and decomposition contract gaps.
- Added `apps/desktop/src/renderer/contextReview.ts` plus focused renderer tests for bundle classification.
- Updated product, Desktop, and design-system memory to make default context bundle review durable behavior.

## Current State

- Normal new aim flow remains: describe aim -> enter context collection -> answer or attach context -> generate plan.
- Context still shows the captured aim and context source setup without asking users to re-enter the aim.
- Context and Sub-aims now show "Review context before planning" with clear empty states before context is collected.
- Raw model prompts and debug traces remain outside the default product surface.
- Planning live events are now subscribed in the renderer so context review can populate during active planning runs, not only after save.

## Verification

Passed on this branch:

```bash
PATH=/Users/jenson/.local/node/bin:$PATH pnpm build && PATH=/Users/jenson/.local/node/bin:$PATH pnpm test && PATH=/Users/jenson/.local/node/bin:$PATH pnpm typecheck && PATH=/Users/jenson/.local/node/bin:$PATH pnpm lint && PATH=/Users/jenson/.local/node/bin:$PATH pnpm core:purity
git diff --check
```

Notes:
- `pnpm install` required network approval because `node_modules` was missing in the worktree.
- Turbo emitted non-fatal `IO error: Operation not permitted` warnings while all required tasks exited successfully.

Commit/push status: a local focused commit exists on `codex/context-bundle-review`; push is still pending explicit user approval because it transfers repository content to `origin`.

## Next Session Prompt

```text
Continue from codex/context-bundle-review or main after merge. Start by reading AGENTS.md, docs/handoff.md, and docs/memory/README.md, then load only task-relevant module memory. Keep context bundle review as a default product view before/inside planning: used context, skipped/unread context, permission/setup gaps, and unresolved decomposition risks should remain visible without exposing raw prompts/model traces. Keep new aim title/description owned by Aim, Context focused on captured aim plus answers/sources/review, Sub-aims focused on contracts plus context review, Execute focused on next-work ownership/actions, and Eval focused on evidence/rule review.
```
