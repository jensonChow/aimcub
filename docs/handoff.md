# Aimcub Handoff

Last updated: 2026-07-11
Branch: `main`. Journey-first **Stages 1–3** are committed, merged, and **pushed** (origin/main =
`fdfb238f`). Stage 3 = fold Context into the Journey sheet.

## Active epic — Journey-first rebuild (staged)

Epic plan: `~/.claude/plans/resilient-drifting-quail.md`. The founder wants the WHOLE working flow to
match the reference `Aimcub Glass.dc.html`: set aim → straight to the Journey; all work through the
station strip + drill-in **sheets** + the single "Your move" card, absorbing the heavy stage panels.
Delivered **in stages**, each green on the full gate.

**Routing bridge (unchanged):** `saveGoal` needs a validated plan; the Goal is created only at the end
of the intake→draft→clarify funnel, so true goal-first can't ship green in one step. Approach:
**bridge** (Stages 1–5 keep the funnel; the Journey already mounts post-save; fold panels into sheets
*behind* the existing `openCockpitStage` fallbacks) → **goal-first flip** at Stage 6.

Roadmap: 1 New Aim composer (DONE) · 2 Journey parity + interactive-sheet infra (DONE) · **3 Fold
Context into the Journey sheet (DONE this session)** · 4 Plan sheet · 5 Run/Evidence + Eval sheets ·
6 goal-first routing flip · 7 cleanup. Each later stage gets its own detailed plan when reached.

## Stage 3 — Fold Context into the Journey sheet (DONE this session)

The Journey's **Context station sheet** now hosts the live saved-goal Context interior instead of
read-only rows, reusing the existing prop-driven panels + accept/reject handlers. No new backend/IPC.
Plan: `~/.claude/plans/drifting-singing-pebble.md`.

- **New stateless `JourneyContextSheetBody`** (`stages/journey/JourneyView.tsx`, exported for SSR
  tests) renders, in a `.od-journey-context` wrapper: `ContextInbox` (pending-candidate triage — shown
  when there are pending candidates), `ContextActivityPanel` (**only when `loop.hasLiveResearchData`**
  — on a settled goal the activity rows read as misleading "waiting/idle" states, so it's suppressed;
  the full stage still shows it), `ContextReviewPanel` (compact, self-nulls when empty), and an honest
  **empty hint** (`glass.journey.contextEmpty`) when none apply.
- **`JourneyView`** gains optional `contextLoop` / `contextReview` / `onAcceptContextCandidate` /
  `onRejectContextCandidate`. When the Context station is open AND those are supplied, the sheet renders
  the rich body; else the read-only rows. Accept/reject route through the existing epoch-safe App
  handlers and do **not** close the sheet (multi-triage); the sheet updates on refresh. The
  `openCockpitStage("context")` "Continue" fallback stays (bridge).
- **Correction to the epic sketch:** for a saved goal `clarifyPhase === null` (reset in `openGoal`), so
  the clarify Q&A wizard is NOT live post-save → correctly **out of scope** (re-planning stays in the
  old funnel until Stage 6). `ContextSourcesPanel` (the only IPC-embedding panel) stays in the old stage.
- **Single source of truth:** added `pendingContextCandidates(candidates)` to `labels.ts` (keeps global
  `goal_id === null` candidates, unlike `pendingContextForGoal`); refactored EvalStage to use it; the
  Journey sheet + the read-only fallback rows both filter to `status === "pending"`.
- Files: `stages/journey/JourneyView.tsx`, `App.tsx` (mount props), `labels.ts`,
  `stages/eval/EvalStage.tsx`, `workflow/journey/stationSheet.ts`, `cockpit.css`, `i18n.tsx`. Reused as-is
  (untouched): `ContextInbox`, `ContextActivityPanel`, `ContextReviewPanel`, `contextLoop`/`contextReview`.

## Verification (Stage 3)

- Full gate green: `build` (+ `@core` no-leak) + **271 tests** (+4 `JourneyContextSheetBody`: empty
  hint, inbox render, activity honesty-gate, review receipt) + `typecheck` + `lint` + `core:purity`.
- **Live packaged-app QA** (isolated `AIMCUB_HOME` via `seedLocalAlphaDemo`; real `~/.aimcub` untouched
  — mtime unchanged): opening the Journey **Context** station shows the inbox with the seeded pending
  candidate (meta chips, editable content, scope toggle, Accept/Reject) — fits the 560px sheet cleanly,
  no activity panel (settled goal → honesty gate), review self-nulled; clicking **Accept** triaged it
  in place, the sheet stayed open, the inbox emptied, and the honest empty hint appeared; **Continue**
  opened the full old Context stage (which *does* show the idle activity panel — confirming the gate).
  Native traffic lights native.
- Repacked (`pnpm desktop:pack`) + refreshed root `Aimcub.app`.

## Commit / push

- Journey-first Stage 3: committed + merged to `main` and **pushed** (origin/main = `fdfb238f`;
  commits `4429c4e1` feature + `fdfb238f` merge).

## Open risks / notes

- The context-candidate inbox now appears in BOTH the Journey Context sheet and EvalStage (both use the
  same handlers → consistent). Stage 5 (Eval fold) removes the Eval duplicate.
- New cross-stage import edge (`stages/journey` → `stages/context` panels + renderer-root `ContextInbox`
  / `labels`); no guard blocks it, but the seam is brittle to context-panel prop changes.
- Pre-existing: `com.aimcub.desktop` vs ASC `com.jensonchow.aimcub` bundle-id mismatch. Dead i18n keys
  `glass.journey.receipt` (Stage 5 rich receipt) + `glass.home.yourMove` (Stage 7 prune).

## Next session prompt

```text
Journey-first rebuild: Stages 1–3 done + pushed (Stage 3 = Context folded into the Journey sheet;
origin/main=fdfb238f). Read docs/handoff.md + the epic plan
(~/.claude/plans/resilient-drifting-quail.md). Next is Stage 4 (Fold Plan into the Journey sheet): the
Plan station sheet hosts PlanContractCard/PlanPanel (node select + rule drafts) with revise-in-place
via applyPlanEdit; the old `contracts` stage stays reachable via openCockpitStage until the flip. Reuse
the Stage-2/3 sheet-body seam (a stateless exported JourneyPlanSheetBody + re-passed App handlers).
Detail Stage 4 in a plan before coding. Same gate + harness + live-packaged-app QA discipline.
```
