# Aimcub Handoff

Last updated: 2026-07-09
Branch: detached HEAD parallel worktree

## Current Session

- Request: replace the large numbered top stage pills with compact non-linear workbench navigation while preserving the Desktop shell/sidebar/window-chrome framework.
- Scope constraints followed: no GUI/computer-use, no packaged `Aimcub.app`, no `pnpm desktop`, no `pnpm desktop:dev`, no `pnpm desktop:pack`, no root app refresh, no real `~/.aimcub` writes, no push, no pull, no merge.
- This worktree is intentionally local-only; integration owns push, merge, full verification, and packaging.

## Completed Work

- Replaced numbered stage pills in `apps/desktop/src/renderer/CockpitShell.tsx` with compact workbench navigation: current surface label plus quiet segmented switcher.
- Top navigation labels are now Aim, Context, Contracts, Work, and Review. Internal `CockpitStage` names were preserved.
- Kept Cmd/Ctrl+1-5 stage shortcuts mapped to Aim, Context, Contracts, Run, and Eval through `WORKBENCH_STAGE_IDS`.
- Kept command palette stage navigation working by deriving stage command items from the same workbench stage metadata.
- Scoped CSS changes to `.od-stage-nav` and new stage-navigation descendants in `apps/desktop/src/renderer/cockpit.css`.
- Updated `apps/desktop/src/renderer/i18n.tsx` and `apps/desktop/src/renderer/App.test.tsx` for the new labels, accessibility, shortcut mapping, and protected-selector assertions.
- Recorded the durable non-linear workbench navigation rule in `docs/memory/desktop.md` and `docs/memory/design-system.md`.

## Verification

- `pnpm --filter @app/desktop typecheck` - passed.
- `pnpm --filter @app/desktop test` - passed, 17 test files and 129 tests.
- `git diff --check` - passed.

The first `pnpm --filter` script invocation hydrated ignored workspace dependencies because this worktree lacked `node_modules`. No `pnpm install` command was run, and no package manager or dependency files were changed.

## Shell And Sidebar Preservation

- Preserved sidebar pinned/collapsed/peek state model, hover reveal rail, toggle behavior, resize behavior and bounds, main sidebar geometry, Settings locked sidebar behavior, footer user menu/language submenu behavior, Home Panel/New Aim actions, recent aims behavior, native traffic lights/window chrome/drag strip behavior, and shell grid push/overlay behavior.
- Did not modify selectors beginning with or governing `.od-sidebar`, `.od-sidebar-*`, `.od-user-menu-*`, `.od-window-drag-strip`, `.od-sidebar-hover-zone`, `.od-sidebar-peek-trigger`, `.od-sidebar-toggle`, `.od-sidebar-resizer`, or shell grid/sidebar state selectors.
- Protected-selector preservation is covered by updated CSS assertions in `App.test.tsx`.

## Commit And Push Status

- Local focused commit: created after this handoff update; final hash is reported in the Codex response because a commit cannot contain its own final hash.
- Not pushed or merged by request. No packaging or root `Aimcub.app` refresh was performed.

## Open Items

- Integration should perform full visual QA at 960x680, 760x600, and 640x520, then package and refresh root `Aimcub.app` when it owns the final integration pass.

## Next Session Prompt

```text
Continue from this parallel Aimcub worktree. Read AGENTS.md, docs/handoff.md, and docs/memory/README.md first, then inspect git status. The workbench navigation commit is local-only and intentionally not pushed or merged; integration owns final visual QA, packaging, push, and merge.
```
