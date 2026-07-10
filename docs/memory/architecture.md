# Architecture Memory

## Source Of Truth

Hosted Supabase is the online source of truth for MCP evidence and the future platform: Postgres, Auth, RLS, Realtime, and Storage.

The local Aim OS harness is local-store first until sync parity is explicitly needed. Current desktop data lives outside the repo under `~/.aimcub/store.json`; provider and context-source settings live beside it under `~/.aimcub/`.

Recoverable `AimDraft` rows are local-store product data, distinct from saved `Goal` rows. `saveGoal` can receive a draft id and should discard that draft only after the saved aim and related side effects have materialized successfully.

Do not reintroduce a hosted Web app until Supabase parity, collaboration, or sync needs a product surface. Do not assume hosted platform tables for local orchestration until Supabase migrations and API adapters are added.

## Core Boundaries

`@core/*` is the only place business logic lives. It must stay pure TypeScript with zero platform dependencies and unit tests. App shells under `apps/*` handle only I/O, rendering, and platform bridging.

CI protects core purity with ESLint `no-restricted-imports` and `types: []` TypeScript checks. New shared behavior belongs in `packages/core`, `packages/types`, `packages/store`, or `packages/llm` before it is wired into apps.

The normative choice-cardinality rule lives in `product.md`. Generation prompts perform the Aim-aware semantic work: they receive the Aim and relevant context, test option pairs for same-scope coexistence, and split mixed decision dimensions. `packages/core/src/choice-selection.ts` is a deterministic trust-but-verify layer, not a general semantic classifier. It recognizes explicit exactly-one/primary/scalar wording plus clear Yes/No or same-resource availability binaries; preserves an aligned model `single` plus `mutually_exclusive` or `primary_choice_requested` decision when no strong coexistence contradiction exists; and preserves multiple for additive sets, compatible routes/evidence/capabilities, plural or coexistence cues, and uncertainty. Its stable auditable reasons are `mutually_exclusive`, `primary_choice_requested`, `compatible_options`, and `unclear_defaults_multiple`. Intake generation, post-draft clarification, `context.ask_user`, draft hydration, Desktop, and CLI all normalize through this shared layer.

Anthropic's public `multiSelect` contract informed the pairwise-coexistence rule, but Anthropic does not publish its internal classifier or system prompt. Do not describe Aimcub's layered implementation as copied Claude internals.

Interactive and non-interactive answer paths consume that same normalized contract. CLI JSON input is validated against the generated questions and rejects multiple or conflicting values for a single-select question. Selection reasons persist through shared types and draft storage so hydration can normalize legacy questions again.

## Evidence And Eval

Evidence is append-only and idempotent. Milestone completion is state derived from the evidence stream through `evaluate()`, never written directly.

Agent runs may record low-trust evidence with attribution, but should not auto-complete milestones unless eval/manual confirmation derives completion.

Execution progress read models must expose evidence review details from core, not UI-only state: each milestone row carries evidence items, trust, matched acceptance rule indexes/evaluators, pass/fail reasoning, and the next review action.

## Lean Defaults

Stay lean until concrete triggers demand more: use a jobs table plus pg_cron, linear milestones rather than DAGs, and single-table memory rather than vector infrastructure.

## Planning Tools

Built-in local planning tools are first-party Aimcub runtime tools, not MCP. MCP is the external connector/plugin boundary.

The unified built-in tool contract substrate lives in `packages/llm/src/tool-contract.ts` and is exported from `@core/llm`. It defines contracts, permissions, structured observations, normalized errors, handler types, and registries for `local.*`, `memory.*`, `web.*`, and `context.*` planning tools.

Pre-decomposition question generation uses bounded prompt sections so Aim text, internal gaps, cardinality rules, prior answers, and the final output instruction survive large memory/research inputs. The generator can split one broad gap into atomic decision dimensions, while Desktop asks for one question per adaptive turn and returns cumulative exploration history for the next decision. Follow-ups may explore outcome/motivation, baseline, stakeholders, resources/access/skills/budget/time, preferences/tradeoffs, authority/delegation, risks, source truth, environment/distribution, and completion evidence only when that dimension can change the plan. If collected context has eliminated every high-impact blocker, the model returns no question instead of forcing filler.

Web research is provider-independent above the search boundary. `packages/llm/src/planning-tool-context.ts` builds a bounded query plan across aim facts, authoritative requirements, alternatives/market, risks/tradeoffs, and user/audience evidence when relevant. It selects diverse sources with authority preference, fetches a bounded subset, preserves full URLs, and emits lane coverage, domain diversity, authority, freshness, conflict, uncertainty, and a scored sufficiency signal. Thin or unavailable research stays visible as a gap; it must not be promoted to sufficient context.

Post-draft clarification does not pad a useful model-generated set to an arbitrary form length. After generated questions are filtered against relevant memory, an empty unresolved set may receive up to two baseline questions within the runtime question budget: inspectable context and completion evidence. Concrete constraints and capabilities must come from actual Aim/context gaps rather than generic category cards; an existing-procedure fallback may replace the evidence question when durable eval context is already known.

Desktop binds runtime handlers for memory, local, context, and web planning paths. Its web runtime prefers configured Brave search and can fall back to an authenticated local Codex or Claude CLI for the bounded live-search corpus; provider failures remain normalized tool failures and research gaps.

## Local Agent Runtime

`packages/local-agent` is the shared Codex/Claude CLI boundary for Desktop and CLI. It owns discovery, authentication/model probes, safe command construction, permission mapping, structured event normalization, and the `LocalCliLlmGateway` planning fallback. Codex live search uses its explicit search mode; ordinary execution remains read-only or workspace-write according to the caller, with network disabled unless that workflow grants it.

`aimcub agents` exposes runtime detection. `aimcub run <aim> --workspace <absolute-path>` selects one dependency-ready, agent-owned, incomplete sub-aim unless `--milestone` chooses one; it persists a Run, normalized events, and attributed low-trust evidence, then re-reads derived progress. The command does not run a daemon, iterate until blocked, or write completion directly. A later queue/orchestration layer may schedule repeated runs, but eval remains the only automatic completion authority.

## Current Orchestration Model

Aim OS orchestration has a durable local model in `@core/types`, `@core/domain`, and `@core/store`: actors, assignments, runs, run events, tool traces, context intake sessions, sub-aim relations, evidence attribution, evaluator runtime reports, and `AimProgressReadModel`.

Local goal creation materializes routing assignments from decomposition contracts. Manual child-aim decomposition is stored as a first-class sub-aim relation instead of only metadata.

`AimProgressReadModel` includes a derived completion recap only after all milestones are complete. The recap maps completed sub-aims, matching evidence summaries, passed evaluator rows, and pending or accepted context memory without storing separate aim-completion state.
