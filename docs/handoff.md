# Aimcub Handoff

Last updated: 2026-07-04

## Product Memory

- Aimcub is an aim-management layer, not a task-list shell. The product manages aims across humans and agents, then accrues durable context and personalized eval from real work.
- Aimcub is intended to be open source as a local-first planning and agent-management product. The license is still TBD; do not add a license file until the business/community boundary is explicit.
- Brand boundary: the local planning architecture and agent-management loop are open source; multi-user collaboration, team routing, sync, managed infrastructure, and the broader aim platform are online products.
- Desktop is now the primary product surface for agent orchestration. CLI remains important for setup, scripting, debugging, and automation, but new orchestration UX should land in Desktop first.
- Desktop must function as a debug cockpit while the product is still being shaped. During aim setup and context collection, users need to see the live planning timeline, model calls, tool/context activity, generated questions, and structured planning artifacts before the final plan exists.
- The current user rejects command-wall UX. Any shell surface should still answer "what can I do next?" rather than "what commands exist?", but it should not pull focus away from the Desktop cockpit.
- Aimcub's first local planning tools should be first-party built-in runtime tools, following the Claude Code pattern: `Read` / `Write` / `Edit` / `Grep` / `Glob`-style primitives are owned by the harness and permission system. MCP is the external connector/plugin boundary, not the foundation for core local context tools.
- First-time use must include setup. If provider config is incomplete and the terminal is interactive, `aimcub` should guide into setup; if non-interactive, it should print scriptable setup commands and exit cleanly.
- Keep scriptability: existing commands, JSON output, stdin input, and automation flows must remain stable while the human-facing top layer gets simpler.
- Context collection is the v1b center of gravity. Aim decomposition should gather just enough user context to improve decomposition, acceptance rules, and future reuse without becoming a profile editor.
- Context collection must distinguish durable/global context from aim-local context. Long-lived preferences, constraints, eval signals, and capability facts should become memory candidates; short-lived facts should stay scoped to the current aim.
- Consumer/life/product aims require real-world context, not only developer-style product/platform assumptions. For example, a tarot app plan should ask about Apple developer account access, App Store/distribution path, the user's tarot experience, deck/art/IP/licensing, content voice, target audience, budget/timeline, monetization, and whether the user wants to learn or delegate.
- The context inbox is a review queue for candidate memory/eval/context signals, not the primary debug surface. Candidate text should be editable before acceptance, and the UI must make clear whether acceptance stores it as global durable context or current-aim context.
- Agent routing should be agent-forward: assign all digital, research, coding, summarization, and network-searchable work to agents by default. Humans should own only physical-world actions, authority/approval, secrets/access, taste calls, and final non-delegable decisions.
- Product flow should stay centered on the simplest loop: user enters an aim -> Aim OS collects context -> Aim OS creates sub-aims with eval rules -> each sub-aim is either handed to an agent/user for execution and evaluation, or manually broken down into smaller sub-aims.

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
- Desktop now enforces a single app instance in `apps/desktop/src/main/index.ts`. In development macOS may still label the Dock app as `Electron`, but duplicate launches should focus the existing window instead of opening another Aimcub window. When manually cleaning old dev runs, quit `Electron` as well as `Aimcub`.
- Desktop model-provider work now supports provider selection beyond Anthropic/OpenAI, including OpenAI-compatible providers such as DeepSeek, MiniMax, Z.ai, Gemini compatibility, Qwen/DashScope, and custom endpoints.
- Recent DeepSeek fixes disabled unsupported structured-output assumptions for custom/OpenAI-compatible paths and added request-shaping for DeepSeek-style JSON responses. If providers fail, surface the model/provider error quickly instead of leaving Desktop stuck on "starting initial plan".
- Clarify/decompose has been strengthened but is still not enough. It now asks more baseline context questions and routes more digital work to agents, but it is still mostly prompt-only. The next missing layer is a first-party planning tool substrate that lets the model inspect local context, search/read files, use memory, and optionally research the web before decomposing an aim.
- Desktop pre-draft intake now has a model pass: deterministic `reviewAimIntake` gaps are internal signals only, Desktop first collects memory/local/web tool context, then calls `generateAimIntakeQuestions` to produce the user-facing questions/options. Do not surface template prompts like "Ask for..." directly to users; if research/local context is unavailable, the model should ask for enabling or attaching that context instead of pretending it has facts.
- Context collection is now a first-class Desktop setup layer: `context-sources.json` records linked local folders, explicit local files, online connector references such as Notion/Obsidian/databases/URLs, Web/deep-research preference, the dedicated context session toggle, and choice-question toggle. Planning consumes this before decomposition through `context.linked_sources`, `local.read`, optional `web.search`/`web.fetch`, `context.distill`, and structured user questions. Connector references are treated as locations/access gaps until a runtime can actually read them.
- Desktop planning debug now exposes the pre-draft/context phase as first-class state: live timeline events, model run status, prompt/system previews, usage/duration when available, tool observations/failures, context distillation, intake/clarify questions and answers, structured rationale, decomposition contracts, review actions, and context gaps. It must show auditable rationale and plan artifacts without exposing hidden chain-of-thought.
- The middle Desktop panel and right runtime/debug panel must remain independently scrollable; users need to inspect content outside the first viewport while a planning run is still in progress.
- The first unified built-in tool contract substrate now lives in `packages/llm/src/tool-contract.ts` and is exported from `@core/llm`. It defines contracts, permissions, structured observations, normalized errors, handler types, and a registry for `local.*`, `memory.*`, `web.*`, and `context.*` planning tools. Runtime handlers and Desktop permission UI are still next.
- Desktop now has a first pass of the local CLI agent harness in `apps/desktop/src/main/local-agents.ts`, following the OpenDesign-style local adapter pattern: registry definitions for Codex and Claude, executable detection via explicit env overrides/PATH/common install paths, version/auth/model probes, command construction, stdin prompt delivery, and JSONL/stream-json event normalization into Aimcub events.
- This local CLI harness is an Aimcub runtime layer, not MCP. Aimcub should continue to own aim decomposition, context, permissions, evidence, and eval, but local CLIs such as `codex exec --json` and `claude -p` are now also valid planning runtimes when no API provider is configured; API providers remain the preferred metered path when configured.
- Desktop settings now includes a minimal "Local CLI agents" panel that lists detected Codex/Claude CLIs and can run an explicit read-only smoke test. Keep this panel thin until the runtime is connected to milestone execution and evidence capture.
- Saved Desktop aims now expose the first usable sub-aim loop: each saved sub-aim shows its persisted milestone status and can be handed to a local CLI agent, manually confirmed as done through the store's eval path, or used as the seed for a new child aim when the user wants to break it down further. Agent runs are recorded as evidence but do not auto-complete milestones; completion remains governed by eval/manual confirmation.
- Aim OS orchestration now has a first durable local model in `@core/types`, `@core/domain`, and `@core/store`: actors, assignments, runs, run events, tool traces, context intake sessions, sub-aim relations, evidence attribution, evaluator runtime reports, and an `AimProgressReadModel`.
- Local goal creation now materializes routing assignments from decomposition contracts. Agent execution through Desktop creates a `Run`, records low-trust evidence with attribution, finishes the run, and sediments pending context candidates. Manual child-aim decomposition is stored as a first-class sub-aim relation instead of only `metadata`.
- The current Aim OS model is local-store first. Supabase schema parity is still future work; do not assume hosted Web has these orchestration tables until migrations and API adapters are added.
- Desktop renderer has been reset from the old debug-heavy 3,500-line panel into a compact Aim OS cockpit MVP. The new first screen centers the actual flow: aim intake, context questions, sub-aim/eval preview, assignment/run/evidence/eval cockpit, context inbox, and runtime settings. It intentionally keeps rough MVP styling and reuses existing IPC instead of adding new product logic in the renderer.
- Latest mainline commits to preserve as the current baseline:
  - `873a404` — local Aim OS orchestration model.
  - `793f623` — Desktop UI reset around the Aim OS cockpit.
  - `ca5e33a` — fix Desktop panel scrolling.
  - `141d3d9` — stream Desktop planning debug events.
  - `b744dcc` — add pre-draft context debugging.
  - `e00d479` — broaden real-world planning context.
  - `98f9785` — ground intake questions in model context.
  - `bd379de` — add first-class context collection sources.
- The Desktop app was launched successfully after the UI reset with `PATH=/private/tmp/aimcub-pnpm9-bin:$PATH pnpm desktop`. A later local test launch also succeeded by running Electron against `apps/desktop/out/renderer/index.html`; in development macOS may still show the app name as `Electron`, but the window title should be `Aimcub`.

## Verification Notes

- The project declares `pnpm@9.15.0`, but the Codex runtime's bare `pnpm` may resolve to pnpm 11.7.0 and misread the legacy `package.json` `pnpm.overrides` field.
- Use this prefix when running full gates from Codex:
  `PATH=/private/tmp/aimcub-pnpm9-bin:$PATH pnpm <command>`
- Use the same PATH prefix when launching Desktop from Codex. Running `/private/tmp/aimcub-pnpm9-bin/pnpm desktop` without the PATH prefix can still fail because the root script invokes a nested bare `pnpm`, which may resolve to pnpm 11 and abort with `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`.
- Verified after the v1b wrap-up:
  - `PATH=/private/tmp/aimcub-pnpm9-bin:$PATH pnpm build`
  - `PATH=/private/tmp/aimcub-pnpm9-bin:$PATH pnpm test`
  - `PATH=/private/tmp/aimcub-pnpm9-bin:$PATH pnpm typecheck`
  - `PATH=/private/tmp/aimcub-pnpm9-bin:$PATH pnpm lint`
  - `PATH=/private/tmp/aimcub-pnpm9-bin:$PATH pnpm core:purity`
  - `git diff --check`
- CLI smoke checks:
  - `AIMCUB_HOME=/private/tmp/aimcub-cli-smoke-first-run node apps/cli/dist/index.js`
  - `AIMCUB_HOME=/private/tmp/aimcub-cli-smoke-configured ANTHROPIC_API_KEY=sk-test AIMCUB_MODEL=claude-test node apps/cli/dist/index.js`

## Recommended Next Work

- Continue Desktop-first: split the aim creation/refinement and plan review panels out of `App.tsx`, then design the local orchestration cockpit around aims, agents, evidence, context, and eval.
- Implement Desktop runtime handlers for the first-party built-in planning tools and wire them into pre-decomposition context gathering. Start with read/context tools, not execution tools.
- Turn the Desktop home screen into a more useful cockpit: show the most recent active aim, pending context review, and the single best next action.
- Keep CLI work incremental: split help into layers, preserve scriptability, and add command-dispatch smoke tests before adding more verbs.
- Before a public open-source release, choose the license, add `CONTRIBUTING.md` and `SECURITY.md`, audit secrets/env examples, and separate public local-first docs from hosted online-platform deployment notes.
- Keep refining aim decomposition around context capture: ask fewer but higher-value questions, prefer eval signals, and show why a question changes the plan.
- Improve research depth for open-ended aims. The planner should proactively identify domain, legal/access, distribution, skill, budget, taste, and operational constraints before locking the decomposition, especially for non-developer aims where the best questions are not obvious from code/product structure alone.
- Next local-agent work: persist per-agent model/reasoning selection, improve milestone-level agent prompts with workspace selection, add a real run queue tied to milestones, capture file/tool events as append-only evidence, and add cancellation/resume only after the one-shot execution path is reliable.
- Next Aim OS work: deepen the new Desktop cockpit around `getAimProgress`, add Supabase migrations/API parity for actors/assignments/runs/sub-aim relations/evidence attribution, and replace the current one-shot local agent runner with a queue that can stream run events and artifacts.

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
   - Current status: `packages/llm/src/web-research.ts` provides first-party runtime handlers for both tools. `web.search` supports a provider abstraction with Brave Search as the first built-in provider; `web.fetch` supports bounded public URL extraction with private-host blocking.
   - Current status: `packages/llm/src/tool-registry.ts` and `packages/llm/src/planning-tool-context.ts` provide the unified first-party registry path used by Desktop planning. `apps/desktop/src/main/tools.ts` binds memory/context/web handlers and gates web research behind explicit environment flags.
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
