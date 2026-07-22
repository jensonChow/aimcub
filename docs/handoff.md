# Aimcub Handoff

Last updated: 2026-07-22
Branch: `main`. **OSS-maturity epic batch 3 is MERGED and verified**; batch 4
(quality + launch prep) plus a standalone rename prompt are staged in
gitignored `worktrees/prompts/`. Local `main` is ahead of `origin/main`
(`410c2776`) by batches 1–3 — **push needs founder approval**.

## Batch 3 — integrated (merged B3-4 → B3-3 → B3-1 → B3-2)

1. `3cd2bea9` **eval-moat-benchmark** — `examples/eval-moat`: deterministic
   two-condition fixtures (3 personas), budgeted live mode, blind seeded A/B
   judging, honest reporting. **First live result** (deepseek, 9 calls):
   contexted wins 2/1, mean +7.67/25 — directional, N=1. Surfaced two real
   `@core` bugs (below).
2. `e088b198` **test-integrity** — mcp test count was a pure dist mirror
   (114 → **57**); core/store/llm typecheck now covers test files (~40 fixture
   drifts fixed, zero weakened assertions; core gained `lib: WebWorker` for
   `structuredClone` — purity tripwire intact).
3. `64e3272f` **artifact-capture** — adapters emit file artifacts (codex
   file_change/patch; claude Write/Edit/MultiEdit/NotebookEdit — nested
   tool_use now normalizes as real tool events); orchestrator persists deduped
   `artifact.created`, capped raw (8KB/event, 256KB/run, explicit markers),
   artifact summary + `evidence.reported` on the run's evidence. Typed
   selection errors → clean CLI user errors.
4. `a8dcac97` **permissions-inspection** — per-run consent
   (sandbox/network/workspace; main rejects `danger-full-access` and invalid
   workspaces — renderer is not the boundary), background drain stays
   read-only-scoped with widened runs executed only via same-session
   claim-by-id; run timeline (generic fallback for unknown event types);
   store-recovery banner; developer mode (gates the two real debug surfaces;
   new `desktop-settings.json`); `docs/agent-permissions.md` threat model.
5. `f38b4bc5` — integration fix for the planned cross-lane gap (store queue
   fixture annotation).

## Verification (integration round)

- Full gate green first run on merged `main`: build 9/9 · typecheck 16/16
  (now honestly covering test files) · lint 10/10 · purity clean ·
  **1028 tests** (desktop 339, domain 187, llm 170, cli 103, store 95,
  mcp 57 honest, db 36, local-agent 21, api 20).
- Repacked + refreshed root `Aimcub.app`; boot smoke clean (main + 3
  renderers), real `~/.aimcub` untouched, no debris.
- Eval-moat dry run executed from merged main: deterministic, 0 provider
  calls, context diff non-empty for all 3 personas. Typed CLI error verified
  live: `Claude Code is not authenticated.` with no "Unexpected error:"
  prefix.

## Open threads

- **Batch 4 staged** (`worktrees/prompts/B4-*.md`, 3 parallel lanes):
  B4-1 fix the two eval-moat findings in `@core` + join `examples/*` to the
  workspace so the benchmark's 48 tests enter the gate (Opus 4.8) ·
  B4-2 community scaffolding: public roadmap from v1-spec gates,
  good-first-issues, adapter-proposal template (Sonnet 5) ·
  B4-3 cockpit + CLI loose ends: PlanningDebugPanel dead code, stranded
  widened-run affordance, `--jsonl` artifacts field, queue-request `surface`
  marker (Sonnet 5). Merge order: B4-2 → B4-3 → B4-1.
- **`SOLO-rename.md` staged** — the `@core/*`→`@aimcub/*` rename prompt.
  Run it ALONE (no parallel worktrees); schedule at will, ideally right
  before publish.
- The two eval-moat `@core` findings (fixed by B4-1): planning-context admits
  unrelated rows via function-word overlap (`RELEVANCE_STOPWORDS`,
  `packages/llm/src/planning-context.ts:61`); `critiquePlan` zeroes honestly
  human-routed plans (`manual_only_verification` / duplicate `manual_confirm`
  penalties) that the blind judge preferred.
- Post-batch-4 the epic reduces to the founder checklist + rename +
  distribution: license decision; `@aimcub` npm org; GitHub description /
  Discussions / private vuln reporting; CoC contact; Apple signing creds
  (then re-verify entitlements signed); gitleaks history scan; flip public;
  tag v0.1.0; npx/Homebrew after npm publish exists; **push authorization**.
- Smaller carried notes: "Learn more" in the consent control is text until a
  public repo URL exists; second-provider eval-moat run would size judge
  bias; store schema version still deferred.

## Next session

Integrate batch 4 (merge B4-2 → B4-3 → B4-1; gate now includes eval-moat
tests once B4-1 lands; re-run the benchmark dry-run as smoke). After that,
the remaining work is founder-gated launch execution — assemble the final
public-flip run-list when the license lands.
