# Aimcub Handoff

Last updated: 2026-07-11
Branch: `main`. Journey-first **Stages 1–4** are committed, merged, and **pushed** (origin/main =
`b14c07a3`). Stage 4 = fold the read-only Plan interior into the Journey sheet.

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
Context into the Journey sheet (DONE) · **4 Fold Plan into the Journey sheet (DONE this session)** ·
5 Run/Evidence + Eval sheets · 6 goal-first routing flip · 7 cleanup. Each later stage gets its own
detailed plan when reached.

## Stage 4 — Fold Plan into the Journey sheet (DONE this session)

The Journey's **Plan station sheet** now hosts the real Plan contract interior (node selector + the
full read-only `PlanContractCard`) instead of today's flat milestone rows, reusing the existing
prop-driven `PlanPanel` verbatim. No new backend/IPC. Plan: `~/.claude/plans/mutable-percolating-pretzel.md`.

- **New stateless `JourneyPlanSheetBody`** (`stages/journey/JourneyView.tsx`, exported for SSR tests)
  renders, in a `.od-journey-plan` wrapper, the existing `<PlanPanel>` with `saved` /
  `onChange={undefined}` / `onSave={NOOP_SAVE}` — the canonical saved-goal read-only plan review
  (metrics + node selector + one read-only contract card: why / done-when / evidence / eval-signal /
  routing / acceptance-rule). `disabled` tracks busy so node browsing (the one live affordance) works.
- **`JourneyView`** gains one bundled optional prop `planReview?: Pick<PlanPanelProps, "plan" |
  "quality" | "review" | "validationErrors" | "routingAgents" | "routingValidation">`. Gate:
  `const planBody = sheet?.station === "plan" && props.planReview ? props.planReview : null;` — render
  branch inserted between the Stage-3 `contextBody` branch and the read-only-rows fallback (precedence
  interaction→context→plan→empty→rows). Absent → flat `planRows` fallback unchanged. The
  `openCockpitStage("contracts")` "Continue" fallback stays (bridge).
- **App.tsx** passes `planReview` at the `<JourneyView>` mount from already-computed view-models
  (`activePlan`, `planResult?.quality/review`, `activePlanValidationMessages`, `routingAgents`,
  `planRoutingValidation`), gated on `activePlan` being present.
- **Honest-data correction to the epic sketch:** for a SAVED goal there is **no live in-place
  plan-edit path** — `openGoal` nulls `draft`/`finalPlan`, so `PlanPanel` is `saved=true` /
  `onChange=undefined` (read-only); `applyPlanEdit` is unreachable, `refinePlan`/`savePlan` no-op, and
  every save path forks a NEW goal via `createGoal`. So **plan editing / re-plan is deferred to
  Stage 6** (the in-place `updateGoalPlan` IPC spike), exactly as Stage 3 deferred the clarify wizard.
  The sheet is intentionally read-only review + node browsing (still a real upgrade over flat rows).
- **CSS:** `.od-journey-plan { display: grid }` + `.od-journey-plan .od-stage-kicker { display: none }`
  (hides PlanPanel's own "Sub-aims" kicker — the sheet head already carries "PLAN"). Layout-only
  (ramp/weight guards). `.od-stage-panel` is a bare grid and `.od-plan-editor` has no own rule, so
  there was no nested card chrome to strip. No new i18n keys, no new Glass tokens.
- Files: `stages/journey/JourneyView.tsx`, `App.tsx` (mount prop), `cockpit.css`,
  `stages/journey/JourneyView.test.tsx`. Reused as-is (untouched): `PlanPanel`, `PlanContractCard`,
  `stationSheet.ts` (`interaction` stays null for plan → journey.test invariant intact).

## Verification (Stage 4)

- Full gate green: `build` (+ `@core` no-leak) + **273 tests** (+2 `JourneyPlanSheetBody`: hosts the
  read-only selector + one contract card with the other node's body hidden; renders no edit
  affordances — no textarea / routing-details / structure-details / Save) + `typecheck` + `lint` +
  `core:purity`. App.test.tsx PlanPanel CSS snapshots + `plan-contract-selector` anchor unaffected
  (PlanPanel rendered in isolation there).
- **Static cockpit.css harness** (light + dark): the read-only PlanPanel fits the 560px sheet with no
  horizontal overflow; the "Sub-aims" kicker is hidden; metrics show honest "-"/"0" (parity with the
  contracts stage). AA contrast reads fine in both themes.
- **Live packaged-app QA via CDP** (isolated `AIMCUB_HOME` seeded with `seedLocalAlphaDemo`; real
  `~/.aimcub` untouched — `store.json` mtime unchanged): opening the Journey **Plan** station shows
  `.od-journey-plan` with the node selector listing all 4 seeded sub-aims + exactly one read-only
  contract card (real seeded contract, routing chip, done-when/evidence/rationale), 0 editable
  textareas, no Save, no routing/structure edit controls, kicker hidden, no overflow; switching the
  node `<select>` re-rendered the card; **Continue** closed the sheet and opened the old contracts
  stage (`.od-plan-editor` + selector) — roadmap fallback intact. (Computer-use screen control was
  declined this session; CDP against the self-launched instance was used instead — same as the
  documented headless path.)
- Repacked (`pnpm desktop:pack`) + refreshed root `Aimcub.app`.

## Commit / push

- Journey-first Stage 4: committed on `glass-journey-stage4`, merged to `main`, and **pushed**
  (origin/main = `b14c07a3`; commits `f3afa7f5` feature + `b14c07a3` merge).

## Open risks / notes

- **Empty metrics cosmetics** — for a saved goal `planResult` is null → Quality "-" / Actions "0" in
  the sheet. Honest and matches the contracts stage; if the founder finds it jarring, a follow-up can
  wire the persisted `reviewOf(selected)` (`App.tsx`) into BOTH surfaces (out of Stage-4 scope; wiring
  only the sheet would desync the two).
- New cross-stage import edge (`stages/journey` → `stages/plan/PlanPanel`, like Stage 3's
  `stages/journey`→`stages/context` edge); no guard blocks it, but `Pick<PlanPanelProps,…>` makes a
  breaking PlanPanel prop change fail at compile.
- **Plan editing genuinely deferred to Stage 6** — in-place plan-update needs the create-shell /
  `updateGoalPlan` IPC spike.
- Pre-existing: `com.aimcub.desktop` vs ASC `com.jensonchow.aimcub` bundle-id mismatch. Dead i18n keys
  `glass.journey.receipt` (Stage 5 rich receipt) + `glass.home.yourMove` (Stage 7 prune).

## Next session prompt

```text
Journey-first rebuild: Stages 1–4 done (Stage 4 = read-only Plan interior folded into the Journey
sheet via JourneyPlanSheetBody; edit deferred to Stage 6). All on origin/main=b14c07a3. Read docs/handoff.md +
the epic plan (~/.claude/plans/resilient-drifting-quail.md). Next is Stage 5 (Fold Run/Evidence + Eval
into Journey sheets): the Run sheet hosts EvidenceSubmissionForm + proof-draft state (respect
onProofDraftActiveChange nav-lock) + LocalAgentExecutionSummary; the Eval sheet hosts EvalStage's
EvidenceReviewList + recap; old stages stay reachable via openCockpitStage until the flip. Reuse the
Stage-2/3/4 sheet-body seam (a stateless exported body + re-passed App handlers; exclude IPC-embedding
panels). Check honest-data (which Run/Eval affordances are genuinely live post-save). Detail Stage 5 in
a plan before coding. Same gate + static harness + live-packaged-app QA discipline. Stage 5 removes the
Eval-duplicate context inbox from Stage 3.
```
