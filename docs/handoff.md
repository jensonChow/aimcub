# Aimcub Handoff

Last updated: 2026-07-10
Branch: `main`

## Current Session

- Request: fix repeated misclassification of compatible Context answers as single-select, research the public Claude Design and Claude Code interaction model, and improve Aim/context understanding rather than adding another option-count heuristic.
- Starting state: clean local `main` at `c3d58d25`, three commits ahead of `origin/main` at `c15345f8`.
- Evidence reviewed: official Anthropic Claude Code user-input, agent-loop, best-practice, autonomy, and Claude Design materials; the complete pre-draft and post-draft clarification pipelines; `context.ask_user`; Desktop, CLI, draft persistence, store, and type contracts; current product and interaction memories; and the user's reported non-exclusive life-path example.
- Research boundary: Anthropic publicly exposes an explicit `multiSelect` contract and examples where compatible sections are multiple while mutually exclusive output formats are single. It does not publish Claude's internal classifier or system prompt. The pairwise-coexistence policy and deterministic safeguards below are Aimcub engineering inferences from that public behavior, not copied Claude internals.

## Completed Work

- Added one pure core selection policy shared by every Aimcub question surface. A question is single-select only when the answer set is demonstrably mutually exclusive or the prompt is tightly anchored to one primary/default/best/current scalar choice. Compatible answers and unresolved ambiguity default to multiple-select. Model-provided mode or reason alone cannot force single-select.
- Added structured selection reason codes and propagated them through intake, clarification, tool contracts, shared types, store fixtures, Desktop drafts, and hydration. Legacy drafts are re-normalized on load so old incorrect single-select labels do not silently retain bad behavior.
- Reworked both clarification prompts around pairwise coexistence, exact Aim wording, existing context, memory, and prior answers. Broad source gaps can split into several atomic questions; empty model output is valid; pre-draft and post-draft flows no longer manufacture a fixed-size form or pad high-confidence output with generic capability and constraint questions.
- Hardened question quality and budgets: bounded every prompt section independently, enforced runtime question limits, deduplicated option labels and identifiers, preserved `Other`, and kept fallback questions limited to high-impact source and completion-evidence gaps.
- Updated Desktop answer semantics. Single-select custom text replaces a preset; multiple-select custom text supplements presets. Single questions now expose a real radio-group accessibility model with roving focus and arrow/Home/End navigation, while multiple questions remain pressed toggle buttons.
- Updated CLI answer semantics. Interactive multiple-select accepts comma-separated choices plus optional custom text; JSON answers validate against the actual question modes and reject conflicting values for single-select questions. Selected labels now survive into the intake signal.
- Added bilingual adversarial coverage for the reported life-path case, parallel routes, cross-resource availability, contextual versus genuine primary/default wording, binary availability, dates, residency, current scalar state, duplicate options, split-gap identifiers, prompt truncation, zero-question readiness, persistence migration, and keyboard behavior.
- Updated durable product, architecture, Desktop, and design-system memory to lock the semantic policy and answer-control behavior.

## Changed Areas

- `packages/core`: shared semantic choice-mode policy, reason vocabulary, intake types, exports, and adversarial tests.
- `packages/llm`: pre-draft intake, post-draft clarification, schemas, `context.ask_user`, tool contracts, prompt budgets, fallbacks, and tests.
- `apps/desktop`: planner integration, clarification controls, debug rendering, draft persistence and migration, accessibility, and tests.
- `apps/cli`: interactive and JSON answer parsing, selected-label propagation, and tests.
- `packages/types` and `packages/store`: persisted reason contract and fixtures.
- `docs/memory`: product, architecture, Desktop, and design-system rules.

## Verification

- Full required gate passed after the final edits: `pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm core:purity && git diff --check`.
- Test result: 81 files and 868 tests passed. Relevant package totals were Core 171, LLM 164, CLI 84, Desktop 197, Store 62, API 40, DB 36, and MCP 114.
- The expected MCP missing-Supabase-environment stderr came only from its hygiene fixture; the suite passed.
- `pnpm desktop:pack` passed with Electron 43.0.0 for macOS arm64, without signing.
- `ditto apps/desktop/dist/mac-arm64/Aimcub.app Aimcub.app` refreshed the project-root bundle. It is `com.aimcub.desktop`, version `0.0.0`; `Resources/app.asar` SHA256 is `a22b2a4e9c792f3607471a10f10a0ce28201d0bd83dad22617621908c210ebaa`.
- No live app state was mutated and no real `~/.aimcub` data was written. Logic, persistence migration, SSR rendering, accessibility, and keyboard behavior were verified through automated tests.
- Independent final review found no P0 or P1 issue in the policy, intake/clarify counts, CLI validation, Desktop radio behavior, or legacy migration.

## Commit And Push Status

- Feature commit: `8e5ed037` (`Fix semantic context choice modes`).
- Local merge commit: `74e9a825` (`Merge semantic context choice modes`).
- Handoff-only commit: pending at the time this file was written.
- Remote push: not performed. The prior export safety review requires fresh explicit user approval; `origin/main` remains at `c15345f8`.

## Open Risks

- The deterministic core deliberately covers only high-confidence wording and answer-shape evidence. It is a safety layer around model understanding, not an attempt to encode every language pattern. Unknown or ambiguous relations intentionally resolve to multiple-select because that loses less valid context than a false single-select.
- Anthropic's internal classification logic is not public. Future tuning should continue to use observed product failures and adversarial bilingual examples, without presenting Aimcub's inferred policy as Claude internals.
- A future deterministic seeded visual pass can supplement the automated radio and multi-toggle coverage, but no known behavior or accessibility blocker remains.

## Next Session Prompt

```text
Continue from Aimcub main. Read AGENTS.md, docs/handoff.md, docs/memory/README.md, docs/memory/product.md, docs/memory/architecture.md, docs/memory/desktop.md, and docs/memory/design-system.md first. Preserve the shared semantic choice policy: require strong evidence for single-select, default uncertain compatible answers to multiple-select, and never reintroduce option-count or fixed-form padding heuristics. Use an isolated AIMCUB_HOME for any state-changing visual QA.
```
