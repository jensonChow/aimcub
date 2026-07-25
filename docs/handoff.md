# Aimcub Handoff

Last updated: 2026-07-25
Branch: `main`, **PUSHED to origin 2026-07-25** (founder authorized; destination
jensonChow/aimcub verified). Both same-day epics are on origin: the UI collapse
(4 stages) and the planning-lane clarity polish. All session branches merged
and deleted locally.
**The UI collapse epic ("agent + plan") is CODE-COMPLETE**: the founder said the
UI was still too complicated the day after the one-flow shipped; the audit found
two product generations mounted at once (funnel-era workbench pages beside the
agent one-flow) with most state rendered 2–4 times. The fix was structural: the
Journey is now the ONE work surface per aim.

## What changed (four stages on this branch)

1. `034569b1` **plan-as-object rows** — the Journey gained `JourneyPlanBand`:
   one row per sub-aim (owner chip, in-flight dot, status pill, route+evidence
   meta) expanding in place to the full work detail (blocker, live run + Stop,
   stranded-run recovery, per-session permission consent, primary action, proof
   form with the nav lock) plus inline eval receipts (evidence review +
   evaluator matches). The "Your move" CTA lands on its own row instead of
   navigating to stages.
2. `fcb5ecc2` **stations/sheets/turns removed** — the 6-station strip, all
   station drill-in sheets (7 bodies), and the Turns roster deleted; the journal
   became a closed-by-default disclosure; pending context candidates became an
   inline Journey band (the sheet was the only triage surface); Re-plan moved to
   the plan band head; `JourneyPlanSheetBody` → `JourneyPlanReview`.
3. `f5e05edf` **standalone stage pages retired** — `CockpitStage` collapsed to
   `aim | settings | memory`; Context/Contracts/Run/Eval pages, LockedStagePanel,
   Cmd+1..5, and palette stage entries deleted; every planning failure and
   refinement lands on the Journey; the completed-aim recap renders at the top
   of the Journey; `savePlan`/`saveGoal` renderer path deleted (goal-first is
   the only path); the developer trace panel mounts under the Journey when
   developer mode is on.
4. (this commit) **mass deletion + purge** — deleted ContextStage +
   overview/activity/review panels + contextLoop + contextReview,
   ExecutePanel, the EvalStage page component (file survives as the receipts
   module), and ContextSourcesPanel's workbench variant; purged 451 unused
   i18n keys (en+zh) and ~1,400 lines of dead CSS; docs/memory updated.

## Verification

- Full gate green after every stage: build 9/9 · typecheck 17/17 · lint 11/11 ·
  purity clean · desktop tests 335 (Execute-stage behavior tests ported to the
  plan band, receipts/recap tests ported to the kept components).
- Renderer mass: ~17.6k → ~14.6k non-test LOC; cockpit.css 7,644 → 6,399 lines;
  i18n 1,239 → 788 keys. Root `Aimcub.app` repacked + boot-smoked this session.

## What survived, where

- Planning session/funnel: both mount through the Journey's planning slot
  (`ContextClarifyPanel`, `PlanningSessionPanel` kept).
- Plan editing/repair: `PlanPanel`/`PlanContractCard` as `JourneyPlanReview`
  (in-place buffered commit; also the planning landing's review).
- Work detail internals: `stages/execute/*` helpers + controls (consent,
  timeline, stranded-run, proof form) — consumed by `JourneyPlanBand`.
- Receipts: `stages/eval/EvalStage.tsx` = EvidenceReviewList,
  EvaluatorMatchList, CompletionRecapPanel only.
- Sources setup: Settings → Research (`ContextSourcesPanel`, settings variant
  only). Memory page, Home, composer, drafts, funnel fallback: unchanged.

## Post-collapse polish (same day)

5. **planning-lane-clarity** — the founder's first live look said the planning
   card was "not clear enough"; the screenshot showed raw trace words ("brain
   started", "tool") on the product surface, three zero-counters, and the
   optional chat box dominating. Fix: main now emits STRUCTURED activity
   (kind/code/tool/count — never display copy) and the renderer speaks it in
   localized agent voice (`planningActivityLine`; unsayable rows drop to null,
   so raw ids can never render). The live card is one pulsing title + ONE
   current-activity line + counts only when non-zero + a single-lane chat
   composer + quiet Draft-now/Stop controls; the Journey header sub swaps to
   "Aimcub researches first, and asks only what research can't answer" while a
   session runs. 19 new `planningSession.now.*` keys (en+zh); 6 voice tests.

6. **aim-delete-action** — founder: "should add a delete or archive action."
   Saved aims now carry the draft rows' menu idiom: a hover/focus-revealed More
   Actions trigger with menu-gated **Delete aim** + inline confirm. Store
   cascade already existed (`deleteGoal`, CLI parity included); main now stops
   any planning session for the aim before deleting; the renderer stops a live
   run it can see, and deleting the open aim lands on Home. Archive-with-
   restore deliberately deferred until shelving real aims is the need (delete
   answers the test-junk cleanup without a data-black-hole archive view).

## Open items

1. **Founder look-through** of the collapsed Journey + the clarified planning
   card (a FRESH session shows the new lines; a session started under the old
   build replays legacy rows as the quiet fallback).
2. Prior open items unchanged: founder `claude /login` → first Claude-brain
   live smoke; Settings → Brain effort/reasoning control; online linked-source
   connectors reading content; the OSS launch checklist (license → npm org →
   repo settings → gitleaks → public flip).

## Next session

Have the founder drive one real aim end-to-end on the collapsed surface
(create → answer → adopt → run/proof → receipts) and collect what still feels
heavy. Candidate follow-ups only if he flags them: trimming Settings panes,
Memory palette entry, renaming `stages/execute|eval` directories to match their
new roles.
