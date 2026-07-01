import { describe, expect, it } from "vitest";
import { AcceptanceRule, type Evidence } from "@core/types";
import { evaluate } from "./evaluate";

function ev(o: Partial<Evidence> & Pick<Evidence, "kind">): Evidence {
  return {
    id: o.id ?? "e",
    owner_id: o.owner_id ?? "u",
    goal_id: o.goal_id ?? "g",
    milestone_id: o.milestone_id ?? null,
    emitter_id: o.emitter_id ?? null,
    kind: o.kind,
    source_event_id: o.source_event_id ?? null,
    occurred_at: o.occurred_at ?? "2026-01-01T00:00:00Z",
    summary: o.summary ?? "",
    payload: o.payload ?? {},
    trust_score: o.trust_score ?? 1,
    created_at: o.created_at,
  };
}

const migrationCommit = ev({
  id: "c1",
  kind: "git_commit",
  trust_score: 1,
  payload: { sha: "abc", message: "add migration", files: ["db/migrations/001_init.sql"] },
});
const ciPass = ev({
  id: "ci1",
  kind: "ci_passed",
  trust_score: 1,
  payload: { workflow: "test", conclusion: "success", run_id: "r1" },
});

describe("evaluate · logic=all", () => {
  const rule = AcceptanceRule.parse({
    logic: "all",
    clauses: [
      { evaluator: "commit_pattern", match: { path_glob: "**/migrations/*", min_files: 1 } },
      { evaluator: "ci_status", match: { conclusion: "success", workflow: "test" } },
    ],
  });

  it("passes when all clauses matched", () => {
    const r = evaluate(rule, [migrationCommit, ciPass]);
    expect(r.passed).toBe(true);
    expect(r.matchedEvidenceIds.sort()).toEqual(["c1", "ci1"]);
    expect(r.trustScore).toBe(1);
  });

  it("fails when one clause unmatched", () => {
    const r = evaluate(rule, [migrationCommit]); // missing CI
    expect(r.passed).toBe(false);
    expect(r.clauseSatisfied).toEqual([true, false]);
  });

  it("does not match a commit outside the path_glob", () => {
    const other = ev({ id: "c2", kind: "git_commit", payload: { sha: "z", message: "ui", files: ["src/app.tsx"] } });
    const r = evaluate(rule, [other, ciPass]);
    expect(r.passed).toBe(false);
  });
});

describe("evaluate · logic=any / weighted", () => {
  it("any passes with a single matched clause", () => {
    const rule = AcceptanceRule.parse({
      logic: "any",
      clauses: [
        { evaluator: "commit_pattern", match: { path_glob: "**/migrations/*" } },
        { evaluator: "ci_status", match: { conclusion: "success" } },
      ],
    });
    expect(evaluate(rule, [migrationCommit]).passed).toBe(true);
  });

  it("weighted passes only when accumulated weight ≥ threshold", () => {
    const rule = AcceptanceRule.parse({
      logic: "weighted",
      threshold: 0.8,
      clauses: [
        { evaluator: "commit_pattern", weight: 0.3, match: { path_glob: "**/migrations/*" } },
        { evaluator: "ci_status", weight: 0.6, match: { conclusion: "success" } },
      ],
    });
    expect(evaluate(rule, [migrationCommit]).passed).toBe(false); // 0.3 < 0.8
    expect(evaluate(rule, [migrationCommit, ciPass]).passed).toBe(true); // 0.9 >= 0.8
  });
});

describe("evaluate · ci workflow name matching", () => {
  it("matches workflow names case-insensitively (plan says 'ci', workflow is named 'CI')", () => {
    const rule = AcceptanceRule.parse({
      logic: "all",
      clauses: [{ evaluator: "ci_status", match: { conclusion: "success", workflow: "ci" } }],
    });
    const upperCased = ev({
      id: "ci2",
      kind: "ci_passed",
      payload: { workflow: "CI", conclusion: "success", run_id: "r2" },
    });
    expect(evaluate(rule, [upperCased]).passed).toBe(true);
  });

  it("still rejects a different workflow name", () => {
    const rule = AcceptanceRule.parse({
      logic: "all",
      clauses: [{ evaluator: "ci_status", match: { conclusion: "success", workflow: "deploy" } }],
    });
    expect(evaluate(rule, [ciPass]).passed).toBe(false);
  });
});

describe("evaluate · anti-spoofing (auto_verifiable)", () => {
  it("rejects low-trust evidence for an auto_verifiable clause", () => {
    const rule = AcceptanceRule.parse({
      logic: "all",
      clauses: [{ evaluator: "commit_pattern", auto_verifiable: true, match: { path_glob: "**/migrations/*" } }],
    });
    const lowTrust = ev({
      id: "m1",
      kind: "git_commit",
      trust_score: 0.5, // unattested / low-trust source
      payload: { sha: "x", message: "m", files: ["db/migrations/x.sql"] },
    });
    expect(evaluate(rule, [lowTrust]).passed).toBe(false);
    expect(evaluate(rule, [migrationCommit]).passed).toBe(true); // same glob, but trust=1
  });
});

describe("evaluate · manual_confirm", () => {
  it("matches a trusted manual_check evidence row", () => {
    const rule = AcceptanceRule.parse({
      logic: "all",
      completion_mode: "manual",
      clauses: [{ evaluator: "manual_confirm", match: {} }],
    });
    const manual = ev({
      id: "manual1",
      kind: "manual_check",
      payload: { confirmed: true },
      trust_score: 1,
    });
    const r = evaluate(rule, [manual]);
    expect(r.passed).toBe(true);
    expect(r.matchedEvidenceIds).toEqual(["manual1"]);
  });

  it("rejects an explicit negative manual check", () => {
    const rule = AcceptanceRule.parse({
      logic: "all",
      clauses: [{ evaluator: "manual_confirm", match: {} }],
    });
    expect(evaluate(rule, [ev({ kind: "manual_check", payload: { confirmed: false } })]).passed).toBe(false);
  });
});
