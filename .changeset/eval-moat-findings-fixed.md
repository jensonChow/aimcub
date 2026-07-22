---
"@core/domain": patch
"@core/llm": patch
---

Close the two `@core` defects the eval-moat benchmark found on its first live run, and put the benchmark's own checks in the gate. Planning context no longer admits a memory scoped to an unrelated aim on function-word overlap: closed-class function words are stopwords, a match must be carried by a word rather than a bare figure, and a cross-aim row needs at least one content-word match before it reaches the prompt. `critiquePlan` no longer punishes honest human routing: `manual_only_verification` fires only where machine-checkable evidence was plausibly available and went unused (agent-routed, or work whose owner the plan never declared), and `duplicate_acceptance_rule` skips manual-only rules, which repeat by construction because `manual_confirm` has no fields to differ on. Plans full of waivers, kiln schedules, and board sign-off now score on their merits instead of collecting penalties for being truthful. `examples/*` joined the pnpm workspace as `@examples/eval-moat`, so the benchmark's 49 tests, typecheck, and lint run in the root gate; it declares no workspace dependencies, so it stays out of the release graph.
