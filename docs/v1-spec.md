# Aimcub v1 — aim-native, hybrid human/agent orchestration (spec)

> Status: draft, 2026-06-30. Builds on `docs/vision.md`. Scope = phase-1 "smallest-but-
> still-real" cut of the full hybrid-routing vision (model C). English-only per repo rules.

## What v1 is

"Multica, but aim-native and verified." You state an **aim**; Aimcub decomposes it (with a
clarifying-questions step); a **routing brain** auto-assigns each subtask to a linked coding
**agent** or to a **human**; work executes; completion is **derived from real evidence via
`evaluate()`** — proven, not self-claimed.

Differentiators vs Multica:
- Unit is a **verifiable aim** (a goal decomposed into a plan with `acceptance_rule`s), not an issue board.
- **"Done" is eval-derived** from real commit/CI (and, for humans, an explicit confirm) — never agent self-report.

## The flow

1. **Aim** — natural language.
2. **Decompose (with user feedback)** — three sub-steps:
   1. *Investigate & draft* — first-pass plan; expose assumptions + the high-impact forks.
   2. **Ask the user** — present only the few clarifying questions whose answers most change
      the plan, as options-with-hypotheses ("I have some questions for you"); default-and-
      disclose the rest. Also captures involvement / routing preferences. Answers persist as
      aim context (first write toward the memory pillar).
   3. *Refine* — fold answers in → final subtasks, each with an `acceptance_rule`.
3. **Route** — routing brain assigns each subtask → a coding agent or a human.
4. **Execute** — agents run locally via ACP; humans get a task card.
5. **Verify** — `evaluate()` derives completion from evidence (code: commit/CI; human: `manual_confirm`).
6. **Board** — the aim board lights up via Realtime.

## Phase-1 dials (recommended defaults — confirm or adjust)

| dial | v1 default | later |
|---|---|---|
| Execution locus | coding agents via **ACP, local** | cloud-run agents |
| Routing brain | **LLM `classify` (Haiku) + manual override** | learned capability optimizer |
| Agent capability source | **declared at link-time** | learned from history (needs memory) |
| Human "done" | build the reserved **`manual_confirm`** evaluator | `llm_judge` for correctness / non-code |

## Components: reuse vs net-new

| component | status | where |
|---|---|---|
| aim → decompose | **reuse** | `@core/llm` decompose, `apps/web/lib/decompose.ts` |
| acceptance rules + `evaluate()` | **reuse** | `packages/core/src/evaluate.ts` (commit_pattern, ci_status) |
| evidence ingest + jobs/cron judge + Realtime | **reuse** | `packages/db` edge fns, MCP, webhooks |
| **clarifying-questions step** | net-new | new: question generator (reuse `classify`) + web Q&A surface + persistence |
| **agent registry** | net-new | link different agents + a capability descriptor each |
| **actor model** | net-new | each subtask carries an assignee (agent or human) |
| **routing brain** | net-new | decide assignee per subtask |
| **execution / dispatch** | net-new | local ACP client for agents; task card for humans |
| **aim board UI** | net-new | humans + agents side by side; auto-lighting |
| **`manual_confirm` evaluator** | first slice implemented | `evaluate()` matches trusted `manual_check` evidence |

## Data model additions (sketch)

- `agents` — registry: `id, owner_id, kind (claude_code|codex|opencode|...), capabilities[], connection_ref, revoked_at`.
- milestone gains assignment: `assignee_type (agent|human), assignee_id, assignment_status`.
- `aim_intake` — the readiness report + elicitation Q&A (which context is present/missing,
  questions/options, the user's answers); also the first source rows for the `memories`
  table (kind = user_stated).
- `memories.category` — the lean typed context signal used by planning:
  `preference | constraint | capability | eval_signal | project_fact | procedure`.
- `memories.status = pending` — context candidates extracted from evidence before the user accepts or rejects them.
- Reuse unchanged: `goals`, `milestones` (+ `acceptance_rule`, `xp_reward`), `evidence`, `milestone_completions`.

## Decompose-with-elicitation (detail)

Reuses `@core/llm` decompose for the draft and final plan; new is the middle step:
- A **question generator** turns the draft's exposed assumptions/forks into a small set of
  option-questions (route via the existing `classify` LlmTask → Haiku). Rule: ask only what
  most changes the plan; default-and-disclose the rest; options are concrete hypotheses with
  trade-offs; always allow free-text.
- A **web Q&A surface** between "create goal" and "show milestones" (small form/cards).
- **Persistence**: answers stored on the aim and written to `memories` (user_stated) — the
  first concrete memory-write, so the system asks less over time.
- Decompose's final pass takes the answers as input → sharper subtasks + acceptance rules.

## Context-aware decomposition

Aimcub decomposition is not generic task breakdown. It is **verified path finding**:
turn a fuzzy aim into milestones whose completion can be proven by evidence, while using
the user's accumulated context to avoid repeated questions and to shape the path.

The first local slice is:
- saved `memories` are readable as planning context;
- `decompose` and `clarify` receive relevant active memories in their prompts; planning
  context is selected deterministically by confidence, category, goal scope, and textual
  relevance instead of blindly taking the newest rows;
- global memories can shape future aims; goal-scoped memories from a previous aim only
  carry forward when they are relevant to the new aim, while the current aim's own memories
  stay available during replanning;
- planning context selection emits a trace with selected and ignored rows, including score,
  reason, scope, and matched tokens; saved aims persist this under
  `goals.metadata.planning_context` so eval can inspect whether context was useful,
  stale, low-confidence, unrelated, or merely over the selection limit;
- planning context traces drive context health review: repeatedly ignored, unrelated, or
  low-confidence memories become review/deprioritization/archive candidates before they
  pollute future decompositions;
- context health actions are explicit user operations: archive marks a memory deleted,
  while deprioritize preserves it as `deprioritized` so it stops feeding default planning
  without erasing history;
- clarify answers write dimension-aware `user_stated` memories: question kind still shapes
  the default category, while `verifiability`/`distinctness` answers become `eval_signal`
  context and `granularity` answers become `constraint` context unless a more specific
  capability/constraint kind applies;
- clarify performs a deterministic context pass after the model returns questions: if a
  question is already answered by high-confidence, category-compatible context, it becomes
  a disclosed assumption instead of another prompt to the user;
- when the user saves a clarified aim, disclosed planning assumptions become pending
  `project_fact` context candidates scoped to that aim; assumptions that merely restate
  already-known context are skipped;
- evidence can propose pending context candidates from explicit payload fields
  (`memory`, `context`, `project_fact`, `preference`, `constraint`, `capability`,
  `procedure`, `eval_signal`)
  and from manual confirmation signals;
- the CLI exposes `memories`, `context`, and `context review/accept/reject` so the user can
  audit what the system remembers before inferred context affects future decomposition.
- the CLI default entry is onboarding/cockpit, not a full command reference: first run guides
  setup, configured runs show compact aim/context status and next actions, while full help
  stays behind explicit help commands.
- the Desktop home surface exposes a context inbox for pending candidates, where the user
  can edit, accept, or reject inferred context before it becomes active planning input.
- accepting a pending context candidate is scope-aware: the store keeps the candidate's
  current scope unless the client/user explicitly sends a global promotion.
- accepting a pending context candidate is a user confirmation signal: unless the client
  supplies an explicit confidence, the accepted memory becomes high-confidence planning
  input, and duplicate active context is strengthened rather than losing the confirmation.
- prompt-like candidates generated from context gaps must be edited into actual answers
  before acceptance; the system must not promote "pending answer needed" or "confirm
  whether..." placeholders into active planning memory.
- clients should surface prompt-like context candidates as edit-required and prevent direct
  accept while the placeholder wording is still present; the store enforces the same guard.
- clients should recommend a scope before acceptance: `preference`, `constraint`,
  `capability`, and `eval_signal` default toward global reuse; `project_fact` and
  `procedure` default toward the current aim unless the user promotes them.

The decomposition loop should follow this product rule:
- Use existing context when it answers a preference, constraint, capability, environment,
  or standard.
- Interpret context by category:
  - `constraint` = hard limits that shape milestones, dependencies, and acceptance rules;
  - `preference` = scope, quality bar, interaction style, and default assumptions;
  - `capability` = routing and ownership hints for humans/agents;
  - `eval_signal` = what this user considers "done", used to sharpen acceptance rules;
  - `procedure` = proven workflows and verification steps;
  - `project_fact` = concrete environment/tooling facts.
- Ask only questions with high value-of-information: answers that would change milestones,
  acceptance rules, routing, quality bar, timeline, or scope.
- Default-and-disclose low-impact unknowns as assumptions instead of making the user fill forms.
- Extract new memories as a side effect of work, not through a profile editor; inferred context
  starts pending and needs user confirmation before it becomes active planning context.

## Plan quality loop

Decomposition is not complete just because the LLM returned valid JSON. Aimcub runs a
deterministic critique pass over the plan:
- `validatePlan()` checks graph shape and structural invariants.
- `critiquePlan()` scores decomposition quality against context usage and verifiability.
- `PlanQualityReport.dimensions` summarizes the scorecard across `verifiability`,
  `granularity`, `distinctness`, and `context_fit`, so clients can explain why a plan is
  weak instead of only showing a flat score.

The first quality slice is intentionally simple and pure:
- warn when high-impact active context (`constraint`, `procedure`, `eval_signal`) is not
  visibly reflected in the plan;
- warn when high-confidence `eval_signal` context appears only in prose and is not reflected
  in `acceptance_rule`s, because personalized eval must shape what counts as complete;
- produce a `plan_review` report that separates active context into applied, unapplied, and
  low-confidence ignored groups before the user accepts the decomposition;
- report missing high-value context gaps, especially `eval_signal`, so clients can collect
  the minimum context that would change decomposition or acceptance rules;
- make context gaps quality-aware: granularity issues ask which outcomes should be separate,
  distinctness issues ask what evidence uniquely proves each milestone, and verifiability
  issues ask for workflows/commands/artifacts that can prove completion;
- feed the draft plan's scorecard + context gaps into the clarify step, so high-value
  questions can improve the plan before save instead of only creating post-save inbox work;
- attach an optional `source_dimension` to clarify questions (`verifiability`,
  `granularity`, `distinctness`, `context_fit`) so clients can explain why the question is
  worth asking and which decomposition weakness the answer should improve;
- when clarify answers are saved, persist `clarify_answer_impact` metadata that links each
  answer to the derived memory, quality-dimension delta, and likely affected milestones;
  this is evidence for whether a question improved decomposition rather than a vanity form
  field;
- summarize historical `clarify_answer_impact` into clarify-learning guidance, and feed it
  into future clarify prompts as a tie-breaker so Aimcub asks more of the question types
  that actually improved plans for this user/org;
- expose clarify-learning in clients (`context learning` in CLI and a Desktop home panel)
  so users can see what Aimcub has learned about which questions improve decomposition;
- attach deterministic `why_asked` annotations to each clarify question from current review
  gaps, quality dimensions, and historical learning, then surface those reasons in CLI and
  Desktop question UIs;
- expose a context profile/readiness report by category (`eval_signal`, `procedure`,
  `capability`, etc.) so the product can show which parts of the user's context are strong,
  thin, or missing before asking more questions;
- derive an aim-specific `reviewAimIntake()` report that combines the aim text, selected
  planning context, profile coverage, and optional draft `plan_review` into a readiness
  score, targeted context questions, missing core context, and next actions;
- expose the intake report in the CLI (`aimcub intake`) and attach it to plan/new/clarify
  outputs plus saved aim metadata, so decomposition decisions keep their context trail;
- feed aim intake readiness into the clarify prompt, and annotate clarify questions whose
  value comes from intake gaps with `why_asked: aim_intake`;
- derive an aim-learning summary from saved metadata and pending context candidates, so a
  saved aim can show what context was learned, what is pending review, and which gaps remain;
- turn high/medium-priority context gaps into pending context candidates after save, so the
  user can edit/confirm the missing eval or constraint signal in the normal context inbox;
- derive machine-readable `plan_review.actions` such as `fix_quality_errors`,
  `refine_with_unapplied_context`, and `accept_plan`; actions may carry a `refinePrompt`
  that clients can feed back into the planner instead of relying on ad hoc UI text;
- when review finds unapplied high-impact context, write pending context candidates (not
  active memories) so the user can confirm whether the context should shape this aim or is
  stale/irrelevant;
- after a Desktop save, pending candidates flow into the same context inbox instead of
  staying as an invisible count;
- fail rules that let any trusted commit satisfy a milestone (`commit_pattern` with no
  filters);
- warn on broad commit patterns and manual-only verification;
- warn when a milestone is estimated as `xl`, because oversized milestones hide decomposition
  decisions and should usually be split into smaller verifiable milestones;
- warn when a milestone bundles multiple independent deliverables, because each milestone
  should have one clear outcome, its own `acceptance_rule`, and distinct evidence;
- warn when a verification-only milestone, such as a `ci_status` node, is not linked after
  the implementation milestone it verifies;
- warn when multiple milestones share the exact same `acceptance_rule`, because one evidence
  event could complete several milestones at once;
- warn when different milestones can be completed by the same auto-verifiable evidence
  filter, even if their full `acceptance_rule`s are not byte-identical;
- feed actionable quality issues back into one automatic decomposition retry; keep the retry
  only when its quality is better or equal to the first valid plan;
- retry prompts should include the scorecard dimensions and fix order, so the planner fixes
  verifiability before optimizing granularity, distinctness, or context fit;
- retry prompts should reuse `plan_review.actions[].refinePrompt`, so personalized eval
  warnings tell the planner to convert `eval_signal` into evidence-backed
  `acceptance_rule` details instead of merely restating the warning;
- surface the report in CLI text/JSON and persist `plan_quality` + `plan_review` in
  `goals.metadata` for saved aims so Web/Desktop/CLI-created plans have the same quality
  and context-usage signal for later review and eval;
- let Desktop trigger a review-driven refine pass before saving when the top action carries a
  `refinePrompt`.

## Routing brain (v1)

`classify` (Haiku) decides per subtask: **agent-doable vs needs-human**, and (if multiple
agents) **which agent** by declared capability. Output is advisory — the user can **override**
any assignment on the board. Transparent, not a black-box optimizer. The intake answers about
involvement/autonomy bias the routing.

## Execution

- **Agents**: a local **ACP** client drives linked coding agents (Claude Code / Codex /
  OpenCode) — same protocol Multica started on; data/agents stay on the user's machine.
- **Humans**: a task card surfaces the assigned subtask + its acceptance criteria.

## Per-actor done-verification

- **Coding agent** → existing `commit_pattern` / `ci_status` evaluators (self-reported MCP
  evidence stays trust-capped at 0.6; only HMAC-verified GitHub/CI ≥ 0.8 lights a milestone).
- **Human** → build the reserved **`manual_confirm`** evaluator (a trusted explicit confirm).
- Completion stays **derived state**, recomputable from the evidence stream — never written directly.

## Deferred (explicitly not in v1)

`llm_judge` correctness / non-code verification; learned agent-capability model; cloud-run
agents; team / aim-sharing; calendar; a native iOS surface for this (web first — the
just-scaffolded `apps/ios` is a separate track).

## Open dials to confirm

The four in "Phase-1 dials" above. Once locked, the next artifact is the change list
(interfaces + migrations + which files) and an implementation order.
