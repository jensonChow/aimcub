# Worktree Report: community-scaffolding

## What changed

- `docs/roadmap.md` (new) — public, gate-by-gate status derived from `docs/v1-spec.md`.
- `docs/good-first-contributions.md` (new) — 7 curated, currently-open items.
- `.github/ISSUE_TEMPLATE/adapter_proposal.yml` (new) — structured local-agent
  adapter proposal template.
- `README.md` — added roadmap + good-first-contributions links in "Where To
  Start" and "Contributing & Community" only; no other changes.
- `.changeset/release-scaffolding-community.md` — patch bump on `@core/types`
  (docs-only precedent already used by `quickstart-front-door.md`).

Why: give a stranger reading the repo an honest map of where it stands and
concrete, real work to pick up, without any status claim being aspirational.

## Decisions made

- Every "Done"/"Partial"/"In progress" label in roadmap.md was checked against
  code, not copied from `docs/handoff.md` prose (see spot-checks below).
- "Local store compaction/export/import" is marked **Partial**: export/import
  are real and working; compaction does not exist (no `compact`/`prune`/`vacuum`
  and no `schema_version` field anywhere in `packages/store`).
- Kept internal process labels (batch numbers, `B4-1`, epic names) out of both
  public docs — described capabilities, not internal scheduling.
- "Deliberately deferred pre-launch" covers only the four categories the
  mission named (license, npm publish, distribution, signing) — handoff's
  founder-facing launch checklist has internal-only items (push authorization,
  gitleaks scan) that wouldn't mean anything to an outside reader.
- good-first-contributions.md excludes everything handoff's "Open threads"
  names as batch-4-owned: `PlanningDebugPanel` (confirmed dead — exported but
  zero JSX usages, only its pure helper `mergePlanningDebugTraces` is used),
  the stranded widened-run affordance, the CLI `--jsonl` artifacts field, the
  queue-request `surface` marker, and both eval-moat `@core` findings
  (`planning-context.ts` stopwords, `critiquePlan` manual-verification bias).
- Chose 7 items (within the requested 6–10): flagship adapter, a live
  second-provider eval-moat run, a new eval-moat persona, an i18n review, a
  store schema-version design proposal, Windows atomic-write verification, and
  a docs-discoverability fix — spread across difficulty and area, none
  overlapping each other or batch 4.

## Verification spot-checks (roadmap.md claim → evidence)

- Durable queue + streamed events: `packages/local-agent/src/run-queue.ts`,
  `orchestrator.ts`; behavior detailed in `docs/local-agent-adapters.md`.
- Structured artifact capture: `docs/local-agent-adapters.md` "Artifacts"
  section; `artifact.created` event handling.
- Per-agent model/reasoning/workspace persistence: `Run` schema in
  `packages/types` carries `model`/`reasoning`/`workspace_root`/`sandbox`;
  `PlanPanel.tsx` records a per-node model override.
- Dev-mode-gated debug: `useDeveloperMode` consumed in exactly two places
  (`App.tsx`, `PlanContractCard.tsx`) — matches handoff's "gates the two real
  debug surfaces."
- Eval-moat live result: `examples/eval-moat/README.md` and handoff agree
  (deepseek, 9 calls, contexted wins 2/1, mean +7.67/25, `N=1`).
- Only two adapters registered (`packages/local-agent/src/registry.ts`:
  `[codexAdapter, claudeAdapter]`) — confirms a third is genuinely open.
- Windows caveat: `packages/store/src/safe-fs.ts` header explicitly documents
  unverified best-effort Windows behavior.
- Docs discoverability: README's Architecture Map has no `examples/` row;
  `product-story.md`, `tool-contracts.md`, `desktop-product-bugs.md`,
  `desktop-action-menu-audit.md`, `desktop-gui-research.md` have zero inbound
  links from README/CONTRIBUTING/`docs/memory/README.md` (grep-verified).

## Out-of-scope discoveries

None beyond what's already captured as a good-first-contribution candidate
above — no code defects found; this branch touched no code.

## Verification

Full gate green: build 9/9, **1028 tests** (api-client 20, domain 187, db 36,
store 95, llm 170, mcp 57, local-agent 21, cli 103, desktop 339 — matches
handoff's baseline exactly), typecheck 16/16, lint 10/10, purity clean. All
docs-only; every task hit cache, confirming zero code impact. All relative
links across the three new/edited docs verified programmatically to resolve.
`adapter_proposal.yml` parsed with PyYAML: `name`/`description`/`body` present,
every non-markdown element has `id` + `label`, all dropdowns have `options`,
no duplicate ids.
