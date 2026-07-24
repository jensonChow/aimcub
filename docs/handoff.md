# Aimcub Handoff

Last updated: 2026-07-22
Branch: `main`. **OSS-maturity epic: all four engineering batches AND the
`@aimcub/*` rename are MERGED, verified, and PUSHED** (founder authorized
2026-07-22; destination verified as `jensonChow/aimcub`, ADMIN, before
pushing — the repo itself is still PRIVATE). No unmerged branches remain.
What remains is the founder-owned launch checklist below.

## Batch 4 + rename — integrated

1. `e5758dde` **community-scaffolding** — `docs/roadmap.md` (gate-by-gate,
   every claim code-verified), `docs/good-first-contributions.md` (7 items),
   adapter-proposal issue template.
2. `8d96be61` **cockpit-cli-loose-ends** — PlanningDebugPanel remounted in
   ContextStage behind developer mode (its plumbing was live all along);
   stranded widened-run affordance (re-grant claims the recorded consent by
   id; cancel-queued needed a real fix through the drain's own atomic gate);
   `--jsonl` streams artifacts; queue requests carry a `surface` marker
   (desktop/cli) shown in the timeline and logged at startup.
3. `26097df8` **core-quality-eval-findings** — both benchmark findings fixed:
   planning-context closed-class stopwords + content-token guard (the four
   leaked rows are withheld; related rows survive); the critic no longer
   penalizes human-gated milestones for manual verification (ownership rule
   reused from plan-handoff) nor undifferentiable duplicate `manual_confirm`
   rules. 6 new regression tests fail pre-fix. `examples/eval-moat` joined
   the workspace — its 49 tests/typecheck/lint are in the root gate.
4. `cfa5d1e1` **rename** — `@core/*` + `@app/*` → `@aimcub/*` (names only;
   dirs, `private`, publish-blocking unchanged; `@core/domain` → 
   `@aimcub/core`). Purity guard survived by directory glob; the
   escaped-regex `@core\/` in `verify-bundled-core.mjs` was caught (it would
   have silently no-opped the bundle-leak check). The rename ran parallel to
   batch 4 from the same base, so integration reconciled it: 4 conflicts
   resolved (batch-4 behavior under new names) and the map re-applied to
   batch-4-born files (strandedRun.*, three changesets, the new docs).
   `docs/memory/**` re-pointed at integration.

## Verification (integration round)

- Full gate green on final `main`: build 9/9 · typecheck 17/17 · lint 11/11 ·
  purity clean · **1108 tests** under `@aimcub/*` names (desktop 361,
  core 191, llm 172, cli 106, store 95, mcp 57, eval-moat 49, db 36,
  local-agent 21, api 20). Lockfile validated with a frozen install
  post-merge.
- Straggler sweep: zero `@core/`/`@app/` references outside git history.
- Repacked + refreshed root `Aimcub.app`; boot smoke clean; eval-moat dry
  run deterministic from the renamed tree; real `~/.aimcub` untouched.

## The epic is code-complete. Founder-owned launch checklist

Ordered — each unblocks the next:

1. **Decide the license** (unblocks everything outward).
2. Add the LICENSE file + register the **`@aimcub` npm org** (the rename made
   publish a `private: false` flip + `changeset publish`; see
   `docs/releasing.md`).
3. GitHub repo settings: fix the stale "GoalPet" description, enable
   Discussions + private vulnerability reporting; set the CODE_OF_CONDUCT
   enforcement contact.
4. Run a full-history gitleaks/trufflehog scan (targeted sweep in batch 1
   found zero; this is the belt-and-suspenders pass).
5. ~~Authorize the push~~ (done 2026-07-22 — `main` is on origin); **flip the
   repo public** when 1–4 are done.
6. Tag `v0.1.0` (release.yml drafts the GitHub Release with CLI bundle +
   unsigned dmg/zip).
7. Apple signing credentials + notarization (`notarize:check` diagnoses env;
   re-verify the 2-entitlement set under a real signed launch).
8. Post-publish distribution: `npx @aimcub/cli` validation, Homebrew formula.

## Standing follow-ups (non-blocking, tracked in docs/good-first-contributions.md and here)

- Second-provider eval-moat live run (judge-bias sizing); more personas.
- Store on-disk schema version (design proposal welcomed).
- Bare `@core` strings inside six test fixtures' sample prose — deliberate,
  cosmetic only.
- "Learn more" in the consent control becomes a real link once a public repo
  URL exists.

## Next session

If branches return again, the pattern is unchanged (reports → merge → gate →
repack → smoke → docs). Otherwise: execute the launch checklist top-down with
the founder; the first two items are decisions only they can make.
