# Aimcub Handoff

Last updated: 2026-07-02

## Product Memory

- Aimcub is an aim-management layer, not a task-list shell. The product manages aims across humans and agents, then accrues durable context and personalized eval from real work.
- Aimcub is intended to be open source as a local-first planning and agent-management product. The license is still TBD; do not add a license file until the business/community boundary is explicit.
- Brand boundary: the local planning architecture and agent-management loop are open source; multi-user collaboration, team routing, sync, managed infrastructure, and the broader aim platform are online products.
- Desktop is now the primary product surface for agent orchestration. CLI remains important for setup, scripting, debugging, and automation, but new orchestration UX should land in Desktop first.
- The current user rejects command-wall UX. Any shell surface should still answer "what can I do next?" rather than "what commands exist?", but it should not pull focus away from the Desktop cockpit.
- Aimcub's first local planning tools should be first-party built-in runtime tools, following the Claude Code pattern: `Read` / `Write` / `Edit` / `Grep` / `Glob`-style primitives are owned by the harness and permission system. MCP is the external connector/plugin boundary, not the foundation for core local context tools.
- First-time use must include setup. If provider config is incomplete and the terminal is interactive, `aimcub` should guide into setup; if non-interactive, it should print scriptable setup commands and exit cleanly.
- Keep scriptability: existing commands, JSON output, stdin input, and automation flows must remain stable while the human-facing top layer gets simpler.
- Context collection is the v1b center of gravity. Aim decomposition should gather just enough user context to improve decomposition, acceptance rules, and future reuse without becoming a profile editor.
- Context collection must distinguish durable/global context from aim-local context. Long-lived preferences, constraints, eval signals, and capability facts should become memory candidates; short-lived facts should stay scoped to the current aim.
- Agent routing should be agent-forward: assign all digital, research, coding, summarization, and network-searchable work to agents by default. Humans should own only physical-world actions, authority/approval, secrets/access, taste calls, and final non-delegable decisions.

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
- Root Desktop entry is fixed at `pnpm desktop` / `pnpm desktop:dev`; keep this as the stable way to launch the current Desktop app.
- Desktop model-provider work now supports provider selection beyond Anthropic/OpenAI, including OpenAI-compatible providers such as DeepSeek, MiniMax, Z.ai, Gemini compatibility, Qwen/DashScope, and custom endpoints.
- Recent DeepSeek fixes disabled unsupported structured-output assumptions for custom/OpenAI-compatible paths and added request-shaping for DeepSeek-style JSON responses. If providers fail, surface the model/provider error quickly instead of leaving Desktop stuck on "starting initial plan".
- Clarify/decompose has been strengthened but is still not enough. It now asks more baseline context questions and routes more digital work to agents, but it is still mostly prompt-only. The next missing layer is a first-party planning tool substrate that lets the model inspect local context, search/read files, use memory, and optionally research the web before decomposing an aim.

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
- Build the first-party built-in planning tools substrate before adding more planning prompts. Start with read/context tools, not execution tools.
- Turn the Desktop home screen into a more useful cockpit: show the most recent active aim, pending context review, and the single best next action.
- Keep CLI work incremental: split help into layers, preserve scriptability, and add command-dispatch smoke tests before adding more verbs.
- Before a public open-source release, choose the license, add `CONTRIBUTING.md` and `SECURITY.md`, audit secrets/env examples, and separate public local-first docs from hosted online-platform deployment notes.
- Keep refining aim decomposition around context capture: ask fewer but higher-value questions, prefer eval signals, and show why a question changes the plan.

## Next Session Goal Prompt

Copy this prompt into the next coding session:

```text
/goal Build Aimcub's first batch of first-party built-in planning tools for Desktop-first aim decomposition. Do not implement these as MCP. MCP remains the external connector/plugin boundary; the core local context tools must be owned by the Aimcub runtime and permission model.

Context:
- Current product direction: Aimcub is a local-first planning and agent-management product. Desktop is the primary orchestration surface; CLI should remain scriptable but should not drive the UX.
- User pain: current planning is mostly a model wrapper. It asks too little context, cannot inspect local context, cannot search/read relevant files as tools, cannot research the web, and therefore cannot make a good agent/human routing plan.
- Required philosophy: all digital/research/code/summarization/searchable work should default to agents. Humans should own physical-world actions, authority/approval, secrets/access, taste calls, and final non-delegable decisions.
- Claude Code reference: local primitives like Read, Write, Edit, Grep, Glob, and Bash are built-in runtime tools gated by permissions. MCP is for external tools and connectors.

Implement a narrow v1 tool substrate:
1. Add a typed first-party tool contract in the core layer, preferably under @core/llm unless a smaller existing package is clearly more appropriate. Include name, description, input schema shape, permission kind, handler context, structured result, errors, and evidence/source metadata.
2. Add read-only/context-first built-in tools:
   - memory.search: search active global and current-aim memories through the existing store interfaces.
   - memory.write_candidate: create pending memory candidates, clearly separating global durable memory from aim-scoped context.
   - local.scan_workspace: summarize a user-selected workspace/root with file counts, likely project type, important manifest files, and ignored/sensitive path handling.
   - local.search: content search over the selected workspace, using safe local search semantics and returning bounded matches with file/line references.
   - local.read: read bounded slices of text files by absolute path, with line numbers, size limits, and explicit errors for directories/binary/denied paths.
   - context.distill: merge user answers, memory hits, local scan/search/read results, and optional web results into a compact planning-context object.
   - context.ask_user: represent missing-context questions as structured tool requests so Desktop can render them rather than burying them in model prose.
3. Add optional web tool interfaces but keep implementation conservative:
   - web.search and web.fetch should have typed contracts and disabled/no-provider behavior if no provider is configured.
   - Do not block the local MVP on a paid search provider. The planner should record "needs web research" gaps when web is unavailable.
4. Integrate tools into the planning pipeline before decompose:
   aim input -> memory.search -> local.scan_workspace when a workspace is selected -> local.search/read when useful -> optional web.search/fetch -> context.distill -> context.ask_user for remaining durable/aim-local gaps -> decompose -> plan critique.
5. Desktop integration:
   - Keep `pnpm desktop` as the fixed entry.
   - Add the minimum UI needed to choose/confirm a local workspace and show tool activity/results during initial planning.
   - Do not grow `apps/desktop/src/renderer/App.tsx` further; split focused renderer/main modules first if UI changes are needed.
6. Tests:
   - Unit-test tool contracts and local tool behavior, including denied/sensitive paths, bounds/truncation, binary/directory errors, and memory scope separation.
   - Unit-test planner integration with fake tools so a planning run uses gathered context before decompose.
   - Keep @core pure and run the relevant package tests/typecheck. If time permits, run full gates with `PATH=/Users/jenson/.local/node/bin:$PATH corepack pnpm build && ... test && typecheck && lint && core:purity`.

Completion condition:
- A Desktop-first planning run can gather structured memory/local context through first-party built-in tools before decomposition, can surface missing context questions, and can proceed gracefully when web search is unavailable.
```
