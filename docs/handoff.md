# Aimcub Handoff

Last updated: 2026-07-22
Branch: `main`. **OSS-maturity epic batch 2 is MERGED and verified**; batch 3
prompts are staged (gitignored `worktrees/prompts/`, see its README). Local
`main` (`291ceb73` + this docs commit) is ahead of `origin/main` (`410c2776`)
by both batches — **push needs founder approval**.

## Batch 2 — integrated (merged B2-3 → B2-4 → B2-2 → B2-1)

1. `455fd094` **quickstart-front-door** — `docs/quickstart.md` (every command
   executed verbatim), README front-door Quickstart, examples aligned.
2. `6747132a` **desktop-packaging-identity** — appId `com.jensonchow.aimcub`
   (ASC 6785268817 / team K9XA27TP7F), committed placeholder icon + generator,
   hardened-runtime entitlements (JIT + network client), built-in notarize
   enabled but inert while `identity: null`; `notarize:check` diagnostic.
3. `4a784346` **publish-build-prep** — per-package `tsconfig.build.json`
   (test-free dist) + vitest src-allowlists; killed the dist test double-count
   (local-agent 28→14, api 40→20 — the api case was discovered, not reported);
   `files` + `publishConfig` stubs so the `@aimcub` rename is a name change.
4. `291ceb73` **queue-streaming** — durable run queue (runs collection = the
   queue; atomic sandbox-scoped claims under the store lock), one shared
   orchestrator behind CLI + Desktop, batched `appendRunEvents`, live
   `runLiveEvent` push IPC + Execute status/Stop, retry-once for retryable
   failures, `aimcub run --until-blocked`. Details in
   `docs/memory/architecture.md`.

## Verification (integration round)

- Full gate green on merged `main`: build 9/9 · typecheck 16/16 · lint 10/10 ·
  purity clean · **1031 tests** with honest counts (desktop 296, domain 187,
  llm 170, mcp 114*, cli 99, store 95, api 20, db 36, local-agent 14).
  *mcp still double-counts dist tests — flagged by B2-2, fixed in batch 3.
- Repacked + refreshed root `Aimcub.app`; PlistBuddy confirms
  `com.jensonchow.aimcub`, `icon.icns`, productivity category; no
  default-icon warning.
- Live smoke, isolated `AIMCUB_HOME`: seed → `board` renders; queue path
  probed without spending agent quota (`run --until-blocked --agent claude`
  with Claude unauthenticated fails at selection BEFORE enqueuing — no
  stranded queued rows); packaged app boots (main + 3 renderers), desktop
  worker correctly drains nothing, real `~/.aimcub` untouched, no lock/temp
  debris.

## Open threads

- **Batch 3 staged** (`worktrees/prompts/B3-*.md`): B3-1 artifact capture
  (Opus 4.8) · B3-2 execution permissions + run inspection UX (Opus 4.8) ·
  B3-3 test integrity: mcp dist-dup + never-typechecked test-file debt
  (Sonnet 5) · B3-4 eval-moat benchmark harness (Opus 4.8). Merge order:
  B3-4 → B3-3 → B3-1 → B3-2.
- Re-sliced from the original plan: distribution (npx/Homebrew) moved to the
  launch batch (it needs npm publish, which needs the license); the
  `@core/*`→`@aimcub/*` rename runs as a SOLO mini-batch whenever the founder
  wants it, ideally right before publish (build side is ready per B2-2).
- Carried polish notes: CLI selection errors render as "Unexpected error:"
  (B3-1 fixes via typed orchestrator errors); live-run line reuses
  `od-work-note` styling (B3-2); a surface marker on queue requests would make
  cross-surface claiming explicit (future); no store schema version yet.
- Founder-owned (outward, unchanged): license decision; `@aimcub` npm org;
  GitHub description/Discussions/private vuln reporting; CoC contact; Apple
  signing credentials (then re-verify the 2-entitlement set under a real
  signed launch); gitleaks history scan; **push authorization**.

## Next session

Integrate batch 3 when branches return: reports + diffs, merge
B3-4 → B3-3 → B3-1 → B3-2 (strip reports), full gate + repack + smoke
(exercise artifact events + permission consent + diagnostics banner), update
memory docs, then stage the launch batch (rename solo-lane, distribution,
community scaffolding, public-flip checklist execution).
