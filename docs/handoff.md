# Aimcub Handoff

Last updated: 2026-07-11
Branch: `main`. Prior Glass polish pass is committed, merged, and **pushed** (origin/main).
This session's **Journey-first rebuild Stage 1** is committed + merged to local `main`, **not pushed**.

## Active epic — Journey-first rebuild (staged)

Plan: `~/.claude/plans/resilient-drifting-quail.md` (approved). The founder wants the WHOLE working
flow to match the reference `Aimcub Glass.dc.html`: set aim → straight to the Journey; all work
(research/context/plan/run/eval) through the Journey's station strip + drill-in **sheets** + the
single "Your move" card, absorbing the separate heavy stage panels. Delivered **in stages**, each
green on the full gate.

**Routing decision (central tension):** `saveGoal` requires a validated plan (`shared/ipc.ts`) and
the Goal is only created at the end of the intake→draft→clarify funnel (`startDraft`, App.tsx),
so true goal-first can't ship green in one step. Approach: **bridge** (Stages 1–5 keep the funnel;
the Journey already mounts post-save) → **goal-first flip** at Stage 6 (new create-shell /
`updateGoalPlan` IPC). Most heavy-panel interaction logic already lives in framework-free helpers +
stateless components (see the plan's "Reusable seams"), so the fold-in is re-hosting, not rewriting.

Roadmap: 1 New Aim composer (DONE) · 2 Journey visual parity + interactive-sheet infra · 3 Context/
Research sheet · 4 Plan sheet · 5 Run/Evidence + Eval sheets · 6 goal-first routing flip · 7 cleanup.
Each later stage gets its own detailed plan when reached.

## Stage 1 — New Aim composer (DONE this session)

New `stages/aim/NewAimComposer.tsx` (+ test) renders the reference NEW AIM screen: accent "NEW AIM"
eyebrow, a big single-line headline input with a bottom rule (accent-underline focus, ring
suppressed), a 44px circular submit shown once the input has content, a "Name the outcome you want"
helper + an "Add details" toggle, spark suggestion chips while empty, a rotating ghost placeholder,
and a memory-aware footer. `App.tsx` splits the `showAimEditor` branch: `aimSurfaceMode ===
"compose" && !parent` → `NewAimComposer`; edit-mode + child breakdown keep the unchanged
`AimIntakePanel` (so `.od-aim-composer`, its exact-CSS assertions, and the `aim-edit-mode` anchor are
intact). New `.od-newaim-*` CSS + `glass.newAim.*` i18n (en+zh). **No routing change** — submit still
calls `startDraft({})`, so the flow still passes through the (still pre-Glass) Context/Plan funnel
until later stages Glass-ify them and Stage 6 flips the routing. `AimHelperGuidancePanel` is rendered
by App and passed to the composer as a `ReactNode` (`guidance`) to keep it decoupled.

## Verification (Stage 1)

- Full gate green: `build` (+ `@core` no-leak) + **254 tests** (8 new NewAimComposer) + `typecheck` +
  `lint` + `core:purity`.
- Harness QA (real `cockpit.css`, light + dark): empty state (eyebrow, headline + ghost, helper,
  5 sparks, footer) and typed state (circular submit + "Add details" toggle, no sparks) match the
  reference NEW AIM.
- **Live QA in the packaged app** (isolated `AIMCUB_HOME`, real `~/.aimcub` untouched): "Set your
  first aim" opens the new composer; the ghost placeholder rotates; typing reveals the circular
  submit + details toggle and hides sparks; submitting creates the aim and routes onward via the
  existing funnel (Context stage) — no crash, routing unchanged as intended. Native traffic lights
  stay native.
- Repacked + refreshed root `Aimcub.app`.

## Commit / push

- Prior Glass polish pass: committed, merged, **pushed** (origin/main == the polish merge).
- Journey-first Stage 1: committed + merged to **local** `main`, **not pushed** — ask before
  `git push origin main`.

## Open risks / notes

- **Stage 1 is composer-visual-only**: after submit you STILL see the old Context/Plan funnel. That
  is expected and shippable; Stages 3–5 Glass-ify the interior and Stage 6 flips set-aim→Journey.
- **Focus deviation:** the NEW AIM headline input uses an accent-underline focus (ring suppressed)
  to match the reference, instead of the usual 4px `--od-focus` ring — an intentional per-surface
  exception; fold into `design-system.md` in a later stage.
- Pre-existing: `com.aimcub.desktop` vs App Store Connect `com.jensonchow.aimcub` bundle-id mismatch.
- Dead i18n keys (`glass.home.yourMove`, `glass.journey.later`, `glass.journey.receipt`) — Stage 2/7
  may consume or prune them (the reference's Your-move secondary actions + receipt sheet).

## Next session prompt

```text
Journey-first rebuild is underway (plan: ~/.claude/plans/resilient-drifting-quail.md). Stage 1 (New
Aim composer, stages/aim/NewAimComposer.tsx) is done, green, and on LOCAL main but NOT pushed — offer
to push. Read docs/handoff.md + the plan. Next up is Stage 2 (Journey visual parity + interactive-
sheet infrastructure): header sub-eyebrow + headMeta, "N turns elsewhere" chip, ambient take-back +
secondary Your-move actions, and a generic interactive sheet (selectable options → enable-gated
confirm via the existing confirmMilestone/runAgent handlers → receipt). Detail Stage 2 before coding.
```
