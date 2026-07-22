/**
 * Crash-safe local-file primitives for the JSON store.
 *
 * Three properties the plain `writeFileSync` store could not offer:
 *
 * 1. ATOMIC WRITES — same-directory temp file + `fsync` + `rename`. A reader never observes a
 *    half-written file, and a crash mid-write leaves the previous file intact instead of a
 *    truncated one.
 * 2. CORRUPTION SAFETY — a known-good `.bak` refreshed on every successful save, plus quarantine
 *    + recovery on load. A corrupt store must never present as an empty store (silent data loss
 *    is worse than a crash).
 * 3. CROSS-PROCESS MUTUAL EXCLUSION — a hand-rolled advisory lock file so Desktop and the CLI
 *    can share one `~/.aimcub` without clobbering each other's whole-file writes.
 *
 * Deliberately dependency-free (node fs only): a single-user local store does not justify
 * SQLite or a lockfile package — lean-first.
 *
 * PLATFORM: POSIX/macOS is the target. On Windows `rename` over an existing file still replaces
 * it atomically, but it can fail with EPERM/EBUSY when another process (indexer, antivirus) has
 * the destination open, and a directory handle cannot be fsync'd — both are handled as
 * best-effort below rather than as hard failures.
 */
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

/** Prefix for every operator-facing warning this module emits. */
const LOG_PREFIX = "[@core/store]";

// ──────────────────────────────────────────────────────────────────────────
// Atomic writes
// ──────────────────────────────────────────────────────────────────────────

let tempCounter = 0;

/**
 * Follow a symlink to the file it points at, so an atomic write REPLACES THE CONTENT the user
 * expects (e.g. `~/.aimcub/store.json` symlinked into a synced folder) rather than replacing the
 * symlink with a regular file. Unresolvable (i.e. not yet created) paths are used as-is.
 */
function resolveWriteTarget(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** fsync the directory so the rename itself — not just the bytes — survives a power loss. */
function syncDirectory(dir: string): void {
  let fd: number | null = null;
  try {
    fd = openSync(dir, "r");
    fsyncSync(fd);
  } catch {
    /* Windows cannot open a directory for fsync; the rename is still atomic there. */
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        /* best-effort close */
      }
    }
  }
}

/**
 * Write `data` to `path` atomically: a same-directory temp file is written and fsync'd, then
 * renamed over the destination. Any reader sees either the whole old file or the whole new one.
 * The temp file is removed if anything fails, so a failed write leaves no debris.
 */
export function writeFileAtomic(path: string, data: string | Uint8Array, options: { mode?: number } = {}): void {
  const target = resolveWriteTarget(path);
  const dir = dirname(target);
  mkdirSync(dir, { recursive: true });
  // Same directory as the destination — `rename` is only atomic within one filesystem.
  const tmp = join(
    dir,
    `.${basename(target)}.${process.pid.toString(36)}-${(tempCounter++).toString(36)}-${Date.now().toString(36)}.tmp`,
  );
  try {
    const fd = openSync(tmp, "wx", options.mode ?? 0o666);
    try {
      writeFileSync(fd, data);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    if (options.mode !== undefined) {
      // `open` mode is filtered by umask; re-apply so a secrets file is exactly 0600.
      try {
        chmodSync(tmp, options.mode);
      } catch {
        /* best-effort (e.g. Windows) */
      }
    }
    renameSync(tmp, target);
  } catch (error) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      /* nothing further to do — the write already failed */
    }
    throw error;
  }
  syncDirectory(dir);
}

// ──────────────────────────────────────────────────────────────────────────
// Corruption safety: previous-good backup, quarantine, recovery
// ──────────────────────────────────────────────────────────────────────────

/** What the store noticed about its own files. Surfaced by `AimStore.getDiagnostics()`. */
export type StoreDiagnosticKind =
  /** The live file existed but could not be read/parsed/normalized. `quarantinePath` is set when it could be moved aside. */
  | "corrupt_quarantined"
  /** The previous-good backup parsed and was restored to the live path. */
  | "recovered_from_backup"
  /** A backup existed but was itself unusable. */
  | "backup_unusable"
  /** No backup existed, so the store started empty (data was NOT silently discarded — see quarantine). */
  | "no_backup";

/** One recovery/corruption event. Additive, queryable API — nothing here is silent. */
export interface StoreDiagnostic {
  kind: StoreDiagnosticKind;
  /** ISO timestamp of when the store noticed. */
  at: string;
  /** The same one-liner that was sent to `console.warn`. */
  message: string;
  /** The file the event is about. */
  path: string;
  /** Where the unusable file was moved for forensics. */
  quarantinePath?: string;
  /** The backup that was consulted. */
  backupPath?: string;
  /** Underlying error text, when there was one. */
  detail?: string;
}

export interface SafeReadResult<T> {
  /** The normalized content, or `null` when there is nothing usable on disk. */
  value: T | null;
  /** Empty on a clean read or a clean first run. */
  diagnostics: StoreDiagnostic[];
}

/** Path of the known-good copy kept beside a persisted file. */
export function backupPathFor(file: string): string {
  return `${file}.bak`;
}

/** Filesystem-safe timestamped quarantine path (colons are hostile on some filesystems). */
export function quarantinePathFor(file: string, at: Date = new Date()): string {
  return `${file}.corrupt-${at.toISOString().replace(/[:.]/g, "-")}`;
}

function asErrorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function record(diagnostics: StoreDiagnostic[], diagnostic: StoreDiagnostic): void {
  diagnostics.push(diagnostic);
  console.warn(`${LOG_PREFIX} ${diagnostic.message}`);
}

function tryReadNormalized<T>(file: string, normalize: (raw: unknown) => T): { ok: true; value: T } | { ok: false; error: string } {
  try {
    return { ok: true, value: normalize(JSON.parse(readFileSync(file, "utf8")) as unknown) };
  } catch (error) {
    return { ok: false, error: asErrorText(error) };
  }
}

/**
 * Read a JSON file that must never fail silently.
 *
 * - Missing file ⇒ `{ value: null }` with NO diagnostics: a clean first run is not an incident.
 * - Present but unreadable/unparsable/not normalizable ⇒ the file is QUARANTINED (renamed with a
 *   timestamp, kept for forensics), the `.bak` is tried, and every step is reported.
 *
 * `normalize` must throw when the parsed value is not a usable store — that is what turns
 * "parses as JSON but is not our shape" into a recoverable incident instead of an empty store.
 */
export function readJsonFileSafe<T>(file: string, normalize: (raw: unknown) => T): SafeReadResult<T> {
  const diagnostics: StoreDiagnostic[] = [];
  if (!existsSync(file)) return { value: null, diagnostics };

  const direct = tryReadNormalized(file, normalize);
  if (direct.ok) return { value: direct.value, diagnostics };

  // The live file is unusable. Move it aside BEFORE anything can overwrite it: the user's rows
  // may still be extractable by hand, and a silent empty store would hide that forever.
  const at = new Date();
  const quarantinePath = quarantinePathFor(file, at);
  let quarantined = false;
  try {
    renameSync(file, quarantinePath);
    quarantined = true;
  } catch (error) {
    // ENOENT here means another process quarantined the same file first — that is fine.
    record(diagnostics, {
      kind: "corrupt_quarantined",
      at: at.toISOString(),
      message: `${file} is unusable (${direct.error}) and could not be quarantined (${asErrorText(error)}).`,
      path: file,
      detail: direct.error,
    });
  }
  if (quarantined) {
    record(diagnostics, {
      kind: "corrupt_quarantined",
      at: at.toISOString(),
      message: `${file} is unusable (${direct.error}); kept for inspection at ${quarantinePath}.`,
      path: file,
      quarantinePath,
      detail: direct.error,
    });
  }

  const backup = backupPathFor(file);
  if (!existsSync(backup)) {
    record(diagnostics, {
      kind: "no_backup",
      at: at.toISOString(),
      message: `No known-good backup at ${backup}; starting from an empty store.`,
      path: file,
      backupPath: backup,
    });
    return { value: null, diagnostics };
  }

  const recovered = tryReadNormalized(backup, normalize);
  if (!recovered.ok) {
    record(diagnostics, {
      kind: "backup_unusable",
      at: at.toISOString(),
      message: `Backup ${backup} is also unusable (${recovered.error}); starting from an empty store.`,
      path: file,
      backupPath: backup,
      detail: recovered.error,
    });
    return { value: null, diagnostics };
  }

  // Put the good bytes back at the live path so lock-free readers see them too. If two processes
  // recover at once they write identical content through atomic renames, so this cannot tear.
  // Only when the quarantine succeeded: otherwise the unusable file is still sitting at `file`,
  // and restoring over it would destroy the only copy of whatever the user actually had.
  if (quarantined) {
    try {
      writeFileAtomic(file, readFileSync(backup));
    } catch (error) {
      record(diagnostics, {
        kind: "backup_unusable",
        at: at.toISOString(),
        message: `Recovered from ${backup} but could not restore ${file} (${asErrorText(error)}).`,
        path: file,
        backupPath: backup,
        detail: asErrorText(error),
      });
      return { value: recovered.value, diagnostics };
    }
  }

  record(diagnostics, {
    kind: "recovered_from_backup",
    at: at.toISOString(),
    message: `Recovered ${file} from ${backup}.`,
    path: file,
    backupPath: backup,
    quarantinePath: quarantined ? quarantinePath : undefined,
  });
  return { value: recovered.value, diagnostics };
}

/**
 * Atomically persist `text` to `file`, then mirror the same bytes into the `.bak`.
 *
 * Mirroring AFTER the successful write (rather than copying the old file aside before it) is
 * what makes recovery lossless: the backup holds the last COMMITTED state, so a store.json
 * destroyed by something outside this module costs the user nothing. It also means only bytes
 * this module just wrote can ever become the backup — garbage can never be promoted into it.
 */
export function writeJsonFileWithBackup(file: string, text: string): void {
  writeFileAtomic(file, text);
  try {
    writeFileAtomic(backupPathFor(file), text);
  } catch {
    /* The backup is insurance; failing to refresh it must never fail a successful save. */
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Cross-process advisory lock
// ──────────────────────────────────────────────────────────────────────────

/** Wait this long for the lock before giving up with a descriptive error. */
const DEFAULT_LOCK_TIMEOUT_MS = 5_000;
/** A lock older than this is assumed abandoned even if some process still owns the pid. */
const DEFAULT_LOCK_STALE_MS = 30_000;
/** Backoff between acquisition attempts. */
const DEFAULT_LOCK_RETRY_MS = 20;

export interface StoreLockOptions {
  /** Max total wait before {@link acquireStoreLock} throws. Default 5000ms. */
  timeoutMs?: number;
  /** Age at which a lock is reclaimable regardless of its pid. Default 30000ms. */
  staleMs?: number;
  /** Backoff between attempts. Default 20ms. */
  retryMs?: number;
}

/** What a lock file contains. Written as JSON so a human can read who is holding the store. */
export interface StoreLockPayload {
  pid: number;
  /** ISO timestamp of acquisition. */
  acquiredAt: string;
  /** Distinguishes successive locks from the same pid, so a release cannot delete a newer lock. */
  token: string;
}

export interface StoreLockHandle {
  release(): void;
}

interface LockHolder {
  payload: StoreLockPayload | null;
  mtimeMs: number;
}

/** The advisory lock file guarding whole-file writes to `store.json`. */
export function storeLockPath(dataDir: string): string {
  return join(dataDir, "store.lock");
}

function isErrnoCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && (error as NodeJS.ErrnoException).code === code;
}

/** A pid we cannot signal is dead; EPERM means alive but owned by another user. */
function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isErrnoCode(error, "EPERM");
  }
}

function readLockHolder(lockPath: string): LockHolder | null {
  let mtimeMs: number;
  try {
    mtimeMs = statSync(lockPath).mtimeMs;
  } catch {
    return null; // the lock vanished between the failed create and this read
  }
  try {
    const raw = JSON.parse(readFileSync(lockPath, "utf8")) as Partial<StoreLockPayload>;
    if (typeof raw?.pid === "number" && typeof raw.acquiredAt === "string" && typeof raw.token === "string") {
      return { payload: { pid: raw.pid, acquiredAt: raw.acquiredAt, token: raw.token }, mtimeMs };
    }
  } catch {
    /* An empty/torn lock file is possible: creation and content are two steps. Fall back to mtime. */
  }
  return { payload: null, mtimeMs };
}

function lockAgeMs(holder: LockHolder, now: number): number {
  const acquiredAt = holder.payload ? Date.parse(holder.payload.acquiredAt) : Number.NaN;
  const since = Number.isFinite(acquiredAt) ? acquiredAt : holder.mtimeMs;
  return now - since;
}

function isStale(holder: LockHolder, staleMs: number, now: number): boolean {
  if (holder.payload && !isProcessAlive(holder.payload.pid)) return true;
  return lockAgeMs(holder, now) > staleMs;
}

function sameHolder(a: LockHolder | null, b: LockHolder): boolean {
  if (a === null) return false;
  if (a.payload && b.payload) return a.payload.token === b.payload.token;
  if (a.payload || b.payload) return false;
  return a.mtimeMs === b.mtimeMs;
}

/**
 * Remove a lock we judged abandoned. The re-read + `rename` makes the reclaim itself a race
 * winner-takes-all: if another process reclaimed (or the holder released and re-locked) first,
 * we see a different token / lose the rename and simply retry.
 */
function reclaimStaleLock(lockPath: string, holder: LockHolder): boolean {
  if (!sameHolder(readLockHolder(lockPath), holder)) return false;
  const claimed = `${lockPath}.stale-${process.pid.toString(36)}-${Date.now().toString(36)}`;
  try {
    renameSync(lockPath, claimed);
  } catch {
    return false; // someone else got there first
  }
  try {
    unlinkSync(claimed);
  } catch {
    /* best-effort cleanup; the file is already out of the way */
  }
  console.warn(
    `${LOG_PREFIX} Reclaimed a stale store lock at ${lockPath}` +
      (holder.payload ? ` (pid ${holder.payload.pid}, held since ${holder.payload.acquiredAt}).` : "."),
  );
  return true;
}

/**
 * Sleep without yielding the event loop. The whole store is synchronous fs under async
 * signatures, so a blocking wait is what "wait for the other process" has to mean here.
 * `Atomics.wait` parks the thread instead of burning CPU; the spin is only a fallback.
 */
const sleepSignal = typeof SharedArrayBuffer === "function" ? new Int32Array(new SharedArrayBuffer(4)) : null;

function sleepSync(ms: number): void {
  if (ms <= 0) return;
  if (sleepSignal) {
    Atomics.wait(sleepSignal, 0, 0, ms);
    return;
  }
  const until = Date.now() + ms;
  while (Date.now() < until) {
    /* busy-wait fallback when SharedArrayBuffer is unavailable */
  }
}

function lockTimeoutError(lockPath: string, holder: LockHolder | null, timeoutMs: number): Error {
  const held = holder?.payload
    ? `pid ${holder.payload.pid} (held since ${holder.payload.acquiredAt})`
    : "an unidentified process";
  return new Error(
    `Timed out after ${timeoutMs}ms waiting for the Aimcub store lock at ${lockPath}: it is held by ${held}. ` +
      "Close the other Aimcub Desktop/CLI process, or delete the lock file if that process is gone.",
  );
}

/**
 * Take the cross-process write lock for `dataDir`. Callers MUST release it in a `finally`.
 *
 * Exclusive creation (`wx`) is the primitive: it is atomic on local POSIX filesystems, so
 * exactly one process wins. Abandoned locks (dead holder pid, or older than `staleMs`) are
 * reclaimed so a crashed Desktop can never wedge the CLI forever.
 */
export function acquireStoreLock(dataDir: string, options: StoreLockOptions = {}): StoreLockHandle {
  const timeoutMs = Math.max(0, options.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS);
  const staleMs = Math.max(0, options.staleMs ?? DEFAULT_LOCK_STALE_MS);
  const retryMs = Math.max(1, options.retryMs ?? DEFAULT_LOCK_RETRY_MS);
  const lockPath = storeLockPath(dataDir);
  mkdirSync(dataDir, { recursive: true });

  const payload: StoreLockPayload = { pid: process.pid, acquiredAt: new Date().toISOString(), token: randomUUID() };
  const body = JSON.stringify(payload);
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    try {
      writeFileSync(lockPath, body, { encoding: "utf8", flag: "wx" });
      return { release: () => releaseStoreLock(lockPath, payload) };
    } catch (error) {
      if (!isErrnoCode(error, "EEXIST")) throw error;
    }

    const holder = readLockHolder(lockPath);
    const now = Date.now();
    if (holder !== null && isStale(holder, staleMs, now) && reclaimStaleLock(lockPath, holder)) continue;
    if (now >= deadline) throw lockTimeoutError(lockPath, holder, timeoutMs);
    sleepSync(Math.min(retryMs, Math.max(1, deadline - now)));
  }
}

/** Release a lock we own. A lock reclaimed from under us is left alone — it is someone else's now. */
function releaseStoreLock(lockPath: string, payload: StoreLockPayload): void {
  const holder = readLockHolder(lockPath);
  if (holder?.payload && holder.payload.token !== payload.token) return;
  try {
    unlinkSync(lockPath);
  } catch {
    /* already gone (reclaimed as stale) — nothing to release */
  }
}
