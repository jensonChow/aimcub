import { describe, expect, it } from "vitest";
import { normalizeCiEvidence, normalizeCommitEvidence } from "./evidence";
import { globToRegExp, matchesPattern } from "./glob";

const T = "2026-06-07T10:00:00Z";

describe("normalizeCommitEvidence", () => {
  it("uses the first message line as summary and the sha as the idempotency key", () => {
    const e = normalizeCommitEvidence({ sha: "deadbeef", message: "feat: login\n\nbody", verified: true }, T);
    expect(e.kind).toBe("git_commit");
    expect(e.source_event_id).toBe("deadbeef");
    expect(e.summary).toBe("feat: login");
    expect(e.trust_score).toBe(1);
  });

  it("lowers trust for unverified commits", () => {
    const e = normalizeCommitEvidence({ sha: "x", message: "wip" }, T);
    expect(e.trust_score).toBe(0.7);
  });
});

describe("normalizeCiEvidence", () => {
  it("maps conclusion to ci_passed / ci_failed", () => {
    expect(normalizeCiEvidence({ conclusion: "success", runId: "r1" }, T).kind).toBe("ci_passed");
    expect(normalizeCiEvidence({ conclusion: "failure", runId: "r2" }, T).kind).toBe("ci_failed");
  });
});

describe("globToRegExp", () => {
  it("handles **/ as zero-or-more directory segments", () => {
    const re = globToRegExp("**/migrations/*");
    expect(re.test("db/migrations/001.sql")).toBe(true);
    expect(re.test("migrations/x.sql")).toBe(true);
    expect(re.test("src/app.ts")).toBe(false);
  });

  it("* stays within a path segment", () => {
    const re = globToRegExp("*.ts");
    expect(re.test("app.ts")).toBe(true);
    expect(re.test("src/app.ts")).toBe(false);
  });

  it("src/** matches nested files", () => {
    expect(globToRegExp("src/**").test("src/a/b.ts")).toBe(true);
  });
});

describe("matchesPattern", () => {
  it("treats valid regex as regex and falls back to substring", () => {
    expect(matchesPattern("^feat:", "feat: x")).toBe(true);
    expect(matchesPattern("[", "has [ bracket")).toBe(true); // 非法正则 → 子串包含
  });
});
