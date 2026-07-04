# Architecture Memory

## Source Of Truth

Hosted Supabase is the online source of truth for MCP evidence and the future platform: Postgres, Auth, RLS, Realtime, and Storage.

The local Aim OS harness is local-store first until sync parity is explicitly needed. Current desktop data lives outside the repo under `~/.aimcub/store.json`; provider and context-source settings live beside it under `~/.aimcub/`.

Do not reintroduce a hosted Web app until Supabase parity, collaboration, or sync needs a product surface. Do not assume hosted platform tables for local orchestration until Supabase migrations and API adapters are added.

## Core Boundaries

`@core/*` is the only place business logic lives. It must stay pure TypeScript with zero platform dependencies and unit tests. App shells under `apps/*` handle only I/O, rendering, and platform bridging.

CI protects core purity with ESLint `no-restricted-imports` and `types: []` TypeScript checks. New shared behavior belongs in `packages/core`, `packages/types`, `packages/store`, or `packages/llm` before it is wired into apps.

## Evidence And Eval

Evidence is append-only and idempotent. Milestone completion is state derived from the evidence stream through `evaluate()`, never written directly.

Agent runs may record low-trust evidence with attribution, but should not auto-complete milestones unless eval/manual confirmation derives completion.

## Lean Defaults

Stay lean until concrete triggers demand more: use a jobs table plus pg_cron, linear milestones rather than DAGs, and single-table memory rather than vector infrastructure.

## Planning Tools

Built-in local planning tools are first-party Aimcub runtime tools, not MCP. MCP is the external connector/plugin boundary.

The unified built-in tool contract substrate lives in `packages/llm/src/tool-contract.ts` and is exported from `@core/llm`. It defines contracts, permissions, structured observations, normalized errors, handler types, and registries for `local.*`, `memory.*`, `web.*`, and `context.*` planning tools.

Desktop binds runtime handlers for memory, local, context, and web planning paths. Permission UX, clearer user-facing activity, and execution-side evidence capture remain next-stage work.

## Current Orchestration Model

Aim OS orchestration has a durable local model in `@core/types`, `@core/domain`, and `@core/store`: actors, assignments, runs, run events, tool traces, context intake sessions, sub-aim relations, evidence attribution, evaluator runtime reports, and `AimProgressReadModel`.

Local goal creation materializes routing assignments from decomposition contracts. Manual child-aim decomposition is stored as a first-class sub-aim relation instead of only metadata.

`AimProgressReadModel` includes a derived completion recap only after all milestones are complete. The recap maps completed sub-aims, matching evidence summaries, passed evaluator rows, and pending or accepted context memory without storing separate aim-completion state.
