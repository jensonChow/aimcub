# Aimcub Handoff

Last updated: 2026-07-09
Branch: detached HEAD worktree

## Current Session

- Request: fix Desktop product-usage bugs around raw planning errors, stale state, confusing transitions, and brittle plan-generation failure handling.
- Objective source: `/Users/jenson/.codex/attachments/b4047f6d-80bc-4027-baf9-fa0930140550/goal-objective.md`.
- Worktree constraints followed: no GUI/computer-use, no packaged app launch, no `pnpm desktop`, no `pnpm desktop:dev`, no `pnpm desktop:pack`, no root `Aimcub.app` refresh, no real `~/.aimcub` writes, no push, no merge.
- Desktop shell/sidebar/window-chrome preservation: `CockpitShell.tsx`, Desktop shell/sidebar/window-chrome selectors, and packaged app artifacts were not modified. `cockpit.css` changes are scoped to `.od-notice*` planning error disclosure styling.

## Completed Work

- Added `docs/desktop-product-bugs.md` with the focused product bug audit and regression cases.
- Added `apps/desktop/src/renderer/workflow/planningErrors.ts` for product-facing planning error formatting and retry route decisions.
- Updated Desktop draft/refine/save handling so:
  - raw validator paths are not shown in the default global error UI
  - developer details remain available behind an explicit disclosure
  - draft failures return to Context for regenerate/retry
  - refine failures keep the previous draft path available
  - save validation failures stay on Plan/Contracts
  - active plan validation messages are friendly in `PlanPanel`
- Updated `Notice` and `.od-notice*` styles for compact product copy plus bounded developer details.
- Extended LLM raw-plan normalization to repair numeric-string `min_files` values before Zod validation.
- Added renderer and LLM regression tests for user-facing formatting, developer details, failure routes, stale-state clearing, and `min_files` repair.
- Added a durable Desktop memory rule that planning/draft/refine/save internals stay behind Developer details.

## Changed Files

- `apps/desktop/src/renderer/App.tsx`
- `apps/desktop/src/renderer/App.test.tsx`
- `apps/desktop/src/renderer/Notice.tsx`
- `apps/desktop/src/renderer/cockpit.css`
- `apps/desktop/src/renderer/i18n.tsx`
- `apps/desktop/src/renderer/workflow/planningErrors.ts`
- `apps/desktop/src/renderer/workflow/workflowHelpers.test.ts`
- `packages/llm/src/decompose.ts`
- `packages/llm/src/decompose.test.ts`
- `docs/desktop-product-bugs.md`
- `docs/memory/desktop.md`
- `docs/handoff.md`

## Verification

- `pnpm --filter @app/desktop typecheck` passed.
- `pnpm --filter @app/desktop test` passed: 17 files, 131 tests.
- `pnpm --filter @core/domain test` passed: 14 files, 127 tests.
- `pnpm --filter @core/types test` passed with no test files.
- `pnpm --filter @core/llm test` passed: 17 files, 152 tests.
- `git diff --check` passed.

Note: the first `pnpm --filter @app/desktop typecheck` run hydrated missing workspace dependencies and found one optional `debugTrace` narrowing error, which was fixed before the passing rerun.

## Commit And Push Status

- Local commit is pending. The final commit hash will be reported in the Codex response after commit creation.
- This worktree is intentionally not pushed or merged. Integration will handle full verification, packaging, push, merge, and root `Aimcub.app` refresh.

## Open Items

- Full root verification, packaging, and app refresh are intentionally deferred to integration per objective.
- No browser/GUI visual pass was run because the objective forbids GUI interaction and packaged app operation in this parallel worktree.

## Next Session Prompt

```text
Continue from this detached Aimcub worktree or the integration branch. Read AGENTS.md, docs/handoff.md, and docs/memory/README.md first. Preserve Desktop shell/sidebar/window-chrome behavior. This session intentionally committed local Desktop planning error/state fixes without push, merge, desktop packaging, or root Aimcub.app refresh.
```
