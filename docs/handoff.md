# Aimcub Handoff

Last updated: 2026-07-07
Branch: detached worktree

## Current Session

- Added `docs/local-alpha.md` as the concise open-source local alpha contract.
- Linked the local alpha contract from `README.md` and `docs/v1-spec.md`.
- Defined the local alpha golden path: New Aim -> Context intake -> Plan/contracts -> Human/agent routing -> Run/manual proof -> Evidence append -> Eval -> Context candidate review -> Future reuse.
- Made local alpha non-goals explicit: hosted multiplayer, sync, teams, Aim Share, iOS, browser extension, cloud-agent runner, and vector memory.
- Added `@core/domain` golden-loop coverage for the pure `AimProgressReadModel`: next action, evidence review, completion recap, pending context, accepted global context, and manual proof.
- Added `@core/store` golden-loop coverage that replays one realistic local aim through context intake, decomposition contracts, routing assignments, agent run/manual proof, evidence append, derived completion, context sedimentation, candidate acceptance, and reusable global memory.

## Current State

- One focused local commit will be created after this handoff update: `Define local alpha contract and golden loop tests`.
- Final commit hash is reported in the session final response after the commit is created.
- This worktree is intentionally not pushed or merged; the integration session will handle that.
- Root `Aimcub.app` was not refreshed and `pnpm desktop:pack` was not run because packaging was not changed and the user explicitly opted out for this parallel worktree.
- Desktop shell/sidebar/window-chrome files were not edited.

## Verification

Passed:

- `COREPACK_HOME=/private/tmp/aimcub-corepack PATH=/Users/jenson/.local/node/bin:$PATH pnpm --filter @core/domain test -- src/aim-os.test.ts`
- `COREPACK_HOME=/private/tmp/aimcub-corepack PATH=/Users/jenson/.local/node/bin:$PATH pnpm --filter @core/store test -- src/store.test.ts`
- `COREPACK_HOME=/private/tmp/aimcub-corepack PATH=/Users/jenson/.local/node/bin:$PATH pnpm --filter @core/domain test`
- `COREPACK_HOME=/private/tmp/aimcub-corepack PATH=/Users/jenson/.local/node/bin:$PATH pnpm --filter @core/store test`
- `COREPACK_HOME=/private/tmp/aimcub-corepack PATH=/Users/jenson/.local/node/bin:$PATH pnpm --filter @core/domain typecheck`
- `COREPACK_HOME=/private/tmp/aimcub-corepack PATH=/Users/jenson/.local/node/bin:$PATH pnpm --filter @core/store typecheck`
- `git diff --check`

Notes:

- The first narrow `@core/domain` test run exposed a test-fixture mismatch between the commit-pattern acceptance rule and the synthetic evidence message; the fixture was corrected and the affected test was rerun successfully.
- The first test commands hydrated this worktree's dependencies and logged slow registry download warnings before tests ran.

## Next Session Prompt

```text
Continue from the local commit created by this session in the detached Aimcub worktree. Start by reading AGENTS.md, docs/handoff.md, docs/memory/README.md, then task-relevant module memory.

This session added docs/local-alpha.md, linked it from README.md and docs/v1-spec.md, and added local alpha golden-loop tests in packages/core/src/aim-os.test.ts and packages/store/src/store.test.ts. It intentionally did not push, merge, run pnpm desktop:pack, or refresh root Aimcub.app. Integration should run the full repo verification/packaging flow and then handle push/merge if approved.
```
