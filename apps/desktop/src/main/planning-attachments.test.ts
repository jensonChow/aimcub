/**
 * Staging is the only reason a mid-pass attachment can work at all, so its failure modes are the
 * interesting part: the brain's sandbox is already fixed, and anything that does not land in the
 * staging directory is a file the user believes it has and it cannot read.
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  MAX_ATTACHMENT_BYTES,
  attachmentMessage,
  createAttachmentStage,
  removeAttachmentStage,
  stageAttachments,
  uniqueAttachmentName,
} from "./planning-attachments";

let source: string;
let stage: string;

beforeEach(() => {
  source = mkdtempSync(join(tmpdir(), "aimcub-attach-src-"));
  stage = createAttachmentStage();
});

afterEach(() => {
  rmSync(source, { recursive: true, force: true });
  removeAttachmentStage(stage);
});

function file(name: string, contents = "hello"): string {
  const path = join(source, name);
  writeFileSync(path, contents);
  return path;
}

describe("uniqueAttachmentName", () => {
  it("keeps the basename free of collisions so two same-named files both survive", () => {
    // Attaching notes.md from two folders is ordinary; the second overwriting the first would
    // hand the brain one file while the user believes it has two.
    expect(uniqueAttachmentName("notes.md", new Set())).toBe("notes.md");
    expect(uniqueAttachmentName("notes.md", new Set(["notes.md"]))).toBe("notes (2).md");
    expect(uniqueAttachmentName("notes.md", new Set(["notes.md", "notes (2).md"]))).toBe("notes (3).md");
    // Extensionless names still get a suffix rather than a stray trailing dot.
    expect(uniqueAttachmentName("LICENSE", new Set(["LICENSE"]))).toBe("LICENSE (2)");
  });
});

describe("stageAttachments", () => {
  it("copies picked files into the granted directory, contents intact", () => {
    const result = stageAttachments(stage, [file("spec.md", "the real contents")]);
    expect(result.rejected).toEqual([]);
    expect(result.staged).toHaveLength(1);
    const staged = result.staged[0]!;
    expect(staged.name).toBe("spec.md");
    expect(staged.originalPath).toBe(join(source, "spec.md"));
    expect(readFileSync(staged.stagedPath, "utf8")).toBe("the real contents");
  });

  it("keeps both files when two attachments share a basename", () => {
    const nested = join(source, "nested");
    mkdirSync(nested);
    writeFileSync(join(nested, "notes.md"), "second");
    const result = stageAttachments(stage, [file("notes.md", "first"), join(nested, "notes.md")]);
    expect(result.staged.map((entry) => entry.name)).toEqual(["notes.md", "notes (2).md"]);
    expect(readFileSync(result.staged[0]!.stagedPath, "utf8")).toBe("first");
    expect(readFileSync(result.staged[1]!.stagedPath, "utf8")).toBe("second");
  });

  it("staging twice adds to the directory instead of colliding with the first batch", () => {
    stageAttachments(stage, [file("a.md")]);
    const second = stageAttachments(stage, [file("b.md")]);
    expect(second.staged).toHaveLength(1);
    expect(readdirSync(stage).sort()).toEqual(["a.md", "b.md"]);
  });

  it("judges each file on its own — one bad path never costs the rest of the selection", () => {
    const folder = join(source, "a-folder");
    mkdirSync(folder);
    const huge = join(source, "huge.bin");
    writeFileSync(huge, Buffer.alloc(MAX_ATTACHMENT_BYTES + 1));
    const result = stageAttachments(stage, [
      file("good.md"),
      folder,
      huge,
      join(source, "not-there.md"),
      file("also-good.md"),
    ]);
    expect(result.staged.map((entry) => entry.name)).toEqual(["good.md", "also-good.md"]);
    // Every failure is reported: a file the brain never received must not pass in silence.
    expect(result.rejected.map((entry) => entry.path)).toEqual([folder, huge, join(source, "not-there.md")]);
    expect(result.rejected.every((entry) => entry.reason.trim().length > 0)).toBe(true);
  });
});

describe("attachmentMessage", () => {
  it("names every staged path, because a path the brain guesses is one it fails to read", () => {
    const message = attachmentMessage("/stage", [
      { originalPath: "/home/a.md", stagedPath: "/stage/a.md", name: "a.md", bytes: 1 },
      { originalPath: "/home/b.pdf", stagedPath: "/stage/b.pdf", name: "b.pdf", bytes: 2 },
    ]);
    expect(message).toContain("I attached 2 files");
    expect(message).toContain("/stage/a.md");
    expect(message).toContain("/stage/b.pdf");
    expect(message).toContain("/stage");
  });

  it("counts one file as one file", () => {
    const message = attachmentMessage("/stage", [
      { originalPath: "/home/a.md", stagedPath: "/stage/a.md", name: "a.md", bytes: 1 },
    ]);
    expect(message).toContain("I attached a file");
    expect(message).not.toContain("1 files");
  });
});
