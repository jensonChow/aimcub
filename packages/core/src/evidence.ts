/**
 * 证据归一化:把异构来源(git commit / CI run / ...)映射成统一信封。
 * 纯函数 —— occurred_at 由调用方传入,保持确定性可测。
 * id / owner_id / emitter_id 由调用方(Edge Function)补齐。
 */
import { type EvidenceKind } from "@core/types";

export interface NormalizedEvidence {
  kind: EvidenceKind;
  /** 上游事件原生 id;与 emitter_id 组成幂等键。 */
  source_event_id: string;
  occurred_at: string;
  summary: string;
  payload: Record<string, unknown>;
  trust_score: number;
}

export interface RawCommit {
  sha: string;
  message: string;
  branch?: string;
  files?: string[];
  additions?: number;
  deletions?: number;
  /** GitHub 验签状态。verified 提升可信度。 */
  verified?: boolean;
}

export function normalizeCommitEvidence(commit: RawCommit, occurredAt: string): NormalizedEvidence {
  const firstLine = commit.message.split("\n")[0] ?? "";
  return {
    kind: "git_commit",
    source_event_id: commit.sha,
    occurred_at: occurredAt,
    summary: firstLine,
    payload: {
      sha: commit.sha,
      message: commit.message,
      branch: commit.branch,
      files: commit.files ?? [],
      additions: commit.additions,
      deletions: commit.deletions,
      verified: commit.verified,
    },
    // 注意:GitHub verified 只证明签名密钥归属某账户,不证明代码有意义。
    trust_score: commit.verified ? 1 : 0.7,
  };
}

export interface RawCiRun {
  workflow?: string;
  conclusion: string;
  runId: string;
  branch?: string;
}

export function normalizeCiEvidence(run: RawCiRun, occurredAt: string): NormalizedEvidence {
  const passed = run.conclusion === "success";
  return {
    kind: passed ? "ci_passed" : "ci_failed",
    source_event_id: run.runId,
    occurred_at: occurredAt,
    summary: `CI ${run.workflow ?? ""} ${passed ? "✅" : "❌"} (${run.conclusion})`.replace(/\s+/g, " ").trim(),
    payload: {
      workflow: run.workflow,
      conclusion: run.conclusion,
      run_id: run.runId,
      branch: run.branch,
    },
    // 来自已验签 CI webhook,可信度高。
    trust_score: 1,
  };
}
