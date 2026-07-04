# Aimcub Handoff

Last updated: 2026-07-04
Branch: `codex/aim-first-onboarding`

## Current Session

- Fixed first-run Desktop routing so missing planning helpers no longer send users directly to Aim helpers settings.
- Added aim-derived helper guidance: after a user states an aim and no provider/local CLI agent is ready, the Aim stage explains the needed capability and best helper path for that aim.
- Made Aim helpers settings contextual when an aim is active, showing the aim title, derived capability, best helper, and return-to-aim action.
- Added focused renderer tests for first-run routing, runtime readiness, and aim helper profile derivation.
- Added the durable first-run aim-first rule to `docs/memory/design-system.md`.

## Current State

- Initial Desktop refresh defaults to the Aim stage whether or not a provider/local agent exists.
- Submitting an aim without a configured provider or ready local CLI agent keeps the user on Aim and shows helper setup guidance instead of jumping to settings.
- Runtime settings remain reachable from the sidebar and from the new guidance card; when opened with an active aim, settings explain why the helper matters for that aim.
- Helper profile derivation currently uses lean keyword heuristics for code/workspace, current research, source-context, and general planning aims.

## Verification

Passed:

```bash
PATH=/Users/jenson/.local/node/bin:$PATH pnpm --filter @app/desktop test -- firstRunFlow
PATH=/Users/jenson/.local/node/bin:$PATH pnpm --filter @app/desktop typecheck
PATH=/Users/jenson/.local/node/bin:$PATH pnpm --filter @app/desktop lint
PATH=/Users/jenson/.local/node/bin:$PATH pnpm build && PATH=/Users/jenson/.local/node/bin:$PATH pnpm test && PATH=/Users/jenson/.local/node/bin:$PATH pnpm typecheck && PATH=/Users/jenson/.local/node/bin:$PATH pnpm lint && PATH=/Users/jenson/.local/node/bin:$PATH pnpm core:purity
git diff --check
```

Notes:
- `pnpm install` was required because workspace dependencies were absent; initial sandboxed install failed on registry DNS, then succeeded with approved network access.
- Turbo emitted non-fatal `IO error: Operation not permitted` warnings while all required tasks exited successfully.

Commit/push status: focused commit and push are completed from this session.

## Next Session Prompt

```text
Continue from branch codex/aim-first-onboarding after the aim-first onboarding fix. Start by reading AGENTS.md, docs/handoff.md, and docs/memory/README.md. Preserve the first-run rule: capture the aim before helper setup, derive or explain required helper capability from that aim, and keep Aim helpers settings contextual rather than a generic runtime landing page.
```
