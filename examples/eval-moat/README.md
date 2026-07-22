# Eval-moat benchmark

The v1 beta gate says: *"Context and personalized eval demonstrably improve later
decompositions."* This directory is the instrument for that sentence — the thing that can prove it
or falsify it.

Same aim, two conditions:

- **bare** — a first-run store: the aim, nothing else. A fair newcomer, not a sabotaged one.
- **contexted** — the same aim, behind a history: prior aims that were planned, worked, and proven
  by evidence, with the context those aims left behind.

Both conditions are decomposed by the real pipeline, the two plans are judged blind against a fixed
rubric, and the difference is reported. **A null or negative result is a valid finding and the
project wants to know it.** The harness is built so it can say "no difference" or "context made it
worse" without any code change — the summary line has both sentences in it.

For the product claim behind this, see [`../../docs/vision.md`](../../docs/vision.md) and the Local
Harness Beta gate in [`../../docs/v1-spec.md`](../../docs/v1-spec.md).

## What it proves — and what it does not

Proves (to the strength of its sample size):

- whether accrued context changes what the planner *injects* (provider-free, deterministic), and
- whether the resulting single-shot decomposition is better *for that specific person*, as scored
  blind against a fixed rubric.

Does **not** prove:

- that the full aim loop works. This measures one decomposition, not execution, evidence, `evaluate()`,
  or context sedimentation over time.
- anything statistically significant at the default `N=1` per cell. Three aims and one repetition is
  a directional signal. Use `--repeat` and read the spread, not the mean.
- that a better score means a better outcome. The rubric is a proxy, chosen and committed in
  [`src/rubric.ts`](src/rubric.ts) so you can disagree with it in a reviewable way.
- anything about a judge's own bias. The judge is one model scoring text; it sees the persona's
  ground truth, so it can reward alignment with facts a bare plan never had. That is the claim under
  test, not a flaw — but it means the judge is not a neutral observer of "plan quality in general".

## Run it

Bundle the runner with the existing CLI toolchain (same pattern as
[`../local-alpha`](../local-alpha/README.md)):

```bash
pnpm --filter @aimcub/cli exec esbuild ../../examples/eval-moat/run-benchmark.ts --bundle --platform=node --format=esm --target=node22 --outfile=/tmp/eval-moat.mjs
```

### Dry run (default — no provider, no key, no cost)

```bash
node /tmp/eval-moat.mjs --out /tmp/eval-moat-dry
```

Seeds both conditions into isolated store directories and reports the **context diff**: every row
the contexted store injects that the bare store cannot, why the selector chose it, and every row it
held back. No provider is contacted; `createGateway` is never called.

### Live run (real decompositions + blind judging)

```bash
node /tmp/eval-moat.mjs --out /tmp/eval-moat-live --live
```

Uses whatever provider `aimcub` itself would use — `AIMCUB_API_KEY` / `ANTHROPIC_API_KEY` / … from
the environment, else the `settings.json` written by `aimcub setup`. Key resolution is literally
[`apps/cli/src/config.ts`](../../apps/cli/src/config.ts); this harness has no key handling of its
own and never prints or persists a key.

Useful flags: `--repeat <n>`, `--aims <ids>`, `--seed <string>`, `--max-calls <n>`, `--rerender
<results.json>`, `--help`.

### Cost

`aims × 2 conditions × repetitions` decomposition calls, plus one judging call per aim and
repetition — the default is **9 calls** (3 aims × 2 + 3). The estimate is printed before anything is
spent, and `--max-calls` is a hard ceiling: the run aborts rather than exceeding it. In the sample
run each decomposition cost ~2.9k input tokens bare and ~3.7k contexted, with ~2.2–3.8k output;
judging carries two full plans on top. On a mid-priced model the whole default run is cents.

## What comes out

Everything lands in `--out` (nothing is committed by a run):

```
eval-moat-report.md   the report: summary, context diff, scores, cross-check
results.json          the whole run as data — re-render the report from it with --rerender
stores/<aim>/<cond>/  the seeded store for each cell, an isolated AIMCUB_HOME
context/              the exact context block each cell was given + the selection trace
plans/                every generated plan
judge/                the judge prompt, the raw response, and the A/B label map
```

[`sample-live-report.md`](sample-live-report.md) is a committed sample so you can see the output
without spending anything. It is one run of `N=1` — read it as a shape, not as a result.

## How the judging works

- **Fixed rubric**, five criteria × 5 points, anchors at 1/3/5: acceptance specificity, fit to this
  person's reality, absence of filler, routing sanity, prerequisite realism. Changing the rubric
  changes the instrument, so change it in its own commit.
- **Blind**: the judge sees plans labelled A and B, ordered by a seeded RNG
  (`--seed`), and is never told which store produced which. The label map is written to `judge/`
  *before* the call, so a crash still leaves the blind decipherable and a human can re-score by hand.
- **Not blind to truth**: the judge is given the persona's real constraints — the same set for both
  plans — because "did this plan fit the person it was for" cannot be judged without knowing the
  person. The prompt explicitly protects the bare condition: asking a good open question is not a
  defect, and more milestones is not better.
- **A deterministic cross-check** runs alongside it: `critiquePlan` from `@aimcub/core`, scored for
  both plans against the *same* ground-truth context. It needs no judge model — but see below.

### What this benchmark has already found

Two real `@core` defects, both surfaced by the first live run and both now fixed:

1. **Planning-context relevance leak.** Context scoped to a completely unrelated aim was selected
   into planning on function-word overlap alone (`the` + `should`, `for`, `the`) — reproduced on all
   three personas. `selectPlanningMemories` now treats closed-class function words as stopwords and
   requires at least one content-word match before a cross-aim row is admitted. The detector stays
   in [`src/context.ts`](src/context.ts) as a standing regression guard with its own word list.
2. **The cross-check punished honest human routing.** `critiquePlan` raised
   `manual_only_verification` on every human-owned milestone and `duplicate_acceptance_rule` on
   repeated `manual_confirm` clauses, so the contexted plans for the two non-technical personas —
   correctly full of waivers, kiln schedules, and board sign-off — scored 0/100 while the blind
   judge preferred them (+11, +14). Those rules now fire only where machine-checkable evidence was
   plausibly available and went unused.

The sample report below predates both fixes; it is kept as the record of the run that found them.
Where the deterministic table and the blind judge still disagree, **treat the gap as a finding about
the scorer, not as proof that either is wrong.**

## Adding an aim or a persona

Append a `BenchmarkAim` to `BENCHMARK_AIMS` in [`src/aims.ts`](src/aims.ts). The rules that keep the
result meaningful are in the file header; the short version:

1. The aim title and description must be what a user would actually type, and identical across
   conditions. Nothing about the persona's constraints may leak into them.
2. Context must be the residue of prior work, not instructions for the plan under test. No fixture
   row may name a milestone, a step count, or a structure the planner should reproduce.
3. Include context that should *not* reach the plan — a pending candidate, a deprioritized row, a
   weakly-inferred row, context scoped to an unrelated aim. Whether selection holds it back is a
   result, not an assumption.
4. Prior aims are completed the product's way: evidence is appended and completion is derived by
   `evaluate()`. Never write a completion directly.

Then re-run the dry run and read the context diff before spending anything on a live run.

## Tests

This directory is the workspace package `@examples/eval-moat`, so its tests, typecheck, and lint run
in the root gate (`pnpm test`, `pnpm typecheck`, `pnpm lint`) like any other package. Run them alone
with:

```bash
pnpm --filter @examples/eval-moat test
```

They cover the parts that must not rot: seeding is byte-deterministic, the bare condition really is
empty, the context diff is non-empty and excludes withheld rows, no row from another aim is admitted
on function-word overlap alone, blind labelling is seeded and reproducible, judge output is validated
rather than silently zero-scored, the report renders a negative result honestly, and the whole live
path runs against a mock gateway — same orchestration, same budget guard, no key and no network.

The package depends on nothing in the workspace: it reaches the planning code by relative path
through [`src/core.ts`](src/core.ts), which is what keeps the benchmark out of the release graph and
keeps the esbuild bundle above working for anyone who just wants to run it.

## Honest limitations

- `N=1` per cell by default; no significance testing anywhere.
- One judge model, one rubric author. Judge-model bias is unmeasured — running `--live` under two
  different providers and comparing would be the cheapest next check.
- Three personas. Enough to avoid one-aim luck, not enough to generalise.
- The contexted condition also gets richer decomposition-learning and strategy inputs, not only
  context rows. The report separates those channels in the diff, but a live score difference cannot
  be attributed to context rows alone.
- Single-shot `decompose` is measured, not `decomposeWithQuality`: no critique-and-retry loop, so
  the numbers are a floor on what the product ships.
- The local-CLI planning fallback (Codex/Claude Code as the gateway) is deliberately not wired in;
  live mode requires a provider key so cost and model identity stay explicit.
