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
closed service. Keep `@aimcub/*` portable and platform-neutral so contributors can
build new shells, agent adapters, and local workflows without rewriting the aim
logic.

The brand strategy is deliberately split:

- **Open-source local Aim OS agent harness.** Desktop, local storage, provider
  setup, first-party local tools, local agent management, context capture,
  evidence attribution, and eval transparency are the trust anchor.
- **Online Aim platform.** Multi-user collaboration, team routing, cross-device
  sync, permissioned sharing, managed infrastructure, and the future Aim Share
  network require hosted surfaces.

The repository is open source under the MIT License (see `LICENSE`).

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

1. **Local Aim OS agent harness.** You treat yourself as an agent, collaborate
   with local coding/research agents, treat the real world as context, and let
   the system route sub-aims to the right human/agent path. This must be fully
   credible as an open-source local product.
2. **Online multiplayer Aim platform.** Many people + agents; each person has a
   context; aims are shared, synced, permissioned, and dispatched according to
   that context. This is primarily an online product because identity,
   permissions, sync, and team routing are networked concerns.
3. **Aim Share.** Break the boundaries of the organization — everything is
   aim-first. A person with deeply specialized context can be shared across many
   aims. Think a closed, paid GitHub for goals — but mind where GitHub falls
   short: GitHub organizes the **what**, aimcub organizes the **why**. The
   sharing surface has to be why-first, not just another what-tracker.
4. **Context as value.** As a person completes aim after aim in the harness and
   on the platform, their context accretes; the system routes different aims to
   them on the strength of that context, and that generates value.

**Calendar** is a component of all of this: aim management is, at bottom, time
management — the calendar is how you manage the time you spend solving problems.

## What exists today

The hosted evidence spine is already built and live, and the local Aim OS agent
harness is now the active product surface. The old emotional shell was removed.

- **Goals → decomposition → milestones.** A goal is set in natural language and
  decomposed (Claude structured output, deterministic local fallback) into a flat
  `nodes[] + edges[]` plan. `planMerge()` freezes completed milestones across
  replans.
- **Evidence ingestion.** Append-only, idempotent on `(emitter_id, source_event_id)`.
  Emitters: MCP (a coding agent reports work), GitHub/CI webhooks (HMAC-verified).
- **Eval / judging.** `evaluate()` (pure `@aimcub/core` kernel) decides whether evidence
  satisfies a milestone's `acceptance_rule`; trusted evidence auto-completes the
  milestone (anti-spoofing trust floor). Milestone completion is **derived state**,
  recomputable from the evidence stream — never written directly.
- **Memory.** A single `memories` table (no vectors yet) — the substrate for the
  memory pillar. The local store already supports active, pending,
  deprioritized, and deleted memories with typed categories.
- **Local Aim OS model.** The local store now carries actors, assignments, runs,
  run events, tool traces, sub-aim relations, evidence attribution, context
  intake sessions, and an Aim progress read model.
- **First-party planning tools.** Local memory, file/context, linked-source, web
  research, context distillation, and user-question tools are Aimcub runtime
  tools, not MCP primitives.
- **Local CLI agent harness.** Desktop and CLI share Codex/Claude discovery,
  permission mapping, event normalization, and execution adapters. Desktop can
  use an authenticated local runtime for planning and relevant web-research
  fallback; `aimcub run` executes one ready agent-owned sub-aim, records
  low-trust evidence, and keeps completion governed by eval/manual confirmation.
- **MCP server.** The human/agent connection point: OAuth 2.1 resource server,
  `report_evidence` / `goal_status` / `list_milestones`. This is central, not
  peripheral — it is how agents plug into an aim.
- **Supabase hosted spine.** Supabase is the source of truth for hosted web/MCP
  evidence surfaces; jobs + pg_cron run the judge there. Supabase parity for the
  newer local Aim OS orchestration entities comes with the online platform.

## Removed in the pivot (the abandoned "emotional shell")

Digital **pet** (growth / stages / XP-as-gamification), **collectibles** (badge /
trophy minting), **celebrations**, the proactive **companion** nudges, and the
pet-voice **persona**. Migration `0011` dropped the `pets` / `collectibles` /
`notifications` tables, the `rarity` / `minted_collectible_id` columns, and the
`upsert_pet_monotonic` RPC. The numeric `xp_reward` / `awarded_xp` weight was
**kept**, reframed as a neutral effort/contribution signal that feeds progress and
will feed eval weighting — it is no longer "pet XP".

## What's next

The current build is the local Aim OS agent harness. The next work is:

- **Local run loop**: replace one-shot local agent execution with a durable queue,
  streamed run events, structured artifacts, retries, and clear user control.
- **Context + personalized eval**: make accepted context and eval signals visibly
  improve later decomposition and acceptance rules.
- **Desktop product clarity**: keep the default cockpit focused on the aim loop;
  put debug traces behind explicit developer mode.
- **Hosted parity when needed**: add Supabase schema/API parity for local Aim OS
  entities when sync, teams, or hosted collaboration require it.
- **Online platform**: team/multiplayer aims, cross-device sync, permissions,
  managed infrastructure, and Aim Share.
- **Calendar**: time-management surface over aims.

See `docs/v1-spec.md` for the active local harness plan.
