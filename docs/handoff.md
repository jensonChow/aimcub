# Aimcub Handoff

Last updated: 2026-07-25
Branch: `main`, **PUSHED to origin** (founder authorized each push; destination
jensonChow/aimcub verified; repo still PRIVATE). No unmerged branches.

## What shipped today (all on origin)

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

Full gate green after every batch (build 9/9 · typecheck 17/17 · lint 11/11 ·
purity · desktop 344 tests). Root `Aimcub.app` repacked + boot-smoked after
each batch. Renderer mass after the collapse: ~14.6k non-test LOC, cockpit.css
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
