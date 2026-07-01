# Aimcub Handoff

Last updated: 2026-07-01

## Product Memory

- Aimcub is an aim-management layer, not a task-list shell. The product manages aims across humans and agents, then accrues durable context and personalized eval from real work.
- The current user strongly prefers a CLI that feels like a work cockpit, using Claude Code and Hermes as the benchmark. Multica-style command walls are explicitly rejected.
- The CLI default entry must answer "what can I do next?" rather than "what commands exist?" Bare `aimcub` should be a first-run setup or a compact aim cockpit, never the full manual.
- First-time use must include setup. If provider config is incomplete and the terminal is interactive, `aimcub` should guide into setup; if non-interactive, it should print scriptable setup commands and exit cleanly.
- Keep scriptability: existing commands, JSON output, stdin input, and automation flows must remain stable while the human-facing top layer gets simpler.
- Context collection is the v1b center of gravity. Aim decomposition should gather just enough user context to improve decomposition, acceptance rules, and future reuse without becoming a profile editor.

## Current Implementation State

- Wrap-up branch: `codex-v1b-context-eval-wrapup`.
- The v1b context/eval slice has been consolidated around a shared planning-context workflow in
  `packages/llm/src/context-workflow.ts`. CLI and Desktop now use the same store-port helpers
  for planning context selection, aim intake, clarify/capture/lineage/decomposition learning,
  decomposition strategy, and review/assumption context candidates.
- `packages/llm/src/context-workflow.test.ts` covers the extracted store-port workflow.
- Core v1b modules now cover context profile/health, pending context capture, context lineage,
  aim intake, plan quality, aim learning, and decomposition learning.
- The local store supports active/pending/deprioritized/deleted memories plus scope-aware
  candidate acceptance, rejection, archiving, and deprioritization.
- CLI entry work completed in `apps/cli/src/index.ts`, `apps/cli/src/home.ts`, and `apps/cli/src/home.test.ts`.
- Bare `aimcub` now resolves provider config:
  - incomplete provider config -> first-run setup prelude;
  - interactive terminal -> continues into the existing hidden-key `aimcub setup` wizard;
  - non-interactive terminal -> prints setup commands using `--api-key -`;
  - configured provider -> prints a compact "Aim cockpit" with provider, aim count, pending context count, store path, and next actions.
- `aimcub setup` completion copy now points users at `aimcub new`, `aimcub clarify --save`, and `aimcub help` instead of a one-off `plan` demo.
- `docs/v1-spec.md` should treat CLI onboarding as part of the context/eval product surface, not just help text.
- The broad v1b context/eval work has been committed together after structural cleanup. Future work
  should avoid growing `apps/cli/src/index.ts` and `apps/desktop/src/renderer/App.tsx` further; split
  new command/UI surfaces into focused modules first.

## Verification Notes

- The project declares `pnpm@9.15.0`, but the Codex runtime's bare `pnpm` may resolve to pnpm 11.7.0 and misread the legacy `package.json` `pnpm.overrides` field.
- Use this prefix when running full gates from Codex:
  `PATH=/Users/jenson/.local/node/bin:$PATH corepack pnpm <command>`
- Verified after the v1b wrap-up:
  - `PATH=/Users/jenson/.local/node/bin:$PATH corepack pnpm build`
  - `PATH=/Users/jenson/.local/node/bin:$PATH corepack pnpm test`
  - `PATH=/Users/jenson/.local/node/bin:$PATH corepack pnpm typecheck`
  - `PATH=/Users/jenson/.local/node/bin:$PATH corepack pnpm lint`
  - `PATH=/Users/jenson/.local/node/bin:$PATH corepack pnpm core:purity`
  - `git diff --check`
- CLI smoke checks:
  - `AIMCUB_HOME=/private/tmp/aimcub-cli-smoke-first-run node apps/cli/dist/index.js`
  - `AIMCUB_HOME=/private/tmp/aimcub-cli-smoke-configured ANTHROPIC_API_KEY=sk-test AIMCUB_MODEL=claude-test node apps/cli/dist/index.js`

## Recommended Next Work

- Split help into layers: `aimcub help` should be concise; move the full command reference to `aimcub help all` or equivalent.
- Add a simple human verb layer while preserving advanced commands: likely `ask` as an alias for `clarify`, plus a future `next` command for recommended aim action.
- Turn the configured home screen into a more useful cockpit: show the most recent active aim, pending context review, and the single best next action.
- Add command-dispatch smoke tests around `aimcub`, `aimcub help`, unknown command, and first-run non-interactive output.
- Split CLI command handlers out of `apps/cli/src/index.ts` before adding more verbs.
- Split Desktop renderer panels out of `apps/desktop/src/renderer/App.tsx` before adding more context/eval UI.
- Keep refining aim decomposition around context capture: ask fewer but higher-value questions, prefer eval signals, and show why a question changes the plan.
