# Aimcub - Core Project Memory

Aimcub is a universal aim-management layer: it holds the aim, routes work across humans and agents, and accrues the context plus eval that make the system intelligent.

## Non-Negotiables
- Keep this file at 50 lines or fewer. It is the root memory for MUST/NEVER rules only.
- Put durable module memory in `docs/memory/`; put transient session transfer in `docs/handoff.md`.
- All committed repo content must be English: code, comments, identifiers, commit messages, docs, and SQL. Only `zh` i18n values may be Chinese.
- After repository changes, run `pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm core:purity`, then create a focused commit and push unless the user explicitly says not to.
- Update `docs/handoff.md` before ending a session that changes the repo.

## Product Contract
- Aimcub must manage aims, not avatars. Humans and agents are both paths to the goal.
- Memory and eval are core product pillars; memory keeps the org stable, eval keeps it correct.
- Context is the product: durable context must form naturally from work, not from hand-maintained profiles.
- Eval must be personalized. Benchmarks without user/org context are not enough.

## Locked Invariants
- Hosted Supabase is the online source of truth for web/MCP evidence and the future platform.
- Local Aim OS state is local-store first until sync parity is explicitly needed.
- Evidence is append-only and idempotent; milestone completion is derived by `evaluate()`, never written directly.
- `@core/*` is the only place business logic lives: pure TypeScript, zero platform dependencies, unit-tested.
- App shells under `apps/*` only perform I/O, rendering, and platform bridging.
- Stay lean-first: jobs table plus pg_cron, linear milestones, single-table memory, no vectors until concrete triggers demand more.
- Built-in local planning tools are first-party Aimcub runtime tools; MCP is the external extension boundary.

## Loading Order
- Always read `docs/handoff.md` for the current transfer state.
- Read `docs/memory/README.md`, then only the module memories relevant to the task.
- For frontend or visual design work, load and update `docs/memory/design-system.md` with new user design requirements.
- Use `docs/vision.md` and `docs/v1-spec.md` for full product direction and current v1 scope.

## Commands
`pnpm install` - `pnpm build` - `pnpm test` - `pnpm typecheck` - `pnpm lint` - `pnpm core:purity`
