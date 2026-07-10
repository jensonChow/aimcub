# Aimcub Handoff

Last updated: 2026-07-10
Branch: `codex/fix-aim-summary-regression`

## Current Session

- Request: fix the regression where a captured Aim could reappear as the New Aim input after submit or draft recovery.
- Starting state: clean `main` matched `origin/main` at `ba029dfe` (`Refresh compact Aim layout handoff`).
- Root cause: the missing-runtime submit branch returned before switching from compose to summary, while hydration guessed the Aim presentation from stage, phase, and plan state because drafts did not persist that distinction.

## Completed Work

- Made the submit presentation decision explicit. A normal first submit now checkpoints a durable summary snapshot before changing the UI, then enters the static Aim summary even when no provider or authenticated local agent is available. Explicit Edit remains buffered when runtime setup blocks regeneration, so the committed Aim and existing plan cannot drift.
- Added the persisted `aim_surface` draft field with `compose` and `summary` values. New drafts write the current presentation state, edit serializes as summary, and legacy rows without the field recover safely into summary instead of reopening an input.
- Removed the stage/phase/plan hydration heuristic. Draft autosave now reacts to Aim surface changes, and unsubmitted composition no longer presents itself as a selected draft workbench with Aim/Context/Contracts navigation.
- Added a summary-native helper-setup state. A captured Aim without a planning runtime stays readable and offers Edit plus Set up planning helper instead of keeping helper recovery inside the composer.
- Added value-level transition, persistence, legacy normalization, Store round-trip, component rendering, and App integration regression tests. Updated architecture, Desktop, and design-system memory with the durable presentation-state contract.

## Verification

- Focused verification passed: Desktop 29 test files / 220 tests, Desktop typecheck, Store 64 tests, and `git diff --check`.
- Repository gates passed: `pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm core:purity`, and `git diff --check`.
- Repository tests passed across 90 test files and 918 tests. Package totals were Core 176, LLM 170, local-agent 10, CLI 88, Desktop 220, Store 64, API 40, DB 36, and MCP 114. The expected missing-Supabase stderr came only from the MCP hygiene fixture.
- `pnpm desktop:pack` passed with Electron 43.0.0 for macOS arm64, without signing. The project-root `Aimcub.app` exactly matches the packaged output; `Resources/app.asar` SHA256 is `0e3442704e79060c9a5e4c7eb047d30c143eafc895cca6a1588b6786fa53d96b`.
- Packaged UI verification used the exact root app with isolated `HOME`, `AIMCUB_HOME`, and Electron user-data directories under `/tmp`. A legacy aim-stage draft opened directly as a static summary with no input; Edit opened the buffered composer and Cancel restored the summary. A brand-new Aim submitted without any planning runtime also switched immediately to the static summary. A final checkpoint race test first confirmed `aim_surface: "compose"` on disk, submitted the Aim, terminated the app as soon as summary appeared, restarted against the same Store, and reopened the draft as summary with no input; disk held `aim_surface: "summary"`. The isolated instances were closed, and no real `~/.aimcub` data was read or written.

## Commit And Push Status

- Feature commit: pending final review.
- Local merge to `main`: pending final review.
- Push: not authorized and not attempted. Require fresh explicit authorization before publishing.

## Open Risks

- Legacy drafts cannot reveal whether their old title was submitted or only autosaved because the field did not exist. Recovery intentionally fails safe to the readable summary; Edit remains the explicit route back to composition.
- The local macOS bundle remains unsigned and uses the default Electron icon. This does not affect the verified Aim presentation behavior.

## Next Session Prompt

```text
Continue from Aimcub main. Read AGENTS.md, docs/handoff.md, docs/memory/README.md, and the relevant module memory. Preserve the compose-summary-edit contract: first submit and legacy draft recovery show a static Aim summary; only explicit Edit opens the composer. Keep aim_surface persisted, serialize Edit as summary, and never let missing runtime setup, autosave, navigation, or restart reopen a captured Aim as an input. Use isolated HOME, AIMCUB_HOME, and Electron user data for packaged QA. Require fresh explicit authorization before pushing.
```
