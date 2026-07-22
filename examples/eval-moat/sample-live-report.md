<!--
This file is a COMMITTED SAMPLE of the harness output, kept so a reader can see what the
instrument produces without spending a provider call. It is not a claim: it is one run.

Produced by: node run-benchmark.mjs --out <disposable dir> --live
Provider/model: deepseek · deepseek-v4-pro (whatever provider is configured is what runs)
Date: 2026-07-22 · 3 aims × 2 conditions × 1 repetition · 9 provider calls
Regenerate this file from a run's artifacts with: --rerender <run>/results.json

Read the caveats in README.md before quoting any number here. N=1 per cell.

This run PREDATES the two @core fixes it found: the planning-context relevance leak (unrelated-aim
rows admitted on function-word overlap) and the cross-check penalising honest human routing. Both
are fixed, so the context diff and the deterministic cross-check below no longer reproduce — that
is the instrument working, not the sample rotting. It is kept as the record of the run that found
them; regenerating it needs a fresh live run, not an edit.
-->

# Eval-moat benchmark report

> Does accrued context and personalized eval demonstrably improve later decompositions?
> This report is the instrument's raw output. A null or negative result is a valid finding.

## Run

- mode: **live**
- started: 2026-07-22T08:14:57.227Z
- aims: receipt-scanning, pottery-course, impact-report
- seed: `aimcub-eval-moat-1` · repetitions per cell: 1
- provider: deepseek
- model: deepseek-v4-pro
- provider calls made: **9**

## Summary

Live run, 3 blind comparison(s) at 1 repetition(s) per cell: the contexted condition scored higher than bare (+7.67 of 25; 2 win / 1 loss / 0 tie). This is a directional signal from a small sample, not a significance test.

## Context diff (provider-free)

What the contexted store injects into the decomposition prompt that the bare store cannot.

### receipt-scanning

- injected: **8 row(s)** / 1315 chars (bare: 0 row(s) / 0 chars)
- categories: constraint ×2, preference ×2, capability ×1, eval_signal ×1, procedure ×1, project_fact ×1
- withheld from planning: 3 row(s) held back by selection

| scope | category | why selected | context |
| --- | --- | --- | --- |
| global | constraint | global_context_with_goal_overlap (112) | Constraint: The app must keep working with networking fully disabled, and no customer document or image may leave the device — a cloud API is only acceptable behind an explicit local fallback the user opts into. |
| global | constraint | global_context_with_goal_overlap (96) | Constraint: Releases ship as a signed, notarized macOS build through the existing update feed; notarization needs the developer's own Apple credentials and cannot be automated away. |
| global | eval_signal | global_context_with_goal_overlap (90) | Eval signal: A feature counts as done when it produces a correct result on a machine with networking disabled and the test suite covers the failure path, not only the happy path. |
| global | preference | global_context_with_goal_overlap (86) | Preference: Ship one well-tested path rather than a configurable framework; optional code paths in this app have historically shipped untested and regressed. |
| global | capability | global_context_with_goal_overlap (70) | Capability: Solo developer, strong in TypeScript and comfortable in Rust, has never trained or deployed a machine-learning model, and has no budget for a paid API tier. |
| related_goal | preference | related_goal_context (68) | Preference: The marketing site should stay a single static page with no JavaScript framework. |
| related_goal | procedure | related_goal_context (62) | Procedure: Before tagging any release, run the offline smoke script against a disposable data directory with the network off; the two rollbacks both skipped it. |
| related_goal | project_fact | related_goal_context (52) | Project fact: Expense rows live in a local SQLite table with a NOT NULL merchant column, so any importer must produce a merchant value or an explicit unknown sentinel. |

- ⚠ 2 row(s) from another aim were admitted on function-word overlap alone:
  - matched on `the`, `should` · [preference] Preference: The marketing site should stay a single static page with no JavaScript framework.
  - matched on `before`, `the` · [procedure] Procedure: Before tagging any release, run the offline smoke script against a disposable data directory with the network off; the two rollbacks both skipped it.

<details><summary>Withheld rows and why</summary>

- `not_active_context:deprioritized` · [project_fact] Project fact: The app used to ship a Windows build.
- `low_confidence` · [preference] Preference: Prefer a dark theme in the settings pane.
- `not_active_context:pending` · [procedure] Procedure: Answer support email in one batch on Friday afternoons.

</details>

- decomposition learning: 2 more prior aim(s), 3 more completed milestone(s) to learn from
- decomposition strategy: 1 more strategy action(s) derived
- strategy action only in contexted: [high] evidence_pattern: Reuse proven evidence/evaluator pairings such as git_commit via commit_pattern; manual_check via manual_confirm when they fit this aim.

### pottery-course

- injected: **8 row(s)** / 1174 chars (bare: 0 row(s) / 0 chars)
- categories: constraint ×3, capability ×1, eval_signal ×1, preference ×1, procedure ×1, project_fact ×1
- withheld from planning: 1 row(s) held back by selection

| scope | category | why selected | context |
| --- | --- | --- | --- |
| global | constraint | global_context_with_goal_overlap (88) | Constraint: The insurer caps a session at 8 students and voids cover unless every student has signed the liability waiver before touching a wheel. |
| global | constraint | global_context_with_goal_overlap (88) | Constraint: The studio has one kiln; a bisque firing plus cooldown takes about 14 hours, so no two sessions that both need fired work can sit on consecutive days. |
| global | preference | global_context_with_goal_overlap (78) | Preference: Sell to the mailing list of roughly 600 past students first; the owner will not buy social ads and will not make video content. |
| global | eval_signal | global_context_with_goal_overlap (74) | Eval signal: A workshop counts as successful when at least 6 of 8 seats are paid in full a week before it starts and every student leaves with a fired piece. |
| global | capability | global_context_with_goal_overlap (70) | Capability: The owner teaches every session and does all firing; a part-time assistant is available on Saturdays only, and nobody on the team edits video or writes code. |
| related_goal | constraint | related_goal_context (68) | Constraint: The wholesale mug order for the corner cafe ships on the last Friday of each month. |
| related_goal | project_fact | related_goal_context (62) | Project fact: Bookings and deposits run through the studio's existing Square checkout; refunds are manual and the deposit policy must appear on the checkout page. |
| related_goal | procedure | related_goal_context (52) | Procedure: Open registration exactly three weeks ahead with a 50% deposit; opening earlier produced a 40% no-show rate on the last two sessions. |

- ⚠ 1 row(s) from another aim were admitted on function-word overlap alone:
  - matched on `for` · [constraint] Constraint: The wholesale mug order for the corner cafe ships on the last Friday of each month.

<details><summary>Withheld rows and why</summary>

- `not_active_context:pending` · [preference] Preference: Consider raising the open-studio membership price next year.

</details>

- decomposition learning: 2 more prior aim(s), 2 more completed milestone(s) to learn from
- decomposition strategy: 1 more strategy action(s) derived
- strategy action only in contexted: [high] evidence_pattern: Reuse proven evidence/evaluator pairings such as manual_check via manual_confirm when they fit this aim.

### impact-report

- injected: **8 row(s)** / 1235 chars (bare: 0 row(s) / 0 chars)
- categories: constraint ×2, project_fact ×2, capability ×1, eval_signal ×1, preference ×1, procedure ×1
- withheld from planning: 1 row(s) held back by selection

| scope | category | why selected | context |
| --- | --- | --- | --- |
| global | constraint | global_context_with_goal_overlap (104) | Constraint: The board signs off on the draft at its quarterly meeting and only one meeting falls before the funder deadline, so missing that draft date costs a full quarter. |
| global | eval_signal | global_context_with_goal_overlap (98) | Eval signal: A report is done when every number traces to a reconciled source, every quote has a signed release on file, and the tagged PDF passes the funder's screen-reader check. |
| global | constraint | global_context_with_goal_overlap (96) | Constraint: No participant name, photo, or school identifier may be published without a signed release, and releases route through the partner school on a roughly two-week turnaround. |
| global | preference | global_context_with_goal_overlap (86) | Preference: The director wants participant experience carried by direct quotes rather than adjectives, and rejects words like transformative or life-changing in drafts. |
| global | capability | global_context_with_goal_overlap (78) | Capability: One program manager writes and coordinates everything; layout goes to a freelance designer who must be booked about three weeks ahead, and there is no in-house data analyst. |
| related_goal | procedure | related_goal_context (72) | Procedure: Pull program numbers from the Airtable base and reconcile them against the finance export before any writing starts; an unreconciled number reached print once already. |
| related_goal | project_fact | related_goal_context (62) | Project fact: The funder requires an accessible tagged PDF plus a plain-text summary under 500 words. |
| related_goal | project_fact | related_goal_context (52) | Project fact: The office lease renewal decision is due in November. |

- ⚠ 1 row(s) from another aim were admitted on function-word overlap alone:
  - matched on `the` · [project_fact] Project fact: The office lease renewal decision is due in November.

<details><summary>Withheld rows and why</summary>

- `not_active_context:pending` · [capability] Capability: A board member has offered to help with photography.

</details>

- decomposition learning: 2 more prior aim(s), 2 more completed milestone(s) to learn from
- decomposition strategy: 1 more strategy action(s) derived
- strategy action only in contexted: [high] evidence_pattern: Reuse proven evidence/evaluator pairings such as manual_check via manual_confirm when they fit this aim.

## Blind judgement

Rubric: 5 criteria × 5 points = 25 max. The judge saw both plans
labelled A/B in a seeded random order, with the persona's ground truth but no condition labels.

| aim | rep | bare | contexted | delta |
| --- | --- | --- | --- | --- |
| receipt-scanning | 1 | 17 | 15 | -2 |
| pottery-course | 1 | 11 | 22 | +11 |
| impact-report | 1 | 11 | 25 | +14 |

### Per criterion (mean across all judged cells)

| criterion | bare | contexted | delta |
| --- | --- | --- | --- |
| acceptance_specificity | 2.67 | 3.67 | +1.00 |
| persona_fit | 2.00 | 4.67 | +2.67 |
| filler_absence | 3.33 | 4.67 | +1.33 |
| routing_sanity | 2.67 | 3.67 | +1.00 |
| prerequisite_realism | 2.33 | 4.00 | +1.67 |

### Deterministic cross-check (no judge involved)

`critiquePlan` scored against the persona's full ground-truth context — the same yardstick held
to both plans. This number is computed locally and does not depend on the judge model.

Read it with the manual-only column below, not on its own. The scorer penalises
`manual_only_verification` and `duplicate_acceptance_rule`, so a plan that correctly routes
real-world human work — approvals, waivers, sign-offs — loses points for being honest about it.
Where this table and the blind judge disagree, that gap is a finding about the scorer, not proof
that the judge is wrong.

| aim | bare | contexted | delta |
| --- | --- | --- | --- |
| receipt-scanning | 60.0 | 60.0 | 0.0 |
| pottery-course | 30.0 | 0.0 | -30.0 |
| impact-report | 60.0 | 0.0 | -60.0 |

### Plan shape

| aim | condition | rep | milestones | manual-only | owner mix | valid |
| --- | --- | --- | --- | --- | --- | --- |
| receipt-scanning | bare | 1 | 8 | 1 | agent:7 human:1 | yes |
| receipt-scanning | contexted | 1 | 5 | 0 | agent:3 unset:2 | yes |
| pottery-course | bare | 1 | 7 | 3 | human:3 mixed:4 | yes |
| pottery-course | contexted | 1 | 5 | 4 | either:1 human:3 mixed:1 | yes |
| impact-report | bare | 1 | 8 | 2 | agent:5 human:2 mixed:1 | yes |
| impact-report | contexted | 1 | 6 | 6 | either:2 human:3 mixed:1 | yes |

### Judge notes

- **receipt-scanning** (rep 1, A=bare): Plan B better integrates the user's known constraints (offline, SQLite, sentinel) and tech preferences, but suffers from incomplete acceptance criteria and missing ownership in key milestones. Plan A has more complete routing and acceptance but is more generic and less shaped by the user's specific reality.
- **pottery-course** (rep 1, A=contexted): Plan A is tightly aligned with the user's known reality and constraints, while Plan B contradicts fundamental ground truths (user owns a studio, will not buy social ads or make video content, and has a mailing list), making it deeply inconsistent with the persona.
- **impact-report** (rep 1, A=bare): Plan B explicitly incorporates and sequences all known constraints and prerequisites (data reconciliation, release-form lead times, freelance designer booking, board sign-off deadline, banned adjectives) while Plan A treats the project as a generic report-building exercise, ignoring the user's specific procedures, preferences, and external dependencies.

## Re-score this by hand

Every plan and every raw judge response is written next to this report: `plans/` holds the
generated plans, `context/` the exact context block each cell was given, and `judge/` the
prompt, the raw response, and the A/B label map. Re-scoring by hand needs nothing else.

