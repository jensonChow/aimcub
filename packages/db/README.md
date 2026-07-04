# @core/db — Hosted Supabase Schema

`supabase/migrations/` contains the SQL migrations named by sequence number for
the hosted MCP evidence spine and future online platform. The local Aim OS
agent harness is local-store first; Supabase parity for newer local
orchestration entities is added only when hosted sync/collaboration needs it.

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
  `subscriptions` — prevents users from forging completions/evidence/entitlement tiers (derived state is anti-cheat).
- **jobs**: internal table, no user access whatsoever; `service_role` bypasses RLS. `claim_jobs(batch)` lets a worker atomically claim a batch.

> The emotional-shell tables (`pets` / `collectibles` / `notifications`) were dropped in migration `0011`
> when the product pivoted to pure aim management. Migrations `0001`-`0010` remain as immutable history.

## Key invariants

- `evidence` is append-only; `(emitter_id, source_event_id)` is unique = idempotency key.
- `milestone_completions.milestone_id` is unique = a node can only be completed once.
- `assert_evidence_emitter_owner` trigger: the evidence's emitter must belong to the same owner (prevents cross-user writes).
- `jobs.type` is constrained to `judge_evidence` / `extract_memory` (the surviving job kinds).
