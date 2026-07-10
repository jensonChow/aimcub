# Aimcub Handoff

Last updated: 2026-07-10
Branch: `main`

## Current Session

- Request: fix repeated single-select classification of compatible Context answers, research the public Claude interaction contract, then run `$memory-refresh` so project memory matches the implementation and current Git state.
- Starting state: the feature began from local `main` at `c3d58d25`, three commits ahead of `origin/main`; the memory refresh began from clean `main` at `2769ff4e`, six commits ahead of `origin/main` at `c15345f8`.
- Evidence reviewed: official Anthropic public materials, the complete choice-mode implementation and adversarial tests, recent diffs and commits, the memory audit, root contracts, module memory map, prior handoffs at `c15345f8` and `c3d58d25`, and three independent read-only audits.

## Completed Work

- Added one shared choice-mode contract across pre-draft intake, post-draft clarification, `context.ask_user`, Desktop, draft hydration, and CLI. Aim-aware generation prompts test same-scope option coexistence; the deterministic Core layer accepts only high-confidence single-choice evidence and otherwise preserves context as multiple-select.
- Removed option-count and fixed-form heuristics. Pre-draft intake can split a broad gap into atomic questions or return zero when ready. Post-draft clarification keeps any useful non-empty model set without padding; after memory filtering leaves no unresolved question, it may add up to two baseline questions within the runtime budget.
- Preserved answer semantics end to end: Desktop single custom text replaces a preset while multi custom text supplements presets; radio groups support roving keyboard navigation; legacy migration preserves ambiguous or unknown selections as visible custom text; CLI validates answers against the generated question mode.
- Added bilingual adversarial coverage for compatible life paths and routes, primary/default/scalar counterexamples, binary availability, migration, CLI parsing, prompt budgets, question counts, and Desktop control semantics.
- Refreshed memory ownership. `product.md` is the normative semantic source; `architecture.md` now distinguishes model reasoning from the deterministic safety layer and records the public-research boundary; `desktop.md` owns hydration data safety; `design-system.md` owns radio/toggle/custom/keyboard behavior; `operations.md` and the root contracts now require authorization before push.
- Restored unresolved risks that had been dropped when the prior handoff was replaced, and corrected the stale pending handoff commit state.

## Memory-Refresh Files

- `AGENTS.md`
- `CLAUDE.md`
- `docs/memory/architecture.md`
- `docs/memory/desktop.md`
- `docs/memory/design-system.md`
- `docs/memory/operations.md`
- `docs/handoff.md`

## Verification

- The read-only memory audit passed; `AGENTS.md` and `CLAUDE.md` remain identical, hard-rule-only, and 34 lines each under the 50-line limit.
- The full required gate passed on the refresh: `pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm core:purity`, and `git diff --check`.
- Test result: 81 files and 868 tests passed. Package totals remain Core 171, LLM 164, CLI 84, Desktop 197, Store 62, API 40, DB 36, and MCP 114. The expected missing-Supabase stderr came only from the MCP hygiene fixture.
- `pnpm desktop:pack` passed with Electron 43.0.0 for macOS arm64, without signing, and the project-root `Aimcub.app` was refreshed. It is `com.aimcub.desktop`, version `0.0.0`; `Resources/app.asar` SHA256 is `a22b2a4e9c792f3607471a10f10a0ce28201d0bd83dad22617621908c210ebaa`.
- No live app state or real `~/.aimcub` data was changed during this memory refresh.

## Commit And Push Status

- Choice-mode feature commit: `8e5ed037` (`Fix semantic context choice modes`).
- Choice-mode local merge commit: `74e9a825` (`Merge semantic context choice modes`).
- Choice-mode handoff commit: `2769ff4e` (`Finalize context choice mode handoff`).
- This handoff is part of the focused memory-refresh commit on local `main`; no separate branch merge is needed. That commit leaves local `main` seven commits ahead of `origin/main`.
- Remote push is not performed. The prior export safety review requires fresh explicit user approval; `origin/main` remains at `c15345f8`.

## Open Risks

- Semantic pairwise reasoning currently depends on the model prompt, pure Core tests, and mock-gateway adversarial regressions. The Core layer is intentionally a conservative wording/answer-shape safeguard, and there is not yet a live-provider accuracy benchmark over a broader Aim corpus.
- An open manual-proof draft is protected from normal in-app navigation but is not checkpointed across process termination or a full reload.
- A deterministic isolated-seed packaged pass should still cover the new radio/multi controls, the Aim summary at exactly 640 by 520, saved-contract code, the fixed web provider value, and selected Contract/Work layouts. Automated regressions cover related component behavior and responsive selectors; these packaged visual assertions remain pending.

## Next Session Prompt

```text
Continue from Aimcub main. Read AGENTS.md, docs/handoff.md, docs/memory/README.md, and the module memory for the surface you touch. Preserve product.md as the choice-cardinality source of truth, keep model semantic reasoning separate from the conservative Core safeguard, and never reintroduce option-count or fixed-form padding heuristics. Use an isolated AIMCUB_HOME for state-changing visual QA. Do not push the seven local commits until the user gives fresh explicit approval.
```
