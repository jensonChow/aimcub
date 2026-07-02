import type { AcceptanceRule } from "@core/types";

/** A compact, human-readable summary of a milestone's acceptance rule. */
export function summarizeRule(rule: AcceptanceRule): string {
  const parts = rule.clauses.map((c) => {
    if (c.evaluator === "commit_pattern") {
      const hints: string[] = [];
      if (c.match.path_glob) hints.push(`touches ${c.match.path_glob}`);
      if (c.match.min_files) hints.push(`updates ${c.match.min_files} or more files`);
      if (c.match.branch) hints.push(`lands on ${c.match.branch}`);
      return hints.length > 0
        ? `A matching commit that ${hints.join(" and ")}`
        : "A relevant commit is recorded";
    }
    if (c.evaluator === "ci_status") {
      const workflow = c.match.workflow ? `${c.match.workflow} ` : "";
      return `${workflow}checks ${c.match.conclusion === "success" ? "pass" : c.match.conclusion}`;
    }
    if (c.evaluator === "manual_confirm") return "You confirm it is done";
    if (c.evaluator === "file_uploaded") return "The needed file is attached";
    if (c.evaluator === "url") return "A relevant link is provided";
    return "Aimcub reviews the result";
  });
  if (parts.length === 0) return "manual";
  if (parts.length === 1) return parts[0]!;
  const joiner = rule.logic === "any" ? " or " : " and ";
  return parts.join(joiner);
}
