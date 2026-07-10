# Aimcub Handoff

Last updated: 2026-07-10
Branch: `main`

## Current Session

- Request: make sidebar Aim entries ChatGPT-like single-line labels with concise summaries, remove redundant sidebar workflow status subtitles, and coordinate the right workspace's spacing and alignment.
- Starting state: local `main` at `5381bd35`, thirteen commits ahead of `origin/main` at `c15345f8`.
- Implementation branch: `codex/compact-aim-sidebar-layout`.

## Completed Work

- Added a display-only Aim navigation-title pipeline. It prefers a generated plan `goal_summary`, removes common intent framing before a plan exists, applies a grapheme-safe bounded label for long fallback text, and keeps the full cleaned summary on the focusable row for accessibility.
- Kept the canonical user title unchanged for editing, planning, search, CLI, agents, and the open-Aim callback. Search explicitly covers both the display summary and canonical title.
- Tightened the planning schema and prompt so future model-generated `goal_summary` values are concise navigation labels rather than copied user framing.
- Converted saved Aim and draft sidebar entries to compact 36 px one-line rows with responsive ellipsis. Removed Context needed, Plan ready, Save blocked, active, paused, and other status subtitles from the sidebar while preserving selected state and draft More Actions.
- Unified selected saved-Aim styling with the quiet sidebar language: fill only, no visible border or inset selection shadow, with a focus ring reserved for keyboard focus.
- Simplified Home so recoverable drafts replace the empty Workspace ready placeholder rather than appearing as a second, vertically separated surface.
- Introduced shared workspace rails: 560 px compose/draft, 760 px reading/focused context, and 940 px operational workbench. The current-surface label and stage switcher now form one start-aligned group, and touched Context and Aim surfaces use the same visible alignment system.
- Updated `docs/memory/design-system.md` and `docs/memory/desktop.md` with the durable title, sidebar, Home, rail, and stage-navigation rules.

## Verification

- Final full gate passed after all review fixes: `pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm core:purity`, and `git diff --check`.
- Test result: 90 test files and 911 tests passed. Package totals were Core 176, LLM 170, local-agent 10, CLI 88, Desktop 215, Store 62, API 40, DB 36, and MCP 114. The expected missing-Supabase stderr came only from the MCP hygiene fixture.
- Desktop build transformed 245 main-process modules and 176 renderer modules; the bundle verifier confirmed no external `@core/*` runtime imports.
- `pnpm desktop:pack` passed with Electron 43.0.0 for macOS arm64, without signing. The project-root `Aimcub.app` exactly matches the packaged output; `Resources/app.asar` SHA256 is `a7bc3098d60e0ba3f5fc43fd268320997bb4afef067b09fd2ff16a4595fbd3cb`.
- The exact root `Aimcub.app` was launched with isolated `HOME`, `AIMCUB_HOME`, Electron user data, and unavailable CLI paths under `/tmp`. Visual and accessibility-tree QA confirmed: one-line summarized sidebar text with ellipsis; no sidebar Context needed subtitle; one top-aligned Home draft surface; a single named Recoverable drafts region; full accessible row and More Actions names; and start-aligned Context workbench navigation/content.
- The isolated packaged verification instance was closed. No real `~/.aimcub` data was read or written.
- Two independent final read-only reviews found no remaining layout, accessibility, React, or implementation blockers.

## Commit And Push Status

- Feature commit: `b7247c33` (`Compact Aim navigation and workspace layout`).
- Local merge commit: `eb241ef5` (`Merge compact Aim navigation and layout`).
- Initial handoff commit: `c34c075a` (`Finalize compact Aim layout handoff`).
- The user explicitly authorized commit, merge, and push after invoking `memory-refresh`. `main` through `c34c075a` was pushed successfully, advancing `origin/main` from `c15345f8`; this focused memory-refresh record is the final history-only update and is published as the new `main` tip.

## Open Risks

- Model-backed plans now request a genuinely concise `goal_summary`. Before a plan exists, or during deterministic offline fallback, Aimcub can safely clean and bound the user text but cannot perform full semantic summarization without a model call.
- The local macOS bundle remains unsigned and uses the default Electron icon. This does not affect the verified layout or startup path but remains release work.
- The compact layout uses Electron's current Chromium support for `:has()`. Electron 43 passed packaged visual QA; recheck these direct-child layout selectors after a major Electron downgrade or shell rewrite.

## Next Session Prompt

```text
Continue from Aimcub main. Read AGENTS.md, docs/handoff.md, docs/memory/README.md, and the relevant module memory. The compact Aim navigation and workspace alignment work is merged and published on origin/main. Preserve canonical Aim titles for editing, planning, search, CLI, and agent work; use concise display-only navigation summaries in one-line sidebar rows without status subtitles. Keep Home single-surface and align related workbench content to the shared 560/760/940 px rails. Use isolated HOME, AIMCUB_HOME, and Electron user data for packaged QA. The project-root Aimcub.app is the current verified bundle. Require fresh explicit authorization for future pushes.
```
