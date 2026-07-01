# Aimcub

> A universal **aim-management** layer for the harness era: humans and agents are
> interchangeable tools for reaching a goal, and aimcub is the architecture that
> holds the aim, routes the work, and accrues the **context** + **eval** that make
> the system intelligent.

You set an aim (愿景 = long-term vision, 任务 = short-term task); the system
decomposes it, ingests real evidence of progress, and judges completion
automatically. As you (and your agents) work, a durable context forms — your
"résumé in the new era."

**Core positioning**: a coding agent (Claude Code, etc.) is just one of many
"evidence emitters," reporting in via MCP; git/CI webhooks are another class of
emitter. The MCP server is the human/agent connection point. The developer
scenario is simply the first subset to light up. See [`docs/vision.md`](docs/vision.md)
for the full direction.

## Open-source posture

Aimcub is intended to be open source as a local-first planning and agent
orchestration product. The local desktop loop and shared `@core` packages should
remain usable, inspectable, and hackable without relying on a closed hosted
service.

The brand boundary is: **open local planning architecture, online aim platform**.
The local product should own planning, agent management, provider configuration,
context capture, and eval transparency. The online product should own multi-user
collaboration, cross-device sync, team permissions, managed infrastructure, and
the future aim-sharing platform.

Hosted Supabase-backed surfaces can add networked value, but the core
aim/context/eval architecture should stay transparent. License choice is
intentionally TBD before public release.

## Architecture principles

- **The backend's single source of truth = Supabase** (Postgres + Auth + RLS + Realtime + Storage).
- **Evidence is append-only + idempotent**; milestone completion is derived from the evidence stream via `evaluate()`, never written directly.
- **`@core/*` is the single logic source for all clients** (pure TS, zero platform dependencies, unit-testable). Each app shell handles only I/O, rendering, and platform bridging.
- Lean-first: a jobs table + pg_cron (not pgmq), linear milestones (not a DAG), a single-table memory (no vectors). Complexity is added back only when a trigger condition demands it.

## Monorepo layout

```
packages/
  core/        @core/domain      Pure TS kernel: evaluate / planMerge / normalizeEvidence / validatePlan
  types/       @core/types       zod domain models (single source of truth)
  db/          @core/db          Supabase migrations + RLS + Edge Functions
  api/         @core/api-client  supabase-js wrapper
  llm/         @core/llm         Claude gateway (model routing + metering) + goal decomposition
  ui-tokens/   @ui/tokens        design tokens
apps/
  web/         Next.js @ Vercel              — active
  mcp/         MCP server (Streamable HTTP)  — active
  ios/         Expo RN                       — v2 (placeholder)
  extension/   Chrome MV3                    — v3 (placeholder)
```

## Live deployment

| Surface | Where | Notes |
|---|---|---|
| Web app | [aimcub.com](https://aimcub.com) | Next.js @ Vercel; email+password auth; milestones light up via Realtime |
| MCP server | `https://mcp.aimcub.com` | Cloudflare Workers; OAuth 2.1 resource server (Supabase AS, Path A); RFC 9728 metadata at `/.well-known/oauth-protected-resource` |
| Database | Supabase `gtasruxwmcsxicyujlfu` (us-west-1) | migrations 0001-0011; RLS verified (users cannot forge milestones) |
| Evidence ingest | Edge Functions `ingest` (emitter tokens) + `github-webhook` (HMAC) | both feed the same idempotent `handleIngest` pipeline |
| Judging | Edge Function `jobs-worker`, pg_cron every minute | `claim_jobs` batch → `evaluate()` → auto-completion; goal-level evidence fans out across open milestones |
| Passive evidence | GitHub App [Aimcub](https://github.com/apps/aimcub) | push / workflow_run events; secrets in Vault |
| Goal decomposition | Claude Sonnet 4.6 structured output | all-required + nullable schema (the optional-property grammar blowup is real); deterministic local fallback |

## Development

```bash
corepack enable pnpm
pnpm install
pnpm build        # turbo full build
pnpm test         # @core/domain unit tests
pnpm core:purity  # verify core has zero platform dependencies
```

## Roadmap (with falsifiable gates)

- **v0** ✅ Foundation: monorepo + `@core` + Supabase schema. DoD = core imported by both web and mcp + zero-dependency build passes.
- **v1a** ✅ H1 (frictionless automatic evidence): set a goal on the web → decompose → MCP/GitHub evidence → milestones **light up automatically**.
- **v1b** H2 (the value is context + eval), **go/no-go gate**: completing aims accrues a per-person context + a personalized eval signal worth paying for.
- **v2** team aim-management (per-person context routing); **v3** aim-sharing platform (cross-org — a "paid GitHub for goals"). Calendar is a time-management component throughout.

See [`docs/vision.md`](docs/vision.md) for the full direction and the four pillars (humans-as-agents · memory + eval · context-as-product · personalized eval).
