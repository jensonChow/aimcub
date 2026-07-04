# Aimcub v1 — Local Aim OS Agent Harness

> Status: active direction, 2026-07-04. This supersedes the earlier v1a/v1b
> split as the primary roadmap. The old H1/H2 labels remain useful validation
> history, but the product being built now is the local Aim OS agent harness.

## Product End State

Aimcub has two product layers:

1. **Open-source local Aim OS agent harness.** A local, inspectable runtime that
   holds aims, gathers context, decomposes work, routes sub-aims across humans
   and local agents, records evidence, runs eval, and lets durable context form
   naturally as work happens.
2. **Online Aim platform.** A hosted platform for multiplayer collaboration,
   cross-device sync, team permissions, managed infrastructure, and the future
   Aim Share network where aims and specialized context can move across people
   and organizations.

The current build focus is the first layer: the open-source local Aim OS agent
harness. The hosted product should add networked value without turning the local
harness into a thin client.

## What v1 Is

v1 is a Desktop-first local harness for managing aims with agents:

1. The user enters an aim.
2. Aim OS gathers planning context from memory, selected local files/folders,
   linked source references, optional web research, and user answers.
3. Aim OS decomposes the aim into sub-aims with explicit eval contracts.
4. Aim OS routes each sub-aim to an agent or a human, with the user able to
   override routing.
5. Local agents run through local CLI adapters such as Codex or Claude Code;
   humans get clear proof/approval tasks.
6. Evidence is appended, attributed to runs/assignments, and evaluated through
   the shared `evaluate()` kernel.
7. Completion and progress are derived from evidence and manual confirmation,
   not written as arbitrary checklist state.
8. Useful context and eval signals become reviewable memory candidates and are
   reused in later aims.

The important shift: v1 is not just "web goal -> evidence -> realtime board" and
not just "context/eval after completion." Those pieces are now components inside
the local Aim OS harness.

## What v1 Is Not

- Not a generic task board.
- Not a marketing-first web app.
- Not the multiplayer collaboration platform.
- Not Aim Share.
- Not a cloud-agent runner.
- Not a current hosted web, native iOS, or browser-extension product surface.
- Not MCP as the substrate for local tools. Local read/search/memory/context
  tools are first-party Aimcub runtime tools; MCP remains the external extension
  boundary.

## Relationship To The Old v1a/v1b Split

The earlier split was:

- **v1a / H1: frictionless automatic evidence.** Web aim creation, MCP/GitHub
  evidence, Supabase-backed judging, and Realtime auto-lighting.
- **v1b / H2: context + eval value.** Completing aims should accrue durable
  per-person context and personalized eval signals worth paying for.

That split is no longer the active product roadmap. Treat it as validation
history:

- The H1 evidence spine remains important infrastructure for hosted surfaces:
  Supabase, MCP, GitHub webhooks, idempotent evidence, jobs, and `evaluate()`.
- The H2 context/eval work is no longer a separate later phase. It is a core
  capability of the local Aim OS harness: context intake, context inbox,
  personalized eval signals, and plan quality all shape planning before and
  after execution.

## Local Harness Surface

The local product should own:

- Desktop as the primary orchestration cockpit.
- CLI as the scriptable/debuggable companion surface.
- Local store under the shared AimStore interface.
- Provider/model setup.
- Local agent registry and execution adapters.
- First-party local planning tools for memory, files, linked sources, web
  research, context distillation, and user questions.
- Evidence attribution, eval transparency, run history, and context review.

The first screen should be the working harness, not a landing page or command
wall. Each screen should answer "what should happen next?" for one part of the
aim loop.

## Online Platform Boundary

The online platform should own:

- Identity, sync, and cross-device continuity.
- Team/multiplayer aims.
- Permissions and org-level governance.
- Shared context routing across people and agents.
- Managed infrastructure and hosted agent execution where local execution is not
  enough.
- Aim Share: an aim-first network for sharing goals, specialized context,
  capabilities, and paid/cross-org participation.

Supabase remains the hosted source of truth for the online platform and for the
existing MCP evidence spine. Local Aim OS state starts in the local store and
gets Supabase parity only when the hosted collaboration layer needs it.

## Core Loop

The v1 loop is:

```text
aim intake
  -> gather context
  -> decompose into sub-aims and eval contracts
  -> route to human/agent
  -> execute locally or collect human proof
  -> append evidence
  -> evaluate completion
  -> review context/eval candidates
  -> reuse learned context in the next aim
```

## Data And Runtime Model

The local harness model includes:

- `goals`, `milestones`, `evidence`, and `milestone_completions`.
- `memories` with category and status, including pending/deprioritized rows.
- actors, assignments, runs, run events, tool traces, sub-aim relations,
  evidence attribution, evaluator reports, and context intake sessions.
- an `AimProgressReadModel` that presents the current aim as progress, next
  action, assignments, latest runs, evidence counts, child aims, and context
  candidates.

The hosted Supabase schema already covers the evidence spine. Supabase parity for
the newer local Aim OS orchestration entities is a future online-platform task,
not a blocker for the local v1 harness.

## Evidence And Eval Invariants

- Evidence is append-only and idempotent where an upstream source event exists.
- Completion is derived from evidence through `evaluate()` or explicit manual
  confirmation.
- Low-trust agent self-reporting cannot auto-complete an auto-verifiable
  milestone.
- Agent runs can produce evidence and context candidates, but completion remains
  governed by eval/manual confirmation.
- Context inferred from work starts reviewable; it should not silently become
  active planning memory.

## Current v1 Gates

### Local Harness Alpha

DoD:

- Desktop creates an aim and gathers memory/local/web/user context before
  decomposition.
- The generated plan has sub-aims, acceptance rules, and routing assignments.
- A saved sub-aim can be handed to a local CLI agent or confirmed by a human.
- Runs and manual confirmations append evidence.
- Aim progress is derived into a readable cockpit state.
- Context/eval candidates appear in the inbox and can be accepted, rejected,
  edited, scoped, archived, or deprioritized.

### Local Harness Beta

DoD:

- Local agent execution uses a durable run queue with streamed events.
- Tool/file/artifact events are captured as structured evidence or artifacts.
- Per-agent model/reasoning/workspace choices persist.
- The Desktop cockpit is screen-by-screen product-clean, with debug surfaces
  behind explicit developer mode.
- Local store compaction/export/import are practical enough for real use.
- Context and personalized eval demonstrably improve later decompositions.

### Online Platform

DoD:

- Supabase has parity for the local Aim OS orchestration entities that need sync.
- Teams can share aims, assignments, permissions, and context routing.
- A hosted app can be reintroduced as the online collaboration layer for the
  same Aim OS model.

### Aim Share

DoD:

- Aims, context, and capability signals can be shared across organizational
  boundaries.
- A person's accumulated context can help route valuable work beyond one local
  workspace or one team.

## Deferred From Local v1

- Full cloud-agent execution.
- Cross-org Aim Share.
- Calendar as a complete time-management layer.
- Hosted web, native iOS, and browser-extension product surfaces.
- Heavy memory infrastructure such as vectors, unless a concrete local harness
  trigger proves the lean single-table model is insufficient.
