/**
 * Pure helper: turn a milestone's AcceptanceRule into a short human-readable summary
 * for the dashboard. Presentation only — it never decides completion (that is
 * @core/domain's evaluate()).
 */
import type { AcceptanceClause, AcceptanceRule } from "@core/types";

function clauseSummary(clause: AcceptanceClause): string {
  switch (clause.evaluator) {
    case "commit_pattern": {
      const parts: string[] = [];
      if (clause.match.path_glob) parts.push(`files ${clause.match.path_glob}`);
      if (clause.match.message_pattern) parts.push(`message ~ /${clause.match.message_pattern}/`);
      if (clause.match.branch) parts.push(`branch ${clause.match.branch}`);
      if (clause.match.min_files) parts.push(`≥${clause.match.min_files} file(s)`);
      return `commit (${parts.join(", ") || "any"})`;
    }
    case "ci_status":
      return `CI ${clause.match.workflow ? `${clause.match.workflow} ` : ""}= ${clause.match.conclusion}`;
    case "manual_confirm":
      return "manual confirmation";
    case "file_uploaded":
      return `${clause.match.min_count} file upload(s)`;
    case "url":
      return clause.match.pattern ? `url ~ /${clause.match.pattern}/` : "url provided";
    case "llm_judge":
      return "LLM judge";
  }
}

/** A one-line summary like "all of: commit (files src/**), CI = success". */
export function acceptanceSummary(rule: AcceptanceRule): string {
  const joiner =
    rule.logic === "all" ? "all of" : rule.logic === "any" ? "any of" : `weighted ≥ ${rule.threshold}`;
  const clauses = rule.clauses.map(clauseSummary).join(", ");
  return `${joiner}: ${clauses}`;
}

/** Per-clause summary list, for richer rendering. */
export function acceptanceClauseSummaries(rule: AcceptanceRule): string[] {
  return rule.clauses.map(clauseSummary);
}
