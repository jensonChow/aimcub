# artifact-capture — structured artifact capture + typed orchestrator errors

## What changed

1. **Adapter contract** (`packages/local-agent/src/types.ts`, `adapters/*`): `LocalAgentEvent`
   gains optional `artifacts: { path, kind }[]` with `kind` ∈ `file_write | file_edit |
   file_delete`. Codex reads `file_change` items and `patch_apply_*` changes (both the list and
   the path-keyed map shapes, via the new `fileArtifactsFromChanges` helper); Claude reads
   `tool_use` blocks (`Write`/`Edit`/`MultiEdit`/`NotebookEdit` → path + kind). Unset otherwise.
2. **Orchestrator emission**: each newly seen `path`+`kind` becomes a durable `artifact.created`
   run event written right after the event that produced it, payload `{ path, kind, tool_id,
   tool_name, source_event_type }`, through the same batched `appendRunEvents`.
3. **Raw retention with caps**: persisted events now keep the runtime's `raw` up to
   `RUN_EVENT_RAW_CHAR_CAP` (8,192 serialized-JSON chars) per event and `RUN_RAW_CHAR_BUDGET`
   (262,144) per run, with explicit `raw_truncated`/`raw_chars`/`raw_preview` and
   `raw_omitted: "run_budget" | "unserializable"` markers. Summaries are never capped; the
   in-memory `LocalAgentRunResult` still holds every `raw` in full.
4. **Evidence fold-in**: the `mcp_report` payload gains `artifacts: [{ path, kinds, touches }]`,
   and one `evidence.reported` event (payload `{ evidence_id, kind, trust_score, milestone_id,
   artifact_count, completion_count }`) lands after `addEvidence`. Evidence stays append-only,
   trust stays 0.6, completion stays `evaluate()`-derived.
5. **Typed selection errors** (new `packages/local-agent/src/errors.ts`): `RunSelectionError` base
   with `AgentSelectionError` (`no_ready_agent`/`unknown_agent`/`agent_not_installed`/
   `agent_not_authenticated`) and `MilestoneSelectionError` (5 codes); `NoRunnableMilestoneError`
   now extends the latter, so existing `instanceof` checks in `agent-run.ts` still hold. Every
   message text is byte-identical to before. `apps/cli/src/index.ts` maps them to the UserError
   path, so `aimcub run --agent claude` unauthenticated prints just
   `Claude Code is not authenticated.` and exits 1.

`packages/types` untouched — `artifact.created` / `evidence.reported` were already in
`RunEventType`, and `OrchestratorRunEventType` stays a subset of it.

## Decisions

- **Dedupe: first touch wins, count travels on evidence.** Run events are append-only history, so
  an "updated count" would mean rewriting a persisted event, and per-touch events would flood the
  journal for a file edited thirty times. One `artifact.created` per (path, kind); repeat touches
  are tallied into the evidence `artifacts` summary (`touches`).
- **Kinds name the operation, not the resulting state.** A runtime that overwrites a path cannot
  say whether it existed, so `file_write` covers create-or-overwrite rather than lying about
  "created". Reads are deliberately not artifacts — `artifact.created` claims work product.
- **Claude block-level `raw`.** Tool events normalized out of a nested block carry that block as
  `raw`, not the whole message: precise provenance, and no N× duplication under the cap.
- **Claude tool normalization improved as a side effect** (worth knowing at merge): real Claude
  stream-json nests `tool_use`/`tool_result` inside `assistant`/`user` messages, which previously
  normalized to `agent.raw`. They now become `agent.tool.started`/`finished`, so the cockpit shows
  real Claude tool steps for the first time.

## Out of scope / handoff

- **One out-of-footprint edit, forced:** `apps/desktop/src/main/run-queue.test.ts:158` pins the
  persisted event sequence, which `evidence.reported` necessarily changes. Adding that one string
  was the only way to keep the gate green (rule 6 vs rule 3); it is a single line, so drop and
  re-apply it if the parallel desktop worktree conflicts. No desktop source was touched.
- `streamedAgentEvent` in `apps/cli/src/index.ts` whitelists fields, so `--jsonl` does not stream
  `artifacts` yet — one line (`...(event.artifacts ? { artifacts: event.artifacts } : {})`), left
  out because my index.ts footprint was error mapping only.
- `@core/types` has an unused `RunArtifactKind` (`file`/`url`/`diff`/`commit`/…). local-agent
  cannot depend on `@core/types`, so it keeps its own operation-shaped vocabulary; converging the
  two is a future call for whoever adds non-file artifacts (URLs, commits, CI).
- Verified read-only: the desktop journal already maps `artifact.created` → "artifact" and filters
  `evidence.reported`, and renders `entry.what` (our summary) before any i18n key — so no desktop
  string is missing. Desktop error rendering is message-only (`{ok:false, error}`), so nothing
  there depended on error identity.

## Verification

Full gate green: `pnpm build` 9/9 · `pnpm test` **1042 passed** (api 20, domain 187, db 36, llm
170, local-agent 21, mcp 114, store 95, desktop 296, cli 103) · `pnpm typecheck` 16/16 ·
`pnpm lint` 10/10 · `pnpm core:purity` clean.

`pnpm --filter @app/cli exec vitest run src/run-queue.test.ts --reporter=verbose`:

```
 RUN  v4.1.9 /Users/jenson/Desktop/Aimcub/.claude/worktrees/adapter-boundary-dc4552/apps/cli

 ✓ src/run-queue.test.ts > local agent run queue > drains queued sub-aims serially in plan order and persists every event 322ms
 ✓ src/run-queue.test.ts > local agent run queue > streams every normalized event live, not only the persisted flushes 173ms
 ✓ src/run-queue.test.ts > local agent run queue > retries a retryable failure exactly once, linked back to the attempt it replaces 1835ms
 ✓ src/run-queue.test.ts > local agent run queue > does not retry a non-retryable failure 153ms
 ✓ src/run-queue.test.ts > local agent run queue > cancels the executing run, never retries it, and keeps draining the rest 301ms
 ✓ src/run-queue.test.ts > local agent run queue > never enqueues a sub-aim that already has an active run 64ms
 ✓ src/run-queue.test.ts > local agent run queue > persists file artifacts as durable events and folds them into the run's evidence 205ms
 ✓ src/run-queue.test.ts > local agent run queue > keeps a run with no artifacts free of artifact events and reports an empty summary 172ms
 ✓ src/run-queue.test.ts > local agent run queue > retains runtime raw payloads under the per-event cap and the per-run budget 188ms
 ✓ src/run-queue.test.ts > local agent run queue > executes a run enqueued by another process from the queued row alone 126ms
 ✓ src/run-queue.test.ts > aimcub run --until-blocked > drains every ready agent-owned sub-aim and stops at the human-owned tail 329ms
 ✓ src/run-queue.test.ts > aimcub run --until-blocked > stops the sweep on a terminal run failure instead of moving to the next sub-aim 133ms
 ✓ src/run-queue.test.ts > aimcub run --until-blocked > keeps the single-run default: one sub-aim, one run, unchanged result shape 170ms

 Test Files  1 passed (1)
      Tests  13 passed (13)
   Duration  4.45s
```

New tests: 6 adapter fixtures (`packages/local-agent/src/adapters/artifacts.test.ts`), 3 queue
e2e cases (artifacts+evidence, artifact-free run, raw caps), 1 CLI case that bundles the real
`aimcub` binary with esbuild and asserts stderr/exit code for an unauthenticated runtime.
