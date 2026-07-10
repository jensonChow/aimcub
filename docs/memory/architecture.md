# Architecture Memory

## Source Of Truth

Hosted Supabase is the online source of truth for MCP evidence and the future platform: Postgres, Auth, RLS, Realtime, and Storage.

The local Aim OS harness is local-store first until sync parity is explicitly needed. Current desktop data lives outside the repo under `~/.aimcub/store.json`; provider and context-source settings live beside it under `~/.aimcub/`.

Recoverable `AimDraft` rows are local-store product data, distinct from saved `Goal` rows. `saveGoal` can receive a draft id and should discard that draft only after the saved aim and related side effects have materialized successfully.

Do not reintroduce a hosted Web app until Supabase parity, collaboration, or sync needs a product surface. Do not assume hosted platform tables for local orchestration until Supabase migrations and API adapters are added.

## Core Boundaries

`@core/*` is the only place business logic lives. It must stay pure TypeScript with zero platform dependencies and unit tests. App shells under `apps/*` handle only I/O, rendering, and platform bridging.

CI protects core purity with ESLint `no-restricted-imports` and `types: []` TypeScript checks. New shared behavior belongs in `packages/core`, `packages/types`, `packages/store`, or `packages/llm` before it is wired into apps.

Choice cardinality is shared domain policy in `packages/core/src/choice-selection.ts`, not a renderer or prompt-only guess. Intake generation, post-draft clarification, `context.ask_user`, draft hydration, Desktop, and CLI all normalize through the same conservative decision: single-select needs explicit exactly-one/primary/default/best-fit copy or a clear binary/scalar shape; compatible or unclear answers resolve to multi-select. Structured model output carries an auditable reason code, but the reason alone cannot force single-select. Generators must phrase genuine single-choice scope explicitly so runtime normalization can verify it.

Interactive and non-interactive answer paths preserve that same contract. Desktop custom text replaces a preset single choice but supplements a multi-select set; CLI JSON input is validated against the generated questions and rejects multiple or conflicting values for a single-select question instead of silently discarding context.

## Evidence And Eval

Evidence is append-only and idempotent. Milestone completion is state derived from the evidence stream through `evaluate()`, never written directly.

Agent runs may record low-trust evidence with attribution, but should not auto-complete milestones unless eval/manual confirmation derives completion.

Execution progress read models must expose evidence review details from core, not UI-only state: each milestone row carries evidence items, trust, matched acceptance rule indexes/evaluators, pass/fail reasoning, and the next review action.

## Lean Defaults

Stay lean until concrete triggers demand more: use a jobs table plus pg_cron, linear milestones rather than DAGs, and single-table memory rather than vector infrastructure.

## Planning Tools

Built-in local planning tools are first-party Aimcub runtime tools, not MCP. MCP is the external connector/plugin boundary.

The unified built-in tool contract substrate lives in `packages/llm/src/tool-contract.ts` and is exported from `@core/llm`. It defines contracts, permissions, structured observations, normalized errors, handler types, and registries for `local.*`, `memory.*`, `web.*`, and `context.*` planning tools.

Pre-decomposition question generation uses bounded prompt sections so Aim text, internal gaps, cardinality rules, and the final output instruction survive large memory/research inputs. One broad internal gap may produce several atomic user questions within the global question budget; generated rows are no longer deduplicated solely by their source gap. If the model determines that collected context has already eliminated every high-impact blocker, it may return no question and the intake report becomes ready instead of forcing filler.

Post-draft clarification does not pad a useful model-generated set to an arbitrary form length. A two-question baseline is used only when the model returns no unresolved questions at all; it covers inspectable context and completion evidence. Concrete constraints and capabilities must come from actual Aim/context gaps rather than generic category cards; an existing-procedure fallback may replace the evidence question when durable eval context is already known.

Desktop binds runtime handlers for memory, local, context, and web planning paths. Permission UX, clearer user-facing activity, and execution-side evidence capture remain next-stage work.

## Current Orchestration Model

Aim OS orchestration has a durable local model in `@core/types`, `@core/domain`, and `@core/store`: actors, assignments, runs, run events, tool traces, context intake sessions, sub-aim relations, evidence attribution, evaluator runtime reports, and `AimProgressReadModel`.

Local goal creation materializes routing assignments from decomposition contracts. Manual child-aim decomposition is stored as a first-class sub-aim relation instead of only metadata.

`AimProgressReadModel` includes a derived completion recap only after all milestones are complete. The recap maps completed sub-aims, matching evidence summaries, passed evaluator rows, and pending or accepted context memory without storing separate aim-completion state.
