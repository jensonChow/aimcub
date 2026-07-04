# History Memory

## Legacy Gates

v0 is complete: monorepo foundation, `@core` kernel, and hosted Supabase evidence spine.

H1 auto-evidence and H2 context/eval are validation history and infrastructure inside the current v1. Do not use them as the active product phase split unless the user explicitly pivots back.

The old v1a/v1b split is historical. `WORKTREES.md` documents the completed v1a/H1 parallel worktree effort and should be treated as archived memory.

## Historical Product Shift

The project moved from a hosted milestone auto-light demo toward a local-first Aim OS agent harness. Desktop is now the primary local orchestration surface; MCP remains the hosted external evidence surface. The old Web app, iOS app, extension placeholder, and unused cross-platform UI tokens package were removed from the active workspace on 2026-07-04.

The local Aim OS direction consolidated context/eval around a shared planning-context workflow in `packages/llm/src/context-workflow.ts`. CLI and Desktop use shared store-port helpers for planning context selection, aim intake, clarify/capture/lineage/decomposition learning, decomposition strategy, and review/assumption context candidates.

## Recent Baseline Commits

Recent mainline commits that shaped the current memory:

- `23ebde9` - sync memory docs with local harness direction.
- `d0e5dad` - reframe v1 around local Aim OS harness.
- `6f7946a` - update desktop handoff memory.
- `f5297ca` - simplify desktop app layout.
- `0b82fc5` - add desktop release packaging.

## Archived Tool-Substrate Context

The first-party planning tool substrate has already landed in the local harness direction. If the user asks to revisit it, start from the current contracts and handlers rather than the old archived prompt:

- `packages/llm/src/tool-contract.ts`
- `packages/llm/src/tool-registry.ts`
- `packages/llm/src/planning-tool-context.ts`
- `apps/desktop/src/main/tools.ts`

The active missing layer is permission UX, clearer user-facing tool activity, execution-side evidence capture, and tighter local-agent run feedback.
