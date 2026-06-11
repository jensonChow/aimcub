/**
 * evaluate() — the true kernel of the system. Decides whether a set of evidence
 * satisfies a milestone's acceptance_rule.
 * A pure function: all four clients + the Edge Function share the same decision logic.
 *
 * Anti-spoofing is key: an `auto_verifiable` clause only accepts evidence from
 * trusted sources (trust_score >= threshold) — bare manual / low-trust reports
 * cannot trigger auto-completion on their own.
 */
import {
  type AcceptanceClause,
  type AcceptanceRule,
  CiPayload,
  type CiStatusMatch,
  type CommitPatternMatch,
  type Evidence,
  GitCommitPayload,
} from "@core/types";
import { globToRegExp, matchesPattern } from "./glob";

/** Minimum source trust score required by an auto_verifiable clause. */
export const AUTO_VERIFY_MIN_TRUST = 0.8;

export interface EvaluateResult {
  passed: boolean;
  /** Deduplicated ids of the evidence that triggered the decision. */
  matchedEvidenceIds: string[];
  /** Lowest trust score among matched evidence (0 when nothing matched). */
  trustScore: number;
  /** Whether each clause was satisfied, by index (for debugging and showing progress in the UI). */
  clauseSatisfied: boolean[];
}

function commitMatches(m: CommitPatternMatch, p: GitCommitPayload): boolean {
  if (m.branch !== undefined && p.branch !== m.branch) return false;
  if (m.message_pattern !== undefined && !matchesPattern(m.message_pattern, p.message)) return false;
  if (m.path_glob !== undefined) {
    const re = globToRegExp(m.path_glob);
    const hits = p.files.filter((f) => re.test(f)).length;
    if (hits < (m.min_files ?? 1)) return false;
  } else if (m.min_files !== undefined) {
    if (p.files.length < m.min_files) return false;
  }
  return true;
}

function ciMatches(m: CiStatusMatch, p: CiPayload): boolean {
  // Workflow names are human-edited display names (GitHub: `name: CI`), so a plan
  // that says "ci" must still match a workflow named "CI" — compare case-insensitively.
  if (m.workflow !== undefined && p.workflow?.toLowerCase() !== m.workflow.toLowerCase()) {
    return false;
  }
  return p.conclusion === m.conclusion;
}

function evidenceMatchesClause(clause: AcceptanceClause, ev: Evidence): boolean {
  // Verifiable clause: must come from a trusted source (signature-verified webhook / authenticated MCP).
  if (clause.auto_verifiable && ev.trust_score < AUTO_VERIFY_MIN_TRUST) return false;

  switch (clause.evaluator) {
    case "commit_pattern": {
      if (ev.kind !== "git_commit" && ev.kind !== "pr_merged") return false;
      const parsed = GitCommitPayload.safeParse(ev.payload);
      return parsed.success && commitMatches(clause.match, parsed.data);
    }
    case "ci_status": {
      if (ev.kind !== "ci_passed" && ev.kind !== "ci_failed") return false;
      const parsed = CiPayload.safeParse(ev.payload);
      return parsed.success && ciMatches(clause.match, parsed.data);
    }
    // Evaluators reserved for v3 are not yet implemented in v1 — match no evidence.
    case "manual_confirm":
    case "file_uploaded":
    case "url":
    case "llm_judge":
      return false;
  }
}

export function evaluate(rule: AcceptanceRule, evidence: Evidence[]): EvaluateResult {
  const matchedByClause = rule.clauses.map((clause) =>
    evidence.filter((ev) => evidenceMatchesClause(clause, ev)),
  );
  const clauseSatisfied = matchedByClause.map((arr) => arr.length > 0);

  let passed: boolean;
  if (rule.logic === "all") {
    passed = clauseSatisfied.every(Boolean);
  } else if (rule.logic === "any") {
    passed = clauseSatisfied.some(Boolean);
  } else {
    // weighted: sum of the weights of satisfied clauses must be >= threshold
    const sum = rule.clauses.reduce(
      (acc, clause, i) => acc + ((clauseSatisfied[i] ?? false) ? (clause.weight ?? 1) : 0),
      0,
    );
    passed = sum >= rule.threshold;
  }

  const matchedIds = [...new Set(matchedByClause.flat().map((ev) => ev.id))];
  const matched = evidence.filter((ev) => matchedIds.includes(ev.id));
  const trustScore = matched.length ? Math.min(...matched.map((e) => e.trust_score)) : 0;

  return { passed, matchedEvidenceIds: matchedIds, trustScore, clauseSatisfied };
}
