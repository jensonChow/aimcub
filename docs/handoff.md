# Aimcub Handoff

Last updated: 2026-07-11
Branch: `main` (Glass stages 0/A/B/C/D/E previously merged + pushed; origin/main == `c23255ef`).
This session's polish work is **committed and merged to `main` locally, not yet pushed** — see
Commit status.

## Current Session — Aimcub Glass UI/UX polish pass

Re-imported the `Aimcub Glass.dc.html` reference from the founder's claude.ai/design project
(DesignSync) and did a focused **polish pass** on the already-shipped Glass desktop UI. Confirmed
the shipped CSS is highly faithful to the reference; the gains are in states, a11y, i18n, contrast,
and one real layout bug. Verification was done against a faithful static harness of `cockpit.css`
(scratchpad) screenshotted in both themes at 1180×820 / 960×680 / 640×520, plus a 5-lens adversarial
audit workflow (19 candidates → 13 verified; 6 false positives dropped).

Changes (all in `apps/desktop/src/renderer`, plus design-system docs):

1. **Unsafe-centering clip [HIGH, layout].** `.od-workspace-aim` centered with `align-content:
   center`; a tall Journey / populated Home had its title + station strip + Your-move heading pushed
   above the scroll pane and **unreachable** (verified 263px clipped, scrollTop clamps to 0 at
   640×520). Fixed to `align-content: safe center`.
2. **Journey width [layout].** `.od-journey` declared 820px but the 760px reading-rail parent capped
   it; added `.od-workspace-aim:has(> .od-journey) { width: min(100%, 820px) }` so it gets its rail.
3. **WCAG AA contrast [HIGH/MED].** Founder chose "fix for AA" over exact reference-palette fidelity
   ([[aimcub-glass-contrast-aa]]). `--faint` #8a8a91→#61616a (light) / #84848f→#9b9ba5 (dark), light
   `--acc` #0071e3→#0064cc, and you/agent chips switched from `--acc` text to `--ink2` (keeping the
   acc-soft tint). All Glass meta text + chips now clear 4.5:1. `--od-accent` (legacy) untouched.
4. **States/motion.** Added `:active` scale(0.99) to `.od-journey-station` and `.od-home-card`
   (+transform transition); added `transition` to `.od-journey-secondary` and `-sheet-close` hover
   swaps; gave `.od-journey-journal-view` a real ≥24px target + the `--od-focus` ring.
5. **Fidelity/typography.** Not-started ("up") station names now `--mut`; removed positive
   letter-spacing (→0) on the three uppercase eyebrow/tag labels per the "letter-spacing always 0"
   rule.
6. **A11y.** Station strip `role="list"`+`listitem`→`role="group"` + plain buttons (listitem was
   clobbering the button role). Station **sheet** is now a real modal: focus moves to the close
   button on open, Escape closes, focus restores to the opener. Journal "view" buttons got a
   disambiguating `aria-label` (`view · {station}`).
7. **i18n.** Turns relative-time (`now`/`{n}m`/`{n}h`) and station-sheet meta status tokens
   (milestone/run statuses) were raw English — now routed through `t(...)` with new
   `glass.turns.*` + `glass.station.meta.*` keys (en+zh); free-text metas fall through verbatim.

## Verification

- **Full gate green**: `pnpm build && test (246 desktop) && typecheck && lint && core:purity`; build
  re-verified no `@core` leakage. Fixed one stale test expectation (`journey.test.ts` `since:"6m"` →
  the i18n-key stub form) caused by the Turns-time i18n change.
- **Visual QA** via the static `cockpit.css` harness in both themes: Journey (light+dark, move +
  ambient + sheet), Home (first-run + populated), Memory (light+dark), at 1180×820 / 960×680 /
  640×520. Confirmed the clip fix (title/stations reachable at 640×520), the darker/lighter faint
  meta text is legible (esp. Memory provenance, previously 2.6:1), ink2 chips read well, and the
  un-tracked eyebrows and muted "up" station read fine.
- Repacked (`pnpm desktop:pack`) and refreshed the untracked root `Aimcub.app`.
- **Not run**: on-screen Electron / computer-use pass (the harness renders the real `cockpit.css`
  but not the live IPC/data). The sheet focus-management + Escape are wired + typechecked but were
  not exercised in a live keyboard session.

## Commit And Push Status

- Polish work is committed on a focused branch and **merged to local `main`, not pushed**. The
  prior Glass stages (0/A/B/C/D/E, up to `c23255ef`) are what remains on origin/main. Push needs the
  user's authorization (`git push origin main`).

## Open Risks / Notes

- **Bundle-id mismatch** (pre-existing): dist builds `com.aimcub.desktop` while App Store Connect
  records `com.jensonchow.aimcub`. Reconcile before store distribution.
- Dead i18n keys remain (`glass.home.yourMove`, `glass.journey.later`, `glass.journey.receipt`) —
  leftovers from reference affordances the shipped design intentionally simplified (dots-not-
  subtitles, no Later/receipt). Left in place (removal risks parity churn for no user gain).
- Optional follow-up still open: Cmd/Ctrl+K Memory palette entry; a live computer-use pass to
  confirm the sheet keyboard flow and the native titlebar theme-follow.

## Next Session Prompt

```text
The Aimcub Glass UI/UX polish pass is done, green on the full gate, and merged to LOCAL main but
NOT pushed (see docs/handoff.md) — offer to `git push origin main` when the user is ready. Read
docs/handoff.md and docs/memory/design-system.md (Glass + the new AA/contrast, safe-center, and
station/sheet interaction rules). Possible next work: live computer-use QA of the station-sheet
keyboard flow, the Cmd/Ctrl+K Memory palette entry, or the com.aimcub.desktop vs
com.jensonchow.aimcub bundle-id reconciliation.
```
