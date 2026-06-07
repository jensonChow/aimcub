/**
 * evaluate() —— 系统的真正内核。判定一组证据是否满足里程碑的 acceptance_rule。
 * 纯函数,四端 + Edge Function 共享同一份判定逻辑。
 *
 * 防伪关键:`auto_verifiable` 子句只接受可信来源证据(trust_score ≥ 阈值)——
 * 裸 manual / 低可信上报无法单独触发自动完成。
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

/** auto_verifiable 子句要求的最低来源可信度。 */
export const AUTO_VERIFY_MIN_TRUST = 0.8;

export interface EvaluateResult {
  passed: boolean;
  /** 触发判定的去重证据 id。 */
  matchedEvidenceIds: string[];
  /** 命中证据的最弱可信度(无命中为 0)。 */
  trustScore: number;
  /** 逐子句是否被满足(便于调试与 UI 展示进度)。 */
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
  if (m.workflow !== undefined && p.workflow !== m.workflow) return false;
  return p.conclusion === m.conclusion;
}

function evidenceMatchesClause(clause: AcceptanceClause, ev: Evidence): boolean {
  // 可验证子句:必须来自可信来源(验签 webhook / 鉴权 MCP)。
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
    // v3 预留的 evaluator 在 v1 尚未实现 —— 不匹配任何证据。
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
    // weighted:累计满足子句的权重 ≥ threshold
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
