# Aimcub Handoff

Last updated: 2026-07-04
Branch: `codex/plan-editing-tools`

## Current Session

- Added pure plan editing helpers in `@core/domain`: executable-plan validation, sub-aim text/rule edits, merge, split, and reorder with linear dependency rewriting.
- Added Desktop pre-save editing in the Plan/Contracts stage: title/body fields, done/evidence/eval contract fields, schema-validated acceptance rule editing, move up/down, merge up/down, and split.
- Kept save flow on the existing `DecompositionOutput` path. Edited drafts update `finalPlan`, save is blocked on invalid plans, and the store still materializes through the same validation gate.
- Added focused tests for edit/merge/split/reorder transformations and for creating a saved goal from an edited pre-save payload.
- Updated `docs/memory/design-system.md` with the durable requirement that generated plans are directly editable before save.

## Current State

- Normal new aim flow remains: describe aim -> collect context -> generate plan -> optionally refine -> edit/save plan.
- Unsaved generated plans can now be edited directly before saving. Saved aims remain read-only in the Plan/Contracts view.
- Structural edits rewrite plan edges into the current visible order so milestones remain executable as a linear chain.
- Acceptance-rule edits use the same `AcceptanceRule` schema as the rest of the app; invalid rule drafts show inline errors and disable Save.

## Verification

Passed:

```bash
PATH=/Users/jenson/.local/node/bin:$PATH pnpm build
PATH=/Users/jenson/.local/node/bin:$PATH pnpm test
PATH=/Users/jenson/.local/node/bin:$PATH pnpm typecheck
PATH=/Users/jenson/.local/node/bin:$PATH pnpm lint
PATH=/Users/jenson/.local/node/bin:$PATH pnpm core:purity
git diff --check
```

Notes:
- `pnpm install` was needed because this worktree initially had no `node_modules`; the first sandboxed install hit DNS restrictions, then a network-escalated install succeeded.
- Turbo emitted non-fatal `IO error: Operation not permitted` warnings while all required tasks exited successfully.
- `pnpm test` included the expected MCP stderr hygiene test output and still exited successfully.

Commit/push status: committed and pushed on `codex/plan-editing-tools`.

## Next Session Prompt

```text
Continue from `codex/plan-editing-tools` after the generated-plan editing tools. Start by reading AGENTS.md, docs/handoff.md, and docs/memory/README.md. Keep plan editing as a pre-save Plan/Contracts workflow: direct sub-aim text edits, acceptance/eval rule edits, merge, split, reorder, inline validation, and save through the validated DecompositionOutput path.
```
