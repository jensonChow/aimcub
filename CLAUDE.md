# Aimcub — Project Rules

Universal goal/milestone tracker + evidence-ingestion layer, wrapped in a "digital pet + collectibles + proactive companion" shell. A coding agent (Claude Code) is just one of many evidence *emitters* (via MCP); git/CI webhooks are another. Positioning: developers first, general users second.

## Working agreement
- **Language**: the user gives instructions in Chinese and you may reply in Chinese, but **everything committed to the repo is English** — code, comments, identifiers, commit messages, docs, UI copy, SQL. V1 ships as an English product.
- **This file is the project's top-level rule set. Keep it ≤50 lines.** Detailed design lives in the plan doc — never grow CLAUDE.md into it.
- Verify before claiming "done": `pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm core:purity` must stay green.

## Locked invariants (do not break without explicit sign-off)
- **Supabase is the single source of truth** (Postgres + Auth + RLS + Realtime + Storage).
- **Evidence is append-only + idempotent**; milestones / pet / collectibles are state *derived* from the evidence stream, never written directly.
- **`@core/*` is the only place business logic lives** — pure TS, zero platform deps, unit-tested. App shells (`apps/*`) only do I/O, rendering, platform bridging. CI guards purity via ESLint `no-restricted-imports` + `types:[]` tsc.
- **Lean-first**: v1 uses a `jobs` table + pg_cron (not pgmq), linear milestones (not DAG), single-table memory (no vectors), sprite sheets (not Rive). Add complexity only when a concrete trigger demands it.
- One pet per goal; proactive messages are rate-limited per user.

## Layout
`packages/{core (@core/domain), types (@core/types), db, api, llm, proactive, ui-tokens}` + `apps/{web, mcp = v1 active; ios = v2, extension = v3 = placeholders}`. Full table in `README.md`.

## Commands
`pnpm install` · `pnpm build` · `pnpm test` · `pnpm typecheck` · `pnpm lint` · `pnpm core:purity`

## Roadmap (falsifiable gates)
- **v0** ✅ foundation: monorepo + `@core` kernel + Supabase schema.
- **v1a** — test H1 (frictionless auto-evidence): Web sets goal → decompose → MCP/GitHub evidence → milestone auto-lights. No pet.
- **v1b** — test H2 (emotional shell lifts retention), **go/no-go gate**: add pet growth + collectibles + nudges.
- **v2** iOS + APNs · **v3** Chrome + general goals · **v4** monetization (Stripe + iOS IAP).

Plan: `/Users/jenson/.claude/plans/coding-agent-goal-goal-proactive-ios-mc-encapsulated-stonebraker.md`
