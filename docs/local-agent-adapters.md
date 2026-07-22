# Local agent adapters

`@core/local-agent` runs authenticated local CLI runtimes (Codex, Claude Code, ...) and
normalizes their output into Aimcub run events. A **local agent adapter** is the plug-in
unit of that layer: one module that describes how to find a runtime, how to invoke it, and
how to read its stream. Adding a runtime needs a new adapter module plus tests — no edits to
engine dispatch, `@core/types`, the CLI, or the desktop app.

The engine keeps everything a runtime must not own: process spawning, timeouts, cancellation,
serialized event delivery, output accumulation, and failure classification. An adapter is pure
description plus two pure functions.

## Adapter fields

`LocalAgentAdapter` (see `packages/local-agent/src/types.ts`):

| Field | Meaning |
| --- | --- |
| `id` | Stable runtime id; must match `/^[a-z][a-z0-9-]*$/` and be unique in the registry. |
| `name` | The single source of truth for the runtime's display name in CLI + desktop. |
| `bin` / `fallbackBins` / `fallbackPaths` | Executable names/paths searched on `PATH` and in the common install dirs. |
| `envVar` | Env var that pins the executable path (wins over every search). |
| `versionArgs` | Args for the version probe; a failing probe marks the runtime unavailable. |
| `authProbe` | Optional args whose exit code decides `authStatus` (`ok` / `missing`). |
| `listModels` | Optional live model listing; `parse` returns `null` to fall back. |
| `fallbackModels` / `reasoningOptions` | Offered when no live list is available. |
| `buildInvocation(request)` | Returns `{ args, stdin }` for one run. |
| `parseLine(line)` | Returns normalized events, or `null` for "not mine". |

### `buildInvocation` is the security contract

`buildInvocation` **must** map `request.permission.sandbox` (`read-only` /
`workspace-write` / `danger-full-access`) and `request.permission.network` onto the runtime's
own flags. Aimcub promises the user that a read-only run cannot write and that a
network-disabled run cannot reach the network; only the adapter can keep that promise for its
runtime. If a runtime cannot express a mode, choose its most restrictive flag.

The request is already sanitized when `buildInvocation` sees it — `sanitizeRunRequest` runs
engine-side first, so the prompt is trimmed and non-empty, `cwd` is set, and
`extraAllowedDirs` entries are trimmed and non-empty.

### `parseLine` contract

`parseLine` is called once per trimmed, non-empty line of stdout and stderr.

- Return `LocalAgentEvent[]` for lines you understand (one line may yield several events).
- Return `null` for anything else: the engine emits `agent.raw` (or `agent.stderr` on the
  stderr path) carrying the raw line, so nothing is silently dropped.
- Set `replacesOutput: true` on an `agent.message.delta` when the summary is the runtime's
  authoritative final answer. It replaces the accumulated output text instead of appending to
  it (Claude's `result` event does this); every other delta appends.

Helpers for parsing live in `packages/local-agent/src/adapters/helpers.ts` — `safeJsonParse`,
`isRecord`, `stringifyValue`, `usageFromRecord`, `textFromContent`, `DEFAULT_MODEL`,
`DEFAULT_PROBE_TIMEOUT_MS`. They are exported from the package for adapter authors.

## Contribution recipe

1. **Create `packages/local-agent/src/adapters/<id>.ts`** exporting a `LocalAgentAdapter`.
   Copy `codex.ts` (JSONL, live model listing) or `claude.ts` (stream-json, `replacesOutput`)
   as a starting shape.
2. **Append it to `BUILT_IN_LOCAL_AGENT_ADAPTERS`** in `packages/local-agent/src/registry.ts`,
   and export the adapter from `packages/local-agent/src/index.ts`. Registration order is
   preference order — append, don't insert, unless you intend to change which runtime is
   picked first. (An adapter that ships outside the built-ins can call
   `registerLocalAgentAdapter` instead.)
3. **Add tests.** Cover `buildInvocation` spawn args (especially each sandbox/network mode)
   and `parseLine` normalization, using the fake `ProcessRunner` pattern from
   `packages/local-agent/src/runtime.test.ts` (`executable()` + `streamingRunner`) with an
   isolated `createLocalAgentRegistry([...])`. Child processes are never really spawned in
   tests.
4. **Run the full gate**: `pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm core:purity`.

## Behavior you inherit

- **Display names** flow `adapter.name` → `LocalAgentDetection.name` → routing `agent_label`,
  so a new runtime is labeled correctly everywhere without UI changes.
- **Selection**: an explicit `--agent <id>` or a plan routing override wins when that id is
  detected; an override naming an unregistered id is ignored and the default pick (the first
  available, authenticated detection, i.e. registration order) applies.
- **Unknown ids**: `runLocalAgent` throws `Unknown local agent "<id>". Registered agents: ...`
  — a misconfigured id is a config error, not a retryable run failure. The CLI validates
  `--agent` against `listRegisteredLocalAgentIds()` before it gets that far.
- **Failures** are classified into `LocalAgentRunResult.failure`
  (`executable_not_found` / `timeout` / `canceled` / `nonzero_exit` / `spawn_error` /
  `event_callback_error`); only `timeout` is currently marked retryable.

## What the run queue does with your events

Runs reach adapters through the shared orchestrator (`packages/local-agent/src/orchestrator.ts`)
and its queue (`run-queue.ts`), so an adapter inherits queue behavior for free — and one adapter
decision now has teeth beyond a single run:

- **`retryable` drives a real retry.** A terminal failure marked `retryable` re-enqueues the same
  sub-aim once as a fresh queued run, linked to the attempt it replaces by a `run.log` event. Runs
  are immutable history, so a retry is a new row, never a rewritten one. Classify a failure
  retryable only when running the same request again could plausibly succeed.
- **Every event is persisted, batched.** Events are normalized (`agent.tool.*` → `tool.*`,
  everything else → `run.log` carrying `agent_event_type`) and written in batches — on a tool
  boundary, on a terminal event, or every 250ms. Order is preserved and the full stream is on disk
  by the time a run finishes, so a chatty `parseLine` costs throughput, not correctness.
- **Events stream before they persist.** The same events go live to the desktop cockpit as they
  arrive. A `summary` is user-visible text: keep it short and human, not a raw JSON dump.
- **Cancellation is your `AbortSignal` contract.** The queue holds one `AbortController` per
  executing run; the engine turns an abort into SIGTERM and failure code `canceled`, which is never
  retried.

## Future work (out of scope)

- Declarative, config-driven adapters (describe a runtime in JSON instead of TypeScript).
- Dynamic plugin loading of adapters from outside the repo at runtime.
