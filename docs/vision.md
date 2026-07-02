# Aimcub — Vision

> Source of truth for the product direction. Distilled from the founder's notes
> "愿景、终局", "aim management、context、产品形态", and "AI-Native、Aim组织、why不是what"
> (Notion). Supersedes the earlier "GoalPet" plan (digital pet + collectibles +
> proactive companion), which has been abandoned.

## The thesis

In the harness era the wall between *people* and *agents* should come down. Both
are just tools — paths and processes — for reaching a goal. What matters is not
who or what executes, but the **management of the aim**: the long-term aim is a
**vision** (愿景), the short-term aim is a **task** (任务). People and agents are
the instruments; the aim is the thing.

An organization, then, is simply a collective of people + agents assembled around
an aim. To connect them you need an architecture. **That architecture is aimcub.**

## Open-source posture

Aimcub should be open source as a local-first planning and agent-management
product. This is not just distribution; it is part of the trust model. Users
should be able to inspect how aims are decomposed, how context accrues, how eval
signals are derived, how provider keys are handled, and how agents connect.

The hosted Supabase-backed product can add sync, teams, sharing, and managed
infrastructure, but the local desktop loop must not become a thin client to a
closed service. Keep `@core/*` portable and platform-neutral so contributors can
build new shells, agent adapters, and local workflows without rewriting the aim
logic.

The brand strategy is deliberately split:

- **Open local planning architecture.** Desktop, local storage, provider setup,
  agent management, context capture, and eval transparency are the trust anchor.
- **Online aim platform.** Multi-user collaboration, team routing, cross-device
  sync, permissioned sharing, managed agent infrastructure, and the future
  aim-sharing network require hosted surfaces.

The license is intentionally undecided until the business/community boundary is
explicit.

## The AI-Native test

The honest question to keep asking: *would aimcub still make sense without AI?*
If the answer feels like "yes, more or less," that's a warning — it means the
design is leaning on a pre-AI crutch and isn't truly AI-Native; it means we're
being too optimistic with ourselves. Aimcub's reason to exist is itself an AI
fact: agents have, almost overnight, empowered a huge mass of individuals. The
open problem is how that suddenly-enlarged crowd — people **and** agents — can
contribute value together: how you organize them and point them in a direction.
Aimcub answers by organizing them **around the Aim**. Take the AI away and the
problem disappears, and so does aimcub. That is the bar every feature has to
clear.

## The four pillars

1. **Humans are agents too.** The system manages aims, not avatars. It auto-judges
   the boundary of each agent — part of the work goes to a person, part to an
   agent — and treats the real world as context.

2. **Memory + Eval are the core.** Aim management cannot be hand-maintained the way
   it was before AI — too slow. It must be AI-centric: creating, dispatching, and
   updating aims. Two things make that work:
   - **Memory** keeps the organization running *stably*.
   - **Eval** keeps it running with *quality*.

3. **Context is the product.** Vertical context is only valuable if it can be
   packaged and sold directly. The sharpest form: each person carries a **context**
   that becomes their *résumé in the new era* — and they never have to maintain it
   deliberately. It forms **naturally** as they work inside aimcub.

4. **Personalized eval.** An eval divorced from context is meaningless. Capability
   shows up as meeting expectations on real tasks; benchmarks can't stand in for
   real application. Every person and every organization should have its **own**
   benchmark — *personalized eval* is the only eval that's worth anything.

## Product forms (staged)

1. **Personal aim management.** You treat yourself as an agent, collaborate with
   other agents, treat the real world as context, and let the system auto-judge the
   human/agent boundary — some work to you, some to the agents. This should be
   fully credible in the open-source local product.
2. **Team aim management.** Many people + agents; each person has a context; aims
   are dispatched and handled according to that context. This is primarily an
   online collaboration product because identity, permissions, sync, and routing
   are networked concerns.
3. **Aim-sharing platform.** Break the boundaries of the organization — everything
   is aim-first. A person with deeply specialized context can be shared across many
   aims. Think a closed, paid GitHub for goals — but mind where GitHub falls short:
   GitHub organizes the **what**, aimcub organizes the **why**. GitHub is a
   last-era product — too coarse, and neither beautiful nor approachable enough in
   its GUI to carry this. The sharing surface has to be why-first, not just another
   what-tracker.
4. **Context as value.** As a person completes aim after aim on the platform, their
   context accretes; the system routes different aims to them on the strength of
   that context, and that generates value.

**Calendar** is a component of all of this: aim management is, at bottom, time
management — the calendar is how you manage the time you spend solving problems.

## What exists today (the spine that survived the pivot)

The aim-management spine is already built and live; only the old emotional shell
was removed.

- **Goals → decomposition → milestones.** A goal is set in natural language and
  decomposed (Claude structured output, deterministic local fallback) into a flat
  `nodes[] + edges[]` plan. `planMerge()` freezes completed milestones across
  replans.
- **Evidence ingestion.** Append-only, idempotent on `(emitter_id, source_event_id)`.
  Emitters: MCP (a coding agent reports work), GitHub/CI webhooks (HMAC-verified).
- **Eval / judging.** `evaluate()` (pure `@core` kernel) decides whether evidence
  satisfies a milestone's `acceptance_rule`; trusted evidence auto-completes the
  milestone (anti-spoofing trust floor). Milestone completion is **derived state**,
  recomputable from the evidence stream — never written directly.
- **Memory.** A single `memories` table (no vectors yet) — the substrate for the
  memory pillar. `extract_memory` is the reserved job type that will populate it.
- **MCP server.** The human/agent connection point: OAuth 2.1 resource server,
  `report_evidence` / `goal_status` / `list_milestones`. This is central, not
  peripheral — it is how agents plug into an aim.
- **Supabase** is the single source of truth; jobs + pg_cron run the judge.

## Removed in the pivot (the abandoned "emotional shell")

Digital **pet** (growth / stages / XP-as-gamification), **collectibles** (badge /
trophy minting), **celebrations**, the proactive **companion** nudges, and the
pet-voice **persona**. Migration `0011` dropped the `pets` / `collectibles` /
`notifications` tables, the `rarity` / `minted_collectible_id` columns, and the
`upsert_pet_monotonic` RPC. The numeric `xp_reward` / `awarded_xp` weight was
**kept**, reframed as a neutral effort/contribution signal that feeds progress and
will feed eval weighting — it is no longer "pet XP".

## What's next (to design, not yet built)

The four pillars point at the work that isn't here yet, in roughly this order:

- **Context**: accrue a durable, per-person context from the evidence + completion
  stream — the "résumé" that forms by working.
- **Personalized eval**: turn that context into a per-person/per-org benchmark
  rather than a generic one.
- **Human/agent routing**: auto-judge which slices of an aim go to a person vs. an
  agent, and dispatch accordingly.
- **Calendar**: time-management surface over aims.
- **Team / sharing**: multi-actor aims; context shared across organizational lines.

These are deliberately left open here — this document fixes the *direction*, not
the detailed build plan.
