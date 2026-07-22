# Quickstart

Get from a clone to an explorable, seeded aim in Aimcub Desktop and the CLI —
no API keys, no account, no real agent required. Then see what it takes to
point Aimcub at a real local coding agent.

This walks the same loop the rest of the docs describe:

```text
Aim -> Context -> Plan/contracts -> Execute -> Evidence -> Eval -> Context reuse
```

## Requirements

- Node `>=22.13`
- `pnpm@11.10.0`, enabled via [Corepack](https://nodejs.org/api/corepack.html)

From the repository root:

```bash
corepack enable pnpm
pnpm install
```

`pnpm install` also downloads the Electron runtime used by the desktop app
(well over 100 MB) — the first run takes a minute or two depending on your
connection.

This quickstart only needs the CLI built, not the full monorepo:

```bash
pnpm --filter @aimcub/cli build
```

`@aimcub/*` packages ship as plain TypeScript (`exports` points straight at
`src/index.ts`) — esbuild bundles them from source for the CLI, and Vite does
the same for Desktop in dev mode. Neither needs a separate build step here.
The full `pnpm build && pnpm test && pnpm typecheck && pnpm lint &&
pnpm core:purity` gate matters once you start changing code — see
[`CONTRIBUTING.md`](../CONTRIBUTING.md).

## Five minutes, no provider keys: the local demo loop

Aimcub ships a deterministic, offline seed: one aim, four sub-aims, mixed
human/agent routing, one completed sub-aim with trusted evidence, one
low-trust agent self-report waiting on review, and a pending context
candidate. No LLM provider, no web research, no real local agent is called —
see [`examples/local-alpha/README.md`](../examples/local-alpha/README.md) for
exactly what it contains.

Bundle the seed script, then run it against an isolated data directory —
never your real `~/.aimcub` store:

```bash
pnpm --filter @aimcub/cli exec esbuild ../../examples/local-alpha/seed-local-alpha-demo.ts \
  --bundle --platform=node --format=esm --target=node22 \
  --outfile=~/aimcub-quickstart-seed.mjs

node ~/aimcub-quickstart-seed.mjs --target ~/aimcub-quickstart
```

The second command prints what it created:

```text
Seeded "Dogfood the local alpha open-source loop".
AIMCUB_HOME=/Users/you/aimcub-quickstart
Goal id: 00000000-0000-4000-8000-000000000105
Rows: 1 aim, 4 sub-aims, 2 evidence items, 5 context rows.
```

The seed refuses `~`, `~/.aimcub`, anything under `~/.aimcub`, and filesystem
root by default, so a typo can't wipe real data.

### See it in Desktop

```bash
AIMCUB_HOME=~/aimcub-quickstart pnpm desktop
```

There's no setup wizard and no provider prompt on this path. Desktop finds
the one seeded aim and opens straight into its workspace — the station strip
across the top reads **Aim · Research · Context · Plan · Run · Eval**, and the
header shows **25%** (1 of 4 sub-aims complete). From there:

- **Context** shows the **Context inbox** with the one pending context
  candidate the seed left behind, waiting for accept/reject.
- **Eval** shows why only 1 of 4 is really done: trusted commit-pattern
  evidence closed the first sub-aim, while the fourth carries only a
  low-trust agent self-report that isn't enough to complete it by itself —
  the other two have no evidence yet.

Quit the app when you're done looking around.

### See the same store from the CLI

Desktop and the CLI read and write the same local JSON store, so everything
above is also inspectable headlessly:

```bash
AIMCUB_HOME=~/aimcub-quickstart pnpm --filter @aimcub/cli exec aimcub ls
```

```text
00000000  Dogfood the local alpha open-source loop  (4 milestones · 2026-07-08)
```

```bash
AIMCUB_HOME=~/aimcub-quickstart pnpm --filter @aimcub/cli exec aimcub board 00000000
```

```text
Dogfood the local alpha open-source loop
id: 00000000-0000-4000-8000-000000000105
progress: [#####-------------] 1/4 milestones · 10/50 xp
evidence: 2 events

1. done  Collect useful project context  (+10 xp)
   id: 00000000 · commit_pattern · 1 evidence
   evidence: Trusted commit touching local alpha docs or examples.
2. todo  Build deterministic seed fixture  (+20 xp)
   id: 00000000 · commit_pattern
   evidence: Trusted commit touching the store seed fixture.
3. todo  Review demo narrative with the user  (+10 xp)
   id: 00000000 · manual_confirm
   evidence: Approval note from the user.
4. todo  Review low-trust agent proof  (+10 xp)
   id: 00000000 · commit_pattern · 1 evidence
   evidence: Trusted commit or artifact for the visual QA walkthrough.
```

```bash
AIMCUB_HOME=~/aimcub-quickstart pnpm --filter @aimcub/cli exec aimcub context review
```

```text
00000000  procedure · procedural · agent_inferred · aim 00000000 · recommended aim · 74%
   Procedure: Before presenting local alpha, seed an isolated AIMCUB_HOME and inspect Execute/Eval mixed states.
```

Use the id prefix that `aimcub ls` printed (`00000000` above — yours will
differ) anywhere an `<id>` is expected.

When you're done, the demo directory is disposable:

```bash
rm -rf ~/aimcub-quickstart ~/aimcub-quickstart-seed.mjs
```

## First real run: point Aimcub at a live agent

Everything above is offline. A real run hands one sub-aim to an authenticated
local coding agent CLI — currently Codex or Claude Code — and it does real
work with real network/API usage under your existing local authentication for
that tool.

From here on this is your real `~/.aimcub` store, not the disposable demo
directory above — drop the `AIMCUB_HOME` override. Check what Aimcub can see
on your machine:

```bash
pnpm --filter @aimcub/cli exec aimcub agents
```

```text
Codex CLI: ready · codex-cli 0.142.5
  /path/to/codex
Claude Code: authentication required · 2.1.191 (Claude Code)
  /path/to/claude
```

"ready" means the CLI is installed and already authenticated (`codex login` /
`claude login`, outside Aimcub) — nothing provider-specific to configure in
Aimcub itself. If neither shows "ready", either authenticate one of those
CLIs or run `pnpm --filter @aimcub/cli exec aimcub setup` to configure an API
provider instead.

Once one agent is ready, run one dependency-ready, agent-owned sub-aim on a
saved aim of your own (`pnpm --filter @aimcub/cli exec aimcub new "<title>"`
first if you don't have one — see `aimcub --help` for the full verb list).
Point `--workspace` at an absolute path you're fine with an agent touching —
a scratch checkout, not your real project, until you trust the loop:

```bash
pnpm --filter @aimcub/cli exec aimcub run <id> --workspace ~/some/scratch/workspace --read-only
```

Omit `--milestone` and Aimcub picks the first dependency-ready sub-aim routed
to an agent; add `--milestone <ref>` to choose one, `--agent <id>` to pick
Codex vs. Claude Code, and `--network` only once the task actually needs
outbound access. `--read-only` is the safest first look: the agent can read
the workspace but not write to it.

`aimcub run` persists the run, its streamed events, and the agent's own
evidence — it never marks the sub-aim complete itself. Completion is always
**derived** from evidence by the shared eval kernel, the same one Desktop's
Eval station reads. An agent claiming "done" is just evidence to weigh, not a
verdict.

## Where to go next

- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — environment setup, the full
  verification gate, and contribution conventions.
- [`docs/local-agent-adapters.md`](local-agent-adapters.md) — add support for
  another local agent CLI.
- [`docs/vision.md`](vision.md) — why Aimcub exists and where it's going.
- [`docs/open-source-local-alpha.md`](open-source-local-alpha.md) — the fuller
  contributor guide to the local alpha: package map, local data layout, and
  known limitations.
