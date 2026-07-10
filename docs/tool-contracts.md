# Aimcub First-Party Tool Contracts

Aimcub's built-in planning tools are owned by the Aimcub runtime and permission model. They are not MCP tools. MCP remains the external connector/plugin boundary; these contracts define the local substrate that the planning engine can ask the Desktop runtime to execute.

The first contract surface lives in `packages/llm/src/tool-contract.ts` and is exported from `@core/llm`.

## What A Contract Defines

Each tool contract declares:

- `name`: stable tool id, such as `local.read` or `web.search`.
- `description`: short model-facing description.
- `inputSchema`: JSON-schema-like input shape.
- `outputSchema`: structured observation shape.
- `permission`: Aimcub runtime permission kind, risk, and whether user approval is required.
- `availability`: whether the tool needs a workspace, memory store, network provider, or user.
- `errors`: normalized error codes.
- `sourceMetadata`: source kinds the observation may cite.

Handlers are deliberately separate from contracts. A Desktop runtime layer binds a contract to an `AimcubToolHandler`, enforces permissions, executes the tool, and returns an `AimcubToolResult`.

## Built-In Surface

The v1 contract registry includes:

- `local.read`
- `local.write`
- `local.edit`
- `local.search`
- `local.glob`
- `local.scan_workspace`
- `memory.search`
- `memory.write_candidate`
- `web.search`
- `web.fetch`
- `context.distill`
- `context.ask_user`

## Design Rules

- Local and memory tools are first-party. Do not expose them through MCP.
- Write/edit tools require explicit approval by default.
- Web tools are optional provider-backed tools. If no provider is configured, the planner should record a missing web-research gap instead of blocking local planning.
- Tool observations should cite sources as file, workspace, memory, web, user, or tool metadata so the Desktop Inspector can show process and context provenance.

## First-Party Web Runtime

`packages/llm/src/web-research.ts` implements the v1 first-party runtime handlers for:

- `web.search`
- `web.fetch`

These handlers are still Aimcub-owned runtime tools, not MCP tools. They enforce `network.search` / `network.fetch` permissions and return normalized `AimcubToolResult` observations.

`web.search` uses a provider abstraction. The package-level environment helper can construct `BraveWebSearchClient` from `AIMCUB_BRAVE_SEARCH_API_KEY` or `BRAVE_SEARCH_API_KEY`. Desktop prefers a configured Brave key and otherwise supplies `LocalCliWebSearchClient`, which asks one authenticated Codex or Claude CLI run for a bounded live-search corpus and reuses that corpus across the research lanes. If neither path is available, the handler returns a normalized failure and planning records an explicit web-research gap.

`web.fetch` uses an injected or platform `fetch` implementation. It only fetches `http` / `https` URLs, blocks localhost and private-network hosts by default, enforces response-size limits, extracts text/metadata/links from text-like content, and emits web source metadata for Inspector provenance.

## Registry-Backed Planning

`packages/llm/src/tool-registry.ts` owns the unified first-party registry shape. Runtime shells register handlers for the built-in contracts, then execute tools through a single `execute(name, input, context)` path.

`packages/llm/src/planning-tool-context.ts` is the planning collector used before decomposition. It executes memory, linked/local context, optional web research, and distillation tools, then converts observations into bounded `PlanningMemory` rows for the decompose prompt. Web research uses bounded lanes for aim facts, authoritative requirements, alternatives/market evidence, risks/tradeoffs, and user/audience evidence when relevant. Its brief preserves source URLs and reports lane/domain coverage, authority, freshness, conflicts, uncertainty, and sufficiency.

Desktop binds the registry in `apps/desktop/src/main/tools.ts`. Memory/context and configured local reads are enabled by their source settings. Web permissions are granted only when research is enabled and relevant, or explicitly enabled through `AIMCUB_ENABLE_WEB_RESEARCH`; page fetching follows the saved deep-research/fetch setting or its environment override.
