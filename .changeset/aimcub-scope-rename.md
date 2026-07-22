---
"@aimcub/types": patch
---

Rename every workspace package out of the internal `@core` / `@app` scopes into the public `@aimcub` scope. New package identities: `@aimcub/types`, `@aimcub/core` (the one sub-name change — the domain kernel package moves from the old scope's `domain` name to `core`; its directory, `packages/core`, was already named `core` and is unchanged), `@aimcub/store`, `@aimcub/llm`, `@aimcub/local-agent`, `@aimcub/api-client`, `@aimcub/db`, `@aimcub/cli` (bin stays `aimcub`), `@aimcub/desktop`, and `@aimcub/mcp`. No directory moves — this is a package-identity change only. Every import/require/mock specifier, the eslint purity guard, the desktop `bundleFromSource` list + `verify-bundled-core.mjs` + packaging test, root scripts (`core:purity`), the changesets fixed group, and non-memory docs follow the new names. `private: true` and `publishConfig.access: "restricted"` are unchanged everywhere; no package is published.
