/**
 * Input validation + normalization for the `report_evidence` MCP tool.
 *
 * An agent reports heterogeneous progress (a commit, a CI run, or a free-form
 * note). We validate the raw input with zod schemas built on the frozen
 * `@core/types` enums, then normalize into the uniform NormalizedEvidence
 * envelope using the pure helpers in `@core/domain`. The result is handed to the
 * injected ingest port as an `IngestEvidenceInput`.
 */
import { z } from "zod";
import {
  EvidenceKind,
  type NormalizedEvidence,
  normalizeCommitEvidence,
  normalizeCiEvidence,
} from "@core/domain";
import type { IngestEvidenceInput } from "@core/api-client";

/** A commit reported by the agent (mirrors `@core/domain` RawCommit). */
const CommitReport = z.object({
  type: z.literal("commit"),
  sha: z.string().min(1),
  message: z.string().default(""),
  branch: z.string().optional(),
  files: z.array(z.string()).optional(),
  additions: z.number().int().nonnegative().optional(),
  deletions: z.number().int().nonnegative().optional(),
  /** Self-reported signature status. The MCP self-report trust ceiling still applies. */
  verified: z.boolean().optional(),
});

/** A CI run reported by the agent (mirrors `@core/domain` RawCiRun). */
const CiReport = z.object({
  type: z.literal("ci"),
  workflow: z.string().optional(),
  conclusion: z.string().min(1),
  runId: z.string().min(1),
  branch: z.string().optional(),
});

/** A free-form progress note — normalized to `mcp_report`. */
const NoteReport = z.object({
  type: z.literal("note"),
  summary: z.string().min(1),
  payload: z.record(z.unknown()).optional(),
});

/** Discriminated union of everything an agent may report. */
export const EvidenceReport = z.discriminatedUnion("type", [CommitReport, CiReport, NoteReport]);
export type EvidenceReport = z.infer<typeof EvidenceReport>;

/** The full `report_evidence` tool input: routing identity + the report body. */
export const ReportEvidenceInput = z.object({
  /** Owner the evidence belongs to. TODO(v1a-live): derive from the verified token `sub` instead of trusting input. */
  ownerId: z.string().uuid(),
  /** Goal this progress advances. */
  goalId: z.string().uuid(),
  /** Optional target milestone. */
  milestoneId: z.string().uuid().nullable().optional(),
  /** The emitter (the agent's registered MCP emitter). TODO(v1a-live): derive from token. */
  emitterId: z.string().uuid().nullable().optional(),
  /** ISO 8601 timestamp of when the event actually occurred. */
  occurredAt: z.string().min(1),
  report: EvidenceReport,
});
export type ReportEvidenceInput = z.infer<typeof ReportEvidenceInput>;

/**
 * MCP self-reports are weaker than signature-verified webhook sources (a coding
 * agent is authenticated but can still report freely). Cap the trust score so
 * an MCP report alone cannot auto-complete a milestone whose acceptance clause is
 * marked `auto_verifiable` for a stronger source — anti-spoofing per the
 * AcceptanceRule design.
 */
const MCP_TRUST_CEILING = 0.6;

/** Generic normalizer for a free-form agent note → `mcp_report` envelope. */
function normalizeNote(
  note: { summary: string; payload?: Record<string, unknown> },
  occurredAt: string,
  sourceEventId: string,
): NormalizedEvidence {
  return {
    kind: "mcp_report",
    source_event_id: sourceEventId,
    occurred_at: occurredAt,
    summary: note.summary,
    payload: note.payload ?? {},
    trust_score: MCP_TRUST_CEILING,
  };
}

/** Normalize a validated report into the uniform envelope (pure). */
export function normalizeReport(input: ReportEvidenceInput): NormalizedEvidence {
  const { report, occurredAt } = input;
  switch (report.type) {
    case "commit": {
      const e = normalizeCommitEvidence(
        {
          sha: report.sha,
          message: report.message,
          branch: report.branch,
          files: report.files,
          additions: report.additions,
          deletions: report.deletions,
          verified: report.verified,
        },
        occurredAt,
      );
      // A commit *reported over MCP* is not the same as a verified GitHub webhook:
      // clamp the trust score to the MCP ceiling regardless of the self-reported flag.
      return { ...e, trust_score: Math.min(e.trust_score, MCP_TRUST_CEILING) };
    }
    case "ci": {
      const e = normalizeCiEvidence(
        { workflow: report.workflow, conclusion: report.conclusion, runId: report.runId, branch: report.branch },
        occurredAt,
      );
      return { ...e, trust_score: Math.min(e.trust_score, MCP_TRUST_CEILING) };
    }
    case "note":
      // Use the goal+occurredAt as a stable-ish synthetic event id; the real
      // idempotency key is (emitter_id, source_event_id) at the DB layer.
      return normalizeNote(report, occurredAt, `note:${input.goalId}:${occurredAt}`);
  }
}

/** Build the ingest-port input from validated tool input + the normalized envelope. */
export function toIngestInput(input: ReportEvidenceInput, normalized: NormalizedEvidence): IngestEvidenceInput {
  // Assert the normalized kind is a member of the frozen EvidenceKind enum.
  const kind = EvidenceKind.parse(normalized.kind);
  return {
    ownerId: input.ownerId,
    goalId: input.goalId,
    milestoneId: input.milestoneId ?? null,
    emitterId: input.emitterId ?? null,
    kind,
    sourceEventId: normalized.source_event_id,
    occurredAt: normalized.occurred_at,
    summary: normalized.summary,
    payload: normalized.payload,
    trustScore: normalized.trust_score,
  };
}
