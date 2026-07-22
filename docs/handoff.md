# Aimcub Handoff

Last updated: 2026-07-21
Branch: `main`. **OSS-maturity epic batch 1 is MERGED and verified**; batch 2
prompts are staged (gitignored `worktrees/prompts/`, see its README). Local
`main` is ahead of `origin/main` — **push needs founder approval**.

## Batch 1 — integrated (four parallel worktrees, merged in order)

1. `a0c6e758` **oss-hygiene** — CONTRIBUTING / SECURITY / CODE_OF_CONDUCT /
   issue+PR templates (license-agnostic; license decision stays deferred),
   README "Contributing & Community" section. Secrets sweep of tree + full
   history: zero real-key hits.
2. `79336d05` **release-scaffolding** — changesets (lockstep `@core/*`+`@app/*`;
   workspace root can't join the fixed group — documented in
   `docs/releasing.md`), root CHANGELOG, `release.yml` (verify → macos-14
   CLI bundle + unsigned dmg/zip artifacts → draft GitHub Release on `v*`
   tags; npm publish is a blocked placeholder).
3. `9a13b3c5` **store-hardening** — `packages/store/src/safe-fs.ts`: atomic
   tmp+fsync+rename writes, post-write `store.json.bak` mirroring, corrupt-load
   quarantine + backup recovery + `AimStore.getDiagnostics()` (silent
   emptyStore data loss is gone), advisory cross-process lock around every
   mutating load→mutate→save. 16 new durability tests.
4. `91b768a0` **adapter-boundary** — `packages/local-agent` is an open adapter
   registry (`LocalAgentId` = string; codex/claude are built-ins; registration
   order = preference order). Adapters own `buildInvocation`+`parseLine`;
   engine owns processes/timeout/AbortSignal/classified failures
   (`retryable` = timeout only). Contribution guide:
   `docs/local-agent-adapters.md`. A fake third adapter runs end-to-end
   through `agent-run` in tests.

Details live in module memory now: `docs/memory/architecture.md` (store
durability, adapter boundary), `docs/memory/operations.md` (release flow,
release-readiness state).

## Verification (integration round)

- Full gate green on merged `main`: build 9/9 · typecheck 16/16 · lint 10/10 ·
  purity clean · **1035 tests** (desktop 283, domain 187, llm 170, mcp 114,
  cli 89, store 88, api 40, db 36, local-agent 28*). *local-agent double-counts
  dist-compiled tests — real defect, fixed by batch-2 B2-2.
- Repacked and refreshed root `Aimcub.app`.
- Live smoke, isolated `AIMCUB_HOME`: deterministic seed wrote through the new
  store (`.bak` mirrored); CLI `agents` detects through the registry (Codex
  ready, Claude unauthenticated on this machine); `board` renders seeded
  progress; **live corruption probe**: garbaged `store.json` → quarantined +
  recovered from `.bak` in the same invocation, zero data loss; packaged app
  boots (main + 3 renderers stable); real `~/.aimcub/store.json` mtime
  unchanged.

## Open threads

- **Batch 2 staged** (`worktrees/prompts/B2-*.md`): B2-1 run queue + streamed
  events + shared orchestrator + `--until-blocked` (Opus 4.8) · B2-2 clean
  publishable dist, kills the dist test-dup (Sonnet 5) · B2-3 quickstart front
  door (Sonnet 5) · B2-4 bundle id `com.jensonchow.aimcub` + placeholder icon
  + entitlements/notarize-inert (Sonnet 5). Integration merge order:
  B2-3 → B2-4 → B2-2 → B2-1.
- Carried into later batches: Desktop surfacing of `getDiagnostics()`
  (recovery banner — batch 3 run-inspection lane); store-level schema version
  (deferred until the on-disk shape changes); `@core/*`→`@aimcub/*` rename
  (solo lane, after B2-2); root package version-sync (documented gap).
- Founder-owned (outward): license decision; `@aimcub` npm org; GitHub repo
  description still says "GoalPet" + enable Discussions + private vuln
  reporting; CODE_OF_CONDUCT enforcement contact; Apple signing credentials;
  full-history gitleaks scan before public flip; **push authorization for
  current `main`**.

## Next session

Integrate batch 2 when the founder returns the branches: read each
`WORKTREE-REPORT.md` + diff, merge B2-3 → B2-4 → B2-2 → B2-1 (delete reports
in merge commits), full gate + repack + live smoke (B2-1 changes desktop run
semantics to enqueue+stream — exercise one streamed run), update memory docs,
emit batch 3 (artifact capture · permission model + desktop consent UI ·
run inspection/debug gating incl. diagnostics banner · distribution).
