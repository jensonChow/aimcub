# Archived v1a Parallel Worktrees

> Status: historical memory. This file documents the completed v1a/H1 parallel
> worktree plan that built the hosted evidence spine. It is not the active
> roadmap. Current v1 work is the local Aim OS agent harness in
> `docs/v1-spec.md`; Supabase parity for newer local Aim OS orchestration
> entities is deferred until the online collaboration platform needs sync.

**Historical v1a goal**: Web sets a goal → Sonnet decomposes it → MCP/GitHub evidence → milestone **auto-lights**.

The linked git worktrees lived under `./worktrees/` (gitignored), each on a `v1a/*` branch cut from `main`.
The active `apps/web` package was later removed from the workspace when v1 narrowed to the Desktop-first local Aim OS harness.

## Integration seam
The frozen `@core/types` + `@core/api-client` contract is how the worktrees stay compatible while built in parallel. **No worktree may change `packages/types`** (or other worktrees' owned packages) without coordination — if the contract looks wrong, flag it, don't fork it. All external I/O (Supabase, Claude API, OAuth) is **mocked**; live wiring is a separate integration step performed once credentials exist.

## Worktrees

| Dir | Branch | Owns | Responsibility |
|---|---|---|---|
| `worktrees/data` | `v1a/data` | `packages/db`, `packages/api` | supabase-js `AimcubRepo` implementation, migrations evolution, RLS tests; research + document the aud-bound-token P0 (MCP auth) |
| `worktrees/decompose` | `v1a/decompose` | `packages/llm` | Anthropic `LlmGateway` implementation + goal→milestones decomposition pipeline (prompt + structured output → `validatePlan`) |
| `worktrees/evidence` | `v1a/evidence` | `packages/db/supabase/functions/` | `ingest` Edge Function (auth → idempotent dedup → normalize → write evidence → enqueue jobs) + jobs worker (`claim_jobs` → `evaluate()` → completions) |
| `worktrees/mcp` | `v1a/mcp` | `apps/mcp` | OAuth 2.1 resource server (JWT/JWKS verify + `aud`) + `report_evidence` / `goal_status` / `list_milestones` tools |
| `worktrees/web` | `v1a/web` | `apps/web` | Goal-creation UI, decomposition view, Realtime milestone auto-light, progress bar |

## Dependency note
`v1a/data` was the critical path (everything read/wrote through it), but the integration seam was a stable contract, so `decompose` / `evidence` / `mcp` / `web` built against it + mocks in parallel. The aud-bound-token finding from `v1a/data` informed `v1a/mcp`'s auth design.

Each worktree carried a `CHARTER.md` with its detailed scope, boundaries, mock strategy, acceptance criteria, and explicit live-integration TODOs.
