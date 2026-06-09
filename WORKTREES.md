# v1a Parallel Worktrees

**v1a goal**: Web sets a goal → Sonnet decomposes it → MCP/GitHub evidence → milestone **auto-lights** (no pet yet). See `CLAUDE.md` and the plan doc for the full picture.

Linked git worktrees live under `./worktrees/` (gitignored), each on a `v1a/*` branch cut from `main`.

## Integration seam
The frozen `@core/types` + `@core/api-client` contract is how the worktrees stay compatible while built in parallel. **No worktree may change `packages/types`** (or other worktrees' owned packages) without coordination — if the contract looks wrong, flag it, don't fork it. All external I/O (Supabase, Claude API, OAuth) is **mocked**; live wiring is a separate integration step performed once credentials exist.

## Worktrees

| Dir | Branch | Owns | Responsibility |
|---|---|---|---|
| `worktrees/data` | `v1a/data` | `packages/db`, `packages/api` | supabase-js `GoalPetRepo` implementation, migrations evolution, RLS tests; research + document the aud-bound-token P0 (MCP auth) |
| `worktrees/decompose` | `v1a/decompose` | `packages/llm` | Anthropic `LlmGateway` implementation + goal→milestones decomposition pipeline (prompt + structured output → `validatePlan`) |
| `worktrees/evidence` | `v1a/evidence` | `packages/db/supabase/functions/` | `ingest` Edge Function (auth → idempotent dedup → normalize → write evidence → enqueue jobs) + jobs worker (`claim_jobs` → `evaluate()` → completions) |
| `worktrees/mcp` | `v1a/mcp` | `apps/mcp` | OAuth 2.1 resource server (JWT/JWKS verify + `aud`) + `report_evidence` tool + `get_inbox` |
| `worktrees/web` | `v1a/web` | `apps/web` | Goal-creation UI, decomposition view, Realtime milestone auto-light, progress bar |

## Dependency note
`v1a/data` is the critical path (everything reads/writes through it), but because the integration seam is a stable contract, `decompose` / `evidence` / `mcp` / `web` build against it + mocks in parallel right now. The aud-bound-token finding from `v1a/data` informs `v1a/mcp`'s auth design.

Each worktree carries a `CHARTER.md` with its detailed scope, boundaries, mock strategy, acceptance criteria, and explicit live-integration TODOs.
