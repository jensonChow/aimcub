# Aimcub Handoff

Last updated: 2026-07-07
Branch: `codex/productize-plan-contract-review`

## Current Session

- Refactored the Plan/Contracts renderer out of `apps/desktop/src/renderer/App.tsx` into `apps/desktop/src/renderer/stages/plan/`.
- Reworked the default Plan/Contracts view into per-sub-aim execution contract cards with title/body, why, definition of done, required evidence, eval signal, suggested owner, selected owner, routing rationale, and human/agent override controls.
- Kept raw `acceptance_rule` JSON editing available only behind each sub-aim's Developer details disclosure.
- Preserved move up/down, merge up/down, split, save validation, routing override, agent selection, and model selection.
- Updated stage-scoped Plan/Contracts CSS in `apps/desktop/src/renderer/cockpit.css`; no shell, sidebar, footer menu, window chrome, hover rail, resize, or shell-grid selectors were changed.
- Added renderer coverage for the user-facing contract review default and CSS assertions for weak contract borders and advanced details.
- Updated `docs/memory/design-system.md` with the durable Plan/Contracts contract-review requirement.

## Changed Files

- `apps/desktop/src/renderer/App.tsx`
- `apps/desktop/src/renderer/App.test.tsx`
- `apps/desktop/src/renderer/cockpit.css`
- `apps/desktop/src/renderer/i18n.tsx`
- `apps/desktop/src/renderer/stages/plan/PlanPanel.tsx`
- `apps/desktop/src/renderer/stages/plan/PlanContractCard.tsx`
- `apps/desktop/src/renderer/stages/plan/planContract.ts`
- `docs/memory/design-system.md`
- `docs/handoff.md`

## Verification

Passed:

- `PATH=/Users/jenson/.local/node/bin:$PATH pnpm --filter @app/desktop typecheck`
- `PATH=/Users/jenson/.local/node/bin:$PATH pnpm --filter @app/desktop test`
- `git diff --check`

## Commit And Integration

- Commit message to create: `Productize plan contract review`
- Final commit hash: see `git log -1 --oneline` after the commit is created. The final hash is also reported in the session final because a tracked file cannot contain its own final commit hash without changing that hash.
- This worktree is intentionally not pushed or merged per the user request.
- `pnpm desktop:pack` and root `Aimcub.app` refresh were intentionally skipped per the user request; integration will handle full verification and packaging.

## Next Session Prompt

```text
Continue from `codex/productize-plan-contract-review`. Start by reading AGENTS.md, docs/handoff.md, and docs/memory/README.md, then load task-relevant memory. This branch productizes the Plan/Contracts stage as execution contract review and intentionally has not been pushed, merged, packaged, or refreshed into root Aimcub.app. Inspect `git log -1 --oneline`, run any integration-required verification, package/refresh Aimcub.app if needed, then merge/push from the integration session.
```
