import { describe, expect, it } from "vitest";
import type { AcceptanceRule } from "@core/types";
import { acceptanceClauseSummaries, acceptanceSummary } from "./acceptance";

describe("acceptanceSummary", () => {
  it("summarizes an all-of commit + ci rule", () => {
    const rule: AcceptanceRule = {
      logic: "all",
      threshold: 1,
      completion_mode: "auto_then_confirm",
      clauses: [
        { evaluator: "commit_pattern", auto_verifiable: true, match: { path_glob: "src/**", min_files: 2 } },
        { evaluator: "ci_status", auto_verifiable: true, match: { conclusion: "success" } },
      ],
    };
    const summary = acceptanceSummary(rule);
    expect(summary).toContain("all of");
    expect(summary).toContain("src/**");
    expect(summary).toContain("CI = success");
  });

  it("labels weighted logic with its threshold", () => {
    const rule: AcceptanceRule = {
      logic: "weighted",
      threshold: 0.5,
      completion_mode: "auto",
      clauses: [{ evaluator: "ci_status", auto_verifiable: true, weight: 1, match: { conclusion: "success" } }],
    };
    expect(acceptanceSummary(rule)).toContain("weighted ≥ 0.5");
  });

  it("labels any-of logic", () => {
    const rule: AcceptanceRule = {
      logic: "any",
      threshold: 1,
      completion_mode: "auto",
      clauses: [{ evaluator: "commit_pattern", auto_verifiable: true, match: { message_pattern: "feat" } }],
    };
    expect(acceptanceSummary(rule).startsWith("any of:")).toBe(true);
  });
});

describe("acceptanceClauseSummaries", () => {
  it("returns one summary per clause", () => {
    const rule: AcceptanceRule = {
      logic: "all",
      threshold: 1,
      completion_mode: "auto",
      clauses: [
        { evaluator: "commit_pattern", auto_verifiable: true, match: { branch: "main" } },
        { evaluator: "ci_status", auto_verifiable: true, match: { workflow: "ci", conclusion: "success" } },
      ],
    };
    const list = acceptanceClauseSummaries(rule);
    expect(list).toHaveLength(2);
    expect(list[0]).toContain("branch main");
    expect(list[1]).toContain("CI ci = success");
  });
});
