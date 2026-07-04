# Aimcub Memory Map

This directory is the durable project-memory layer. `AGENTS.md` is the compact root contract, while module memories here hold details that agents should load only when relevant.

## Loading Order

1. Start with `AGENTS.md` (or `CLAUDE.md` for Claude Code compatibility).
2. Read `docs/handoff.md` for the latest session transfer.
3. Read this index and then the specific memory file for the module you will touch.
4. Use `docs/vision.md`, `docs/v1-spec.md`, and module specs for deeper product or implementation detail.

## Write Policy

- Promote a rule to `AGENTS.md` only when missing it would break the project contract.
- Store durable product, architecture, module, and operations decisions in this directory.
- Keep `docs/handoff.md` short and session-scoped: completed work, verification, commit/push status, open risks, and next handoff.
- If a handoff item becomes long-lived memory, move it into a module memory and remove it from the handoff.
- Keep all committed prose English. End-user Chinese belongs only in `zh` i18n values.

## Module Index

| File | Load when... |
| --- | --- |
| `product.md` | Work affects positioning, roadmap, routing philosophy, context/eval behavior, or product copy. |
| `architecture.md` | Work affects core packages, storage, evidence, Supabase, local store, tool contracts, or data flow. |
| `desktop.md` | Work affects the Electron app, local Aim OS cockpit, provider setup, context collection UI, or local agent harness. |
| `design-system.md` | Work affects frontend design, Desktop UI, visual language, layout, typography, spacing, color, controls, or interaction details. |
| `operations.md` | Work affects verification, release, packaging, local machine assumptions, or session handoff process. |
| `history.md` | You need legacy v0/H1/H2/v1a context or archived decisions before changing old surfaces. |

## Memory Hygiene

- Prefer concise, dated durable facts over full transcripts.
- Do not duplicate the same memory across multiple files; link to the owning file instead.
- When the user gives any frontend or visual-design requirement, update `design-system.md`.
- Remove obsolete details when the source module changes.
- Keep handoff prompts short enough that the next session can act without re-reading historical noise.
