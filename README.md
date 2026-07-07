# Aimcub

> A universal **aim-management** layer for the harness era: humans and agents are
> interchangeable tools for reaching a goal, and aimcub is the architecture that
> holds the aim, routes the work, and accrues the **context** + **eval** that make
> the system intelligent.

You set an aim, whether long-term vision or short-term task; the system
decomposes it, ingests real evidence of progress, and judges completion
automatically. As you and your agents work, a durable context forms: your
new-era resume.

**Core positioning**: Aimcub is being built first as a local **Aim OS agent
harness**. Coding agents such as Codex and Claude Code are local runtimes inside
that harness; MCP, GitHub, and CI are evidence/extension channels. The online
product is the multiplayer Aim platform and future Aim Share network. The
desktop app is the fixed local entry for planning, context, provider/model setup,
agent orchestration, evidence, and eval. See [`docs/vision.md`](docs/vision.md)
for the full direction.

## Open-source posture

Aimcub is intended to be open source as a local-first planning and agent
orchestration product. The local desktop loop and shared `@core` packages should
remain usable, inspectable, and hackable without relying on a closed hosted
service.

The brand boundary is: **open-source local Aim OS agent harness, online Aim
platform**. The local product should own planning, local agent management,
provider configuration, context capture, evidence, and eval transparency. The
online product should own multi-user collaboration, cross-device sync, team
permissions, managed infrastructure, and the future Aim Share platform.
The alpha contract for the local open-source loop is defined in
[`docs/local-alpha.md`](docs/local-alpha.md).

Hosted Supabase-backed surfaces can add networked value, but the core
aim/context/eval architecture should stay transparent. License choice is
intentionally TBD before public release.

## Architecture principles

- **The hosted backend's single source of truth = Supabase** (Postgres + Auth + RLS + Realtime + Storage).
- **Evidence is append-only + idempotent**; milestone completion is derived from the evidence stream via `evaluate()`, never written directly.
- **`@core/*` is the single logic source for active surfaces** (pure TS, zero platform dependencies, unit-testable). Each app shell handles only I/O, rendering, and platform bridging.
- Lean-first: a jobs table + pg_cron (not pgmq), linear milestones (not a DAG), a single-table memory (no vectors). Complexity is added back only when a trigger condition demands it.

## Monorepo layout

```
packages/
  core/        @core/domain      Pure TS kernel: evaluate / planMerge / normalizeEvidence / validatePlan
  types/       @core/types       zod domain models (single source of truth)
  db/          @core/db          Supabase migrations + RLS + Edge Functions
  api/         @core/api-client  supabase-js wrapper
  llm/         @core/llm         Claude gateway (model routing + metering) + goal decomposition
  store/       @core/store       local Aim OS store and planning-context persistence
apps/
  desktop/    Electron desktop app           - active local Aim OS harness
  cli/         Node CLI                       - active scriptable/debuggable companion
  mcp/         MCP server (Streamable HTTP)  - active
```

## Live deployment

| Surface | Where | Notes |
|---|---|---|
| MCP server | `https://mcp.aimcub.com` | Cloudflare Workers; OAuth 2.1 resource server (Supabase AS, Path A); RFC 9728 metadata at `/.well-known/oauth-protected-resource` |
| Database | Supabase `gtasruxwmcsxicyujlfu` (us-west-1) | migrations 0001-0013; RLS verified (users cannot forge milestones) |
| Evidence ingest | Edge Functions `ingest` (emitter tokens) + `github-webhook` (HMAC) | both feed the same idempotent `handleIngest` pipeline |
| Judging | Edge Function `jobs-worker`, pg_cron every minute | `claim_jobs` batch -> `evaluate()` -> auto-completion; goal-level evidence fans out across open milestones |
| Passive evidence | GitHub App [Aimcub](https://github.com/apps/aimcub) | push / workflow_run events; secrets in Vault |
| Goal decomposition | Claude Sonnet 4.6 structured output | all-required + nullable schema (the optional-property grammar blowup is real); deterministic local fallback |

## Development

```bash
corepack enable pnpm
pnpm install
pnpm desktop      # fixed local desktop entry
pnpm build        # turbo full build
pnpm test         # workspace test suite
pnpm core:purity  # verify core has zero platform dependencies
```

Desktop-specific commands should be launched from the repo root:

```bash
pnpm desktop        # run the current Electron desktop app
pnpm desktop:build  # build the current desktop app
pnpm desktop:pack   # produce a local macOS app directory
```

Optional live provider smoke tests:

```bash
# Runs real structured-output requests against selected providers.
# Omit AIMCUB_LIVE_PROVIDERS to require all built-ins:
# anthropic, openai, deepseek, minimax, zai, google, qwen.
AIMCUB_LIVE_PROVIDERS=deepseek,qwen \
DEEPSEEK_API_KEY=... \
QWEN_API_KEY=... \
pnpm test:live-providers
```

Provider-specific model/base URL overrides use
`AIMCUB_LIVE_<PROVIDER>_MODEL` and `AIMCUB_LIVE_<PROVIDER>_BASE_URL`, for
example `AIMCUB_LIVE_DEEPSEEK_MODEL=deepseek-v4-flash`.

## Roadmap (with falsifiable gates)

- **v0** Complete: Foundation: monorepo + `@core` + Supabase evidence spine. DoD = core imported by the active app/evidence surfaces + zero-dependency build passes.
- **v1** Local Aim OS agent harness: Desktop-first aim intake, context gathering, decomposition, routing, local agent runs, evidence, eval, and context inbox. The old v1a/v1b labels are now validation history, not the active roadmap.
- **v2** Online multiplayer Aim platform: reintroduce the hosted app when Supabase parity, sync, teams, permissions, and per-person context routing need a product surface.
- **v3** Aim Share: cross-org aim sharing and a paid network for goals, specialized context, and capability signals. Calendar remains a time-management component throughout.

See [`docs/vision.md`](docs/vision.md) for the full direction,
[`docs/v1-spec.md`](docs/v1-spec.md) for the current local harness plan,
[`docs/local-alpha.md`](docs/local-alpha.md) for the local alpha contract, and
[`docs/memory/README.md`](docs/memory/README.md) for the agent memory map.
