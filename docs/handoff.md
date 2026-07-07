# Aimcub Handoff

Last updated: 2026-07-08
Branch: `main`

## Current Session

- Integration goal: merge the deterministic local alpha demo seed and the open-source local alpha readiness docs, then run full verification, package Desktop, refresh root `Aimcub.app`, seed an isolated demo workspace, visually inspect the seeded Desktop loop, commit, and push.
- Read the required preflight docs: `AGENTS.md`, this handoff, `docs/memory/README.md`, product, architecture, desktop, design-system, operations memories, `docs/local-alpha.md`, `docs/v1-spec.md`, `docs/vision.md`, and `README.md`.
- Ran the `memory-refresh` audit on `main` at `e2dcf08e`; the audit kept root memory within line budget and flagged Desktop plus operations as the relevant module memories.
- Inspected both parallel worktrees:
  - `5fd47b82` (`Add local alpha demo seed`) in `/Users/jenson/.codex/worktrees/8de1/Aimcub`.
  - `b41305c2` (`Document local alpha open-source path`) in `/Users/jenson/.codex/worktrees/4137/Aimcub`.
- Parallel handoffs reported no GUI/computer-use use, no push, no package refresh, and no writes to the real `~/.aimcub` store.

## Merges And Conflict Resolution

- Merged `5fd47b82` first. It fast-forwarded `main` and added the deterministic local alpha seed, store test coverage, and seed docs.
- Merged `b41305c2` second. The only merge conflict was `docs/handoff.md`.
- Resolved `docs/handoff.md` by replacing both parallel-session handoffs with this integration handoff.
- Preserved the local-first open-source alpha direction, deterministic seed safety, isolated `AIMCUB_HOME` guidance, local/hosted boundary, and existing eval/completion semantics.
- Updated cross-links:
  - `README.md` links to `docs/local-alpha.md`, `docs/open-source-local-alpha.md`, and the demo seed README.
  - `docs/local-alpha.md` links to the demo seed instructions.
  - `docs/open-source-local-alpha.md` now points to the real deterministic seed path.
  - `examples/local-alpha/README.md` links back to the local alpha contract and onboarding guide.
- Updated `docs/memory/operations.md` with the durable demo seed command and isolated-store visual QA rule.

## Final Seed Path And Command

Seed docs live at `examples/local-alpha/README.md`.

Build the runnable seed script:

```bash
pnpm --filter @app/cli exec esbuild ../../examples/local-alpha/seed-local-alpha-demo.ts --bundle --platform=node --format=esm --target=node22 --outfile=/tmp/aimcub-local-alpha-demo-seed.mjs
```

Seed the isolated demo workspace:

```bash
AIMCUB_HOME=/tmp/aimcub-local-alpha-demo node /tmp/aimcub-local-alpha-demo-seed.mjs
```

Launch Desktop against the same isolated store:

```bash
AIMCUB_HOME=/tmp/aimcub-local-alpha-demo pnpm desktop
```

## Verification

Passed for this integration session:

- `PATH=/Users/jenson/.local/node/bin:$PATH pnpm build`
- `PATH=/Users/jenson/.local/node/bin:$PATH pnpm test`
- `PATH=/Users/jenson/.local/node/bin:$PATH pnpm typecheck`
- `PATH=/Users/jenson/.local/node/bin:$PATH pnpm lint`
- `PATH=/Users/jenson/.local/node/bin:$PATH pnpm core:purity`
- `git diff --check`
- `PATH=/Users/jenson/.local/node/bin:$PATH pnpm --filter @core/store test -- -t "local alpha demo seed"`
- `PATH=/Users/jenson/.local/node/bin:$PATH pnpm --filter @app/cli exec esbuild ../../examples/local-alpha/seed-local-alpha-demo.ts --bundle --platform=node --format=esm --target=node22 --outfile=/tmp/aimcub-local-alpha-demo-seed.mjs`
- `AIMCUB_HOME=/tmp/aimcub-local-alpha-demo node /tmp/aimcub-local-alpha-demo-seed.mjs`
- `AIMCUB_HOME=/tmp/aimcub-local-alpha-demo PATH=/Users/jenson/.local/node/bin:$PATH pnpm --filter @app/cli exec aimcub board 00000000-0000-4000-8000-000000000105`
- `ELECTRON_BUILDER_CACHE=/private/tmp/aimcub-electron-builder-cache COREPACK_HOME=/private/tmp/aimcub-corepack PATH=/Users/jenson/.local/node/bin:$PATH pnpm desktop:pack`
- `ditto apps/desktop/dist/mac-arm64/Aimcub.app Aimcub.app`
- `plutil -p Aimcub.app/Contents/Info.plist`

Notes:

- `pnpm test` passed while logging the expected opaque MCP startup errors for missing hosted Supabase configuration.
- Seed output: 1 aim, 4 sub-aims, 2 evidence items, and 5 context rows.
- CLI board smoke showed 1/4 completed sub-aims, two evidence events, agent and human routing, matched trusted evidence, no-evidence states, and low-trust evidence.
- Real `~/.aimcub/store.json` did not exist before or after seed and visual checks; only `/tmp/aimcub-local-alpha-demo/store.json` was created.
- Root `Aimcub.app` was refreshed from `apps/desktop/dist/mac-arm64/Aimcub.app`.
- `plutil` confirmed bundle id `com.aimcub.desktop` and version `0.0.0`.

## Demo Visual Inspection

Completed with the refreshed root `Aimcub.app` launched against `AIMCUB_HOME=/tmp/aimcub-local-alpha-demo`.

Notes:

- Computer-use app-state capture timed out for Aimcub, and a full-desktop screenshot was rejected because it could capture unrelated sensitive on-screen data. Used an app-only local DevTools target for renderer screenshots and DOM metrics instead.
- Final app-only screenshots were captured from the refreshed root bundle at `960x680`; renderer metrics were checked at `760x600` and `640x520`.
- Seeded Aim overview opened with `Dogfood the local alpha open-source loop`, 25% progress, and `1/4` complete.
- Context showed the saved aim, optional local material, Settings handoff, and a single `Continue to Plan` action.
- Plan/Contracts showed 4 sub-aim contracts, including agent-routed and human-routed paths.
- Execute showed the selected-work pattern:
  - agent-routed incomplete sub-aim with `Run agent` primary action
  - human-routed incomplete sub-aim with `Submit proof` primary action
  - low-trust completed run state with review path and run metadata
  - completed trusted sub-aim in the selector
- Eval showed matched trusted evidence, two no-evidence states, one low-trust evidence state, and one pending Context Inbox candidate.
- Context Inbox rendered only because one pending candidate exists; no large empty Context Inbox was observed.
- Stage navigation remained safe at 960, 760, and 640 px. At 640 px it wrapped into two rows without document-level horizontal overflow.
- DOM metrics reported no horizontal overflow: `docScrollWidth` equaled viewport width at both `760x600` and `640x520`.
- Native traffic lights/window chrome were not directly screenshot-verified due the capture limitation, but the protected shell/sidebar/window-chrome files were not changed.

## Shell Preservation Status

- No Desktop shell/sidebar/window-chrome framework files were edited.
- `apps/desktop/src/renderer/CockpitShell.tsx` remains untouched in this integration.
- `apps/desktop/src/renderer/cockpit.css` and `apps/desktop/src/main/index.ts` remain untouched in the final diff.
- Local agent runtime behavior was not changed.
- Eval/completion semantics were not changed.

## Commit And Push Status

- Final integration commit and push are pending after this handoff update.
- Because this file is part of the commit, the final commit hash and push result are reported in the Codex response rather than self-recorded here.

## Open Items

- Public open-source release still needs license selection, `CONTRIBUTING.md`, `SECURITY.md`, and a secrets/env example review.

## Next Session Prompt

```text
Continue from main. Start by reading AGENTS.md, docs/handoff.md, and docs/memory/README.md, then inspect git status. Preserve the Desktop shell/sidebar/window-chrome framework exactly unless the user explicitly approves a shell change. The local alpha demo seed lives in examples/local-alpha/ and should be run only with an isolated AIMCUB_HOME such as /tmp/aimcub-local-alpha-demo.
```
