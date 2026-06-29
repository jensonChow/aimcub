# Aimcub v1 — aim-native, hybrid human/agent orchestration (spec)

> Status: draft, 2026-06-29. Builds on `docs/vision.md`. Scope = phase-1 "smallest-but-
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
| **`manual_confirm` evaluator** | net-new (small) | reserved in `AcceptanceRule`, currently returns false in `evaluate.ts` |

## Data model additions (sketch)

- `agents` — registry: `id, owner_id, kind (claude_code|codex|opencode|...), capabilities[], connection_ref, revoked_at`.
- milestone gains assignment: `assignee_type (agent|human), assignee_id, assignment_status`.
- `aim_intake` — the elicitation Q&A (questions, options, the user's answers); also the first source rows for the `memories` table (kind = user_stated).
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
