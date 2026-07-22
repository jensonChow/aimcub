# Local Alpha Demo Seed

This example creates a deterministic local Aimcub store for dogfooding and visual QA of the open-source local loop. It does not call an LLM provider, web research, hosted Supabase, or a real local agent.

For the fastest path from a clone to seeing this running, see [`../../docs/quickstart.md`](../../docs/quickstart.md). For the product contract behind this seed, see [`../../docs/local-alpha.md`](../../docs/local-alpha.md). For contributor onboarding, see [`../../docs/open-source-local-alpha.md`](../../docs/open-source-local-alpha.md).

## What It Contains

The seeded aim is `Dogfood the local alpha open-source loop`: **1 aim, 4
sub-aims (1 already complete), 2 evidence items, and 5 context rows**.

In full:

- useful project context from local alpha docs, memory, and Desktop stage contracts
- four Plan/Contracts sub-aims
- agent-routed and human-routed assignments
- one completed sub-aim with trusted matching evidence
- one agent-routed incomplete sub-aim with no evidence
- one human-routed incomplete sub-aim with no evidence
- one incomplete sub-aim with low-trust agent self-report evidence that needs Eval review
- one pending context candidate
- one accepted aim-scoped eval signal and one active global context constraint

The seed replaces `store.json` in the target directory so repeated runs produce the same visual QA state. Use a disposable directory — never your real `~/.aimcub` store.

## Seed An Isolated Directory

From the repository root, first bundle the runnable seed script with the existing CLI toolchain:

```bash
pnpm --filter @aimcub/cli exec esbuild ../../examples/local-alpha/seed-local-alpha-demo.ts --bundle --platform=node --format=esm --target=node22 --outfile=~/aimcub-quickstart-seed.mjs
```

Then seed an isolated directory:

```bash
node ~/aimcub-quickstart-seed.mjs --target ~/aimcub-quickstart
```

You can also use `AIMCUB_HOME` as the explicit target:

```bash
AIMCUB_HOME=~/aimcub-quickstart node ~/aimcub-quickstart-seed.mjs
```

The script refuses `~`, `~/.aimcub`, paths under `~/.aimcub`, and the filesystem root unless `--force` is provided. Do not use `--force` unless the target is disposable.

## Open Desktop Against The Seed

After seeding, launch Desktop with the same isolated home:

```bash
AIMCUB_HOME=~/aimcub-quickstart pnpm desktop
```

There is no setup wizard on this path. With exactly one saved aim and no
pending drafts, Desktop skips its home screen and opens straight into that
aim's workspace, ready to inspect the Context, Plan, Run, and Eval stations
without provider keys or real local-agent execution.
