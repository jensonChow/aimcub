/**
 * Evidence normalization: maps heterogeneous sources (git commit / CI run / ...)
 * into a uniform envelope.
 * Pure function — occurred_at is supplied by the caller to keep it deterministic and testable.
 * id / owner_id / emitter_id are filled in by the caller (Edge Function).
 */
import { type EvidenceKind } from "@core/types";

export interface NormalizedEvidence {
  kind: EvidenceKind;
  /** Native id of the upstream event; combined with emitter_id to form the idempotency key. */
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
  /** GitHub signature verification status. A verified signature raises the trust score. */
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
    // Note: GitHub's "verified" flag only proves the signing key belongs to some account; it does not prove the code is meaningful.
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
    // Comes from a signature-verified CI webhook, so the trust score is high.
    trust_score: 1,
  };
}
