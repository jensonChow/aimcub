# Aimcub Handoff

Last updated: 2026-07-10
Branch: `main`

## Current Session

- Request: repair the project-root `Aimcub.app`, which failed during Electron main-process startup with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` while loading `node_modules/@core/local-agent/src/index.ts`.
- Starting state: local `main` at `bab4ba39`, ten commits ahead of `origin/main` at `c15345f8`.
- Implementation branch: `codex/fix-packaged-local-agent-startup`.
- Root cause: `@core/local-agent` was added as a Desktop runtime dependency but was omitted from Electron's `bundleFromSource` allowlist. Electron Vite therefore left a bare `require("@core/local-agent")` in the main bundle, electron-builder copied the workspace package with its raw-TypeScript entry point, and Electron refused to strip TypeScript under packaged `node_modules`.

## Completed Work

- Added `@core/local-agent` to the Desktop main/preload source-bundling boundary.
- Exported the bundling list and added a manifest-parity regression test that requires every Desktop runtime dependency under `@core/*` to be included.
- Added `apps/desktop/scripts/verify-bundled-core.mjs`, which recursively scans all built main and preload JavaScript chunks and fails when any bare `@core/*` runtime import remains.
- Wired the bundle verifier into Desktop build, pack, and dist commands so electron-builder cannot silently reproduce this failure.
- Recorded the raw-TypeScript package boundary and exact-bundle startup requirement in `docs/memory/operations.md`.
- Rebuilt the macOS arm64 bundle and refreshed the ignored project-root `Aimcub.app`. The old bundle was retained temporarily under `/tmp/Aimcub.app.before-packaging-fix` during the safe replacement.
- Closed the stale pre-fix crash process after confirming that it had no renderer, then completed final visual QA against a separate isolated instance of the rebuilt root bundle.

## Verification

- The final full gate passed: `pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm core:purity`, and `git diff --check`.
- Test result: 89 test files and 901 tests passed. Package totals were Core 176, LLM 170, local-agent 10, CLI 88, Desktop 205, Store 62, API 40, DB 36, and MCP 114. The expected missing-Supabase stderr came only from the MCP hygiene fixture.
- Desktop build transformed 245 main-process modules and the new verifier confirmed that main and preload output contained no external `@core/*` imports.
- `pnpm desktop:pack` passed with Electron 43.0.0 for macOS arm64, without signing. The project-root bundle exactly matches the current packaged output; `Resources/app.asar` SHA256 is `909663279f1be6ca973816cffefcbbbec9b3a622ff0834359d1eb63e6d3c9700`.
- Every packaged main/preload chunk extracted from `app.asar` was checked and contained no external `@core/*` runtime import.
- The exact project-root `Aimcub.app` was launched with isolated `HOME`, `AIMCUB_HOME`, Electron user data, and unavailable CLI paths under `/tmp`. Its main, GPU, network, and renderer processes remained alive, and Computer Use captured the visible Aimcub Home window with Home, New aim, and the aim input surface instead of the JavaScript error dialog.
- The isolated verification instance was closed after the check. No real `~/.aimcub` data was read or written.

## Commit And Push Status

- Feature commit: `3268aeef` (`Fix packaged desktop startup`).
- Local merge commit: `e873dd9d` (`Merge packaged desktop startup fix`).
- This handoff is the only post-merge change and will be finalized in a focused local `main` commit.
- Local `main` is twelve commits ahead of `origin/main` before the handoff commit. Remote push is not performed because the user did not authorize it; `origin/main` remains at `c15345f8`.

## Open Risks

- The local macOS bundle remains unsigned and uses the default Electron icon; this does not affect the repaired startup path but remains release work.
- The bundling rule assumes current `@core/*` packages continue to expose raw TypeScript. The manifest-parity test and output scanner now fail early if a new package is omitted; revisit the rule only if those packages gain stable compiled runtime entry points.
- The packaged startup check is currently a deliberate isolated visual QA step rather than an automated CI window-launch test. The deterministic build verifier covers the exact regression at the artifact boundary.

## Next Session Prompt

```text
Continue from Aimcub main. Read AGENTS.md, docs/handoff.md, docs/memory/README.md, and the module memory for the surface you touch. Preserve the invariant that every raw-TypeScript @core/* Desktop runtime dependency is bundled and that build/pack/dist contain no external @core imports. Use isolated HOME, AIMCUB_HOME, and Electron user data for packaged QA. The project-root Aimcub.app is the current repaired bundle. Do not push local commits until the user gives fresh explicit approval.
```
