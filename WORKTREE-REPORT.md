# queue-streaming — worktree report

Durable run queue + streamed events + one shared orchestrator + `--until-blocked`.

## What changed

**Store (`packages/store/src/index.ts`, additive only)**
- `appendRunEvents(inputs[])` — one lock cycle, order preserved, unknown runs skipped.
- `claimNextQueuedRun(filter?)` — atomically flips the oldest queued run to `running` and emits
  `run.started`. Filter: `goalId` / `runId` / `sandbox`.
- `CreateRunInput.requestPayload` — recorded on the run's opening event, so a queued run is
  self-describing and any worker can execute it later.

**Orchestrator (`packages/local-agent/src/orchestrator.ts`, `run-queue.ts` — new)**
- One pipeline: select sub-aim → select runtime → `createRun(queued)` → claim → `runLocalAgent`
  → evidence (`mcp_report`, trust 0.6, same payload shape) → `finishRun` → sediment. CLI and
  Desktop are now thin wrappers; the near-duplicate copies are gone.
- Store is a **structural port** (`RunOrchestratorStore`), not an `@core/store` import — this
  package must not depend on persistence, and adding a dependency was out of footprint. `Store*`
  helper aliases recover the caller's real `Run`/`Evidence` types, so the CLI result shape is
  unchanged. Exactly one cast (`asStoreRow`) bridges the port; it is commented.
- `routingOverrideForMilestone` is injected (same reason) so `@core/domain` stays the one reader.
- Events are **batched**: flushed on tool boundaries, on terminal events, or every 250ms. All
  events are on disk before a run finishes. A flush failure resurfaces on the engine's callback
  path, so a broken store still classifies as `event_callback_error` mid-run.

**Desktop** — `runMilestoneAgent` is enqueue-and-return (`{ ok, runId, error }`). New
`IPC.runLiveEvent` push channel (modeled on `planningLiveEvent`, broadcast to every window since a
background drain has no originating sender) and `IPC.cancelRun`. `main/run-queue.ts` holds the
worker and imports no Electron, so it is testable against a real store.

**Renderer** — `stages/execute/liveRun.ts` folds the stream into last-event-wins state; the
Execute stage shows a live status line plus a Stop button; App.tsx subscribes once and refreshes
derived progress when a run settles. New strings in `i18n.tsx` (en + zh).

**CLI** — `aimcub run <aim> --until-blocked` sweeps every ready agent-owned sub-aim, one summary
line per run plus a final tally; help text updated. Rejects `--milestone`. Default single-run
behavior and every existing flag are unchanged.

## Decisions worth knowing

1. **A sweep gives each sub-aim at most one attempt.** A finished *run* does not complete a
   *sub-aim* — `evaluate()` does — so the naive loop re-ran the same sub-aim forever (found by a
   hanging test, not by reading). `chooseMilestone` grew `excludeMilestoneIds`; the sweep tracks
   what it already tried.
2. **Retry attempts are counted on the queue request, not by counting historical runs.** `attempt`
   + `retry_of` ride the `run.queued` payload, so an old completed run for the same sub-aim cannot
   consume a retry budget. Retries are new rows (runs stay immutable history) linked by a
   `run.log` event: `Retry 1 of 1 … { retry_of, attempt, failure_code }`.
3. **Sandbox-scoped claiming.** Not in the brief, added deliberately: Desktop's worker drains at
   `sandbox: "read-only"` only. Without it, a `workspace-write` run queued by `aimcub run
   --workspace` and left behind by a crashed CLI would be executed by Desktop at next launch, in
   the user's repo, with write permission the user never granted Desktop. Tested both sides.
4. **The CLI claims by `runId`** right after enqueuing, so it always executes the run it created;
   if another process wins the claim it says so instead of silently running something else.

## Out of scope / handoff

- **Queue end-to-end tests live in `apps/cli/src/run-queue.test.ts`**, not in
  `packages/local-agent`: that package has no `@core/store` dependency and package.json edits were
  forbidden. If a later batch adds `@core/store` as a devDependency there, they belong beside the
  orchestrator.
- No CSS was added (outside footprint): the live-run line reuses `od-work-note`. A dedicated style
  would read better.
- `docs/memory/architecture.md` still describes `aimcub run` as "does not iterate until blocked"
  and the queue as future work — owned by the integrating session.
- Cross-surface claiming is now sandbox-gated but still real (Desktop may drain a `read-only` run
  the CLI queued). Fine today; a surface marker on the queue request would make it explicit.
- No daemon: queued work only moves while Desktop is open or a CLI invocation is running.

## Verification

Full gate green: build 9/9 · typecheck 16/16 · lint 10/10 · purity clean · **1065 tests**
(desktop 296, domain 187, llm 170, mcp 114, cli 99, store 95, api 40, db 36, local-agent 28).
Was 1035. `grep -rn "Codex or Claude" packages apps` → no matches.

```
 ✓ src/run-queue.test.ts > local agent run queue > drains queued sub-aims serially in plan order and persists every event 287ms
 ✓ src/run-queue.test.ts > local agent run queue > streams every normalized event live, not only the persisted flushes 139ms
 ✓ src/run-queue.test.ts > local agent run queue > retries a retryable failure exactly once, linked back to the attempt it replaces 1749ms
 ✓ src/run-queue.test.ts > local agent run queue > does not retry a non-retryable failure 105ms
 ✓ src/run-queue.test.ts > local agent run queue > cancels the executing run, never retries it, and keeps draining the rest 220ms
 ✓ src/run-queue.test.ts > local agent run queue > never enqueues a sub-aim that already has an active run 44ms
 ✓ src/run-queue.test.ts > local agent run queue > executes a run enqueued by another process from the queued row alone 90ms
 ✓ src/run-queue.test.ts > aimcub run --until-blocked > drains every ready agent-owned sub-aim and stops at the human-owned tail 258ms
 ✓ src/run-queue.test.ts > aimcub run --until-blocked > stops the sweep on a terminal run failure instead of moving to the next sub-aim 107ms
 ✓ src/run-queue.test.ts > aimcub run --until-blocked > keeps the single-run default: one sub-aim, one run, unchanged result shape 136ms

 Test Files  1 passed (1)
      Tests  10 passed (10)
```
