# Operations Memory

## Verification

Before claiming repository work is done, keep these gates green:

```bash
PATH=/Users/jenson/.local/node/bin:$PATH pnpm build
PATH=/Users/jenson/.local/node/bin:$PATH pnpm test
PATH=/Users/jenson/.local/node/bin:$PATH pnpm typecheck
PATH=/Users/jenson/.local/node/bin:$PATH pnpm lint
PATH=/Users/jenson/.local/node/bin:$PATH pnpm core:purity
git diff --check
```

The project declares `pnpm@11.10.0` and Node `>=22.13`; the Codex runtime may resolve another pnpm. Prefer the `/Users/jenson/.local/node/bin` PATH prefix on this machine.

**Turbo caches test results, so a repeated `pnpm test` proves nothing.** Identical durations across runs (e.g. the same `2123ms` three times) mean cache hits, not passes. To actually re-execute — the only way to chase a flake — use `TURBO_FORCE=true pnpm test`, or run `npx vitest run` inside the package.

### Flaky-test triage: read the duration first

A failure whose duration is ~5000ms is a **test timeout**, not a wrong assertion — vitest's defaults are `testTimeout: 5000` and `hookTimeout: 10000`, and this repo overrides neither. Both flakes found so far were setup cost blowing that budget, and in both cases the plausible-sounding hypothesis (timer coalescing; JWT clock skew) was wrong — measure before believing one. Three flakes diagnosed this way (2026-08-09):

- **The first test in a file pays the whole module-transform cost.** `planning-checkpoint.test.ts` imports `./planning-session`, which pulls in `@aimcub/llm` + `@aimcub/local-agent`; that first import cost ~1.4s idle *inside test #1*, and under a loaded parallel run it crossed the 5s budget and timed out. Fix: warm the graph in `beforeAll` (10s budget) — test #1 went 1396ms → 16ms, and later `vi.resetModules()` re-imports reuse the cached transform. Apply the same trick to any test file whose first test is disproportionately slow.
- **Fake timers must be scoped to what you are testing.** Bare `vi.useFakeTimers()` also fakes `setImmediate`/`Date`/`queueMicrotask`, which sits under `await import(...)` and promise plumbing, so ordinary async setup can stall until timers are advanced. Fake only the mechanism under test — e.g. `vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })` for a coalescing window — and install it for the whole `describe` so a timer armed by one test cannot fire inside a later one and add a phantom write to shared state.
- **Never generate RSA keys per test.** `apps/mcp/src/auth.test.ts` built a fresh signer in each of its 9 tests, and `makeTestSigner` generated TWO RS256 keypairs — 18 keygens, ~25s of pure crypto. RSA-2048 generation is a probabilistic prime search, so its cost has a long tail: measured here, ~1.0s median but ~3.2s p90 **even idle**, which put each test's pair against the 5s budget and timed two of them out at ~5003ms/5031ms. It was never the `iat`/`exp` clock (the tokens carry a 5-minute expiry — a sign→verify gap would have to exceed 5 minutes). Fix: generate once per process behind a cached promise, generate the pair concurrently, and warm it in `beforeAll`. Per-test cost went from seconds to 2–8ms. Any expensive, immutable fixture (keys, parsers, compiled schemas) belongs in a shared cache, not in each test.

Every repository-changing session must finish by running the full verification suite above, refreshing the project-root `Aimcub.app` with `pnpm desktop:pack`, updating `docs/handoff.md`, creating a focused commit, and merging completed branch work into `main`. Push only when authorized and not explicitly declined by the user. If work happens directly on `main`, record that no separate merge was needed.

If pushing the default branch is blocked by permission review or requires explicit user approval, do not retry through another route. Leave the local focused commit in place, record the exact ahead/unpushed state in `docs/handoff.md`, and ask the user for explicit approval before pushing.

After approval, verify the destination before retrying: use `gh auth status` plus `gh repo view --json nameWithOwner,visibility,viewerPermission,defaultBranchRef`, confirm that `origin` matches that repository, and require suitable write permission. A verified authenticated owner/admin repository is materially different from an unidentified remote; record the resolved push state in the handoff.

## Renderer Harness (UI verification a unit test cannot do)

A green suite is not evidence a gesture works. Every founder-reported Desktop bug so far — a Delete button whose `pointerup` was stolen by a stacking context, planning restarting on every re-entry, a "Start planning" card shown for an aim that was already planned — was invisible to a fully green run, because the suite never exercises a live pointer, CSS layering, or navigation state.

So when a change touches those, drive the real renderer:

```bash
pnpm build && pnpm desktop:harness
```

It copies the built `out/renderer` to a temp dir, injects `apps/desktop/scripts/renderer-harness-stub.js` **before** the module bundle (so `window.aimcub` exists at first render), and serves it on `127.0.0.1:5599` (`AIMCUB_HARNESS_PORT` overrides). Then use browser tools for real: read the accessibility tree, CLICK, screenshot, resize, toggle dark mode.

- `window.__harnessCalls` — every bridge call in order, as `{ name, args }`. Assert the IPC a click actually produced.
- `window.__harnessErrors` — render failures captured before the bundle loads. **Check this first when the page is blank**; a missing fixture usually lands here (a partial `AimProgressReadModel` crashes on `progress.runs.some`).
- Scenario flags on the query string: `/?nopass`, `/?planready`, `/?live`, `/?question` (a blocking free-text question), `/?inbox` (pending context candidates), `/?parallel` (a diamond plan: finished root, two branches ready at once, a join waiting on both). Add more as data, not as code paths.
- **A source file containing a raw NUL byte is invisible to code search.** `orchestrator.ts` once used a literal NUL as a map-key separator inside a template literal; grep/ripgrep classify such a file as BINARY and silently return no matches, which hid a whole store port from repo-wide searches. Write `\u0000` instead — identical at runtime, and the file stays text. If a search "finds nothing" in a file you know contains the term, check for control bytes before trusting the result.
- The stub's fixtures are a floor, not a spec — **extend them** for whatever surface you are verifying. Its first fixture block is load-bearing: without those the app paints nothing at all.

It is deliberately NOT in the verification gate above: it is an interactive tool, not an automated test. Do not use it in place of unit coverage — use it to prove the gesture.

## Dependency Compatibility

As of 2026-07-06, the newest mutually compatible dependency set keeps Electron 43.0.0, electron-builder 26.15.3, electron-vite 5.0.0, Vite 7.3.6, React 19.2.7, TypeScript 6.0.3, Vitest 4.1.9, ESLint 10.6.0, Zod 4.4.3, Supabase JS 2.110.0, Anthropic SDK 0.110.0, Wrangler 4.107.0, and Turbo 2.10.3.

`pnpm outdated -r` is expected to report only intentional compatibility boundaries: `@types/node` 22.20.0 versus npm latest 26.1.0, `@vitejs/plugin-react` 5.2.0 versus 6.0.3, and Vite 7.3.6 versus 8.1.3. Keep `@types/node` on the Node 22 line while the repo engine remains Node `>=22.13`. Keep Vite on 7 until `electron-vite` supports Vite 8; `@vitejs/plugin-react` 6 also requires Vite 8.

## Desktop Runtime

Root desktop entry points are stable:

```bash
pnpm desktop
pnpm desktop:dev
```

The user-facing local app bundle should live directly in the project root as `Aimcub.app` when the user asks for an openable app folder. It is an ignored local artifact and must not be committed.

Folder-style Desktop packaging uses:

```bash
pnpm desktop:pack
```

This creates `apps/desktop/dist/mac-arm64/Aimcub.app`; copy that bundle to root `Aimcub.app` for the current local handoff. In development macOS may label the Dock app as `Electron`, but the window title should be `Aimcub`.

Desktop currently uses Electron 43.0.0. If sandboxed packaging cannot write Electron's default cache under `~/Library/Caches/electron`, run the build and builder steps with a writable Electron download cache, for example:

```bash
pnpm --filter @aimcub/desktop run build
ELECTRON_BUILDER_CACHE=/private/tmp/aimcub-electron-builder-cache pnpm --filter @aimcub/desktop exec electron-builder --mac --dir --config.electronDownload.cache=/private/tmp/aimcub-electron-cache
```

For any repo-changing session, `pnpm build` is not enough because it updates build output but not the project-root `Aimcub.app` bundle. Run `pnpm desktop:pack`, copy `apps/desktop/dist/mac-arm64/Aimcub.app` to root `Aimcub.app`, and restart/open that exact bundle when the user needs to inspect visible app behavior.

## macOS TCC (folder-permission) Discipline

The repo (and therefore root `Aimcub.app`) lives on the Desktop, a TCC-protected folder, and the packed app is only ad-hoc signed, so macOS treats every rebuilt bundle as a new app for consent purposes. Three rules (learned 2026-08-09, when an orphaned "access files in your Desktop folder" dialog wedged the founder's session):

- The packaged main process chdirs to `$HOME` at startup (`main/index.ts`) so a shell-inherited cwd inside Desktop/Documents/Downloads never triggers the folder-consent prompt. Do not remove this for cwd-relative features; nothing may resolve against cwd.
- Launch boot smokes with the shell cwd OUTSIDE protected folders anyway (e.g. `cd /tmp`), and never kill a smoke while a consent dialog could be up: a prompt whose owning process died becomes an unanswerable orphan. If one is stuck: `killall tccd` (user-level; the daemon respawns), or log out/in; `tccutil reset All com.jensonchow.aimcub` clears stale grants keyed to old ad-hoc signatures.
- Until real code signing lands (founder checklist), a rebuilt bundle may legitimately re-prompt for folders the user actually attached files from — that prompt is answerable and fine; only the boot-time/orphaned class is a bug.

Every Desktop runtime dependency among the `@aimcub/*` library packages currently exports raw TypeScript and must be listed in `bundleFromSource` in `apps/desktop/electron.vite.config.ts`. Desktop build, pack, and dist run `scripts/verify-bundled-core.mjs`; do not bypass that check. A successful electron-builder run is not sufficient startup evidence: after refreshing the root bundle, launch that exact `Aimcub.app` with isolated `AIMCUB_HOME` and Electron user data, and confirm that both the main process and a renderer process remain alive.

## Packaged Desktop Visual QA

When Computer Use is available, run packaged visual QA against the exact project-root `Aimcub.app` after it has been refreshed. Start from the visible Home state, keep real local data read-only, and do not answer intake questions, submit proof, save plans, or change settings merely to reach another screen. If Contracts or Work need deterministic data, use the isolated Local Alpha Demo Seed below with `AIMCUB_HOME` under `/tmp`; never seed or rewrite the real `~/.aimcub` store for visual QA.

Check the normal 960 by 680 footprint and the 640 by 520 minimum. At minimum size, verify that the focused Context surface shows only the current question, its answer lane scrolls independently, custom input remains reachable, and the footer action stays visible without horizontal overflow. Also check Home, collapsed and pinned sidebar states, and the Contracts context-gate recovery surface. Use the accessibility tree as well as screenshots to confirm that the current question receives focus and that controls remain reachable. Restore Home and the prior sidebar/workbench state when practical, and record any Contracts or Work surfaces that could not be exercised without mutating real data.

Desktop release packaging for distributable DMG/zip artifacts uses:

```bash
pnpm --filter @aimcub/desktop run dist
```

macOS DMG generation requires `hdiutil`, so it may need to run outside the sandbox.

## Local Data

Local desktop state is not held in project memory. The current local store path is `~/.aimcub/store.json`; provider and context-source settings live beside it under `~/.aimcub/`.

If the local store grows too large, the intended compaction behavior is: back up `store.json`, remove or truncate long debug traces and rejected/obsolete context candidates, and preserve goals, milestones, evidence, accepted context, assignments, runs, and eval state.

## Local Alpha Demo Seed

The deterministic local alpha seed lives under `examples/local-alpha/`. Build it with:

```bash
pnpm --filter @aimcub/cli exec esbuild ../../examples/local-alpha/seed-local-alpha-demo.ts --bundle --platform=node --format=esm --target=node22 --outfile=/tmp/aimcub-local-alpha-demo-seed.mjs
```

Run it only against an isolated directory, for example:

```bash
node /tmp/aimcub-local-alpha-demo-seed.mjs --target /tmp/aimcub-local-alpha-demo
```

The seed refuses `~`, `~/.aimcub`, paths under `~/.aimcub`, and filesystem root by default. Use `AIMCUB_HOME=/tmp/aimcub-local-alpha-demo` when launching Desktop for seeded visual QA, and confirm the real `~/.aimcub` store was not modified.

## Handoff Protocol

At the end of a repo-changing session, update `docs/handoff.md` with:

- Date and branch.
- Completed work.
- Verification commands and result.
- Commit and push status, if known.
- Any approval-required push blocker, especially when local `main` is ahead of `origin/main`.
- Open risks or intentionally deferred work.
- A short next-session prompt.

Move durable decisions into the relevant file under `docs/memory/` instead of leaving them in handoff.

## Desktop Packaging Identity

Since 2026-07-22 the packed app's `appId` is `com.jensonchow.aimcub` (matches ASC App ID 6785268817, team K9XA27TP7F — the old `com.aimcub.desktop` mismatch is resolved). The committed placeholder icon (`apps/desktop/build/icon.icns`) regenerates via `pnpm --filter @aimcub/desktop run icon:generate` (dependency-free script; replace the .icns when real brand lands). Hardened runtime + minimal entitlements (JIT, network client — justified inline; may need `allow-unsigned-executable-memory` once actually signed, untestable while unsigned) are wired; electron-builder's built-in notarize is enabled but inert by construction while `identity: null`; `pnpm --filter @aimcub/desktop run notarize:check` diagnoses credential env. Targets stay arm64 dmg+zip; universal deferred to v0.1.0. Library builds use per-package `tsconfig.build.json` (tests excluded from dist) + vitest src-allowlists — never let dist tests back into runs.

## Release Scaffolding

Versioning is changesets-based (2026-07-21): lockstep `fixed` group across all `@aimcub/*` workspace packages with `privatePackages { version, tag }`; the workspace root cannot join the group (not a workspace package — documented in `docs/releasing.md`, root stays `0.0.0`). Flow: `pnpm changeset` per change → `pnpm release:version` → commit → tag `vX.Y.Z` → push tag (founder-owned) → `.github/workflows/release.yml` verifies (ci.yml steps duplicated; composite-action dedup is a flagged TODO), builds the CLI bundle + unsigned desktop dmg/zip on macos-14, and drafts a GitHub Release via `gh`. npm publish is a deliberately blocked placeholder until the license decision + `@aimcub` org registration.

## Public Release Readiness

`CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, and issue/PR templates exist (2026-07-21) and are license-agnostic. A targeted secrets sweep of the tree + full git history found zero real-key hits. Still founder-owned before the public flip: choose the license (everything-blocker), run a full-history gitleaks/trufflehog scan, set the CODE_OF_CONDUCT enforcement contact, enable GitHub private vulnerability reporting, fix the stale GitHub repo description, and register the `@aimcub` npm org.
