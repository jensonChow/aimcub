import { describe, expect, it } from "vitest";
import type { AcceptanceRule } from "@aimcub/types";

import { summarizeRule } from "./summarize";

describe("summarizeRule", () => {
  it("keeps commit rules user-facing", () => {
    const rule: AcceptanceRule = {
      logic: "all",
      threshold: 1,
      completion_mode: "auto_then_confirm",
      clauses: [
        {
          evaluator: "commit_pattern",
          auto_verifiable: true,
          match: { path_glob: "research/cambodia-travel-basics.md", message_pattern: "add", min_files: 1 },
        },
      ],
    };

    const summary = summarizeRule(rule);

    expect(summary).toBe("A matching commit that touches research/cambodia-travel-basics.md and updates 1 or more files");
    expect(summary).not.toContain("commit_pattern");
    expect(summary).not.toContain("msg:");
    expect(summary).not.toContain("all of");
  });

  it("combines checks without exposing rule logic labels", () => {
    const rule: AcceptanceRule = {
      logic: "all",
      threshold: 1,
      completion_mode: "auto",
      clauses: [
        { evaluator: "commit_pattern", auto_verifiable: true, match: { branch: "main" } },
        { evaluator: "ci_status", auto_verifiable: true, match: { workflow: "desktop", conclusion: "success" } },
      ],
    };

    expect(summarizeRule(rule)).toBe("A matching commit that lands on main and desktop checks pass");
  });
});
