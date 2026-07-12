# Aimcub Handoff

Last updated: 2026-07-12
Branch: `main`. Journey-first **Stages 1–5** are committed and merged. Stages 1–4 are on origin/main
(`b14c07a3`); **Stage 5** (fold Run/Evidence + Eval into the Journey sheets) is committed + merged to
`main` locally, **push pending user authorization**.

## Active epic — Journey-first rebuild (staged)

Epic plan: `~/.claude/plans/resilient-drifting-quail.md`. The founder wants the WHOLE working flow to
match the reference `Aimcub Glass.dc.html`: set aim → straight to the Journey; all work through the
station strip + drill-in **sheets** + the single "Your move" card, absorbing the heavy stage panels.
Delivered **in stages**, each green on the full gate.

**Routing bridge (unchanged):** `saveGoal` needs a validated plan; the Goal is created only at the end
of the intake→draft→clarify funnel, so true goal-first can't ship green in one step. Approach:
**bridge** (Stages 1–5 keep the funnel; the Journey already mounts post-save; fold panels into sheets
*behind* the existing `openCockpitStage` fallbacks) → **goal-first flip** at Stage 6.

Roadmap: 1 New Aim composer (DONE) · 2 Journey parity + interactive-sheet infra (DONE) · 3 Fold
Context (DONE) · 4 Fold Plan (DONE) · **5 Fold Run/Evidence + Eval (DONE this session)** ·
6 goal-first routing flip · 7 cleanup. All the working stations are now folded into Journey sheets;
Stage 6 flips routing so set-aim lands on the Journey immediately, Stage 7 removes the old stage nav.

## Stage 5 — Fold Run/Evidence + Eval into the Journey sheets (DONE this session)

Two independently-green commits on `glass-journey-stage5`. No new backend/IPC; reuse existing App
handlers; the `openCockpitStage("run"|"eval")` "Continue" fallbacks stay. Plan:
`~/.claude/plans/mutable-percolating-pretzel.md`.

**Stage 5A — read-only Eval fold + remove the Eval-duplicate ContextInbox** (`d64a4ae7`).
- New stateless exported `JourneyEvalSheetBody` (`JourneyView.tsx`): the real `CompletionRecapPanel`
  (now exported from `EvalStage.tsx`) when `progress.completion_recap.complete`; else a per-milestone
  frame (met/open chip + title + next-action, mirroring flat `evalRows`) nesting the read-only
  `EvidenceReviewList compact` under any milestone with evidence. **Framed on `progress.milestones`**
  so no milestone is dropped. Gated purely on the open eval station (all data is already in
  `progress`); flat `evalRows` + Continue fallback stay. Eval has no live milestone-mutation → honest
  read-only.
- **Finished the Stage-3 inbox move:** removed `EvalContextReviewSection` + both call sites + the
  `ContextInbox` import from `EvalStage.tsx`, dropping the now-dead `disabled` / `goalTitle` /
  `onAccept` / `onReject` props. Triage still lives in the Journey Context sheet; the "Context
  candidates" eval metric stays. Updated 3 EvalStage tests (inbox now asserted OUT of Eval).
- CSS `.od-journey-eval` + scoped recap reflow (1-col grid, `max-width:none`, hidden kicker). No new
  i18n keys, no new Glass tokens.

**Stage 5B — interactive human evidence fold (Run station)** (`e0864cda`).
- `runInteraction` now partitions pending work THREE ways with no overlap: agent-dispatchable →
  `options`; human ready for proof (`isHumanExecuteRoute && !blocked && !executeRowNeedsEval`) →
  `evidenceOptions`; else → `contextRows` (`stationSheet.ts` + a new `evidenceOptions` field on
  `JourneyStationInteraction`). Picking an evidence option opens the **reused `EvidenceSubmissionForm`
  in-sheet**; Submit → a new `onConfirmMilestone` JourneyView prop → App's live `confirmMilestone`
  (real IPC, persists); Add-files → the App file picker via `onPickEvidenceFiles`.
- Draft state is JourneyView-local (`activeEvidenceMilestoneId` + a per-milestone `evidenceDrafts`
  map), **membership-checked** against the current interaction so a background refresh that drops a
  milestone falls back to the list. **Modal-hide + persistent draft:** closing the sheet only clears
  the active id; drafts persist until a real navigation unmounts the view. **Deliberately no
  `onProofDraftActiveChange` nav-lock** — the sheet stays epoch-free (the nav-locked form remains via
  Continue → Run stage). On submit failure the form + draft stay open (App surfaces the error).
- `JourneySheetActionKind` stays `"run_agent"` (evidence uses a direct handler, not a new actionKind),
  so the journey.test "only Run carries interaction" invariant is intact. Evidence options render
  **read-only when no submit handler is wired** (honest-data). New i18n `glass.journey.evidenceGroup`
  (en/zh); CSS `.od-journey-evidence*`. Updated `journey.test.ts` for the new partition.

## Verification (Stage 5)

- Full gate green for each commit: `build` (+ `@core` no-leak) + **279 tests** (+3 `JourneyEvalSheetBody`
  SSR + EvalStage inbox-removal updates in 5A; +1 journey partition null-case + 2 `JourneyRunSheetBody`
  evidence-group tests in 5B) + `typecheck` + `lint` + `core:purity`. App.test PlanPanel snapshots,
  `EvalStage` CSS snapshot, the font ramp/weight + glass-token + i18n-parity guards, and
  `App.test.tsx:407` (`activeProofId` NOT in App.tsx — evidence state stays in JourneyView as
  `activeEvidenceMilestoneId`) all still pass.
- **Live packaged-app QA via CDP** (isolated `AIMCUB_HOME` seeded with `seedLocalAlphaDemo`; real
  `~/.aimcub` untouched — `store.json` mtime unchanged): Eval station → `.od-journey-eval` frames all 4
  seeded milestones, 2 with a nested read-only evidence review, **no context inbox**, no overflow,
  Continue fallback. Run station → 2 agent options + 1 evidence option ("Review demo narrative…") under
  the "Your move — submit proof" label. Opening the evidence option → the in-sheet form (proof note /
  URL / files / required-evidence check, Submit disabled until valid). Filling the note + ticking the
  required item enabled Submit; **submitting persisted** (form closed, no error, the milestone dropped
  from `evidenceOptions`, the Eval sheet's evidence-review count went 2→3, the isolated store mtime
  advanced). Agent dispatch still selects + enables "Run with agent". Real `~/.aimcub` untouched.
- Repacked (`pnpm desktop:pack`) + refreshed root `Aimcub.app`.

## Commit / push

- Stage 5: committed on `glass-journey-stage5` (`d64a4ae7` 5A + `e0864cda` 5B) + this handoff update,
  merged to `main`. **Not yet pushed** (awaiting user authorization). Once pushed, add an "Update
  handoff: Stage 5 pushed" commit with the origin hash (mirrors the Stage-3/4 pattern).

## Open risks / notes

- **Modal-hide draft persistence** (5B) is verified by design (drafts not reset on station change) but
  not live-tested end-to-end (the seeded demo had one human milestone, consumed by the submit test); a
  re-seed would let a future pass confirm Escape-mid-draft → reopen restores the note.
- **Post-completion routing** — completing the last milestone still auto-lands on the Eval stage recap
  (`App.tsx:1241`), not the Journey. Unchanged; the Journey Eval sheet now ALSO shows the recap, so a
  future stage could reconcile the two entry points.
- New cross-stage import edges (`stages/journey` → `stages/eval/EvalStage` + `stages/execute/
  EvidenceSubmissionForm`); no guard blocks them; typed props make breaking changes fail at compile.
- Pre-existing (carried): `com.aimcub.desktop` vs ASC `com.jensonchow.aimcub` bundle-id mismatch; dead
  i18n keys `glass.journey.receipt` / `glass.home.yourMove` (Stage 7 prune).

## Next session prompt

```text
Journey-first rebuild: Stages 1–5 done (Stage 5 = Run/Evidence + Eval folded into the Journey sheets;
5A read-only eval + inbox de-dup, 5B interactive in-sheet evidence submission → confirmMilestone).
Stages 1–4 on origin/main=b14c07a3; Stage 5 committed+merged locally (push may be pending — check
`git log origin/main`). Read docs/handoff.md + the epic plan (~/.claude/plans/resilient-drifting-quail.md).
Next is Stage 6 (goal-first routing flip — the first BACKEND stage): add a create-shell /
updateGoalPlan IPC so submit lands on the Journey immediately with a "Start research" Your-move, and
in-place plan-edit (the Stage-4 gap) + re-plan become live post-save. Needs a spike: today's re-plan
creates a NEW goal, and saveGoal requires a validated plan. Files: shared/ipc.ts, main/ipc.ts, preload,
@core/domain, App.tsx, JourneyView.tsx. Keep @core pure; persistence in apps/desktop/src/main. Detail
Stage 6 in a plan before coding. Same gate + static harness + live-packaged-app QA discipline.
```
