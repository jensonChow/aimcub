# Aimcub Handoff

Last updated: 2026-07-10
Branch: `codex/unify-aim-layout-state`

## Current Session

- Request: remove Desktop layout conflicts with native macOS traffic lights across the app, then replace the post-submit Aim input treatment with a clearer product-state design and audit similar false-editor patterns.
- Starting state: clean `main` matched `origin/main` at `c15345f8` (`Finalize memory refresh handoff`).
- Evidence reviewed: the two user screenshots, current handoff and module memories, Desktop shell/main-process code, renderer state and CSS, all input/read-only control sites, related tests, and the refreshed packaged app.

## Completed Work

- Replaced the stage-name-specific compact safe area with a shell-geometry rule. Every collapsed or peek non-Settings workspace now reserves one native-titlebar-safe top inset, including Aim and transient notice states. Pinned sidebar surfaces keep the normal shared top baseline.
- Split Aim presentation into `idle`, `compose`, `summary`, and explicit `edit` states. New Aim and unsent child breakdown work use the composer; submitted or normally recovered drafts show a static outcome summary with Edit and Context/Contracts actions.
- Added a dedicated draft Aim overview component. Explicit editing uses an isolated buffer, so the committed Aim and its plan remain intact until Update; Cancel simply discards the buffer. A valid Update clears the stale plan and all previously collected hidden context before restarting intake or planning. Ordinary navigation is blocked until Update or Cancel, while Settings remains a safe runtime-setup detour and its guidance follows the visible edit buffer.
- Removed the child-Aim Context composer exception so top-level and child drafts share the same post-submit summary behavior.
- Replaced saved acceptance-rule JSON rendered as a read-only textarea with selectable code, and replaced the inert Brave Search button with a static configuration value.
- Added English/Chinese copy, focused component/state/CSS regression tests, and durable design-system/Desktop memory rules for geometric titlebar clearance, compose-summary-edit state, and static-control semantics.

## Changed Files

- `apps/desktop/src/renderer/App.tsx`
- `apps/desktop/src/renderer/App.test.tsx`
- `apps/desktop/src/renderer/cockpit.css`
- `apps/desktop/src/renderer/i18n.tsx`
- `apps/desktop/src/renderer/stages/aim/DraftAimOverviewPanel.tsx`
- `apps/desktop/src/renderer/stages/aim/DraftAimOverviewPanel.test.tsx`
- `apps/desktop/src/renderer/stages/context/ContextStage.tsx`
- `apps/desktop/src/renderer/stages/context/ContextStage.test.tsx`
- `apps/desktop/src/renderer/stages/plan/PlanContractCard.tsx`
- `apps/desktop/src/renderer/WebResearchForm.tsx`
- `apps/desktop/src/renderer/WebResearchForm.test.tsx`
- `docs/memory/design-system.md`
- `docs/memory/desktop.md`
- `docs/desktop-polish-audit.md`
- `docs/handoff.md`

## Verification

- Desktop focused gates passed: 26 test files and 193 tests, plus Desktop typecheck and lint.
- Repository gates passed: `pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm core:purity`, and `git diff --check`.
- `pnpm desktop:pack` passed with Electron 43.0.0, and `ditto apps/desktop/dist/mac-arm64/Aimcub.app Aimcub.app` refreshed the project-root bundle.
- Root `Aimcub.app` is `com.aimcub.desktop`, version `0.0.0`; `Resources/app.asar` SHA256 is `47ad4bcfb5bd0d395df89cf061435f6f43f2d03113d034a6bdf4a2dcb7757c9b`.

## Packaged Visual QA

- The final project-root package opened at the normal 960 by 680 footprint. With the sidebar collapsed, the real draft Aim and Context surfaces used the same titlebar-safe navigation baseline; the current-surface label and stage switcher no longer occupied the native traffic-light/sidebar-toggle row.
- The draft Aim opened as a static summary with no input or textarea. Edit Aim explicitly opened a buffered composer with Cancel and Update actions, and Cancel restored the summary without changing the Aim text.
- Pinned sidebar checks kept Aim and Context aligned in the main workspace with no native-control overlap. Accessibility exposed the native close/minimize/fullscreen controls and all summary/edit actions.
- Computer Use resolved the root bundle to the normal local session rather than the prepared `/tmp` demo seed. QA therefore did not type, answer intake, submit, save, discard, or change Settings. The draft's stage metadata was returned to Context before restoring the visible app to Home with the sidebar collapsed.

## Commit And Push Status

- Feature commit: pending final review.
- Push and merge: pending final review.

## Open Risks

- Exact 640 by 520 packaged resizing was not available through the current Computer Use control surface in this pass. Responsive CSS and automated tests cover the same selectors, and prior packaged QA established the focused Context flow at the minimum size, but the new draft summary should receive another exact minimum-size screenshot when deterministic window resizing is available.
- The saved-contract code surface and fixed web provider value are covered by SSR regression tests but were not opened in the live local session because doing so would have required different seeded state.

## Next Session Prompt

```text
Continue from Aimcub main. Read AGENTS.md, docs/handoff.md, docs/memory/README.md, docs/memory/desktop.md, docs/memory/design-system.md, and docs/memory/operations.md first. Preserve geometric titlebar clearance and the Aim compose-summary-edit model; use an isolated AIMCUB_HOME for any state-changing visual QA.
```
