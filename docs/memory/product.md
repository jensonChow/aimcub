# Product Memory

## Positioning

Aimcub is an aim-management layer, not a task list, chat shell, or avatar manager. It manages aims across humans and agents, routes work to the best available path, and accrues durable context plus personalized eval from real work.

Aimcub is being built first as an open-source local Aim OS agent harness. The online Aim platform comes later for multiplayer collaboration, sync, teams, permissions, managed infrastructure, and Aim Share. There is no active iOS app, browser extension, or hosted web app in the current workspace.

## Product Pillars

- Humans are agents too: people and software agents are both execution paths toward an aim.
- Memory plus eval are the core: memory keeps the organization stable, eval keeps it correct.
- Context is the product: a person's context should form naturally by working in the system and become their portable capability record.
- Eval must be personalized: general benchmarks do not represent real user or org needs without context.

## Current Roadmap

- v0 is complete: monorepo foundation, `@core` kernel, and Supabase evidence spine.
- v1 is current: local Aim OS agent harness with Desktop-first aim intake, context gathering, decomposition/eval contracts, human/agent routing, local agent runs/manual proof, evidence/eval, and context inbox reuse.
- H1/H2 and the old v1a/v1b split are validation history inside v1, not the active phase split.
- v2 is the online multiplayer Aim platform: sync, teams, permissions, per-person context routing, and managed infrastructure.
- v3 is Aim Share: a cross-org paid network for aims, context, and capability signals.

## Routing Philosophy

Agent routing should be agent-forward. Digital, research, coding, summarization, and network-searchable work should default to agents. Humans should own physical-world actions, authority/approval, secrets/access, taste calls, and final non-delegable decisions.

The product loop is: user enters an aim -> Aim OS collects context -> Aim OS creates sub-aims with eval rules -> each sub-aim is assigned to an agent or human, or decomposed further -> evidence and eval update progress -> useful context returns to memory.

When every sub-aim is complete, the product should show a completion recap instead of another work queue: final outcome, completed sub-aims, passing evidence, eval result, learned memory/context, and how accepted context can shape the next aim.

## Context Behavior

Context collection is a core local harness capability. It should gather enough context to improve decomposition, acceptance rules, routing, and future reuse without becoming a profile editor.

Planning should make context provenance reviewable by default: show what context was used, what was skipped or unread, what permissions/setup blocked access, and what unresolved questions could still change decomposition.

Durable/global context must be separated from aim-local context. Long-lived preferences, constraints, eval signals, and capability facts become memory candidates. Short-lived facts stay scoped to the current aim.

Consumer and life aims need real-world context, not only developer/product assumptions. Planning should ask about domain constraints, distribution, access, budget, timeline, skill, taste, legal/IP, audience, and whether the user wants to learn or delegate.

Choice questions preserve context instead of forcing false certainty. A question is single-select only when its answers are mutually exclusive in the same scope or the plan explicitly needs one primary choice; if any pair can be true together, it is multi-select, and uncertainty defaults to multi-select. Question generation must stay grounded in the Aim and relevant collected context, split broad gaps into atomic decision dimensions, and keep a free-text escape hatch. A later priority question may narrow compatible routes, but the initial discovery question must not discard combinations prematurely.

The context inbox is a review queue for candidate memory/eval/context signals, not the primary debug surface. Candidate text should be editable before acceptance, and the UI must show whether acceptance stores global durable context or current-aim context.
