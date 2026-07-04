# Aimcub Handoff

Last updated: 2026-07-04
Branch: `codex/runtime-helper-settings`

## Current Session

- Reframed Desktop settings from a flat Runtime page into "Aim helpers": planning model, local CLI agents, web research, and context sources.
- Updated `SettingsPanel` in `apps/desktop/src/renderer/App.tsx` to show helper readiness, blocked/optional/partial states, and the next setup action while keeping the existing Provider/Web/Local Agent/Context form components and save behavior.
- Preserved the existing aim-planning gate: planning is ready when either a provider is configured or an authenticated local CLI agent is available; provider setup does not block aim intake beyond the previous behavior.
- Updated sidebar/settings copy from runtime/cost language to helper/context language and tightened provider/local CLI blurbs so first-run setup feels like connecting helpers for the aim loop.
- Added responsive CSS for the helper intro, readiness rows, setup callout, and unframed helper section headers without adding rails, debug cards, or runtime strips.
- Updated `docs/memory/design-system.md` with the durable rule that settings are an aim-helper setup surface, not a runtime control panel.

## Current State

- Active app surfaces are `apps/desktop`, `apps/cli`, and `apps/mcp`.
- Active packages are `packages/core`, `packages/types`, `packages/store`, `packages/llm`, `packages/api`, and `packages/db`.
- Desktop Settings now starts with helper readiness and next setup action, then shows the unchanged configuration forms in this order: Planning model, Local CLI agents, Web research, Context sources.
- Hosted Supabase remains the online source of truth for MCP evidence and the future platform; the hosted web app should not be reintroduced until sync/collaboration needs it.

## Verification

Passed for this session:

```bash
PATH=/Users/jenson/.local/node/bin:$PATH pnpm build
PATH=/Users/jenson/.local/node/bin:$PATH pnpm test
PATH=/Users/jenson/.local/node/bin:$PATH pnpm typecheck
PATH=/Users/jenson/.local/node/bin:$PATH pnpm lint
PATH=/Users/jenson/.local/node/bin:$PATH pnpm core:purity
git diff --check
```

Note: use the `PATH=/Users/jenson/.local/node/bin:$PATH` prefix for pnpm commands in this worktree so Turbo child scripts use the same pnpm 9.15.0 runtime as the install.

Commit/push status: this handoff is part of the runtime helper settings commit; use `git log -1` for the final hash after the session commits and pushes.

## Next Session Prompt

```text
Continue from the helper-oriented Desktop Settings pass. Start by reading AGENTS.md, docs/handoff.md, and docs/memory/README.md. Then load only the module memory relevant to the task.
Treat Desktop, CLI, MCP, and the core packages as the active code hierarchy. Keep Desktop product-first and do not add default rails, debug cards, runtime strips, or hosted web/iOS/extension surfaces without a concrete product trigger and matching memory update.
```
