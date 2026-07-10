# Open-Source Local Alpha Guide

> Status: onboarding guide, 2026-07-08. This document explains the current
> open-source local alpha for new developers and contributors. It does not expand
> product scope beyond the local alpha contract.

## What Aimcub Is

Aimcub manages aims across humans and agents. The system keeps the aim as the
unit of work, gathers enough context to plan, decomposes the aim into sub-aims
with eval contracts, routes work to a person or local agent, records evidence,
derives completion through eval, and turns useful work signals into reviewable
context for future aims.

The local alpha is the single-user, local-first version of that loop.

## Local Alpha Loop

```text
New Aim
  -> Context intake
  -> Plan/contracts
  -> Human/local-agent routing
  -> Run/manual proof
  -> Evidence append
  -> Eval
  -> Context candidate review
  -> Future reuse
```

Current expectations:

- `packages/core` owns the business rules for evidence, eval, plan review,
  context learning, and completion derivation.
- `packages/store` persists the local loop so Desktop and CLI can share state.
- Desktop is the primary local product surface.
- CLI is the scriptable/debuggable companion.
- Hosted Supabase and MCP remain separate hosted infrastructure.

See [`local-alpha.md`](local-alpha.md) for the alpha contract and
[`v1-spec.md`](v1-spec.md) for active v1 scope.

## Package Map

| Path | Local alpha role |
| --- | --- |
| `packages/types` | Shared Zod schemas and TypeScript types for goals, milestones, evidence, memory, assignments, runs, context, and read models. |
| `packages/core` | Pure TypeScript domain kernel. Completion is derived by `evaluate()` and related core logic, not written directly by app shells. |
| `packages/store` | Local JSON-file AimStore plus provider, web, and context-source settings. It is path-injected and shared by Desktop and CLI. |
| `packages/llm` | Provider catalog, LLM gateways, decomposition, planning-context selection, context distillation, and first-party local planning tool contracts. |
| `packages/local-agent` | Shared Codex/Claude CLI discovery, permission mapping, event normalization, execution, and local-CLI planning fallback for Desktop and CLI. |
| `packages/api` | Supabase API client layer for hosted evidence/platform surfaces. It is outside the local store-first path. |
| `apps/desktop` | Electron local harness. It performs platform I/O, rendering, IPC, local-agent detection/execution, and settings UI around the core/store loop. |
| `apps/cli` | Headless local companion for setup, planning, saved aims, evidence, context review, import/export, and diagnostics over the shared store. |
| `apps/mcp` | Hosted Streamable HTTP MCP server for external evidence reporting and goal status. It is the external extension boundary, not the substrate for built-in local planning tools. |
| `packages/db` | Hosted Supabase migrations, RLS, Edge Functions, and hosted evidence/judging infrastructure for MCP and the future online platform. |

## Desktop Role

Desktop is the main local alpha surface. It should help a contributor understand
the full aim loop without opening a hosted app:

- start or reopen an aim
- collect context from memory, local sources, optional multi-lane web research,
  and adaptive one-question-at-a-time user exploration
- review plan/contracts before saving work
- route sub-aims to humans or local CLI agents
- run a selected local agent or collect manual proof
- review evidence, eval status, and context candidates
- keep provider setup, local-agent setup, web research, and context sources in
  Settings instead of the default workbench

The Desktop shell/sidebar/window-chrome framework is protected project surface.
Do not change it for local-alpha documentation work.

## CLI Role

The CLI is the developer-friendly companion over the same store. It can:

- configure provider settings with `aimcub setup`
- inspect resolved config and data paths with `aimcub config`
- create or inspect aims with `aimcub new`, `aimcub ls`, `aimcub show`, and
  `aimcub board`
- append proof with `aimcub confirm` or `aimcub evidence add`
- review and edit context with `aimcub context ...` and `aimcub memories ...`
- detect authenticated local runtimes with `aimcub agents`
- execute one dependency-ready agent-owned sub-aim with
  `aimcub run <id> --workspace <absolute-path>`; use `--milestone` to choose a
  specific sub-aim and `--network` only when that execution needs network access
- import or export the local store

The CLI does not replace Desktop as the primary product surface for v1.

## Local Data And Privacy

The local data directory is selected by `packages/store`:

```text
$AIMCUB_HOME if set, otherwise ~/.aimcub
```

Files under that directory include:

- `store.json` for local aims, milestones, evidence, memory, assignments, runs,
  tool traces, context intake sessions, and read-model inputs
- `settings.json` for LLM provider configuration
- `web-settings.json` for first-party web research settings
- `context-sources.json` for local paths and online source references

Use `AIMCUB_HOME` for isolated development and demos:

```bash
AIMCUB_HOME=/tmp/aimcub-local-alpha pnpm --filter @app/cli exec aimcub config
```

Privacy expectations for the local alpha:

- Local store data stays on the machine unless a user runs code or configures a
  provider that sends selected content to an external service.
- Provider keys belong in environment variables or local settings files, never in
  committed repo content.
- Local file paths and context-source references can be sensitive. Treat them as
  local user data.
- Hosted MCP/Supabase data is a separate hosted path, not the default local alpha
  store.

## Providers And Local Agents

Planning can use a configured provider or an authenticated local CLI agent,
depending on what is available. The provider catalog currently includes
Anthropic, OpenAI, DeepSeek, MiniMax, Z.ai, Google Gemini, Qwen/DashScope, and a
custom OpenAI-compatible endpoint.

Local CLI agents are optional execution runtimes. Desktop detects configured
local tools such as Codex and Claude Code through the same shared adapter used by
the CLI. Planning can fall back to an authenticated local runtime when no API
provider is configured. When web research is enabled and relevant, Desktop
prefers configured Brave search and otherwise can use an authenticated local CLI
for a bounded live-search corpus; unavailable or unauthenticated providers remain
explicit research gaps.

`aimcub run` persists the orchestration Run, normalized stream events, and
attributed low-trust evidence for one ready sub-aim. It does not mark the sub-aim
complete; the shared eval kernel derives completion from evidence.

## Deterministic Demo Seed

The repository includes a provider-free deterministic local-alpha seed at
[`../examples/local-alpha/README.md`](../examples/local-alpha/README.md). It
creates a disposable local store that exercises the intended Desktop loop:
context-ready state, Plan/Contracts with routed sub-aims, Execute selected-work
states, Eval trust states, and pending/accepted context rows.

Build the seed script and run it against an isolated directory:

```bash
pnpm --filter @app/cli exec esbuild ../../examples/local-alpha/seed-local-alpha-demo.ts --bundle --platform=node --format=esm --target=node22 --outfile=/tmp/aimcub-local-alpha-demo-seed.mjs
node /tmp/aimcub-local-alpha-demo-seed.mjs --target /tmp/aimcub-local-alpha-demo
```

The seed refuses `~`, `~/.aimcub`, paths under `~/.aimcub`, and filesystem root
by default. Launch Desktop with the same isolated store:

```bash
AIMCUB_HOME=/tmp/aimcub-local-alpha-demo pnpm desktop
```

## Known Limitations

- Each `aimcub run` invocation handles one ready agent-owned sub-aim. There is no
  daemon or until-blocked loop, and durable queueing, retries, scheduling, and
  structured artifact capture remain future work even though normalized events
  and low-trust result evidence are persisted.
- Local store persistence is JSON-file based and single-user. Concurrent Desktop
  and CLI writes are a known limitation.
- Context and personalized eval are present, but the visible proof that they
  improve later decompositions is still an active v1 gate.
- Supabase parity for newer local Aim OS orchestration entities is future online
  platform work.
- Public release readiness still needs a license decision, `CONTRIBUTING.md`,
  `SECURITY.md`, and a secrets/env audit.

## Non-Goals

The local alpha does not include:

- sync
- hosted multiplayer
- teams and org permissions
- Aim Share
- iOS
- browser extension
- hosted web product surface
- cloud agent runner
- vector memory

These may be future platform or memory-infrastructure work, but they should not
be described as current local alpha behavior.

## Contributor Workflow

Start each repo-changing session by reading:

- [`../AGENTS.md`](../AGENTS.md)
- [`handoff.md`](handoff.md)
- [`memory/README.md`](memory/README.md)
- the module memories relevant to the change

Install and verify with the existing root commands:

```bash
corepack enable pnpm
pnpm install
pnpm build
pnpm test
pnpm typecheck
pnpm lint
pnpm core:purity
```

For docs-only changes, `git diff --check` is the minimum whitespace check unless
the session scope asks for the full suite.

Before ending a repo-changing session:

- update [`handoff.md`](handoff.md)
- keep durable rules in `docs/memory/` instead of long handoff notes
- create a focused local commit
- do not commit local data, provider keys, packaged app artifacts, or secrets

Parallel worktrees may opt out of pushing, merging, packaging, or touching the
root `Aimcub.app` when an integration session owns those steps.
