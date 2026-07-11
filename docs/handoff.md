# Aimcub Handoff

Last updated: 2026-07-11
Branch: `main`. Journey-first **Stage 1** (New Aim composer) and this session's **Stage 2** (Journey
parity + interactive-sheet infra) are both committed, merged, and **pushed** (origin/main =
`b70f7b9e`).

## Active epic — Journey-first rebuild (staged)

Plan: `~/.claude/plans/resilient-drifting-quail.md` (the epic). Stage 2's detailed plan:
`~/.claude/plans/drifting-singing-pebble.md`. The founder wants the WHOLE working flow to match the
reference `Aimcub Glass.dc.html`: set aim → straight to the Journey; all work through the Journey's
station strip + drill-in **sheets** + the single "Your move" card, absorbing the separate heavy stage
panels. Delivered **in stages**, each green on the full gate.

**Routing bridge (unchanged):** `saveGoal` needs a validated plan and the Goal is only created at the
end of the intake→draft→clarify funnel, so true goal-first can't ship green in one step. Approach:
**bridge** (Stages 1–5 keep the funnel; the Journey already mounts post-save; fold panels into sheets
*behind* the existing `openCockpitStage` fallbacks) → **goal-first flip** at Stage 6.

Roadmap: 1 New Aim composer (DONE) · **2 Journey visual parity + interactive-sheet infra (DONE this
session)** · 3 Context/Research sheet · 4 Plan sheet · 5 Run/Evidence + Eval sheets · 6 goal-first
routing flip · 7 cleanup. Each later stage gets its own detailed plan when reached.

## Stage 2 — Journey visual parity + interactive-sheet infra (DONE this session)

Two live/visible features + forward-ready infra, **no new backend/IPC**, honest-data-only:

- **"N turns elsewhere" jump chip** (header): `App.tsx` computes other aims whose `progressSummaries`
  status is `needs_you` (excl. the current aim; `blocked` deliberately not counted) and passes
  `elsewhereCount` + `onJumpElsewhere` (→ existing `openGoal`). `JourneyView` renders the pill only
  when count > 0. Pill text uses `--ink2` (not `--acc`) on `--acc-soft` — `--acc` there only reaches
  ~3.8:1, below WCAG AA (same call as the you/agent chips; see [[aimcub-glass-contrast-aa]]).
- **Interactive Run-station sheet** (the core deliverable): the pure sheet model now returns an
  optional `interaction` for the Run station — dispatchable agent milestones become selectable
  `options` (a `role=radiogroup`), the non-dispatchable remainder (blocked / human / in-flight) stays
  visible as read-only `contextRows`. Dispatchable = agent-routed & !blocked & not `queued`/`running`.
  An **enable-gated** confirm (membership-checked against live options, so a background `progress`
  refresh can't fire a stale selection) calls the **existing `runAgent` handler** in place, closes the
  sheet, and the run lands as a receipt in Turns/Journal. Read-only stations are unchanged; the
  `openCockpitStage` "Continue" fallback stays on every sheet (roadmap invariant).
- **Forward-ready infra (renders hidden today):** the Your-move "You" chip is live; the secondary
  actions (hand-to-agent / schedule / Later) and the ambient **take-back** button are handler-gated —
  App passes no handler, so they stay hidden until the Stage-6 routing/scheduling backends. Each
  station sheet gained a static, data-free **sub** line.
- Files: `workflow/journey/{types,stationSheet,yourMove,index}.ts`, `stages/journey/JourneyView.tsx`
  (+ exported stateless `JourneyRunSheetBody` for SSR-testable interior), `cockpit.css`, `i18n.tsx`,
  `App.tsx`. Also tightened `yourMove.ts` `isPendingWork` to treat `queued` (not just `running`) as
  in-flight. Consumed the previously-dead `glass.journey.later`; `glass.journey.receipt` +
  `glass.home.yourMove` remain unused (Stage 5/7).

## Verification (Stage 2)

- Full gate green: `build` (+ `@core` no-leak) + **267 tests** (was 254; +13: interactive partition,
  gates, stale-selection, queued, elsewhere/You/secondary/take-back render, `JourneyRunSheetBody` both
  states) + `typecheck` + `lint` + `core:purity`.
- Static `cockpit.css` harness (real CSS, light + dark): header elsewhere pill (AA-verified `--ink2`,
  contrast computed 7.0:1), You chip, secondary actions, ambient take-back, and the interactive Run
  sheet (options → gated confirm, both disabled & enabled) — matches the reference.
- **Live packaged-app QA** (isolated `AIMCUB_HOME` seeded via `seedLocalAlphaDemo`, real `~/.aimcub`
  untouched — mtime unchanged): the Journey renders with the live You chip; opening **Run** shows the
  interactive sheet (2 agent options + 1 human "You" context row); confirm is gated ("Pick one to
  continue" → select → "Run with agent"); confirming dispatched the milestone via `runAgent`, closed
  the sheet, and dropped a receipt in the Journal (the seeded home has no provider, so the agent
  exited code 1 — the existing graceful error path, no crash). Read-only Plan sheet shows the new sub
  line + rows + Continue fallback. Native traffic lights stay native.
- Repacked (`pnpm desktop:pack`) + refreshed root `Aimcub.app`.

## Commit / push

- Journey-first Stage 2: committed + merged to `main` and **pushed** (origin/main = `b70f7b9e`;
  commits `ab89dcc4` feature + `b70f7b9e` merge).

## Open risks / notes

- Stage 2 changes zero save/plan-gen logic (bridge intact). The interactive dispatch reuses the
  already-tested `runAgent`; the sheet stays component-local overlay state keyed by `goal.id`.
- **Divergence from the mockup (intentional):** the reference put its one curated interactive decision
  on a separate `"decide"` pseudo-station off the move card; we realize "selectable options" honestly
  as the Run-station dispatcher over real pending agent milestones. Two dispatch paths (move-card
  primary + run-sheet confirm) both funnel through `runAgent` + busy-gating, so no double-fire.
- Dead keys remaining: `glass.journey.receipt` (Stage 5 rich receipt sheet) and `glass.home.yourMove`
  (Stage 7 prune). Pre-existing `com.aimcub.desktop` vs ASC `com.jensonchow.aimcub` bundle-id mismatch.

## Next session prompt

```text
Journey-first rebuild: Stages 1–2 done + pushed (Stage 2 = Journey visual parity + interactive
Run-dispatch sheet; origin/main=b70f7b9e). Read docs/handoff.md + the epic plan
(~/.claude/plans/resilient-drifting-quail.md). Next is Stage 3 (Fold Context + Research into the
Journey sheet): the Context station sheet hosts ContextClarifyPanel (Q&A), ContextReviewPanel
(compact), ContextActivityPanel, ContextInbox; Research stays a read-only receipt; the old `context`
stage stays reachable via openCockpitStage until the flip. Reuse the Stage-2 interactive-sheet seam
(selectable options → gated confirm via an existing App handler). Detail Stage 3 in a plan before
coding. Same gate + harness + live-packaged-app QA discipline.
```
