# WORKTREE-REPORT: cockpit-cli-loose-ends

Four small, real gaps carried from the batch-3 reports. All four done, in file
footprint, full gate green.

## 1. PlanningDebugPanel

Traced the data flow first: `planningDebugTraces`/`planningLiveEvents` in
`App.tsx` are still actively produced (intake/draft/clarify/refine all push
into them) and persisted via `mergePlanningDebugTraces` into `saveGoal`/
`updateGoalPlan` — the plumbing was live, only the component was unmounted
(removed from a `CockpitShell` inspector column deleted in a July 4 layout
simplification). Mounted `PlanningDebugPanel` in `ContextStage`, gated by
`useDeveloperMode()` inside the stage itself (matching `PlanContractCard`'s
existing pattern, not a prop from `App.tsx`) — shown in both the normal and
focused-question render paths. `App.tsx` builds the element unconditionally,
exactly the original inspector wiring, restored.

## 2. Stranded widened-run affordance

Detection is a pure function (`strandedRun.ts`): a `queued` run above the
read-only floor, for the selected milestone, whose id isn't in a new
session-scoped `Set` (`sessionRunIdsRef` in `App.tsx`, populated the instant
`runMilestoneAgent`/`claimQueuedRun` resolves, before any IPC/refresh gap, so
a run this session just started never flashes as "stranded"). Re-grant adds a
`claimQueuedRun` IPC channel wrapping the existing `claimConsentedRun` — no
new permission is ever negotiated, only the already-recorded one claimed.
Cancel needed a real fix: `RunQueue.cancel` only aborts an *executing* run — a
merely-queued one has no controller. Added `cancelQueuedRun` (desktop-only)
using `claimNextQueuedRun({runId})` + `finishRun` directly — the same atomic
gate the drain claims through, so a real drain claiming the same run in the
same instant is left alone rather than corrupted. No store schema change.
`docs/agent-permissions.md`'s stranded-run paragraph now describes both
actions.

## 3. CLI --jsonl artifacts

One-line fix, but `streamedAgentEvent` lived in `index.ts`, which nothing may
import (top-level `main().then(...)` runs on import). Moved it to
`agent-run.ts` (already side-effect-free, already imported by its test file)
and re-exported into `index.ts`. Test asserts an artifact-bearing event
round-trips through `JSON.stringify`/`JSON.parse` unchanged, plus that a
non-artifact event omits the key entirely.

## 4. Queue-request `surface` marker

Added `RunSurface = "desktop" | "cli"` to `QueuedRunRequest`/
`EnqueueMilestoneRunInput` in `orchestrator.ts` (additive/optional throughout,
including the retry path, which now carries the original run's surface
forward). Both callers set it. Used for: (a) `RunTimelinePanel` shows "Queued
by CLI"/"Queued by Desktop" in the run meta line; (b) a new
`logStrandedQueuedRuns`, called once at Desktop startup alongside the existing
`kickRunQueue`, logs every above-floor queued run and its surface — read-only,
claims nothing, `kickRunQueue`'s own floor filter is untouched.

## Decisions flagged, not built

- Did not make the item-2 stranded-run *notice* surface-aware (e.g. "queued
  by CLI" in its own copy) — item 4 asked for timeline/logging provenance
  specifically; folding it into the notice too is a small, natural follow-up
  but wasn't asked for and I didn't want to re-open completed, tested work
  without a mandate.
- No `packages/store` changes anywhere, including cancel-a-queued-run —
  `claimNextQueuedRun`/`finishRun` already covered it.

## Verification

- Full gate green: `pnpm build && pnpm test && pnpm typecheck && pnpm lint &&
  pnpm core:purity` — all pass. Desktop 361 tests (+22), CLI 106 (+3),
  local-agent 21 (unchanged; tested via its two callers per the package's own
  convention — no `orchestrator.test.ts` exists).
- `apps/desktop`: `pnpm vitest run src/main/run-queue.test.ts` (20/20),
  `src/renderer/App.test.tsx` (76/76, incl. 3 new stranded-run render
  assertions), `src/renderer/stages/execute/runTimeline.test.tsx` (20/20),
  `src/renderer/stages/context/ContextStage.test.tsx` (15/15).
- `apps/cli`: `pnpm vitest run src/agent-run.test.ts` (6/6).
- Booted `pnpm desktop` against `examples/local-alpha`'s seed plus one
  manually injected `workspace-write` run (`surface: "cli"`) on an incomplete
  milestone. Clean boot, no renderer/main errors; the new startup diagnostic
  fired correctly: `[aimcub] run <id> stays queued (sandbox: workspace-write,
  queued by cli) — ...`. Requested `computer-use` access to screenshot the
  Execute-stage notice and Context-stage debug panel directly; access was
  denied (auto-denied, non-interactive session) — those pixels are therefore
  unconfirmed. Structure/text/gating are covered by `renderToStaticMarkup`
  tests against the real production components, not a visual check.
