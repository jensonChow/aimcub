import type { AcceptanceRule } from "@core/types";

/** A compact, human-readable summary of a milestone's acceptance rule. */
export function summarizeRule(rule: AcceptanceRule): string {
  const parts = rule.clauses.map((c) => {
    if (c.evaluator === "commit_pattern") {
      const bits: string[] = [];
      if (c.match.path_glob) bits.push(c.match.path_glob);
      if (c.match.message_pattern) bits.push(`msg: ${c.match.message_pattern}`);
      if (c.match.min_files) bits.push(`${c.match.min_files}+ files`);
      if (c.match.branch) bits.push(`on ${c.match.branch}`);
      return `commit (${bits.join(", ") || "any"})`;
    }
    if (c.evaluator === "ci_status") {
      const wf = c.match.workflow ? ` [${c.match.workflow}]` : "";
      return `CI ${c.match.conclusion ?? "success"}${wf}`;
    }
    // Reserved evaluators (manual_confirm / file_uploaded / url / llm_judge): name them.
    return c.evaluator;
  });
  if (parts.length === 0) return "manual";
  const joiner = rule.logic === "any" ? "any of" : "all of";
  return `${joiner}: ${parts.join("; ")}`;
}
