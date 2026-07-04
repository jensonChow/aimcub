# Aimcub Handoff

Last updated: 2026-07-04
Branch: `codex/separate-execute-eval-stages`

## Current Session

- Split Desktop Execute and Eval into separate stage surfaces instead of sharing one execution panel.
- Execute now focuses on assignment ownership, latest run state, next work, run-agent action, human proof confirmation, and child breakdown.
- Eval now focuses on evidence totals, rule mode, matched evidence IDs from the read model, evaluator status, trust/explanation, human-review flags, and pending context candidates from progress.
- Kept debug traces out of the default stage views.
- Added Desktop CSS for the new stage cards, metrics, evaluator rows, responsive stacking, and disabled action states.
- Updated Desktop i18n strings for the new Execute/Eval labels in English and Chinese.
- Recorded the durable Execute/Eval stage distinction in `docs/memory/design-system.md`.
- Moved the existing pnpm React overrides from deprecated `package.json#pnpm` config to `pnpm-workspace.yaml` for pnpm 11, and added explicit native build approvals plus noninteractive module-purge config so the required pnpm commands run in Codex.

## Current State

- Active app surfaces remain `apps/desktop`, `apps/cli`, and `apps/mcp`.
- Active packages remain `packages/core`, `packages/types`, `packages/store`, `packages/llm`, `packages/api`, and `packages/db`.
- Desktop stage model is Aim -> Context -> Sub-aims -> Execute -> Eval, with Execute answering who/what should do next work and Eval answering what evidence exists, whether rules are satisfied, and what needs review.
- Hosted Supabase remains the online source of truth for MCP evidence and the future platform.

## Verification

Passed for this session:

```bash
pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm core:purity
git diff --check
```

Visual verification also passed with a temporary IPC-mocked renderer harness served on `127.0.0.1`: desktop and 700 px narrow Execute/Eval views had no horizontal overflow; Execute showed owner/action controls; Eval showed evaluator/evidence review without execution action buttons.

## Commit / Push

This handoff is part of the Execute/Eval split commit. Use `git log -1` and `git status --short --branch` for the final local and remote state.

## Next Session Prompt

```text
Continue from the Desktop Execute/Eval split. Start by reading AGENTS.md, docs/handoff.md, and docs/memory/README.md. Then load only the module memory relevant to the task.
Treat Desktop, CLI, MCP, and the core packages as the active code hierarchy. Keep Execute focused on next work ownership/actions and Eval focused on evidence/rule review.
```
