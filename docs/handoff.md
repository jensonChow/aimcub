# Aimcub Handoff

Last updated: 2026-07-04
Branch: `main`

## Current Session

- Previously merged `codex/avoid-duplicate-aim-intake` and `codex/clarify-journey-steps` into `main`.
- Merged `codex/simplify-context-sources` into `main`.
- Merged `codex/runtime-helper-settings` into `main`.
- Resolved merge conflicts in `apps/desktop/src/renderer/cockpit.css` and this handoff.
- Kept all Desktop journey improvements: Context shows the captured aim instead of a second aim composer, pre-draft intake is blocking context, post-draft clarify is optional refinement, context source setup has one summary plus one editable control surface, and Settings is framed as Aim helpers.

## Current State

- Normal new aim flow reads: describe aim -> enter context collection -> answer or attach context -> generate plan.
- Context stage shows a compact captured-aim summary plus context sources/questions. It does not ask users to re-enter the same aim except for explicit child-aim breakdown or unsaved-aim editing paths.
- Pre-draft intake is framed as blocking context before planning.
- Post-draft clarification is framed as optional draft refinement; users can accept the draft without answering optional refinement questions.
- Desktop context collection remains local-store first through `context-sources.json`; no planning/runtime behavior was changed by the context source UI simplification.
- The context source panel now presents active sources, attention state, and a single next action before the editable form, without repeated cards/tables/toggles for the same setting.
- Desktop Settings starts with helper readiness and next setup action, then shows the existing configuration forms in this order: Planning model, Local CLI agents, Web research, Context sources.

## Verification

Passed after merging `codex/runtime-helper-settings`:

```bash
PATH=/Users/jenson/.local/node/bin:$PATH pnpm build
PATH=/Users/jenson/.local/node/bin:$PATH pnpm test
PATH=/Users/jenson/.local/node/bin:$PATH pnpm typecheck
PATH=/Users/jenson/.local/node/bin:$PATH pnpm lint
PATH=/Users/jenson/.local/node/bin:$PATH pnpm core:purity
git diff --check
```

Notes:

- Turbo emitted non-fatal `IO error: Operation not permitted` warnings while all required tasks exited successfully.

Commit/push status: this handoff is part of the merge commit that brings `codex/runtime-helper-settings` into `main`.

## Next Session Prompt

```text
Continue from main after the Desktop journey cleanup merges. Start by reading AGENTS.md, docs/handoff.md, and docs/memory/README.md. Then load only the module memory relevant to the task.
Keep new aim title/description owned by the Aim stage. Context should collect answers, attachments, and sources without asking users to re-enter the same aim, except for explicit child-aim breakdown or unsaved-aim editing paths. Keep pre-draft intake framed as blocking context before planning and post-draft clarify framed as optional draft refinement. Keep context source setup product-first: one clear summary, one edit surface, and no repeated controls for the same source setting. Keep Settings framed as Aim helper setup rather than a runtime control panel.
```
