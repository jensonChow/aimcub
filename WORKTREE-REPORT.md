# core-quality-eval-findings

The instrument-driven loop closing: `examples/eval-moat` found two real `@core` defects on its
first live run; this branch fixes both and puts the benchmark's own checks in the root gate.

## 1. Planning-context relevance leak (`packages/llm/src/planning-context.ts`)

`RELEVANCE_STOPWORDS` now carries the closed-class English function words alongside the existing
Aimcub-generic vocabulary. Closed class is finite and enumerable, which is exactly why a list is the
right instrument there — content vocabulary is not. Two further guards, so list completeness is not
the only defence:

- `isContentToken` requires a match to be carried by a word (`/[a-z]{3,}/`), so a shared bare figure
  ("500", "1.4") cannot admit a row.
- The cross-aim branch states its threshold (`MIN_CROSS_AIM_CONTENT_MATCHES = 1`) at the admission
  site, so the rule is inspectable instead of an implicit consequence of tokenization.

One shared content word still admits a row from another aim — related context keeps flowing; only
grammar stopped counting. Scores of global rows also drop where their old overlap was function
words, which is the same correction.

## 2. Critic punished honest human routing (`packages/core/src/plan-quality.ts`)

- `manual_only_verification` now fires only when the milestone is **not** human-gated. Ownership is
  resolved `routing_override.owner ?? contract.likely_owner ?? "either"`, and human-gated means
  `human` or `mixed` — the same rule `plan-handoff.ts` already uses for `human_handoff`, reused
  rather than re-invented. `either` and a missing contract still fire: absent a declared owner, the
  critic cannot claim the work is human, and the plan already gets `missing_decomposition_contract`.
  The message now names the actionable fix (route it to a person, or produce evidence).
- `duplicate_acceptance_rule` skips manual-only rules. `manual_confirm` has no `match` fields, so
  two human milestones *cannot* be made distinguishable — the warning asked for a change nobody can
  make. Where the repetition is a genuine defect (nothing routed to a person),
  `manual_only_verification` already reports it; owner is deliberately not re-checked here, to avoid
  penalising one defect twice.
- **No existing expected value moved.** All 187 prior `@core` tests passed unchanged: the pinned
  fixtures are agent-routed (`likely_owner: "agent"`) or duplicate a `commit_pattern` rule, so their
  intent is untouched.

## 3. `examples/*` joined the workspace

`pnpm-workspace.yaml` + `examples/eval-moat/package.json` (`@examples/eval-moat`, private, scripts
test/typecheck/lint on the existing configs, `vitest` the only devDependency). It declares **no**
workspace dependencies — it reaches planning code by relative path through `src/core.ts`, which is
what keeps it out of the release graph and keeps the esbuild bundle path working. `.changeset/config.json`
needed no ignore entry: `changeset status` does not list it, before or after adding a changeset.

## Verification

- Full gate green: build 9/9 · test **17/17, 1083 tests** (was 1028: `@core/domain` 187→191,
  `@core/llm` 170→172, new `@examples/eval-moat` 49) · typecheck 17/17 (was 16) · lint 11/11 (was
  10) · purity clean. Second `pnpm build`: `FULL TURBO`, 9/9 cached.
- New regression tests fail against pre-fix code, verified by `git stash push <impl file>`:
  planning-context 2 failed / 7 passed; plan-quality 4 failed / 28 passed (`expected 50 to be 100`
  is finding 2 reproduced exactly). All pass after.
- Benchmark dry run (0 provider calls): **zero** "admitted on function-word overlap alone" rows in
  the report, for all three personas. The four leaked rows are now withheld as
  `unrelated_goal_context` (marketing site, offline-smoke procedure, wholesale mug order, office
  lease); injection drops 8→6 / 8→7 / 8→7 while every genuinely related row survives (SQLite expense
  table, Square checkout, registration procedure, Airtable reconcile, tagged PDF).
- Live re-run not done: no provider key in the environment, and a live run would spend on the
  founder's configured provider. Available on request within the 15-call cap.

## Handoff / out of scope

- `examples/eval-moat/src/context.test.ts` inverted its weak-match expectation deliberately (the
  fixture author asked for exactly that in the comment) and split it: one test asserts the leak
  stays closed for all three personas, one asserts related rows still flow. `weakMatchRows` stays as
  a standing regression guard with its own word list, so it fails independently of the selector's.
- `sample-live-report.md` is left as the record of the run that found both bugs, with a header note
  that it predates the fixes. Regenerating it needs a fresh live run, not an edit.
- Not touched (owned by the integrating session): `docs/handoff.md` and `docs/memory/**` — the
  handoff's "two eval-moat `@core` findings" open thread can now be closed, and the gate totals
  above replace the 1028/16/10 figures recorded there.
- Observation, no action taken: the receipt-scanning persona's "run the offline smoke script before
  tagging" procedure is now withheld. It is correct behaviour (aim-scoped memory, no shared content
  word), but it suggests release-wide procedures should be captured as global context, not
  aim-scoped. Worth a fixture or product note if it recurs.
