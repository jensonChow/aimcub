# Worktree report — eval-moat benchmark

Branch `claude/eval-moat-benchmark-bec9a0`. New `examples/eval-moat/**`, one changeset, this report.
**No `packages/` or `apps/` file was touched.**

## What landed

An instrument for the v1 beta gate *"context and personalized eval demonstrably improve later
decompositions"*: same aim, two isolated stores, real decomposition, blind judging, honest report.

- **Fixtures** (`src/aims.ts`) — 3 personas: solo desktop-app developer, ceramics studio owner,
  nonprofit program manager. Each has a prior aim planned, worked, and **proven by evidence**
  (completion derived by `evaluate()`, never written), context sedimented the product's way
  (candidate → accept → global promotion), plus rows that should not reach planning: pending,
  deprioritized, low-confidence, and unrelated-aim.
- **Seeding** (`src/seed.ts`) — deterministic ids/clock, snapshot built in a temp dir then imported
  with `replace`, as in `examples/local-alpha`. Both conditions carry the *same* plan-less shell aim
  with identical title/description; only the history behind it differs.
- **Harness** — dry run is the default and never constructs a gateway. Live mode calls the same four
  store-driven selectors the CLI calls, then `decompose`. Every call goes through a budgeted gateway
  with a pre-flight check, because `decompose` is total and would otherwise turn a budget hit into a
  "bad plan". `--rerender results.json` rebuilds the report with no provider call.
- **Rubric + blind judging** — 5 criteria × 5 points with 1/3/5 anchors; seeded A/B order; label map
  persisted *before* the call so a crash still leaves the blind decipherable. The judge sees the
  persona's ground truth (identical for both plans) but never the condition.
- **Report** — the summary line can say "identical", "LOWER", or "the fixture, not the product, is
  the problem". Committed sample: `examples/eval-moat/sample-live-report.md`.

## Decisions

- Judge blind to condition, **not** to truth — "did this plan fit the person" is unjudgeable without
  the person; listed as a limitation in the README.
- Measure `decompose`, not `decomposeWithQuality`: a floor on what ships, and a narrower claim.
- `critiquePlan` against the same ground truth for both plans as a provider-free second opinion.
- No local-CLI gateway fallback in live mode, so cost and model identity stay explicit.

## Findings surfaced (out of scope — flagging, not fixing)

1. **Unrelated-aim context is admitted on function-word overlap.** `selectPlanningMemories` scores
   goal-scoped rows by token overlap, and `RELEVANCE_STOPWORDS`
   (`packages/llm/src/planning-context.ts:61`) omits `the`, `and`, `for`, `should`, `before`. All
   three fixtures had an unrelated aim's context selected purely on those (`the`+`should`, `for`,
   `the`). The harness flags such rows (`weakMatches`) so noise is counted, not celebrated as "more
   context". Fix belongs in `@core/llm`.
2. **The deterministic scorer punishes honestly human-routed plans.** `critiquePlan` raises
   `manual_only_verification` per human milestone and `duplicate_acceptance_rule` for repeated
   `manual_confirm` clauses. In the live run the contexted plans for the studio and nonprofit
   personas — correctly full of waivers, kiln windows, board sign-off — scored 0/100 while the blind
   judge preferred them (+11, +14). Real-world human work cannot produce commit evidence.
3. `examples/` is not a workspace package, so nothing under it runs in `pnpm test`/`lint`/
   `typecheck`. The example ships its own `vitest.config.ts` + `tsconfig.json` and documents both
   commands, but this stays unenforced until `examples/*` joins `pnpm-workspace.yaml`.

## Verification

Full gate on this branch, uncached (`--force`): build 9/9 · test 16/16 (**1031 tests**) ·
typecheck 16/16 · lint 10/10 · `core:purity` clean.

Example's own checks (not in the root graph): `pnpm --filter @core/store exec vitest run --root
../../examples/eval-moat` → **48 passed** (byte-identical seeding, empty bare condition, non-empty
context diff, withheld rows excluded, weak-match detection, seeded blind labelling, judge-output
validation, honest negative reporting, and the whole live path against a mock gateway including the
budget abort). `tsc -p examples/eval-moat/tsconfig.json` and `eslint examples/eval-moat` clean.

**Dry run**, isolated output dir, no provider contacted (trimmed):

```
Mode: DRY RUN · no provider call will be made.
receipt-scanning  bare: 1 aim, 0 context rows, 0 completions → injects 0 rows
receipt-scanning  contexted: 3 aims, 11 context rows, 3 completions → injects 8 rows
pottery-course    contexted: 3 aims, 9 context rows, 2 completions → injects 8 rows
impact-report     contexted: 3 aims, 9 context rows, 2 completions → injects 8 rows
Provider calls made: 0
```

**Live run** — deepseek / `deepseek-v4-pro` from local `settings.json`, **9 provider calls for the
whole session** (cap 30):

```
| aim              | rep | bare | contexted | delta |  ground-truth critique (bare → contexted)
| receipt-scanning |  1  |  17  |    15     |  -2   |  60 → 60
| pottery-course   |  1  |  11  |    22     |  +11  |  30 →  0
| impact-report    |  1  |  11  |    25     |  +14  |  60 →  0
contexted mean +7.67 of 25 · 2 win / 1 loss / 0 tie · N=1 per cell, directional only
```

Artifacts stayed in a disposable directory; no `~/.aimcub` store was read or written except
`settings.json` for key resolution (never printed, never persisted).

## Handoff

- Findings 1 and 2 need owners in `@core/llm` and `@core/domain`.
- Decide whether `examples/*` joins the pnpm workspace so example tests run in CI.
- Cheapest next experiment: `--live` under a second provider to size judge-model bias.
