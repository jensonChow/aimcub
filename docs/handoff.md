# Aimcub Handoff

Last updated: 2026-07-01

## Product Memory

- Aimcub is an aim-management layer, not a task-list shell. The product manages aims across humans and agents, then accrues durable context and personalized eval from real work.
- Aimcub is intended to be open source as a local-first planning and agent-management product. The license is still TBD; do not add a license file until the business/community boundary is explicit.
- Brand boundary: the local planning architecture and agent-management loop are open source; multi-user collaboration, team routing, sync, managed infrastructure, and the broader aim platform are online products.
- Desktop is now the primary product surface for agent orchestration. CLI remains important for setup, scripting, debugging, and automation, but new orchestration UX should land in Desktop first.
- The current user rejects command-wall UX. Any shell surface should still answer "what can I do next?" rather than "what commands exist?", but it should not pull focus away from the Desktop cockpit.
- First-time use must include setup. If provider config is incomplete and the terminal is interactive, `aimcub` should guide into setup; if non-interactive, it should print scriptable setup commands and exit cleanly.
- Keep scriptability: existing commands, JSON output, stdin input, and automation flows must remain stable while the human-facing top layer gets simpler.
- Context collection is the v1b center of gravity. Aim decomposition should gather just enough user context to improve decomposition, acceptance rules, and future reuse without becoming a profile editor.

## Current Implementation State

- Wrap-up branch: `codex/v1b-context-eval-wrapup`.
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
- Desktop renderer cleanup has started. Shared renderer primitives now live in
  `apps/desktop/src/renderer/styles.ts`, `labels.ts`, `LangToggle.tsx`, `Notice.tsx`,
  `ProviderForm.tsx`, `ContextInbox.tsx`, and `HomeView.tsx`; keep splitting plan and aim-flow
  panels before adding orchestration controls.

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

- Continue Desktop-first: split the aim creation/refinement and plan review panels out of `App.tsx`, then design the local orchestration cockpit around aims, agents, evidence, context, and eval.
- Turn the Desktop home screen into a more useful cockpit: show the most recent active aim, pending context review, and the single best next action.
- Keep CLI work incremental: split help into layers, preserve scriptability, and add command-dispatch smoke tests before adding more verbs.
- Before a public open-source release, choose the license, add `CONTRIBUTING.md` and `SECURITY.md`, audit secrets/env examples, and separate public local-first docs from hosted online-platform deployment notes.
- Keep refining aim decomposition around context capture: ask fewer but higher-value questions, prefer eval signals, and show why a question changes the plan.
