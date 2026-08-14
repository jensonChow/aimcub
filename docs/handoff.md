# Aimcub Handoff

Last updated: 2026-08-14
Branch: `main`. Pushed state on origin is `88d9ab42` (the 2026-08-13 batch); **this session's
"runs survive the process" commit is LOCAL ONLY** — push was not authorized this session.

## What shipped 2026-08-14: runs survive the process (quit = pause, reopen = continue)

Founder screenshot + report: "重新打开，任务流并没有继续" — his aim sat at 0% with the banner
still saying "Agents are working". Root cause: his store held a run row claimed on 2026-08-09
whose status was still `running` five days after the process died. A `running` status was a claim
of process ownership that no one recorded and no one reconciled, so ANY quit (forced or graceful)
during execution orphaned the row forever: the ambient banner lied permanently, the pulsing dot
lied, Your-move was suppressed (work "in flight"), every dependent milestone stayed waiting,
cancel could not reach it (no in-process controller; the queued-only fallback refused), and
re-running was refused by the active-run guard. A permanently wedged aim with no product exit.

The fix is mechanical, wake-time, and shared (durable rules in `architecture.md`, "Runs survive
the process"):

1. **Claims carry an owner.** `claimNextQueuedRun` stamps `Run.worker_pid` (types + store), and
   `settleInterruptedRun` is the new atomic store gate: still-`running` → `failed`, null on a
   lost race — the claim gate's mirror, so two waking processes settle each orphan exactly once.
2. **Wakes reconcile before claiming.** `reconcileInterruptedRuns`
   (`packages/local-agent/src/interrupted-runs.ts`) runs at Desktop launch (before
   `kickRunQueue`) and at the start of every CLI run invocation: a `running` row whose pid is
   dead, absent (every pre-fix row), or the reconciler's own is settled as `interrupted` and
   re-queued as a continuation carrying the same recorded permission, runtime, instruction, and
   attempt (`resumed_from` links the chain; an interruption never consumes a retry attempt).
   The launch drain then picks continuations up at the read-only floor; above-floor
   continuations wait for the existing re-grant path. Only queue-managed rows (those with a
   `run.queued` event) are touched — demo-seeded `running` rows are not the queue's.
3. **Graceful quit stops pretending.** `before-quit` now calls `abortAllForShutdown`: children
   are killed WITHOUT settling (`SHUTDOWN_ABORT_REASON` gates the orchestrator's settle +
   evidence writes), so a normal quit leaves the same recoverable `running` row a force-quit
   does — one recovery path for both deaths, zero writes racing app exit.
4. **CLI collision = become the worker.** An explicit `aimcub run <sub-aim>` that hits the
   active-run guard because a QUEUED continuation owns the milestone drains that row by id
   instead of failing (`MilestoneSelectionError` now carries `milestoneId`). A sweep still
   skips continuation-queued milestones (they drain at the next Desktop launch) — deliberate.

No renderer changes: the banner/dot/Your-move all read the store, which now tells the truth.

**The founder's wedged aim heals itself**: his orphan (run `394265c9`, aim "我想要研究coding
agent related router") has no `worker_pid`, so the first launch of the new build settles it and
queues the continuation — worth watching live (below).

## Earlier arcs (durable rules live in module memories, not here)

- **2026-08-10..13 — both test flakes deterministic** (planning-checkpoint import warmup +
  scoped fake timers; MCP auth per-process keypair cache). Triage rules in `operations.md`.
- **2026-08-09 — plan is a graph** (`depends_on_ids` fan-in, graph-preserving edits, derived
  readiness, N-worker drain) + **context review as decisions** + **packaged-app TCC fix**
  (`process.chdir(home)`; smokes launch from `/tmp`). Rules in `architecture.md` /
  `design-system.md` / `operations.md`.
- **2026-07-26 — planning passes durable + honest**; **2026-07-25 — UI collapse** (Journey is
  the one surface); **2026-07-24 — embedded planning sessions** (Claude + Codex brains).

## Verification

Full gate green on this tip (build 9/9 · test: core 200 · desktop 415 · cli 122 · llm 204 ·
store 107 · local-agent 48 · mcp 57 · api 20 · db 36 · eval-moat 49 · typecheck · lint ·
purity). New coverage: store claim/settle primitives (3), reconciler e2e over a real store +
fake runtime (7: orphan→continue→drain-to-completed, live-foreign-pid skip, pre-fix
no-pid row, demo-row untouchable, two-orphans-one-continuation, no-runtime honest settle,
shutdown-abort full circle), CLI becomes-the-worker (1). Root `Aimcub.app` repacked from this
tip and boot-smoked from `/tmp`.

## Open items

1. **NOT VERIFIED LIVE: interrupted-run recovery on the founder's real store.** First launch of
   the new build should log `run 394265c9 … continuing as run <id>`, flip his stuck aim's first
   sub-aim to a genuinely executing run, and un-wedge the DAG. Watch the Journey tell the truth.
2. **NOT VERIFIED LIVE: the founder's planning drive** — create → attach file mid-pass → quit →
   reopen → Resume (nothing re-asked, attachment survives).
3. **NOT VERIFIED LIVE: a real multi-branch plan** — first brain-emitted branching plan with two
   runs genuinely overlapping.
4. Hosted Supabase divergence: `depends_on_id` single column AND no `worker_pid` — both
   deliberate (local-store-first), reconcile at sync parity.
5. Founder `claude /login` → first Claude-brain live smoke (Codex is the live-verified path).
6. Settings → Brain effort/reasoning control (proposed follow-up).
7. Online linked-source connectors actually reading content.
8. `docs/local-agent-adapters.md` predates planning sessions (no
   `buildPlanningSessionInvocation` / `resumeSessionId` docs) — worth a section before OSS flip.
9. Two older commit messages (`e7da6a63`, `1054f694`) quote Chinese — founder's call.
10. OSS launch checklist (license → npm org → repo settings → gitleaks → public flip) —
    founder-owned, unchanged.
