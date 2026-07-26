/**
 * Files the user hands to a planning brain that is already running.
 *
 * The brain reads local files with its runtime's OWN tools (`Read`, `Glob`, `Grep`), and those
 * are sandboxed by `extraAllowedDirs`, which is baked into the process arguments at spawn. A file
 * picked in the middle of a pass therefore sits outside the sandbox no matter what we tell the
 * brain about it — naming the path would produce a confident-looking read failure rather than an
 * attachment.
 *
 * So every session gets its own staging directory, granted at spawn and empty at first. Attaching
 * copies the file in, which is the whole reason an attachment can arrive mid-pass at all.
 *
 * Copies, not symlinks: a runtime that refuses to follow a link out of its sandbox would fail in
 * exactly the case this exists for. Staging into a temp directory also means Aimcub never writes
 * into the user's own folders in order to read from them.
 */
import { copyFileSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";

/**
 * Per-file ceiling on what gets copied. Planning material is documents; a multi-gigabyte disk
 * image is a mis-click, and silently copying it into temp is worse than saying no. Rejections are
 * always reported — never dropped — so the user learns the file did not reach the brain.
 */
export const MAX_ATTACHMENT_BYTES = 64 * 1024 * 1024;

export interface StagedAttachment {
  /** Where the user's file actually lives; what a resumed pass re-stages from. */
  originalPath: string;
  /** The copy inside the granted directory — the path the brain is told to read. */
  stagedPath: string;
  /** Basename as shown to the user and named to the brain. */
  name: string;
  bytes: number;
}

export interface RejectedAttachment {
  path: string;
  /** Why it did not reach the brain, in words the surface can show as-is. */
  reason: string;
}

export interface AttachmentStageResult {
  staged: StagedAttachment[];
  rejected: RejectedAttachment[];
}

/**
 * A staged name that will not collide inside the directory. Two files called `notes.md` from
 * different folders are an ordinary thing to attach, and the second one silently overwriting the
 * first would hand the brain one file while the user believes it has two.
 */
export function uniqueAttachmentName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name;
  const ext = extname(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  for (let index = 2; ; index += 1) {
    const candidate = `${stem} (${index})${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** A private directory for one session's attachments. Granted at spawn, so it must exist first. */
export function createAttachmentStage(): string {
  return mkdtempSync(join(tmpdir(), "aimcub-planning-files-"));
}

/** Drop a session's staged copies. Failure is ignored: temp cleanup must never break a session. */
export function removeAttachmentStage(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // A leftover temp directory is the OS's problem, not the user's.
  }
}

/**
 * Copy the picked files into the session's granted directory. Each file is judged on its own: one
 * unreadable or oversized path never costs the user the rest of the selection.
 */
export function stageAttachments(dir: string, paths: readonly string[]): AttachmentStageResult {
  const taken = new Set<string>(readdirSafe(dir));
  const staged: StagedAttachment[] = [];
  const rejected: RejectedAttachment[] = [];
  for (const raw of paths) {
    const originalPath = raw.trim();
    if (!originalPath) continue;
    try {
      const stats = statSync(originalPath);
      if (stats.isDirectory()) {
        rejected.push({ path: originalPath, reason: "Folders cannot be attached — pick the files inside it." });
        continue;
      }
      if (stats.size > MAX_ATTACHMENT_BYTES) {
        rejected.push({ path: originalPath, reason: "Larger than 64 MB." });
        continue;
      }
      const name = uniqueAttachmentName(basename(originalPath), taken);
      const stagedPath = join(dir, name);
      copyFileSync(originalPath, stagedPath);
      taken.add(name);
      staged.push({ originalPath, stagedPath, name, bytes: stats.size });
    } catch {
      rejected.push({ path: originalPath, reason: "Could not be read." });
    }
  }
  return { staged, rejected };
}

function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * What the brain is told when files arrive. It rides the ordinary user-message channel — an
 * attachment is the user speaking, and the session machine already delivers those mid-research or
 * folds them into a pending question's reply.
 *
 * The message names the directory and every file in it, because the brain's own `Glob` may not be
 * pointed there and a path it has to guess is a path it will fail to read.
 */
export function attachmentMessage(dir: string, files: readonly StagedAttachment[]): string {
  const lines = files.map((file) => `- ${file.stagedPath}`);
  return [
    files.length === 1
      ? "I attached a file for you to read:"
      : `I attached ${files.length} files for you to read:`,
    ...lines,
    `They are readable in ${dir}. Read them now and use them in your research before you plan.`,
  ].join("\n");
}
