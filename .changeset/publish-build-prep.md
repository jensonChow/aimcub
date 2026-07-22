---
"@core/types": patch
---

Give every publishable package (types, domain, store, llm, local-agent, api-client) a dedicated `tsconfig.build.json` so `pnpm build` never emits compiled `*.test.*` files into `dist`, add an explicit vitest `include` allowlist so tests never double-count from `dist`, and add `files`/`publishConfig` stubs so the eventual `@aimcub/*` rename is a name change, not a build-system project.
