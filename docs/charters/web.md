# Worktree Charter — `v1a/web` (the Aimcub web app)

> Status: archived historical memory. This charter describes the completed v1a/H1
> hosted evidence-spine worktree. It is not the active roadmap. Current v1 work is
> the local Aim OS agent harness in `docs/v1-spec.md`.

## Scope
Deliver the v1a web experience: **set a goal → see it decompose → watch a milestone light up by itself**, fully demoable locally with mocked data and **no backend**. The web app renders goals + milestones + decomposition + progress + auth only.

## Owned paths
- `apps/web/**`
- `CHARTER.md` (this file, at worktree root)

I do **not** touch `packages/types` (frozen domain contract), `packages/core`, `packages/api`, `packages/ui-tokens`, or any other package/worktree. I consume them read-only via their published types.

## Deliverables
1. **New Goal form** (`title` / `description` / `target_date`) that calls an *injected* data layer to create a goal and immediately render its decomposition.
2. **Decomposition / milestones view**: each milestone shows status, an acceptance-rule summary, `xp_reward` (a neutral effort/contribution weight), plus a goal **progress bar** (completed / total).
3. **Milestone auto-light** behind a `RealtimePort` interface. The mock implementation flips a `pending`/`in_progress` milestone to `completed` after a short delay so the "it lights up by itself" aha is demoable with zero backend. Real Supabase Realtime wiring is stubbed with `// TODO(v1a-live)`.
4. **In-memory mock data layer** (`MockGoalRepo`) seeded with sample goals + milestones, conforming to the `AimcubRepo` read surface from `@core/api-client`. Reads secrets from `process.env` only; never hardcodes.
5. **Unit tests** for pure helpers (progress calculation + acceptance-rule summary).

## Architecture / boundaries
- All domain types come from `@core/types` (re-exported via `@core/domain`); design tokens from `@ui/tokens`. No business logic is added in the app shell beyond pure view-model helpers (`lib/progress.ts`, `lib/acceptance.ts`) — these are presentation helpers, not domain logic, so they live in the app, not in `@core`.
- The data layer is an **injected port** (`DataPort`) so the real supabase-js repo can drop in later without touching the UI. The app wires a `MockGoalRepo` today.
- Realtime is an **injected port** (`RealtimePort`) with a `MockRealtime` driver. Client component subscribes; server components stay pure.

## Mock strategy
- `MockGoalRepo` implements the read slice of `AimcubRepo` (`listGoals`, `getGoal`, `listMilestones`) plus `createGoal`, holding state in module memory. Goal creation runs a deterministic local "decomposer" (no LLM call) that emits a `DecompositionOutput`-shaped plan and materializes `Milestone[]` via `@core/domain` validation.
- `MockRealtime` simulates evidence-driven auto-completion: after subscribe, it flips the next eligible milestone to `completed` on a timer and notifies subscribers. This stands in for the Supabase Realtime channel that, in production, fires when the Edge Function writes a `milestone_completions` row.
- No real network, no Supabase client, no Claude API call is made anywhere. `ANTHROPIC_API_KEY` / `NEXT_PUBLIC_SUPABASE_URL` are read from env only to demonstrate the wiring point and are never required.

## Live-integration TODOs (`// TODO(v1a-live)`)
- Replace `MockGoalRepo` with a supabase-js `AimcubRepo` implementation (user path under RLS).
- Replace the local deterministic decomposer with the `@core/llm` Claude Structured Output decomposition call.
- Replace `MockRealtime` with a Supabase Realtime channel subscription on `milestone_completions` / `milestones` for the current goal.
- Wire real auth (owner_id currently a fixed demo UUID).

## Acceptance criteria
- `pnpm --filter @app/web run typecheck` passes.
- `pnpm --filter @app/web run build` (next build) passes.
- `pnpm --filter @app/web run test` (vitest) passes — covers progress + acceptance-summary helpers.
- App boots with zero env/secrets and demonstrates: create goal → decomposition renders → a milestone auto-flips to completed and the progress bar advances, with no user action.
