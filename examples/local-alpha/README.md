# Local Alpha Demo Seed

This example creates a deterministic local Aimcub store for dogfooding and visual QA of the open-source local loop. It does not call an LLM provider, web research, hosted Supabase, or a real local agent.

## What It Contains

The seeded aim is `Dogfood the local alpha open-source loop`.

It includes:

- useful project context from local alpha docs, memory, and Desktop stage contracts
- four Plan/Contracts sub-aims
- agent-routed and human-routed assignments
- one completed sub-aim with trusted matching evidence
- one agent-routed incomplete sub-aim with no evidence
- one human-routed incomplete sub-aim with no evidence
- one incomplete sub-aim with low-trust agent self-report evidence that needs Eval review
- one pending context candidate
- one accepted aim-scoped eval signal and one active global context constraint

The seed replaces `store.json` in the target directory so repeated runs produce the same visual QA state. Use a disposable directory.

## Seed An Isolated Directory

From the repository root, first bundle the runnable seed script with the existing CLI toolchain:

```bash
pnpm --filter @app/cli exec esbuild ../../examples/local-alpha/seed-local-alpha-demo.ts --bundle --platform=node --format=esm --target=node22 --outfile=/tmp/aimcub-local-alpha-demo-seed.mjs
```

Then seed an isolated directory:

```bash
node /tmp/aimcub-local-alpha-demo-seed.mjs --target /tmp/aimcub-local-alpha-demo
```

You can also use `AIMCUB_HOME` as the explicit target:

```bash
AIMCUB_HOME=/tmp/aimcub-local-alpha-demo node /tmp/aimcub-local-alpha-demo-seed.mjs
```

The script refuses `~`, `~/.aimcub`, paths under `~/.aimcub`, and the filesystem root unless `--force` is provided. Do not use `--force` unless the target is disposable.

## Open Desktop Against The Seed

After seeding, launch Desktop with the same isolated home:

```bash
AIMCUB_HOME=/tmp/aimcub-local-alpha-demo pnpm desktop
```

The app should show the seeded aim in Recent aims. Open it to inspect Context, Plan/Contracts, Execute, and Eval without provider keys or real local-agent execution.
