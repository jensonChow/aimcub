# Worktree report — `wt/adapter-boundary`

## What changed

`packages/local-agent` no longer hardcodes Codex and Claude. The execution layer is now a
registry of `LocalAgentAdapter` objects; adding a runtime is one adapter module plus tests,
with zero edits to core dispatch, `@core/types`, the CLI, or the desktop app. No new runtime
ships in this batch and no existing behavior changes.

- **`src/types.ts`** (still import-free, so adapters/registry stay cycle-free): `LocalAgentId`
  is now `string` (alias kept, so every import site is zero-diff); `LocalAgentEvent` gains
  `replacesOutput?`; new `LocalAgentFailure{Code}` (shape duplicated locally, not imported
  from `@core/llm`), `LocalAgentInvocation`, `LocalAgentAdapter`, `LocalAgentRegistry`;
  `LocalAgentRunResult.failure` is required; `LocalAgentRunOptions` gains `signal` + `registry`.
- **`src/adapters/{helpers,codex,claude}.ts`** — helpers moved verbatim (the community
  toolkit); both runtimes moved verbatim into adapters. Claude's result-derived delta now
  carries `replacesOutput: true`, which replaces the engine's claude special-case.
- **`src/registry.ts`** — mirrors `createAimcubToolRegistry`: `BUILT_IN_LOCAL_AGENT_ADAPTERS`
  (order is semantics), `createLocalAgentRegistry`, `defaultLocalAgentRegistry`,
  `registerLocalAgentAdapter`, `listRegisteredLocalAgentIds`.
- **`src/runtime.ts`** — adapter-agnostic engine. Detection/resolution take an adapter;
  `parseAgentLine` = `adapter.parseLine(line) ?? agent.raw`; `mergeOutputText` generalizes the
  claude case (first `replacesOutput` delta in a batch wins, later batches append onto it);
  unknown id throws with the registered ids; failures are classified with the *existing* error
  precedence (callback > canceled > timeout > spawn > nonzero exit), `retryable` true only for
  timeout; `AbortSignal` → SIGTERM sharing the `settled` guard, clearing the timer and removing
  its listener.
- **Consumers** — gateway default chain = registry ids (imported from `./registry` so
  `vi.mock("./runtime")` survives) + try/catch so a throwing agent continues the chain; CLI
  `chooseAgent`/`--agent` validation and desktop `runMilestoneAgent` honor an override only
  when it is actually detected and otherwise pick the first available/authenticated detection
  (registry order keeps both outcomes identical to today). `isLocalAgentId` and its orphaned
  type import are gone.
- **`docs/local-agent-adapters.md`** (new) — field reference, the security contract on
  `buildInvocation`, the `parseLine`/`replacesOutput` contract, the 4-step contribution recipe,
  and inherited behavior.

## Decisions

- Unknown agent id **throws** (config error) instead of returning a failed result, so a future
  run queue can distinguish it from retryable runtime failures.
- Desktop keeps its `authStatus !== "missing"` predicate (the CLI keeps `=== "ok"`); only the
  `id === "codex"` clause was dropped. Preserved deliberately, not "fixed".
- An override naming an unregistered agent is silently ignored and falls through to the default
  pick — exactly today's behavior for unknown strings.
- `LocalCliLlmGateway` now always passes a run-options object, so the existing
  `toHaveBeenCalledWith` assertion gained a second matcher.
- CLI "no agent available" message generalized to "No authenticated local agent CLI is
  available." (no test or i18n key asserts the old Codex/Claude wording).

## Out of scope (handoff items — flagged, not forked)

- `packages/core/src/aim-os.ts:364` still says "set up Codex or Claude CLI" in a user-facing
  hint; it should become runtime-agnostic now that the boundary is open. `packages/core` is
  forbidden here.
- `docs/memory/README.md` has no pointer to the new `docs/local-agent-adapters.md`; the
  integrating session owns memory docs.
- Pre-existing: `pnpm build` emits `packages/local-agent/dist/**` including compiled test
  files, which vitest then runs a second time (local-agent reports 6 files / 28 tests for 3
  files / 14 tests). Harmless but noisy, and a *stale* dist can fail a run before a rebuild.

## Verification

Full gate green from the worktree root:
`pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm core:purity`.

- Tests: store 72 · domain 187 · api-client 40 · llm 170 · mcp 114 · db 36 ·
  **local-agent 28** (14 src × dist duplication; was 5) · **cli 89** (was 88) · **desktop 283**
  (unchanged). All behavioral anchors pass untouched: codex `--search`/workspace-write/network
  args, claude `acceptEdits` + `--disallowedTools` + `outputText === "done"` (now the
  `replacesOutput` tripwire), desktop `local-agents.test.ts`, cli `local-planning.test.ts`
  (`createGateway` still called with `["codex","claude"]`).
- New: `registry.test.ts` (built-in order, append order, duplicate/invalid id, isolation);
  runtime tests for a third adapter end-to-end, unknown-id rejection, cancel, timeout;
  llm-gateway default-chain order test.
- Straggler sweeps both empty:
  `grep -rn '"codex" | "claude"\|=== "codex" ||\|isLocalAgentId' apps packages` and
  `grep -n codex packages/local-agent/src/runtime.ts`.

Acceptance test run alone:

```
$ pnpm vitest run src/agent-run.test.ts --reporter=verbose      # in apps/cli
 RUN  v4.1.9 /Users/jenson/Desktop/Aimcub/.claude/worktrees/adapter-boundary-dc4552/apps/cli

 ✓ src/agent-run.test.ts > CLI local-agent run orchestration > runs one ready agent milestone and persists streamed events plus low-trust evidence 8ms
 ✓ src/agent-run.test.ts > CLI local-agent run orchestration > runs a fake third adapter end-to-end through agent-run 4ms

 Test Files  1 passed (1)
      Tests  2 passed (2)
```

The second test drives a `gemini-fake` adapter with its own JSONL dialect through the real
store and real engine: detection → routing-override selection → spawn args from
`buildInvocation` → normalized events → `tool.started`/`tool.finished` run events → evidence
with `payload.agent_id === "gemini-fake"`, proving `@core/types` accepts arbitrary agent ids
with no schema edit.
