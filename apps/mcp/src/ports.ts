/**
 * Injectable ports for the MCP server. Every external touchpoint (DB reads,
 * evidence writes) sits behind one of these interfaces so the tools are pure
 * with respect to I/O and fully mockable in tests.
 *
 * The read path reuses the shared data-access contract `AimcubRepo` from
 * `@aimcub/api-client`; the write path is a narrow `EvidenceIngestPort` so the MCP
 * tool layer never constructs queries itself (a locked project invariant).
 */
import type { Evidence } from "@aimcub/core";
import type { AimcubRepo, IngestEvidenceInput } from "@aimcub/api-client";

/**
 * Write side: persists a normalized Evidence envelope. Append-only + idempotent
 * on `(emitterId, sourceEventId)` (enforced by the concrete implementation).
 */
export interface EvidenceIngestPort {
  ingest(input: IngestEvidenceInput): Promise<Evidence>;
}

/** Read side reused verbatim from the shared contract. */
export type AimcubReadPort = Pick<AimcubRepo, "listMilestones" | "getGoal">;

/**
 * Caller identity derived from the VERIFIED OAuth access token (`sub` claim) in
 * the Worker shell. This is the only owner identity the tools trust — tool input
 * never carries an ownerId/emitterId, so a caller cannot act as another user.
 */
export interface CallerIdentity {
  ownerId: string;
}

/** The full dependency bundle the tool layer is wired with (ports + per-request identity). */
export interface ToolDeps {
  repo: AimcubReadPort;
  ingest: EvidenceIngestPort;
  identity: CallerIdentity;
}
