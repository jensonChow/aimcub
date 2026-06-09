# GoalPet

> A general-purpose goal/milestone tracker + evidence ingestion layer, wrapped in an emotional shell of "virtual pet + digital collectibles + proactive companion."
> You work as usual; the pet records every real bit of progress for you, and comes to find you when you slack off.

**Core positioning**: a coding agent (Claude Code, etc.) is just one of many "evidence emitters," reporting in via MCP; git/CI webhooks are another class of emitter. At its core the system is a general-purpose goal tracker, and the developer scenario is simply the first subset to light up.

## Architecture principles

- **The backend's single source of truth = Supabase** (Postgres + Auth + RLS + Realtime + Storage).
- **Evidence is append-only + idempotent**; milestone completion / pets / collectibles are all state derived from the evidence stream.
- **`@core/*` is the single logic source for all four clients** (pure TS, zero platform dependencies, unit-testable). Each app shell handles only I/O, rendering, and platform bridging.
- Lean-first: v1 uses a jobs table + pg_cron (not pgmq), linear milestones (not a DAG), a single-table memory (no vectors), and sprite sheets (not Rive). Complexity is added back only when a trigger condition demands it.

## Monorepo layout

```
packages/
  core/        @core/domain      Pure TS kernel: evaluate / stageForXp / planMerge / normalizeEvidence / validatePlan
  types/       @core/types       zod domain models (single source of truth)
  db/          @core/db          Supabase migrations + RLS
  api/         @core/api-client  supabase-js wrapper
  llm/         @core/llm         Claude gateway (model routing + metering)
  proactive/   @core/proactive   Trigger rules + channel adapter interface
  ui-tokens/   @ui/tokens        design tokens
apps/
  web/         Next.js @ Vercel              — v1 (active)
  mcp/         MCP server (Streamable HTTP)  — v1 (active)
  ios/         Expo RN                       — v2 (placeholder)
  extension/   Chrome MV3                    — v3 (placeholder)
```

## Development

```bash
corepack enable pnpm
pnpm install
pnpm build        # turbo full build
pnpm test         # @core/domain unit tests
pnpm core:purity  # verify core has zero platform dependencies
```

## Roadmap (with falsifiable gates)

- **v0** Foundation: monorepo + `@core` + Supabase schema. DoD = core imported by both web and mcp + zero-dependency build passes.
- **v1a** Validate H1 (frictionless automatic evidence): set a goal on the web → break it down → MCP/GitHub evidence → milestones **light up automatically**. No pets.
- **v1b** Validate H2 (the emotional shell boosts retention): layer on pet growth + collectibles + pet-voiced nudges.
- **v2** iOS + APNs; **v3** Chrome + generalization to arbitrary goals; **v4** monetization (Stripe + iOS IAP).

See `/Users/jenson/.claude/plans/coding-agent-goal-goal-proactive-ios-mc-encapsulated-stonebraker.md` for details.
