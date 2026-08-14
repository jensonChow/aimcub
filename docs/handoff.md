# Aimcub Handoff

Last updated: 2026-08-14
Branch: `main`, **everything PUSHED to origin/main** (founder authorized 2026-08-14: "refresh
memory, commit push merge" — covering `54b590e5` runs-survive-the-process, `173733d7`
question-never-a-candidate, the four work-detail passes `8f2a03b4` / `38412ecd` / `61dc8fa3` /
`7f0e6a13`, and this docs commit). Destination re-verified per the push protocol
(`jensonChow/aimcub`, ADMIN, PRIVATE, default `main`, `origin` matches). Work landed directly
on `main` — no separate merge needed.

## What shipped 2026-08-14 (fourth polish pass): one type system in the row detail

Founder: "字体、字重、字号、对齐、空白等等都太乱了." The last dialect standing was the accent
"Primary action" card — blue eyebrow, bold guidance sentence (which repeated the status line),
right-floated button, its own borders and fill. Deleted: actions now render as ONE
start-aligned row (`od-execute-actions`, primary button first, quiet alternates after, one
height); the guidance sentence lives on the Your-move card only; the consent disclosure moved
down to sit with the other disclosure lines, so the detail reads description → status →
actions → three identical hairline disclosure rows. `execute.primaryActionLabel` removed.
Harness-verified on `?parallel`.

## What shipped 2026-08-14 (third polish pass): the run timeline is deleted

Founder, on the second-pass detail: "runtime line 就没有任何的意义." The standing Run timeline
block (three bordered cards of "Sandbox read-only · Network off · 47 step(s) · Attempt 3 ·
Queued by Desktop") is deleted outright — component, pure helper, tests, ~23 CSS blocks, 26
i18n keys. Run history is the Journal's job; the one honest fact the ledger carried folds into
the status sentence (a blocked row with retries reads "Local agent run timed out. · 3
attempts"). The expanded row is now: description → status sentence → consent line → primary →
Break down → two closed disclosure lines (Evidence review · Runtime details/Activity). Desktop
suite 402 (net −20 from the deletion).

## What shipped 2026-08-14 (second polish pass): receipts fold; no row without a move

Founder, on the new detail with receipts open: "展开后还是有太多乱七八糟的东西." Three finds:
(1) the eval receipts were still a ledger — two stacked disclosures of bordered cards, each
repeating the sub-aim title, the machine kind, per-row trust math, and the SAME two explainer
sentences per card, auto-opened; (2) a standing machine-dialect routing-rationale line under
the buttons; (3) a real functional hole — a blocked row with low-trust evidence offered
NOTHING but Break down (needsEval suppressed the primary, `!row.blocked` suppressed both
secondaries). Now: `EvalReceipts` renders ONE closed disclosure (open only on completed rows)
with one shared verdict sentence + one hairline row per evidence item and evaluator;
`executePrimaryAction` gives every INCOMPLETE row its route's action (blocked agent rows get
"Run agent · Try the run again"); the routing rationale moved into the Runtime details
disclosure; `EvidenceReviewList`/`EvaluatorMatchList` and ~35 orphaned CSS blocks deleted.
Contracts updated in `design-system.md` + `desktop.md`.

## What shipped 2026-08-14 (latest): the expanded plan row is a sentence, not a console

Founder, expanding a sub-aim: "充斥着大量的内容、细节，非常的复杂，这不是给人用的产品."
Diagnosis: the detail told one failure FOUR ways (header pill + second eyebrow pill + a
"Run state: Failed" card + a "Blocked work" banner), repeated the title the user just clicked,
led with a four-card machine grid whose fourth card duplicated the primary action's own detail
line, and kept a standing permission form even at the calm read-only default. Now the detail
adds only what the header cannot say: description → ONE state sentence (`executeStatusLine`,
quiet text + tone dot; a blocked row speaks its run's own error, evidence speaks its verdict, a
quiet ready row says nothing) → primary action → secondaries → default-closed disclosures
(runtime gains the agent name; the consent console collapses to "What this run may do ·
Read only · Network off"). 17 dead i18n keys removed. Contracts in `design-system.md` +
`desktop.md`; guards in App.test.tsx + new executePrimaryAction.test.ts; harness-verified live
on `?parallel` (expanded ready row + done row, zero harness errors).

Also live-verified this session (open item #1): the founder's screenshot showed the runs-batch
recovery working on his real store — orphan `394265c9` settled, its continuation actually
executed (then failed honestly: Codex timed out twice on a research-heavy read-only run). The
run-recovery mechanism is no longer theory; the follow-up product question is whether the
execution timeout budget fits research-shaped sub-aims.

## What shipped 2026-08-14 (later): a question is never a context candidate

Founder, on seeing his inbox full of "pending answer needed:" rows: "不应该有这样一个环节，
这本质上还是multichoice问题选单应该承担的功能." He is right twice over: the clarify flow
ALREADY turns high-priority `review.context.gaps` into askable questions (`clarify.ts`), so
`extractMemoryCandidatesFromReview` was a second consumer of the same gaps that dressed them
as pseudo-facts behind a forced edit gate. Deleted at the source (core composer + llm recorder
+ desktop/CLI call sites), with three mechanical layers so the class cannot return: the shared
composition sink drops prompt-like content, the store accept gate still refuses question-shaped
edits, and store load retires legacy parked-question rows — the founder's five polluted rows
vanish the first time the new build opens his store, with the gap content still durable in the
landed plan's `decomposition_contract.context_gaps`. Renderer/CLI prompt-like checks survive
only as input validation. Durable rules: `architecture.md` (Evidence And Eval) +
`design-system.md` (context band). Coverage moved from pinning the old composition to pinning
the guard + the load retirement (core 197 · store 108; llm/cli/desktop green).

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

Full gate green on this tip (build 9/9 · test: core 197 · desktop 422 · cli 122 · llm 204 ·
store 108 · local-agent 48 · mcp 57 · api 20 · db 36 · eval-moat 49 · typecheck · lint ·
purity). Runs-batch coverage: store claim/settle primitives (3), reconciler e2e over a real
store + fake runtime (7: orphan→continue→drain-to-completed, live-foreign-pid skip, pre-fix
no-pid row, demo-row untouchable, two-orphans-one-continuation, no-runtime honest settle,
shutdown-abort full circle), CLI becomes-the-worker (1). Inbox-batch coverage: the composition
guard (question-shaped content emits nothing), load-time retirement of parked questions
(cross-instance), accept gate re-pinned as edit-into-question refusal. Work-detail coverage:
executeStatusLine unit suite (5), no-eyebrow/no-grid/one-story pins, consent-disclosure pin;
receipts pass re-pins: one-verdict-once + hairline rows + no machine dialect (EvalStage.test),
completed-open/incomplete-closed + low-trust-keeps-its-action (App.test), orphaned ledger CSS
proven gone; harness-driven on `?parallel`. Root `Aimcub.app` repacked from this tip and
boot-smoked from `/tmp`.

## Open items

1. **Execution timeout budget vs research-shaped sub-aims.** Run recovery is now LIVE-VERIFIED
   (the founder's orphan settled and its continuation really executed) — but that continuation
   then timed out twice on a research-heavy read-only run and blocked honestly. Decide whether
   the engine's execution timeout (and/or milestone sizing guidance) fits research work.
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
