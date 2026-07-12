# Aimcub Handoff

Last updated: 2026-07-12
Branch: `glass-journey-stage7` (off `main`, origin/main=`d58cc6e1`). **Stage 7 (cleanup + convergence)
is COMPLETE and full-gate + live-QA green — the FINAL stage of the Journey-first epic. The epic is
closed.** Not yet merged to `main`; do not push without the founder's OK.

## Journey-first rebuild — DONE (Stages 1–7)

Epic plan: `~/.claude/plans/resilient-drifting-quail.md`. Stage 7 plan: `~/.claude/plans/hidden-singing-possum.md`.
Stages 1–5 (bridge: reskin + fold funnel panels into Journey sheets) and Stage 6 (goal-first routing
flip) shipped previously. Stage 7 removed the now-redundant/dead funnel and converged the two flows
that still depended on it (edit + child-breakdown) onto the goal-first model.

**Founder decisions for Stage 7:** scope = **cleanup + convergence** (not pure cleanup); draft
reconciliation = **discard-on-create** (keep the draft subsystem, discard the pre-goal draft on create).

## Stage 7 sub-steps (each independently full-gate green; committed on `glass-journey-stage7`)

- **7.1** Removed the top `.od-stage-nav` strip (it duplicated the Journey's 6-station strip above
  every open goal). `.od-main` base grid → single-row `minmax(0,1fr)` (the `auto` row only held the
  strip; context/contracts/run/eval had no override → would have lost their scroll container). Deleted
  the strip CSS + the orphaned `activeWorkbenchSurface` memo + `hasWorkbenchNavigation` import. Pruned
  10 dead i18n keys. Stages stay reachable via Journey `onOpenStage`, Cmd/Ctrl+1..5, Cmd+K.
- **7.2** Draft-linger fix (discard-on-create): `CreateAimRequest.draftId` → the `createAim` handler
  discards it; `createAimAndOpenJourney` captures the pending draftId + `pauseAutosave()` (session left
  intact so the in-flight timer honors the pause, not `beginSession`'s un-pause) + `resumeAutosave()`.
- **7.3** Child-breakdown → goal-first: `breakDown` mints a linked child shell (`createAim` with
  `parentGoalId`/`parentMilestoneId`) and opens its build-plan Journey (parity with top-level). +store test.
- **7.4** In-Journey aim rename (edit-mode's replacement): new `renameGoal` store method + IPC +
  preload + main handler (title/description only, works on a plan-less shell — `updateGoal` can't). New
  `onRenameAim` inline header editor in `JourneyView` (both header sites) + `renameAim` App handler.
  +6 i18n keys, +CSS, +store/JourneyView/App tests. **Additive** (edit machinery deleted in 7.5).
- **7.5** Deleted the dead funnel intake surfaces: `AimIntakePanel`, `DraftAimOverviewPanel`
  (+component+test), the edit machinery (`beginAimEdit`/`cancelAimEdit`/`changeAim*`/`aimEditBuffer`/
  `restoreAimEditFocus`/all `aimSurfaceMode==="edit"/"summary"` branches), `checkpointSubmittedAim`,
  the `startDraft` non-shell branch (now shell-only), `productErrorFromSaveBlock`, the composer icons,
  `aimSurfaceAfterSubmit` import. `AimSurfaceMode` narrowed to `"idle" | "compose"`. **Gating prereq:**
  `applyHydratedDraft` now lands every resume in the composer (drops legacy plan/clarify/parent/summary
  hydration) so the retained draft-resume path can't re-enter the funnel. Pruned 53 orphaned i18n keys.
  Rewrote the two funnel/edit source-guard test blocks to the compose-only model. **KEPT** (still
  reachable via `onOpenStage` for saved goals): `ContextStage`/`PlanPanel`/`ExecutePanel`/`EvalStage`/
  `LockedStagePanel`, `savePlan`/`saveGoal`/`createGoal`, and the `cockpit.*Locked*`/`context.stage.continue`/
  `checkpointError*` i18n keys.
- **7.6** Docs (`design-system.md` + this file + memory), full gate, live QA, repack, commit.

## Verification (Stage 7)

- **Full gate green** at every sub-step: `build` (+ `@core` no-leak) + tests (**281 desktop** + 72 store
  + 88 cli) + `typecheck` + `lint` + `core:purity`.
- **Live packaged-app QA via CDP** (isolated `AIMCUB_HOME` with the real DeepSeek provider config copied
  in, empty store; real `~/.aimcub/store.json` mtime **unchanged**): (1) submit a new aim →
  plan-less shell (1 goal, `plan_json` null, no fork) + Journey with **exactly one** nav strip (6 Journey
  stations) + build-plan card + rename control; a title typed + paused >500ms autosaves a draft, and
  submitting **discards it** (0 drafts) — the 7.2 fix. (2) Rename in the Journey header → persisted on the
  same goal, no plan churn, no fork. (3) Resume a seeded legacy `summary`-surface draft → lands in the
  **composer**, not the funnel (7.5). (4) Cmd+4 opens the Run stage (ExecutePanel) with no top strip;
  `.od-main` is single-row + `.od-workspace` is the `overflow:auto` container (7.1). (5) Break down a
  milestone → a linked **child shell** is created + opens its build-plan Journey (7.3).
- Repacked (`pnpm desktop:pack`) + refreshed root `Aimcub.app`.

## Follow-up spun off (not blocking)

- **Dead AimIntakePanel/DraftAimOverviewPanel CSS** (~500 lines in `cockpit.css`, gate-harmless) is
  intertwined with live shared classes (`.od-aim-intake`, `.od-aim-kicker`, `.od-aim-primary`,
  `.od-draft-recovery*`, …) so it needs a careful per-block sweep + removing the two stale App.test.tsx
  blocks that assert only dead classes (`"uses the New Aim quiet hover treatment…"`, `"keeps the saved
  Aim overview centered…"`). Spun off as a separate task.

## Invariants (still enforced)
- Journey sheet component-local + epoch-free; mutations via epoch-safe App handlers. The in-Journey
  rename is a header editor behind a NEW `onRenameAim` prop — NOT a station `interaction`, so
  `journey.test.ts:336` "only the Run station carries an interactive payload" holds.
- `@core` pure (the new `renameGoal` is in `@core/store`, which is NOT in `core:purity` scope — that
  scopes only `@core/domain`+`@core/types`; persistence belongs in the store). Evidence append-only +
  idempotent; milestone completion derived by `evaluate()`. Native traffic lights; `data-od-id` anchors;
  font ramp/weight; glass-token 3-block mirror; en/zh parity — all TS/test-enforced.

## Ops gotchas (reusable)
- Live packaged-app QA via CDP: repack + refresh root `Aimcub.app`, launch the binary with
  `AIMCUB_HOME=<isolated>` + `--remote-debugging-port=NNNN` + `--user-data-dir=<isolated>`; copy real
  `~/.aimcub/settings.json` (+ `context-sources.json`) in, empty store; connect a Node CDP driver (Node
  22 has global `WebSocket`; drive `Runtime.evaluate` + `Page.captureScreenshot`). A planned goal can be
  seeded fast via `updateGoalPlan` with the `store.test.ts` PLAN fixture values (domain `software`,
  evaluators `commit_pattern`/`ci_status`, `completion_mode: auto_then_confirm`) — hand-crafted enums are
  rejected by `validateExecutablePlan`. The sidebar labels a goal by its plan `goal_summary`, not
  `goal.title` (aim-navigation title). Always verify real `~/.aimcub/store.json` mtime is unchanged.
- Pre-existing (carried): `com.aimcub.desktop` vs ASC `com.jensonchow.aimcub` bundle-id mismatch.
