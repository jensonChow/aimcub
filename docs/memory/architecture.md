# Architecture Memory

## Source Of Truth

Hosted Supabase is the online source of truth for MCP evidence and the future platform: Postgres, Auth, RLS, Realtime, and Storage.

The local Aim OS harness is local-store first until sync parity is explicitly needed. Current desktop data lives outside the repo under `~/.aimcub/store.json`; provider and context-source settings live beside it under `~/.aimcub/`.

The JSON store is crash-safe and multi-process-safe (2026-07-21): every persisted file is written via same-directory temp + fsync + atomic rename (`packages/store/src/safe-fs.ts`), each successful save mirrors into `store.json.bak`, and a corrupt load quarantines the bad file (`store.json.corrupt-<ts>`), recovers from the backup, and reports through `console.warn` plus the additive `AimStore.getDiagnostics()` — a corrupt store never silently presents as empty. All mutating store methods run their load→mutate→save cycle under a dependency-free advisory lock (`store.lock`: `wx` create, dead-pid/aged-out stale reclaim, token-verified release, 5s default timeout), so Desktop-vs-CLI writes serialize at operation granularity; reads stay lockless. Settings files are atomic + 0600 but deliberately not lock-guarded (whole-file writes, no read-modify-write). No store-level schema version yet — that is the flagged next step if the on-disk shape ever changes incompatibly.

Recoverable `AimDraft` rows are local-store product data, distinct from saved `Goal` rows. They persist `aim_surface` as `compose` or `summary` so restart does not infer committed presentation from stage or plan side effects; legacy rows without the field recover to summary. `saveGoal` can receive a draft id and should discard that draft only after the saved aim and related side effects have materialized successfully.

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

`packages/local-agent` is an open execution adapter boundary (2026-07-21): runtimes are `LocalAgentAdapter` objects in a registration-order registry (`src/registry.ts`; order IS the preference order for default selection and the planning fallback chain), with Codex and Claude as the two built-ins under `src/adapters/`. Adapters are pure description plus two pure functions — `buildInvocation` (MUST map `permission.sandbox`/`network` onto runtime flags; the security contract) and `parseLine` (normalize one output line; `null` ⇒ engine emits `agent.raw`) — while the engine (`src/runtime.ts`) owns processes, timeouts, `AbortSignal` cancellation, serialized `onEvent` delivery, and classified failures (`LocalAgentFailure`, `retryable` true only for timeout so far). `LocalAgentId` is a free string; persistence (`PlanRoutingOverride.agent_id`, evidence payloads) was already string-typed, so third-party ids flow through routing→run→evidence with no schema change. Adding a runtime = one adapter module + tests; see `docs/local-agent-adapters.md`. `LocalCliLlmGateway` remains the planning fallback (chain = registry order of authenticated adapters). Codex live search uses its explicit search mode; ordinary execution remains read-only or workspace-write according to the caller, with network disabled unless that workflow grants it.

Execution is queued and orchestrated (2026-07-22): the runs collection IS the durable queue — `createRun(status:"queued")` + atomic `claimNextQueuedRun` under the store lock (claims are **sandbox-scoped**: Desktop's worker drains `read-only` only, so it can never execute a `workspace-write` run the CLI queued). One shared orchestrator (`packages/local-agent/src/orchestrator.ts` + `run-queue.ts`, store injected as a structural port — local-agent has no `@core/store` dependency; queue e2e tests therefore live in `apps/cli/src/run-queue.test.ts`) runs select→claim→execute→evidence(`mcp_report`, trust 0.6)→finish→sediment for both CLI and Desktop. Events are batched to disk via additive `appendRunEvents` (tool boundaries / terminal / 250ms; all events persisted before a run finishes) and streamed live to the cockpit over the `runLiveEvent` push IPC; `cancelRun` aborts via AbortSignal. Retries: one linked retry for `failure.retryable` (timeout) tracked by `attempt`/`retry_of` on the queue payload; canceled runs never retry; runs are immutable history. `aimcub run` executes one sub-aim by default or sweeps with `--until-blocked` (one attempt per sub-aim per sweep). There is still no background daemon — queued work advances only while Desktop is open or a CLI invocation runs — and eval remains the only automatic completion authority; the queue never writes completion.

Runs are artifact-aware and permission-explicit (2026-07-22). Adapters may enrich tool events with `artifacts: {path, kind}[]` (`file_write`/`file_edit`/`file_delete` — operations, not states; reads are not artifacts); the orchestrator persists one deduped `artifact.created` event per (path, kind) with touch counts on the evidence payload, retains raw runtime payloads under caps (8KB/event, 256KB/run, explicit truncation markers), and emits `evidence.reported` linking the run's `mcp_report` evidence. Selection failures are typed (`AgentSelectionError`/`MilestoneSelectionError` in `packages/local-agent/src/errors.ts`) and map to the CLI's UserError path — message texts are pinned, only classification changed. Desktop execution permission is explicit per run: `RunPermissionConsent` (sandbox/network/workspace) flows renderer→main→queued row, main rejects `danger-full-access` and invalid workspaces (the renderer is never the boundary), the background drain stays read-only-scoped, and widened runs execute only via same-session claim-by-runId — a widened run stranded by a closed window stays queued (consent dies with the session). Debug surfaces are gated behind a persisted developer-mode toggle (`desktop-settings.json`). User-facing threat model: `docs/agent-permissions.md`.

## Current Orchestration Model

Aim OS orchestration has a durable local model in `@core/types`, `@core/domain`, and `@core/store`: actors, assignments, runs, run events, tool traces, context intake sessions, sub-aim relations, evidence attribution, evaluator runtime reports, and `AimProgressReadModel`.

Local goal creation materializes routing assignments from decomposition contracts. Manual child-aim decomposition is stored as a first-class sub-aim relation instead of only metadata.

`AimProgressReadModel` includes a derived completion recap only after all milestones are complete. The recap maps completed sub-aims, matching evidence summaries, passed evaluator rows, and pending or accepted context memory without storing separate aim-completion state.

Two additional pure `@core` read derivations serve Desktop list/journey surfaces without expanding stored state. `summarizeAimProgress` produces a coarse per-aim rollup (total/completed/blocked/running + a status of planning/needs_you/running/blocked/complete) from milestone/assignment/run status only; the store's `listAimProgressSummaries` maps every goal through it in one pass so list surfaces avoid firing N `getAimProgress` calls (each of which runs the full `evaluate()` pipeline). `summarizeAimResearch` derives a real research/context-gathering signal (none/gathering/ready) from an aim's active memories + pending candidates instead of a synthetic proxy. The run-lifecycle journal reads through `store.listRunEvents(goalId)`, which joins the already-persisted `runEvents` (keyed by `run_id`) back to a goal via its runs; it is exposed as a separate `getAimJournal` IPC so it does not bloat the hot `getAimProgress`.
