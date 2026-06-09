# CHARTER — `v1a/data` worktree

Owner: data-access layer + DB. Branch `v1a/data`.

## Scope (owned paths)

- `packages/api/**` — the `GoalPetRepo` implementations.
- `packages/db/**` — migration evolution + the aud-bound-token research finding.
- This `CHARTER.md` at the worktree root.

Nothing else. `packages/types` is the frozen domain contract and is **read-only** here;
if it looks wrong it goes in `result.blockers`, it is never edited.

## Deliverables

1. `SupabaseGoalPetRepo` — implements `GoalPetRepo` (from `@core/api-client`) on top of
   `@supabase/supabase-js`. The **user path** (RLS-bound, anon/user JWT client) is separated
   from the **machine write path** (service_role client) exactly as the interface doc and the
   RLS security groups in `0001_init.sql` describe:
   - User path (Group A read+write / Group B read-only under RLS):
     `createGoal`, `getGoal`, `listGoals`, `listMilestones`, `getPet`, `listCollectibles`, `listInbox`.
   - Server path (service_role, bypasses RLS — writes Group B derived/anti-cheat state):
     `insertMilestones`, `ingestEvidence`.
2. `InMemoryGoalPetRepo` — full in-memory mock of the same interface, for tests and local dev.
   Enforces the three DB invariants in code:
   - evidence is idempotent/unique by `(emitter_id, source_event_id)` when `source_event_id` is non-null;
   - `milestone_completions` unique by `milestone_id` (modeled via the completion set; the repo
     surface that touches it is evidence-driven, so we expose the invariant guard for the worker);
   - one pet per goal (`pets.goal_id` unique).
3. Vitest tests exercising the InMemory invariants + a mocked-client conformance test for Supabase.
4. `packages/db/AUTH_FINDINGS.md` — the aud-bound-token (RFC 8707) P0 research + recommendation
   that feeds the `mcp` worktree.

## Mock strategy

- `@supabase/supabase-js` installed and used for real types. No live project is contacted.
- All external I/O is behind the repo boundary. Tests use `InMemoryGoalPetRepo` plus a tiny
  hand-rolled fake of the postgrest builder to prove `SupabaseGoalPetRepo` issues the right
  table/op/filter chain — no network, no credentials.
- Config (`url`, anon key, service_role key) is read from env at the call site; never hardcoded,
  never required for tests.

## Acceptance criteria

- `pnpm --filter @core/api-client --filter @core/db run typecheck` is green.
- `pnpm --filter @core/api-client --filter @core/db run test` is green.
- `SupabaseGoalPetRepo` and `InMemoryGoalPetRepo` both structurally satisfy `GoalPetRepo`
  (asserted by a `satisfies`/typed-construction test).
- InMemory invariant tests cover: evidence idempotency dedup, one-pet-per-goal, RLS-scoped reads
  (a user only sees their own rows), milestone-completion uniqueness guard.

## Live-integration TODOs (deferred to integration once credentials exist)

Marked in code with `// TODO(v1a-live): ...`:
- Wire real Supabase project URL + keys from env / secrets manager.
- Replace the symmetric anon-JWT assumption with the asymmetric-JWKS + aud-bound token decided in
  `AUTH_FINDINGS.md` once the `mcp` worktree picks an auth model.
- `ingestEvidence` idempotency currently relies on the DB unique index returning a conflict; the
  live path must `upsert ... on conflict (emitter_id, source_event_id) do nothing` + re-select.
- `getPet` / completions assume the jobs worker (other worktree) has materialized derived state.
