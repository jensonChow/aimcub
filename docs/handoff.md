# Aimcub Handoff

Last updated: 2026-07-10
Branch: `main`

## Current Session

- Request: fix the exported Desktop complaint that normal browsing loses the relationship between pages and can select New Aim together with an active draft.
- Starting state: clean `main` matched `origin/main` at `2146ba0d` (`Refresh desktop action menu memory`).
- The evidence showed a resumed draft and New Aim highlighted together and described drafts becoming difficult to return to after ordinary navigation.

## Completed Work

- Replaced independent Home/New Aim/draft/saved-aim selection flags with one mutually exclusive workspace target.
- Scoped persisted drafts to Aim, Context, and Contracts; saved aims keep all five workbench surfaces. Draft navigation remains visible on Aim, and Work/Review no longer render Contracts content under the wrong label.
- Added a serialized draft persistence queue with a stable store-compatible ID, navigation flushes, session invalidation, stale-response detection, and checkpoint-failure recovery.
- Added per-draft activation versions so a delayed open cannot resurrect a draft that was discarded while the read was in flight.
- Added separate target and surface navigation epochs. Older planning and goal responses cannot replace newer navigation, while same-goal data may refresh without rerouting the current surface.
- Locked workflow mutations while a target checkpoint/read is pending, retained side-effect locks across surface browsing, and made save/discard locks release deterministically.
- Split draft/goal list refresh from slower helper probes so a stale startup snapshot cannot hide a draft created during launch.
- Preserved the originating workbench surface across Settings and kept startup on Home when recoverable drafts exist.
- Removed draft list caps so every persisted draft remains reachable. Draft status now reflects workflow content rather than the page the user happened to browse.
- Added focused navigation, persistence, activation, save-release, startup, Settings-return, and stale-response regression coverage plus matching English/Chinese copy.
- Updated `docs/memory/desktop.md` and `docs/memory/design-system.md` with the durable navigation and checkpoint rules.

## Changed Files

- Renderer orchestration and shell: `apps/desktop/src/renderer/App.tsx`, `CockpitShell.tsx`, `firstRunFlow.ts`, and `i18n.tsx`.
- Draft UI and workflow: `stages/aim/AimDraftRecovery.tsx`, `workflow/aimDrafts.ts`, and new `workflow/workspaceNavigation.ts`, `workflow/draftPersistenceQueue.ts`, and `workflow/navigationConcurrency.ts`.
- Tests: matching renderer, routing, draft, workspace-navigation, persistence-queue, and navigation-concurrency test files.
- Memory and transfer docs: `docs/memory/desktop.md`, `docs/memory/design-system.md`, and this handoff.

## Verification

- `pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm core:purity` passed after the final code changes.
- Desktop reported 22 test files and 170 passing tests. MCP worker tests replayed the existing missing-Supabase-env stderr while asserting opaque 500 behavior.
- `git diff --check` passed, and two independent final code reviews reported no remaining actionable issues.
- Isolated live QA used `AIMCUB_HOME=/tmp/aimcub-navigation-qa-019f4a1f` at the normal 960x680 window and a macOS half-screen narrow layout. It confirmed one current draft row, no New Aim double selection, three draft surfaces, ignored Cmd+4, Context -> Settings -> Context return, Home recovery, and no visible overflow.
- `pnpm desktop:pack` passed with Electron 43.0.0, and `ditto apps/desktop/dist/mac-arm64/Aimcub.app Aimcub.app` refreshed the root bundle.
- Root `Aimcub.app` remains `com.aimcub.desktop`, version `0.0.0`; `Resources/app.asar` SHA256 is `bbd5c8e26ee1cb213e728115f0f7276306e6923dfaf37431957de0513c73f06a`.

## Commit And Push Status

- Feature commit: `697d668dcd4787a2dbb48f36edc7d92b4479a63b` (`Fix desktop draft navigation coherence`).
- Local `main` merge: `ee7c84045777df52337f5e1d501056f425909e3a` (`Merge desktop draft navigation coherence`).
- The user explicitly approved remote upload after the initial safety hold. Read-only verification confirmed `jensonChow/aimcub` is the authenticated user's private repository with `ADMIN` access.
- `origin/codex/desktop-navigation-coherence` now contains the feature commit, and `main` was pushed with the verified merge plus final handoff commits.

## Open Risks

- Live QA used an isolated title-only draft and did not run a real provider planning call; deferred persistence, activation, navigation, and lock behavior is covered by deterministic tests.
- Dev mode emitted only the existing Electron insecure-CSP warning; the packaged build does not emit that development warning.

## Next Session Prompt

```text
Continue from Aimcub main. Read AGENTS.md, docs/handoff.md, docs/memory/README.md, docs/memory/desktop.md, and docs/memory/design-system.md first. The verified navigation fix is committed, merged, and pushed to origin. Preserve the single workspace-target invariant: Home, New Aim, one draft, or one saved aim is current; drafts expose Aim/Context/Contracts only; Settings returns to the originating surface. Check git status and remote state before new work.
```
