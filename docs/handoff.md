# Aimcub Handoff

Last updated: 2026-07-10
Branch: `main`

## Current Session

- Request: restore real single-select questions, deepen user exploration and research coverage, add working network research, and connect local agent CLIs to the Aimcub product loop.
- Starting state: local `main` at `e84e229f`, seven commits ahead of `origin/main` at `c15345f8`.
- Implementation branch: `codex/deepen-context-research-cli`.
- Evidence reviewed: the current intake/clarify normalization path, Desktop planning tools and research settings, local Codex/Claude adapters, CLI/store/eval flows, official Codex CLI/config documentation, live local-agent probes, and the relevant durable project memory.

## Completed Work

- Repaired choice normalization with a trust-but-verify rule. An aligned generated `single` plus exclusive/primary reason now survives unless wording or options contain strong additive/coexistence evidence. Compatible routes, evidence, capabilities, plural sets, and uncertainty remain multiple-select.
- Replaced the pre-draft static question batch with a bounded adaptive interview. Desktop asks one question, returns cumulative visible questions and answers through the same intake run, appends one non-duplicate follow-up, and stops when the model reports sufficient context or six turns are reached.
- Expanded model exploration across outcome and motivation, baseline, users and stakeholders, resources/access/skills/budget/time, preferences and tradeoffs, authority/delegation, risks and disallowed outcomes, source truth, environment/distribution, and observable completion evidence when those dimensions can change the plan.
- Added a provider-independent research brief across aim facts, authoritative requirements, alternatives/market, risks/tradeoffs, and user/audience evidence. It preserves URLs and exposes lane coverage, domain diversity, authority, freshness, conflict signals, gaps, and scored sufficiency. Fetch selection is lane-aware, authority-prioritized, and domain-diverse.
- Added Desktop local-CLI web research fallback. Configured Brave remains the dedicated provider; otherwise an authenticated Codex/Claude CLI builds one bounded live-search corpus that is reused across research lanes, and first-party page fetching verifies selected public sources. Web research is required only for relevant or explicitly enabled aims, not every aim merely because deep mode is on.
- Extracted shared Codex/Claude discovery, live model selection, permission mapping, current JSONL parsing, and execution into `packages/local-agent`. Codex network runs use `--search`; workspace-write shell network is separately scoped. Claude workspace writes use `acceptEdits`, and network-off runs disallow built-in WebSearch/WebFetch.
- Connected CLI planning to an authenticated local agent when no API key exists. Added `aimcub agents` and a bounded `aimcub run <id> --workspace <absolute-path>` command that executes one ready agent-owned sub-aim, streams/persists events, records attributed low-trust evidence, re-evaluates progress, and sediments context without writing completion directly.
- Updated durable product, architecture, Desktop, design-system, v1, tool-contract, local-alpha, vision, and README documentation. The CLI remains explicitly one-run-at-a-time: no daemon, until-blocked loop, retry scheduler, or direct completion claim.

## Verification

- `pnpm install --frozen-lockfile` passed for all 11 workspace projects.
- The full required gate passed: `pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm core:purity`, and `git diff --check`.
- Test result: 88 test files and 900 tests passed. Package totals were Core 176, LLM 170, local-agent 10, CLI 88, Desktop 204, Store 62, API 40, DB 36, and MCP 114. The expected missing-Supabase stderr came only from the MCP hygiene fixture.
- A real read-only Codex `--search` run used the live compatible model catalog and returned the current official Codex CLI documentation URL through the normalized JSONL parser.
- Built CLI smoke passed: `aimcub agents --json` detected authenticated Codex CLI `0.142.5` with live models and an installed but unauthenticated Claude Code `2.1.191`.
- An isolated `AIMCUB_HOME=/tmp/aimcub-cli-plan-smoke` run of built `aimcub plan` completed without an API key through local Codex, including structured decomposition and the quality retry/review path. Its deliberately thin input remained honestly flagged for missing context/research instead of being presented as high-quality evidence.
- `pnpm desktop:pack` passed with Electron 43.0.0 for macOS arm64, without signing, and the project-root `Aimcub.app` was refreshed. It is `com.aimcub.desktop`, version `0.0.0`; `Resources/app.asar` SHA256 is `089cf0eb76f30c3f217fb184665dc2947b809c6183e74d92df5a275273325d65`.
- No real `~/.aimcub` state was read or written. Live Aimcub CLI checks used isolated `/tmp` homes; the local-agent smoke was read-only.

## Commit And Push Status

- Feature commit: `c25dcf6b` (`Deepen context research and local CLI orchestration`).
- Local merge commit: `1dd6f9e2` (`Merge deeper context research and CLI orchestration`).
- This handoff is the only post-merge change and will be finalized in a focused local `main` commit.
- Local `main` is nine commits ahead of `origin/main` before the handoff commit. Remote push is not performed because the user did not authorize it; `origin/main` remains at `c15345f8`.

## Open Risks

- Adaptive intake and source classification still depend on model behavior. Deterministic normalization, bounded turns, source URL preservation, coverage scoring, and focused tests constrain the failure modes, but there is not yet a live benchmark across a broad multilingual Aim corpus.
- Local-CLI research gathers one bounded corpus per planning context. It is materially deeper and faster than spawning one agent per lane, but difficult or highly dynamic topics may still need a dedicated Brave provider, additional domain-specific queries, or explicit user sources.
- `aimcub run` handles one ready agent-owned sub-aim per invocation. Durable queues, automatic until-blocked orchestration, retries, resumable sessions, and structured artifact capture remain future work.
- An open manual-proof draft is protected from normal in-app navigation but is not checkpointed across process termination or a full reload.
- A deterministic isolated-seed packaged visual pass remains useful for the adaptive question transition and Settings provider label. Component, source-state, build, package, and real CLI regressions passed in this session.

## Next Session Prompt

```text
Continue from Aimcub main. Read AGENTS.md, docs/handoff.md, docs/memory/README.md, and the module memory for the surface you touch. Preserve trust-but-verify single/multiple normalization, the one-question adaptive intake loop, research coverage/sufficiency honesty, and eval-only completion. Treat packages/local-agent as the shared Codex/Claude runtime boundary. Use isolated AIMCUB_HOME for live or packaged validation. Do not push the local commits until the user gives fresh explicit approval.
```
