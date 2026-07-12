# Aimcub Handoff

Last updated: 2026-07-12
Branch: `glass-journey-stage6` (NOT yet merged to `main`). Journey-first **Stages 1–5** are on
`origin/main` (`6e6f190d`). **Stage 6A** (goal-first create-shell + in-Journey first-plan +
`updateGoalPlan` backbone) is committed on `glass-journey-stage6` and full-gate + live-QA green. This
is a **checkpoint** — Stage 6B (editable plan sheet + re-plan) is next, on the same branch, before
merging to `main`.

## Active epic — Journey-first rebuild (staged)

Epic plan: `~/.claude/plans/resilient-drifting-quail.md`. Stage 6 plan: `~/.claude/plans/fancy-skipping-kazoo.md`.
Stage 6 is the **goal-first routing flip** (the first BACKEND stage): submit lands on the Journey
immediately and plan updates live on the same goal. Founder decisions: **full in-Journey planning**
(fold the research/clarify/plan interaction into the Journey — never leave it) and **6A first →
checkpoint → 6B**.

## Stage 6A — Goal-first create-shell + in-Journey first-plan + `updateGoalPlan` backbone (DONE)

**Backbone (store → IPC → preload → main):**
- `packages/store`: new `createAimShell(input)` — persists a plan-less Goal (`plan_json: null`,
  `status "active"`, zero milestones/assignments). The in-place re-plan primitive `updateGoal` (already
  CLI-proven + tested) is now the land/re-plan path. Extracted a shared `linkParentSubAim` helper
  (used by both create paths). +2 store tests (shell persists null plan + 0 milestones; a later
  `updateGoal` lands the first plan on the SAME goal, no fork).
- `shared/ipc.ts`: `IPC.createAim` + `CreateAimRequest`; `IPC.updateGoalPlan` + `UpdateGoalPlanRequest`
  (mirrors `SaveRequest`'s synthesis inputs + `draftId`). Preload bridges both.
- `main/ipc.ts`: extracted the `saveGoal` synthesis bundle into a shared `synthesizeSavedGoalMetadata`
  + `recordSavedGoalContextCandidates` (behavior-preserving for `saveGoal`). New `createAim` handler →
  `createAimShell`. New `updateGoalPlan` handler → routing re-check (parity with `saveGoal`) → **two
  honest modes**: planning-run mode (`questions` present) recomputes the full synthesis + inserts the
  clarify-answer memories (via `addMemory`, dedup-safe) + records candidates; manual-edit mode (no
  `questions`, for 6B) is minimal (merge the plan only). Discards `draftId` on success; null-safe.
  **`local_handoff_manifest` staleness is a non-issue** — the live agent handoff reads per-milestone
  `decomposition_contract` (refreshed by `mergeMilestones`), never the goal-level manifest, so a
  manual edit needs no expensive manifest regeneration.

**Renderer — goal-first front door + in-Journey planning (`App.tsx` + `JourneyView.tsx`):**
- `createAimAndOpenJourney()` (composer `onSubmit`): ports the `routeAfterAimSubmit` gate (no-op on
  empty title; helper on no-runtime, creates nothing), then `createAim` → `openGoal(shell)`.
- `planningShellId` state + derived `isPlanningShell`: the discriminator for the in-Journey flow
  (replaces `Boolean(selected)` so a shell isn't locked read-only). Cleared on openGoal/resetComposer/
  resetPlanningForAimUpdate.
- `mainStageContent`: a shell-Journey branch **before** the funnel context/contracts interception →
  the Journey stays mounted through the planning run. The Journey element is computed once (`journeyView`)
  and reused normally (`!draft`) + during planning (`isPlanningShell`).
- `startShellResearch()` → `startDraft({ shell })`: `startDraft` gained a `shell` branch that skips the
  composer-surface + draft-checkpoint funnel logic (no orphan draft — the autosave effect is inert
  while a goal is `selected`) and runs the same intake→draft→clarify orchestration. `continueFromContext`
  + `refinePlan` are now shell-aware (read the shell's title/description; thread the shell flag).
- The clarify Q&A (`ContextClarifyPanel`) is folded into a Journey **planning panel** (its `onSkip`
  stays in-Journey for a shell); the generated plan review reuses the read-only `JourneyPlanSheetBody`
  + a "Save plan" action; a working indicator covers the LLM gaps.
- `commitShellPlan()` (Save plan): validate (`validateExecutablePlan` + `validatePlanRouting`) →
  `updateGoalPlan(selected.id, …)` (NOT `saveGoal`) → null-safe → clear `planningShellId`, reset
  planning state, `setSelected(updated.goal)`, route back to the Journey (`mode "cockpit"` /
  `stageOverride "aim"` — else the leftover "contracts" would intercept), `refreshGoalState`.
- JourneyView: `onStartResearch` + `planning` + `planningRuntimeReady` props. A **"build the plan"
  card** renders when `total_milestones === 0` (before the move/ambient ternary), so a fresh shell
  **never shows the false "Aim is complete." ambient** (a plan-less goal's `next_action` leak).
  `yourMove.ts` stays pure/unchanged. New i18n `glass.journey.buildPlan*/planReviewTitle/savePlanCta/
  planningWorking` (en/zh). New CSS `.od-journey-planning*` (token-only). +5 JourneyView tests.

## Verification (Stage 6A)

- **Full gate green**: `build` (+ `@core` no-leak) + **284 tests** (+2 store `createAimShell`, +5
  JourneyView 6A) + `typecheck` + `lint` + `core:purity`. Behavior-preserving `saveGoal` refactor kept
  all prior tests green; the brittle `continueFromContext` source-regex was relaxed for the shell option.
- **Live packaged-app QA via CDP** (isolated `AIMCUB_HOME` with the real provider config copied in — a
  DeepSeek key — but a fresh empty store; real `~/.aimcub/store.json` mtime **unchanged**): submit a new
  aim → **plan-less shell persisted** (1 goal, `plan_json: null`, 0 milestones) → **Journey mounts
  immediately with the "Turn this aim into a plan" card, no false-complete** → "Build the plan" →
  "Working…" → **the clarify Q&A renders IN the Journey** (adaptive intake, 6 turns) → draft → refine
  clarify → **real plan review in-Journey** → "Save plan" → **the plan landed on the SAME goal (goalId
  unchanged, no fork): 7 nodes, 7 milestones, 7 assignments, 30 memories, all 13 metadata keys** (full
  synthesis parity with `saveGoal`) → the Journey flipped to the planned goal (Your-move card, 0/7).
- Repacked (`pnpm desktop:pack`) + refreshed root `Aimcub.app` (matches the committed source).

## Next — Stage 6B (after this checkpoint)

Editable in-place plan sheet + re-plan-same-goal. Make `JourneyPlanSheetBody` editable via a
**buffered-local-plan + explicit "Save plan changes"** commit (do NOT wire `onChange` straight to
`updateGoalPlan` — `planMerge` matches by title, so per-keystroke would churn milestone ids). Use a
dedicated `editableWhenSaved`/`onCommit` seam on `PlanPanel` (keep `saved=true` copy/anchors), NOT
`saved={false}`. Update `JourneyView.test.tsx:409-427` for the new affordances. A "Re-plan" action runs
a planning run → `updateGoalPlan` (merge, completed frozen) — `breakDown` (child decompose) stays.
The `updateGoalPlan` handler's manual-edit mode is already built for this.

## Invariants (still enforced)
- Journey sheet component-local + epoch-free; mutations via epoch-safe App handlers. `journey.test`
  "only the Run station carries an interactive payload" — the build-plan card is App-driven and plan
  editing rides the `planReview` prop channel; `buildJourneyStationSheet`/`interaction` untouched.
- `@core` pure (no new op — the pure surface already existed); persistence in store + main. Evidence
  append-only + idempotent; milestone completion derived by `evaluate()` (`mergeMilestones` freezes
  completed). Native traffic lights; `data-od-id` anchors; font ramp/weight; glass-token 3-block mirror;
  en/zh parity — all TS/test-enforced.

## Ops gotchas (reusable)
- Live QA needs a provider in the isolated home: copy real `~/.aimcub/settings.json` (+ `context-sources.json`)
  into `$AIMCUB_HOME` (read real, write isolated); start with an empty store to prove "one goal, no fork".
  Drive via CDP (`--remote-debugging-port`). The adaptive intake is a multi-question wizard
  (`.od-context-choice-list .od-ui-button-card` options; CTA priority Generate plan > Refine draft >
  Next question, never "← Back"); refine can take 60s+ (poll, don't assume hang). Always verify real
  `store.json` mtime is unchanged.
- Pre-existing (carried): `com.aimcub.desktop` vs ASC `com.jensonchow.aimcub` bundle-id mismatch; dead
  i18n keys `glass.journey.receipt` / `glass.home.yourMove` (Stage 7 prune).
