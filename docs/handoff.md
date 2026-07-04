# Aimcub Handoff

Last updated: 2026-07-04
Branch: `codex/manual-evidence-proof-flow`

## Current Session

- Replaced the thin Desktop Confirm proof action with an inline evidence submission flow.
- Manual proof now collects a proof note, URL(s), local file path references through the existing Electron file picker, and required-evidence checklist mapping before confirmation is recorded.
- Added a structured manual evidence payload for proof notes, URLs, local file references, and required-evidence mapping.
- Store validation now rejects empty manual proof, invalid non-HTTP(S) URLs, unchecked required evidence, and required-evidence items that do not belong to the milestone contract.
- Aim progress read model now carries evidence rows per milestone so Eval can show submitted proof details, not only evidence counts or matched IDs.
- CLI `confirm` now requires `--summary` as the proof note and maps listed required evidence to the confirmation.
- Updated Desktop design memory with the durable manual proof submission requirement.

## Current State

- Execute shows assignments, next work, agent run, child breakdown, and a Confirm proof action that opens the proof form instead of immediately writing evidence.
- Eval shows evaluator status plus submitted evidence summaries and reference counts for downstream review.
- Manual evidence remains append-only and completion remains derived by `evaluate()` through the existing `manual_check` path.
- Local files are referenced by path only; the app does not copy file bytes into evidence storage.

## Verification

Passed:

```bash
PATH=/Users/jenson/.local/node/bin:$PATH pnpm --filter @core/store test
PATH=/Users/jenson/.local/node/bin:$PATH pnpm --filter @app/desktop test -- App.test.tsx
PATH=/Users/jenson/.local/node/bin:$PATH pnpm --filter @core/domain test -- aim-os.test.ts evaluate.test.ts
PATH=/Users/jenson/.local/node/bin:$PATH pnpm build && PATH=/Users/jenson/.local/node/bin:$PATH pnpm test && PATH=/Users/jenson/.local/node/bin:$PATH pnpm typecheck && PATH=/Users/jenson/.local/node/bin:$PATH pnpm lint && PATH=/Users/jenson/.local/node/bin:$PATH pnpm core:purity
git diff --check
```

Visual check:
- Rendered the proof form in a temporary localhost harness using the real Desktop renderer CSS/component.
- Checked desktop 1280x720 and narrow 390x800 viewports in the in-app browser; no horizontal overflow or clipped controls were detected.

Notes:
- Turbo emitted non-fatal `IO error: Operation not permitted` warnings while all required tasks exited successfully.
- MCP worker tests intentionally log the expected missing-Supabase opaque-error path.

Commit/push status: committed and pushed on `codex/manual-evidence-proof-flow`.

## Next Session Prompt

```text
Continue from `codex/manual-evidence-proof-flow`. Start by reading AGENTS.md, docs/handoff.md, and docs/memory/README.md, then load only the module memory relevant to the task. Manual proof confirmation now requires proof details and required-evidence mapping before writing `manual_check` evidence. Keep evidence append-only, keep completion derived by eval, and preserve Execute as the proof collection surface with Eval as the evidence/rule review surface.
```
