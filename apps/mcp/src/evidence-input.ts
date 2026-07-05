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

const DbId = z.string().guid();

/**
 * Upper bounds on agent-supplied content. The caller is authenticated but the
 * content is free-form: bound every unbounded string/array/record so a single
 * report cannot flood the evidence table or the judge pipeline.
 */
const MAX_SUMMARY_CHARS = 4000;
const MAX_COMMIT_MESSAGE_CHARS = 10000;
const MAX_FILES = 500;
const MAX_FILE_PATH_CHARS = 1000;
const MAX_PAYLOAD_JSON_CHARS = 32 * 1024;

/** Free-form payload record, capped by SERIALIZED size — bytes are what hit the DB. */
const BoundedPayload = z.record(z.string(), z.unknown()).superRefine((value, ctx) => {
  if (JSON.stringify(value).length > MAX_PAYLOAD_JSON_CHARS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `payload exceeds ${MAX_PAYLOAD_JSON_CHARS} serialized characters`,
    });
  }
});

/** A commit reported by the agent (mirrors `@core/domain` RawCommit). */
const CommitReport = z.object({
  type: z.literal("commit"),
  sha: z.string().min(1),
  message: z.string().max(MAX_COMMIT_MESSAGE_CHARS).default(""),
  branch: z.string().optional(),
  files: z.array(z.string().max(MAX_FILE_PATH_CHARS)).max(MAX_FILES).optional(),
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
  summary: z.string().min(1).max(MAX_SUMMARY_CHARS),
  payload: BoundedPayload.optional(),
});

/** Discriminated union of everything an agent may report. */
export const EvidenceReport = z.discriminatedUnion("type", [CommitReport, CiReport, NoteReport]);
export type EvidenceReport = z.infer<typeof EvidenceReport>;

/**
 * The full `report_evidence` tool input: routing + the report body.
 *
 * Deliberately NO ownerId/emitterId here: the owner comes from the verified
 * OAuth token (`CallerIdentity`) and the emitter is resolved server-side from
 * that owner. Any identity field a client sneaks into the arguments is stripped
 * by this schema, so spoofing another user is structurally impossible.
 */
export const ReportEvidenceInput = z.object({
  /** Goal this progress advances. */
  goalId: DbId,
  /** Optional target milestone. */
  milestoneId: DbId.nullable().optional(),
  /** ISO 8601 timestamp of when the event actually occurred. */
  occurredAt: z.string().min(1),
  report: EvidenceReport,
});
export type ReportEvidenceInput = z.infer<typeof ReportEvidenceInput>;

/**
 * MCP reports arrive over a VERIFIED OAuth 2.1 channel — the CALLER is
 * authenticated, but the CONTENT is entirely self-attested: an agent can claim
 * any sha, message, file list, `verified` flag or CI run id for work that was
 * never pushed or run, with no cross-check against the real source. Cap the
 * trust score STRICTLY BELOW the `auto_verifiable` floor
 * (`AUTO_VERIFY_MIN_TRUST` = 0.8 in `@core/evaluate`) so an MCP report alone can
 * never auto-complete a milestone whose acceptance clause expects a stronger
 * source — anti-spoofing per the AcceptanceRule design. Only sources whose
 * content cannot be fabricated by the caller (e.g. the signature-verified GitHub
 * webhook, trust 1.0) may reach that floor.
 */
export const MCP_TRUST_CEILING = 0.6;

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

/**
 * Build the ingest-port input from validated tool input + the normalized envelope.
 * `ownerId` is the token-derived caller identity — never tool input. The emitter
 * is intentionally absent: the ingest adapter resolves (or provisions) the
 * caller's MCP emitter from `ownerId`, so a client can never write under a
 * foreign emitter.
 */
export function toIngestInput(
  input: ReportEvidenceInput,
  normalized: NormalizedEvidence,
  ownerId: string,
): IngestEvidenceInput {
  // Assert the normalized kind is a member of the frozen EvidenceKind enum.
  const kind = EvidenceKind.parse(normalized.kind);
  return {
    ownerId,
    goalId: input.goalId,
    milestoneId: input.milestoneId ?? null,
    kind,
    sourceEventId: normalized.source_event_id,
    occurredAt: normalized.occurred_at,
    summary: normalized.summary,
    payload: normalized.payload,
    trustScore: normalized.trust_score,
  };
}
