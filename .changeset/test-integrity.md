---
"@aimcub/types": patch
---

Make `pnpm typecheck` honest: `@aimcub/core`, `@aimcub/store`, and `@aimcub/llm` no longer exclude their own `*.test.ts` files from the base `tsconfig.json`, so type errors in tests are no longer invisible to the gate (builds still emit test-free `dist` via the existing `tsconfig.build.json`). Fix the ~30 real type errors this uncovered in test fixtures (shape drift against current types, a missing `structuredClone` lib entry, mistyped fetch mocks) with no behavioral changes. Give `apps/mcp` the same src-only vitest allowlist and test-free `tsconfig.build.json` used by the publishable libraries, ending its dist test double-count (114 → 57 honest tests).
