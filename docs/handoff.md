# Aimcub Handoff

Last updated: 2026-07-25 (second session)
Branch: `main` (delete-click fix merged locally, **NOT pushed** — push needs
founder authorization). Everything before it is on origin (e6d7df78).

## Second session part 4: card-in-card flattened

Founder (new tarot-aim drive): "too many layers I think. could be simplified."
The live/failed/landed session states rendered a chromed white Panel inside the
already-carded Journey planning island (the question state was already plain) —
desk gradient → island → white panel → field, four layers. All session states
are now `variant="plain"`: gradient → island → field, with the composer as the
only bordered element. Verified visually in the harness; desktop 351 (+1 test
pinning the plain variant). Doctrine: design-system.md "One card per moment —
never card-in-card" with the explicit layer budget.

## Second session part 3: planning surfaces simplified + integrated

Founder (screenshots of the live re-drive): "screen 1 could be optimized, not
simple enough / the elements are not integrated smoothly". Shipped:

1. **Live card** — the mid-research chat is now ONE integrated composer (the
   bordered container is the field, quiet Send inside it, one line at rest,
   Enter sends); the junk "Using tool" line is gone (unknown runtime tool ids
   render the generic "Researching…" line, never an interpolated id); controls
   stay quiet and tight under the composer.
2. **Question card** — a lone question no longer shows "Question 1/1"; the
   single/multi pill only appears when options exist; an options-less question
   labels its field "Your answer" (not "Add a custom answer / Write a different
   answer"); a session answer submits as **"Send answer"** (the funnel's
   "Generate plan" promised the wrong thing mid-research); the footer slab is
   transparent so the card reads as one surface.

Both states VERIFIED VISUALLY by mounting the real renderer in a browser with
a stubbed bridge (start planning → live card; parked free-text question →
question card). Desktop tests 350 (+5 markup tests pinning all of the above).
Doctrine extended in design-system.md ("elements integrate; questions dress
for their actual shape"). Note for later: renderer-side session re-attach after
navigation looks gated off (`planningShellId` is only set on start/create, and
`openGoal` clears it), worth a dedicated look.

## Second session part 2: planning research grounded, questions recalibrated

Founder (driving the collapsed surface): "研究不贴切，选择题总是只有一道" — research
felt generic and every session asked exactly one question. Two shipped answers:

1. **Honest domain** — every aim was silently stamped `domain: "software"` (store
   creation default + prompt fallbacks), so the London-trip aim was presented to
   the brain as a software goal. Now: `Goal.domain`/`DecompositionOutput.domain`
   are nullable, creation never invents a domain, plan landing writes the brain's
   `submit_plan.domain` back to the goal (the only writer), session start passes
   the stored domain, prompts render "not set — infer it" when unknown, and the
   store normalizes the legacy default to null on plan-less shells at load.
   Doctrine in `docs/memory/architecture.md`.
2. **Question economy recalibrated** — the mission prompt now sorts unknowns by
   where the answer lives: world facts = research (never ask), personal facts
   (dates, budget, companions, taste) = ask, never guess; personal-life aims get
   a sanctioned 2-4 question opening set; "low-impact → assumptions" no longer
   swallows plan-shaping personal facts. One-question-at-a-time blocking and the
   6-question budget stay. (The one-per-popup mechanic itself is the ask_user
   contract — a multi-question form would be a contract change, deliberately not
   done.)

Tests: llm 197 (+2 prompt doctrine), store 99 (+3 domain lifecycle), decompose
default-domain test rewritten. Full gate green; root `Aimcub.app` repacked +
boot-smoked (founder must restart the app).

## Second session part 1: Delete aim actually works now

Founder drove Delete aim live and it silently did nothing (menu stayed open,
focus ring on the item). Root cause was CSS, not the delete pipeline:
`.od-aim-card:active { transform: scale(0.99) }` — pressing inside the popover
bubbles `:active` to the row card, the transform instantly creates a stacking
context that traps the z-900 popover under the NEXT sibling row, the sibling
steals the pointerup, and the item's click never fires (rows 1..n-1 all broken;
store was never touched). Fix in `cockpit.css`: the card's pressed-scale is
gated off while its menu is open (`:not(:has(.od-content-entry-more
[aria-expanded="true"]))`), and the in-sidebar confirm card width is capped to
the island (`min(216px, calc(var(--sidebar-content-width) - 20px))` — it used
to clip at the island's left edge). Regression test in App.test.tsx (desktop
now 345). Verified end-to-end by mounting the real renderer in a browser with a
stubbed bridge and clicking through: menu → confirm → deleteGoal → row gone.
Doctrine recorded in design-system.md ("pressed-scale never goes on a container
that hosts an open popover").

## What shipped earlier today (all on origin)

1. **The UI collapse ("agent + plan")** — founder: the UI was still too
   complicated. The Journey is now the ONE work surface per aim: header → one
   live-lane card → the plan band (sub-aim rows expanding in place to run
   consent/proof/receipts) → inline candidate review → journal disclosure.
   Stations, station sheets, Turns, the standalone Context/Plan/Run/Eval pages,
   Cmd+1..5, and the last funnel-era save path are deleted (451 i18n keys,
   ~1,400 CSS lines). The durable model + what must not come back:
   `docs/memory/design-system.md` and `docs/memory/desktop.md`.
2. **Planning-lane clarity** — founder: the live card was "not clear enough"
   (raw "brain started"/"tool" on screen). Now: main emits structured activity
   only; the renderer speaks localized agent voice and drops the unsayable
   (`planningActivityLine`). Doctrine recorded in design-system.md ("status
   streams: main emits structure, the renderer owns every displayed word").
3. **Delete aim** — founder: "should add a delete or archive action." Sidebar
   aim rows: hover-revealed More Actions → menu-gated Delete with inline
   confirm; main cancels the aim's planning session before the store cascade.
   Delete over archive was deliberate (no archive view = data black hole);
   archive-with-restore is the designed follow-up.

## Verification

Full gate green after every batch, the delete-click fix, the domain/question
recalibration, and the surface simplification (build 9/9 · typecheck 17/17 ·
lint 11/11 · purity · desktop 351 · llm 197 · store 99). Root `Aimcub.app`
repacked + boot-smoked after each change (founder must restart the app to get
the fixes). Renderer mass after the collapse: ~14.6k non-test LOC, cockpit.css
6,4xx lines, i18n ~800 keys.

## Open items

1. **Founder drives one real aim end-to-end** on the collapsed surface
   (create → answer → adopt → run/proof → receipts) and flags what still
   feels heavy. Candidate follow-ups only if flagged: Settings pane merge,
   Memory palette entry, renaming `stages/execute|eval` dirs to their new
   roles, archive-with-restore.
2. Founder `claude /login` → first Claude-brain live smoke (Codex path is the
   live-verified one).
3. Settings → Brain effort/reasoning control (proposed follow-up).
4. Online linked-source connectors actually reading content.
5. OSS launch checklist (license → npm org → repo settings → gitleaks →
   public flip) — founder-owned, unchanged.
