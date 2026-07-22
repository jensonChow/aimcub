# wt/store-hardening — crash-safe, multi-process local JSON store

Closes the documented "concurrent Desktop and CLI writes" and silent-corruption limitations of
`@core/store` without SQLite, new dependencies, or schema changes. Footprint: `packages/store/**`
only (`pnpm-lock.yaml` untouched; Desktop/CLI call sites unchanged).

## What changed

**New `packages/store/src/safe-fs.ts`** — dependency-free node-fs primitives:

- `writeFileAtomic()` — same-dir temp file → `fsync` → `rename` + a directory fsync so the rename
  itself is durable. Temp file removed on any failure (no debris); symlinked destinations are
  resolved first. Windows caveats (rename EPERM/EBUSY, no directory fsync) are best-effort and
  documented in the module header.
- `readJsonFileSafe()` — missing file ⇒ clean empty, no warning. Present but
  unreadable/unparsable/wrong-shape ⇒ quarantine to `store.json.corrupt-<ISO>`, recover from
  `store.json.bak`, restore the good bytes to the live path, and report every step through
  `console.warn` + returned diagnostics.
- `writeJsonFileWithBackup()` — atomic write, then mirror the same bytes into `.bak`.
- `acquireStoreLock()` — advisory lock file (`store.lock`) holding `{pid, acquiredAt, token}`,
  created with `wx` (atomic exclusive create), bounded retry with `Atomics.wait` backoff,
  stale reclaim when the holder pid is dead (`process.kill(pid, 0)`) or the lock exceeds
  `staleMs` (30s default), and a timeout error (5s default) naming the holding pid. Reclaim and
  release both re-verify the holder token, so neither can delete someone else's lock.

**`packages/store/src/index.ts`**

- All 24 mutating methods now run inside `withWriteLock(() => …)`, so the lock spans the whole
  `load → mutate → save` cycle; the fresh load under the lock is what makes Desktop-vs-CLI
  interleaving serialize instead of clobber. Reentrancy-guarded. Read-only methods stay lockless.
- `load()` routes through `readJsonFileSafe`; the old `catch { return emptyStore() }` (the
  data-loss bug) is gone. New `normalizeLocalStore()` THROWS on non-object content or a
  wrong-typed collection, so "parses as JSON but is not a store" also gets quarantine+recovery.
- Additive `AimStore.getDiagnostics(): Promise<StoreDiagnostic[]>` (only implementation in the
  repo, so nothing else needed updating). New optional `JsonFileStoreOptions.lock`.
- `importData("replace")` loads first (quarantines an unusable file rather than overwriting it)
  and saves through the same safe path.
- `saveSettings` / `saveWebResearchSettings` / `saveContextSourceSettings` now write atomically
  and still land at 0600 (mode re-applied after `open`, since umask filters the create mode).

## Decisions

- **Backup mirrors the last committed save (post-write) rather than copying the old file aside
  (pre-write).** A pre-write `.bak` is always one generation behind, so every recovery silently
  loses the last successful operation — a test caught exactly that. Post-write mirroring makes
  recovery lossless and means only bytes we just wrote can ever become the backup.
- **Blocking (`Atomics.wait`) rather than async waiting.** The store is synchronous fs under
  async signatures; a real wait for another process has to block. Bounded by `timeoutMs`.
- **Reads stay lockless** — atomic rename already guarantees readers a whole file, and locking
  reads would let a stale lock block the UI. Evidence append-only / derived completions untouched.

## Out of scope (handoff items — flagged, not forked)

- `packages/store/package.json` `description` and `docs/memory/architecture.md` still describe
  the store as last-writer-wins; the integrating session should refresh that wording.
- Desktop could surface `getDiagnostics()` (a recovery banner) — call-site work in `apps/*`.
- Under real contention an Electron main-process write blocks up to `timeoutMs` (5s default);
  a call site may want to pass a shorter timeout. `apps/desktop/src/main/index.ts:124`'s
  single-instance lock is now redundant for store safety but still correct for Desktop-vs-Desktop.
- No store-level schema version (explicitly deferred by the mission) — the natural next step if
  the on-disk shape ever changes incompatibly.
- Settings files are atomic but not lock-guarded: they are whole-file writes with no
  read-modify-write cycle, so last-writer-wins there is intentional.

## Verification

- Full gate green: `pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm core:purity`.
- `@core/store`: **88 tests** = the existing 72 passing **completely unmodified** (no test
  asserted the old broken behavior) + **16 new** in `src/store-durability.test.ts`: interleaving
  of two instances over one dataDir (all writes survive, both instances agree), corruption with
  and without a backup, truncated-file and wrong-shape recovery, first-run silence, post-recovery
  round-trip, `importData(replace)`, held-lock timeout naming the pid, every mutator waiting on
  the lock while reads pass, lock released on a thrown mutation, dead-pid and aged-out reclaim,
  a real second **process** holding then releasing the lock, plus no-temp/no-lock debris,
  `.bak` mirroring, and 0600 settings perms.
- Repo-wide test totals unchanged elsewhere (283 desktop, 170 llm, 114 mcp, 88 cli, 36 db, 10 local-agent).
- Deterministic seed (`examples/local-alpha`, per its README) into an isolated `AIMCUB_HOME`:
  seeded store loads (4 sub-aims, 1 complete, 2 evidence, zero diagnostics), a mutation
  round-trips through a fresh store instance, and corrupting that seeded `store.json` recovers
  the full seed (`corrupt_quarantined -> recovered_from_backup`) with the quarantine file kept
  and no lock/temp leftovers.
