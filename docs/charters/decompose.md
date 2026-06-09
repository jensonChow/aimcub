# CHARTER — `@core/llm` (worktree: decompose)

## Subsystem
LLM gateway + goal-decomposition pipeline for GoalPet v1a.

## Scope (what this worktree owns)
- `packages/llm/**` only. Plus this `CHARTER.md` at the worktree root.
- Deliverables:
  1. `AnthropicLlmGateway` — a concrete `LlmGateway` (`complete` + `completeStructured`)
     backed by the official `@anthropic-ai/sdk`, with model routing via `routeModel(task)`,
     API key read from `process.env.ANTHROPIC_API_KEY`, and usage reported through an
     injected `UsageMeter`.
  2. `decompose(gateway, input)` — builds a system+user prompt, asks Claude for a FLAT
     `nodes[] + edges[]` plan graph (1..15 milestones, each with `commit_pattern` / `ci_status`
     acceptance evaluators), validates with the zod `DecompositionOutput`, runs `validatePlan`,
     and returns `{ output, validation, usage }`. Never throws on bad model output — returns errors.
  3. Vitest tests with a MOCK gateway (no network).

## Boundaries (hard constraints)
- NEVER modify `packages/types` (frozen domain contract) or any package owned by another worktree.
- `validatePlan` + `DecompositionOutput` come from `@core/*`; this package only consumes them.
  - `DecompositionOutput` (zod) is re-exported by `@core/types` and `@core/domain`.
  - `validatePlan` lives in `@core/domain` (`packages/core`) → added as a workspace dependency.
- English only (code, comments, identifiers, prompts, UI copy).

## Mock strategy
- **No real network in tests.** Every test uses a hand-written `MockGateway` implementing
  `LlmGateway`; `completeStructured` returns canned `DecompositionOutput`-shaped JSON.
- The real `AnthropicLlmGateway` reads `process.env.ANTHROPIC_API_KEY` lazily (only when a
  request is actually made), so importing the module and running tests never requires a key.
- `@anthropic-ai/sdk` installed from the offline pnpm cache (`@anthropic-ai/sdk@^0.102.0`).
  Structured output is requested via `output_config.format = { type: "json_schema", schema }`
  on `messages.create()` (GA structured outputs; the JSON Schema is derived from
  `DecompositionOutput` and avoids recursion per the flat nodes+edges design).

## Model routing (locked by the v0 contract — not changed here)
- `goal_complete` → Opus (`claude-opus-4-8`)
- `decompose` / `replan` / `celebrate` → Sonnet (`claude-sonnet-4-6`)
- `nudge` / `classify` / `extract_memory` → Haiku (`claude-haiku-4-5-...`)
`decompose` therefore runs on Sonnet.

## Acceptance criteria
- `pnpm --filter @core/llm run typecheck` passes.
- `pnpm --filter @core/llm run test` passes:
  - decompose maps + validates a canned structured output (commit_pattern + ci_status clauses);
  - decompose rejects cyclic, duplicate-key, and out-of-range (>15 / <1 node) plans via `validatePlan`;
  - decompose surfaces zod parse failures as `{ ok: false, errors }` without throwing;
  - `routeModel` routing assertions (opus / sonnet / haiku) still pass.

## Live-integration TODOs (for when credentials exist)
- `// TODO(v1a-live)` markers in `anthropic-gateway.ts` flag the only real I/O point:
  the `client.messages.create(...)` call and the `ANTHROPIC_API_KEY` read.
- Prompt-caching, retry/circuit-breaker tuning, and prompt-quality iteration are deferred;
  the `UsageMeter` hook is wired so quota/circuit-breaker logic can attach later.
