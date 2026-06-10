# Worktree Charter — `evidence` (v1a/evidence)

## Subsystem
The server spine that turns raw evidence into milestone completions:

1. **Evidence ingest Edge Function** — receives a normalized-ish raw event (commit / CI run)
   from an authenticated emitter, dedupes it, normalizes it via `@core/domain`, persists it as
   append-only evidence, and enqueues a `judge_evidence` job.
2. **Jobs worker** — claims `judge_evidence` jobs, loads the target milestone's `acceptance_rule`
   plus its evidence, runs the pure `@core` `evaluate()` kernel, and (when the rule passes AND the
   `completion_mode` allows auto) writes an **idempotent** `milestone_completion`
   (`decided_by = 'rule_auto'`) and enqueues follow-up jobs (`grow_pet`, `mint_collectible`,
   `deliver_notification`).

Both pieces are written as **pure, dependency-injected functions** (`handleIngest`, `runJob`) so
they are unit-testable in Node/Vitest without Deno, Supabase, or any network. The Deno entry
wrappers (`functions/ingest/index.ts`, `functions/jobs-worker/index.ts`) are the only place that
touches real I/O, and every live wire is tagged `// TODO(v1a-live)`.

## Scope / owned paths
- `packages/db/supabase/functions/**` (new)
- `packages/db/vitest.config.ts` (new)
- `packages/db/package.json` (additive: test/typecheck scripts + dev/workspace deps)
- `CHARTER.md` (this file)

I do **not** touch `packages/types` (frozen contract), `packages/core`, `packages/api`, the SQL
migrations, or any other worktree's package.

## Contract anchors (read, never modified)
- `@core/domain` `evaluate(rule, evidence)` → `{ passed, matchedEvidenceIds, trustScore, clauseSatisfied }`,
  with `AUTO_VERIFY_MIN_TRUST = 0.8`. A clause marked `auto_verifiable` rejects evidence whose
  `trust_score < 0.8` (anti-spoofing).
- `@core/domain` `normalizeCommitEvidence` / `normalizeCiEvidence` → `NormalizedEvidence`
  (`kind`, `source_event_id`, `occurred_at`, `summary`, `payload`, `trust_score`). Verified commit
  trust = 1.0, unverified commit trust = 0.7, CI trust = 1.0.
- `@core/types`: `AcceptanceRule`, `CompletionMode` (`auto` | `manual` | `auto_then_confirm`),
  `Evidence`, `Milestone`, `MilestoneCompletion`, `Job`, `JobType`.
- `IngestEvidenceInput` (`@core/api-client` shape) — the ingest write payload.
- Migration `0001_init.sql`: `evidence` idempotency = unique `(emitter_id, source_event_id)`;
  `milestone_completions.milestone_id` is UNIQUE (a milestone completes once);
  `jobs.dedup_key` is unique-when-present; `claim_jobs(batch)` atomically claims queued jobs.

> NOTE on decoupling: tests define a **local** minimal repo interface inline and do **not** import
> `@core/api-client`. The shared functions are generic over a small `IngestRepo` / `WorkerRepo`
> port defined in `_shared/ports.ts`, so they stay independent of the full `AimcubRepo`.

## Mock strategy
- **No real network or credentials.** `handleIngest` / `runJob` take a `deps` bag (`repo`,
  `verifyAuth`, `now`) — every external interaction is an injected port.
- Tests provide an **in-memory repo** that enforces the same idempotency invariants as Postgres
  (unique `(emitter_id, source_event_id)` on evidence, unique `milestone_id` on completion, unique
  `dedup_key` on jobs).
- The Deno entry wrappers build the *real* deps (service-role Supabase client, real emitter-token
  verifier, `claim_jobs` polling). All of that is behind `// TODO(v1a-live)` and is **never imported
  by tests** — so typecheck/tests stay green offline.

## Acceptance criteria (tests, all in Node/Vitest)
1. **Dedup**: the same `(emitterId, sourceEventId)` ingested twice writes evidence once and enqueues
   the judge job once; the second call returns the existing row.
2. **Normalization correctness**: a raw commit / CI run becomes evidence with the right `kind`,
   `source_event_id`, `summary`, and `trust_score`.
3. **Judge AUTO-completes on trusted evidence**: a verified commit (trust 1.0) satisfying an
   `auto_verifiable` `commit_pattern` clause with `completion_mode: auto` writes a `rule_auto`
   completion carrying the milestone's `xp_reward` and enqueues `grow_pet`.
4. **Judge does NOT auto-complete on low-trust evidence**: an unverified commit (trust 0.7 <
   `AUTO_VERIFY_MIN_TRUST` 0.8) does not produce a completion.
5. **Manual mode guard**: even when the rule passes, `completion_mode: manual` does not auto-complete.
6. **Completion idempotency**: re-running the judge job for an already-completed milestone does not
   double-write or double-award.

## Live-integration TODOs (deferred to v1a-live, all tagged in code)
- Real emitter-token verification (hash lookup against `emitters.token_hash`, revocation check).
- Real service-role Supabase client + `claim_jobs` RPC polling loop (pg_cron trigger).
- Real persistence of evidence / completions / jobs through the supabase-js `AimcubRepo` impl.
- HTTP request parsing / signature verification for GitHub & CI webhooks.
