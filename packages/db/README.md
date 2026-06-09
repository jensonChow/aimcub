# @core/db — Supabase schema (source of truth for data)

`supabase/migrations/` contains the SQL migrations named by sequence number.

## Applying migrations

```bash
# Local development (requires Docker):
supabase start
supabase db reset          # replay all migrations into the local stack

# Remote project:
supabase link --project-ref <ref>
supabase db push
```

Or apply them directly to the remote project via the Supabase MCP tool `apply_migration`.

## Generating shared types

After applying migrations, use `generate_typescript_types` to emit DB types, and check them for drift
against `@core/types` (the single source of truth in zod) in CI.

## Security groups (RLS)

- **Group A (user read/write)**: `goals` / `emitters` / `memories`.
- **Group B (user read-only, writes go through service_role)**: `milestones` / `evidence` / `milestone_completions` /
  `pets` / `collectibles` / `notifications` / `subscriptions` — prevents users from forging completions/evidence/XP/subscription tiers.
- **jobs**: internal table, no user access whatsoever; `service_role` bypasses RLS. `claim_jobs(batch)` lets a worker atomically claim a batch.

## Key invariants

- `evidence` is append-only; `(emitter_id, source_event_id)` is unique = idempotency key.
- `milestone_completions.milestone_id` is unique = a node can only be completed once.
- `pets.goal_id` is unique = one pet per goal.
- `assert_evidence_emitter_owner` trigger: the evidence's emitter must belong to the same owner (prevents cross-user writes).
