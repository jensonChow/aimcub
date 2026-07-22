# WORKTREE-REPORT: desktop-packaging-identity

## What changed
- `apps/desktop/package.json` "build" block: `appId` -> `com.jensonchow.aimcub`
  (was `com.aimcub.desktop`; matches ASC App ID 6785268817 / team K9XA27TP7F).
  Added `mac.icon`, `mac.category` (`public.app-category.productivity`),
  `mac.hardenedRuntime: true`, `mac.entitlements` / `mac.entitlementsInherit`,
  `mac.notarize: true`. `mac.identity` stays `null`; targets stay dmg+zip
  arm64-only. Added `icon:generate` / `notarize:check` script entries.
- New `apps/desktop/build/icon.icns` (placeholder) + the script that makes it,
  `apps/desktop/scripts/generate-icon.mjs`: composes a 1024px master PNG
  entirely in Node (hand-rolled PNG encoder via `node:zlib`'s DEFLATE + its
  built-in `crc32`, no new deps), drawing a rounded-square + geometric white
  "A" through supersampled shape math (no fonts, no SVG rasterizer), then
  shells out to macOS `sips`/`iconutil` for the .icns. Re-run with
  `pnpm --filter @app/desktop run icon:generate`.
- New `apps/desktop/build/entitlements.mac.plist` +
  `entitlements.mac.inherit.plist`: exactly the two entitlements the mission
  scoped (`com.apple.security.cs.allow-jit`, `com.apple.security.network.client`),
  each with a justification comment; the inherit variant adds
  `com.apple.security.inherit` (the inheritance marker itself, not a third
  capability).
- New `apps/desktop/scripts/check-notarize-env.mjs`: a read-only diagnostic
  (`notarize:check`) reporting which of electron-builder's built-in notarize
  credential paths (API key / Apple ID + team K9XA27TP7F / keychain profile)
  is present. No custom `afterSign` hook: confirmed in installed
  `electron-builder@26.15.3` (app-builder-lib's
  `MacTargetHelper.notarizeIfProvided`/`getNotarizeOptions`) that the built-in
  `@electron/notarize` integration already does this, gated on those same env
  vars, and only runs after a *real* codesign — `mac.identity: null` makes
  `MacPackager.sign()` return early, before it's ever reached. Signing and
  notarization are inert today by construction, not a hand-maintained guard.
- `.changeset/desktop-packaging-identity.md` (patch).

## Decisions
- **No inline "arm64-only" comment inside package.json**: electron-builder
  validates `build` with `additionalProperties: false` at every schema level
  (verified in `scheme.json`), so any comment-shaped key throws
  `InvalidConfigurationError` at pack time; the footprint also forbids a
  separate config file. Reasoning, recorded here instead: dmg+zip stays
  arm64-only; universal/x64 is deferred since Electron universal (fat) builds
  roughly double artifact size pre-public-release — revisit at v0.1.0.
- **Entitlements kept to the mission's 2-item scope** (JIT + network client),
  not electron-builder's default template's 3 (it also ships
  `allow-unsigned-executable-memory` / `disable-library-validation`, both
  common for hardened-runtime Electron per Electron's own docs). No bundled
  native/unsigned dylibs exist today to justify the latter. Flagged below.
- Built-in `notarize: true` over a custom `afterSign` script, since `afterSign`
  would run *alongside*, not instead of, the built-in notarize step in
  `MacPackager.sign()` — risking double-notarizing once real signing lands.

## Handoff items (founder/integrator-owned)
- Verify the 2-entitlement set against a real signed + hardened-runtime
  launch before shipping a signed build; add `allow-unsigned-executable-
  memory` if V8 needs it in practice. Untestable here: no Developer ID
  identity available, and `identity: null` skips codesign (and therefore
  entitlement enforcement) entirely.
- Real Developer ID/notarization credentials, license, and `@aimcub` org work
  remain founder-owned and unchanged (already tracked in docs/handoff.md).

## Verification
- Full gate green: build, typecheck, lint, test (cli 89, desktop 283, store
  88 shown fresh; rest cache-hit), `core:purity`, `git diff --check` clean.
  Lint first failed on the two new scripts (`no-undef` on
  `process`/`Buffer`/`URL`, `no-useless-assignment` on a dead `= null` init) —
  fixed via explicit `node:process`/`node:buffer`/`node:url` imports,
  matching `verify-bundled-core.mjs`'s existing convention.
- `pnpm --filter @app/desktop run pack` (unsigned, `ELECTRON_BUILDER_CACHE`
  workaround): `skipped macOS code signing reason=identity explicitly is set
  to null`; no "default Electron icon is used" warning.
- `PlistBuddy` on the packed `Aimcub.app/Contents/Info.plist`:
  ```
  CFBundleIdentifier: com.jensonchow.aimcub
  CFBundleIconFile: icon.icns
  LSApplicationCategoryType: public.app-category.productivity
  ```
  `icon.icns` (99,927 bytes) present under `Contents/Resources/`.
- Live smoke: launched the packed binary directly with an isolated
  `AIMCUB_HOME`/`--user-data-dir` (repo-root `Aimcub.app` untouched); main +
  GPU + network-utility + renderer helper processes all alive, no errors in
  stdout/stderr, killed cleanly. Real `~/.aimcub/store.json` mtime unchanged
  (`Jul 13`) after the run.
- Repo-wide grep for the old `com.aimcub.desktop` id: zero hits anywhere,
  including `docs/handoff.md` (already references the corrected id).
