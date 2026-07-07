# Aimcub

Aimcub is an aim-management layer for coordinating people and agents around an
outcome. It holds the aim, gathers context, decomposes work, routes sub-aims to
humans or agents, records evidence, derives progress through eval, and lets
useful context become reusable memory.

The current project is the open-source local Aim OS agent harness. It is a local
alpha, not the hosted multiplayer platform.

## Local Alpha

The local alpha is the inspectable single-user loop that runs on one machine:

```text
Aim -> Context -> Plan/contracts -> Execute -> Evidence -> Eval -> Context reuse
```

Today this means:

- Desktop is the primary local product surface for aim intake, context review,
  provider/local-agent setup, execution handoff, evidence, eval, and context
  inbox review.
- CLI is the scriptable and debuggable companion over the same local store.
- `@core/*` packages own the domain logic. App shells perform I/O, rendering,
  and platform bridging.
- Local state is local-store first. By default it lives under `~/.aimcub`; use
  `AIMCUB_HOME` to isolate a development or demo store.
- Provider APIs and local CLI agents are optional helpers for planning and
  execution. The local alpha should remain understandable without treating any
  hosted service as required product state.

See [`docs/open-source-local-alpha.md`](docs/open-source-local-alpha.md) for the
developer/contributor guide and [`docs/local-alpha.md`](docs/local-alpha.md) for
the narrower alpha contract. For a provider-free deterministic walkthrough, see
[`examples/local-alpha/README.md`](examples/local-alpha/README.md).

## Not In The Local Alpha

These are future hosted or later-platform concerns, not local-alpha promises:

- sync and cross-device continuity
- hosted multiplayer, teams, permissions, and org governance
- Aim Share
- iOS, browser extension, and hosted web product surfaces
- cloud agent runner
- vector memory

Supabase remains the hosted source of truth for the existing MCP evidence spine
and the future online platform. It is intentionally separate from the local
store-first alpha path.

## Where To Start

For product direction:

- [`docs/vision.md`](docs/vision.md) explains the long-term product thesis.
- [`docs/v1-spec.md`](docs/v1-spec.md) explains the active local harness scope.
- [`docs/local-alpha.md`](docs/local-alpha.md) defines the local alpha contract.

For contributor context:

- [`AGENTS.md`](AGENTS.md) is the root project contract.
- [`docs/handoff.md`](docs/handoff.md) is the latest session transfer.
- [`docs/memory/README.md`](docs/memory/README.md) maps durable module memory.
- [`docs/open-source-local-alpha.md`](docs/open-source-local-alpha.md) gives the
  local alpha onboarding path.

## Architecture Map

| Path | Role |
| --- | --- |
| `packages/types` | Zod domain models and shared TypeScript types. |
| `packages/core` | Pure domain kernel: eval, plan merge, evidence normalization, planning reviews, and aim learning. |
| `packages/store` | Local AimStore implementation, provider/settings files, context-source settings, import/export, and `AIMCUB_HOME` data-root handling. |
| `packages/llm` | Provider catalog, LLM gateways, structured decomposition, planning context selection, and first-party tool contracts. |
| `packages/api` | Supabase API client layer for hosted evidence/platform surfaces. Not required for the local store-first loop. |
| `apps/desktop` | Electron local harness. Primary product surface for the local alpha. |
| `apps/cli` | Headless companion for planning, saved aims, evidence, context, setup, config, import/export, and diagnostics. |
| `apps/mcp` | Hosted Streamable HTTP MCP evidence server. External extension boundary, not the local tool substrate. |
| `packages/db` | Hosted Supabase schema, migrations, RLS, Edge Functions, and hosted judging infrastructure. |

## Development

Requirements are declared in [`package.json`](package.json): Node `>=22.13` and
`pnpm@11.10.0`.

```bash
corepack enable pnpm
pnpm install
pnpm build
pnpm test
pnpm typecheck
pnpm lint
pnpm core:purity
```

Desktop-specific commands are run from the repo root:

```bash
pnpm desktop        # run the Electron desktop app
pnpm desktop:build  # build the desktop app
pnpm desktop:pack   # produce a local macOS app directory
```

CLI commands use the shared local store:

```bash
pnpm --filter @app/cli build
AIMCUB_HOME=/tmp/aimcub-local-alpha pnpm --filter @app/cli exec aimcub config
AIMCUB_HOME=/tmp/aimcub-local-alpha pnpm --filter @app/cli exec aimcub new "Ship a small local tool"
AIMCUB_HOME=/tmp/aimcub-local-alpha pnpm --filter @app/cli exec aimcub board <aim-id>
AIMCUB_HOME=/tmp/aimcub-local-alpha pnpm --filter @app/cli exec aimcub context review
```

For isolated local data during development:

```bash
AIMCUB_HOME=/tmp/aimcub-local-alpha pnpm --filter @app/cli exec aimcub config
```

Do not commit secrets. Provider keys are read from environment variables or saved
local settings files under the selected Aimcub data directory.

## Hosted Surfaces

The hosted spine is still part of the repo, but it is not required to understand
or run the local alpha path.

| Surface | Current role |
| --- | --- |
| MCP server | Cloudflare Worker for external agents to report evidence and read goal status. |
| Supabase database | Hosted Postgres/Auth/RLS/Realtime/Storage source of truth for MCP evidence and future platform state. |
| Edge Functions and pg_cron | Hosted evidence ingest and judging jobs. |
| GitHub App | Passive evidence channel for hosted GitHub/CI events. |

## Roadmap Boundary

- v0 is complete: monorepo foundation, `@core` kernel, and Supabase evidence
  spine.
- v1 is current: local Aim OS agent harness with Desktop-first aim intake,
  context, decomposition, routing, evidence, eval, and context reuse.
- v2 is the online multiplayer Aim platform.
- v3 is Aim Share.

License choice is intentionally undecided before public release.
