# Aimcub — Project Rules

A universal **aim-management** layer for the harness era. Humans and agents are interchangeable tools for reaching a goal; aimcub is the architecture that holds the aim (愿景 = long-term vision, 任务 = short-term task), routes work across people and agents, and accrues the durable **context** + **eval** that make the system intelligent. A coding agent (Codex) is one of many evidence *emitters* via MCP; git/CI webhooks are another. Positioning: developers first, general users second.

## Working agreement
- **Language**: the user gives instructions in Chinese and you may reply in Chinese, but **everything committed to the repo is English** — code, comments, identifiers, commit messages, docs, SQL. **Exception**: end-user UI is bilingual via i18n — English is the source-of-truth + a `zh` locale (only `zh` translation values are Chinese; keys/code/comments stay English).
- **This file is the project's top-level rule set. Keep it ≤50 lines.** Detailed direction lives in `docs/vision.md` — never grow AGENTS.md into it.
- Current handoff and recent decisions live in `docs/handoff.md`; update it when transferring work.
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

## Layout
`packages/{core (@core/domain), types (@core/types), db, api, llm, ui-tokens}` + `apps/{web, mcp = active; ios = v2, extension = v3 = placeholders}`. Full table in `README.md`.

## Commands
`pnpm install` · `pnpm build` · `pnpm test` · `pnpm typecheck` · `pnpm lint` · `pnpm core:purity`

## Roadmap (falsifiable gates)
- **v0** ✅ foundation: monorepo + `@core` kernel + Supabase schema.
- **v1a** ✅ H1 (frictionless auto-evidence): Web sets goal → decompose → MCP/GitHub evidence → milestone auto-lights.
- **v1b** — H2 (the value is context + eval), **go/no-go gate**: completing aims accrues a per-person context + a personalized eval signal worth paying for.
- **v2** team aim-management (per-person context routing) · **v3** aim-sharing platform (cross-org, a "paid GitHub for goals"). Calendar is a time-management component throughout; iOS/extension shells come online as the surfaces demand.

Vision: `docs/vision.md`
