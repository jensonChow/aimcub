# Aimcub — Project Rules

A universal **aim-management** layer for the harness era. Humans and agents are interchangeable tools for reaching a goal; aimcub is the architecture that holds the aim (愿景 = long-term vision, 任务 = short-term task), routes work across people and agents, and accrues the durable **context** + **eval** that make the system intelligent. A coding agent (Codex) is one of many evidence *emitters* via MCP; git/CI webhooks are another. Positioning: developers first, general users second.

## Working agreement
- **Language**: the user gives instructions in Chinese and you may reply in Chinese, but **everything committed to the repo is English** — code, comments, identifiers, commit messages, docs, SQL. **Exception**: end-user UI is bilingual via i18n — English is the source-of-truth + a `zh` locale (only `zh` translation values are Chinese; keys/code/comments stay English).
- **This file is the project's top-level rule set. Keep it ≤50 lines.** Detailed direction lives in `docs/vision.md` — never grow AGENTS.md into it.
- Current handoff and recent decisions live in `docs/handoff.md`; update it when transferring work.
- After making repository changes, create a focused commit and push it before ending the turn unless the user explicitly asks not to; stage only files that belong to the completed work.
- Verify before claiming "done": `pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm core:purity` must stay green.

## North star (the four pillars)
- **Humans are agents too** — the product manages *aims*, not avatars. People and agents are both just paths to the goal; the system auto-judges which work goes to whom.
- **Memory + Eval are the core** — memory keeps the org stable, eval keeps it correct. Aim management is AI-centric, never hand-maintained.
- **Context is the product** — a person's context forms *naturally* by working in the system and becomes their "resume in the new era" (packageable, sellable).
- **Personalized eval** — benchmarks don't represent real use; every person/org has its own. Eval without context is meaningless.

## Locked invariants (do not break without explicit sign-off)
- **Supabase is the single source of truth** (Postgres + Auth + RLS + Realtime + Storage).
- **Evidence is append-only + idempotent**; milestone completion is state *derived* from the evidence stream via `evaluate()`, never written directly.
- **`@core/*` is the only place business logic lives** — pure TS, zero platform deps, unit-tested. App shells (`apps/*`) only do I/O, rendering, platform bridging. CI guards purity via ESLint `no-restricted-imports` + `types:[]` tsc.
- **Lean-first**: a `jobs` table + pg_cron (not pgmq), linear milestones (not DAG), single-table memory (no vectors). Add complexity only when a concrete trigger demands it.
- **Built-in planning tools first**: local read/search/memory/context tools are first-party Aimcub runtime tools; MCP is the external extension boundary, not the substrate for core primitives.

## Layout
`packages/{core (@core/domain), types (@core/types), db, api, llm, ui-tokens}` + `apps/{web, mcp = active; ios = v2, extension = v3 = placeholders}`. Full table in `README.md`.

## Commands
`pnpm install` · `pnpm build` · `pnpm test` · `pnpm typecheck` · `pnpm lint` · `pnpm core:purity`

## Roadmap (falsifiable gates)
- **v0** ✅ foundation: monorepo + `@core` kernel + Supabase evidence spine.
- **v1** — current: open-source local Aim OS agent harness. Desktop-first aim intake → context gathering → decomposition/eval contracts → human/agent routing → local agent runs/manual proof → evidence/eval → context inbox/reuse.
- **H1/H2 legacy gates** — H1 auto-evidence and H2 context/eval are validation history and infrastructure inside v1, not the active phase split.
- **v2** online multiplayer Aim platform: sync, teams, permissions, per-person context routing, managed infrastructure.
- **v3** Aim Share: cross-org, a paid GitHub-for-goals network for aims, context, and capability signals. Calendar remains a time-management component throughout.

Vision: `docs/vision.md`
