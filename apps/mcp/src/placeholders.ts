/**
 * Production wiring placeholders.
 *
 * The concrete supabase-js repo + ingest adapters land later in v1a. Until then
 * the server boots with placeholders that throw a clear "not wired" error so a
 * live call fails loudly rather than silently no-op'ing. Tests never touch these
 * — they inject their own fakes.
 */
import type { Evidence, Goal, Milestone, Notification } from "@core/domain";
import type { IngestEvidenceInput } from "@core/api-client";
import type { EvidenceIngestPort, GoalPetReadPort } from "./ports.js";

function notWired(method: string): never {
  // TODO(v1a-live): replace with the supabase-js implementation of GoalPetRepo.
  throw new Error(`GoalPet repo not wired: ${method}() needs the live supabase-js adapter`);
}

/** Read-path placeholder. Every method throws until the live adapter is wired. */
export const placeholderRepo: GoalPetReadPort = {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getGoal(_id: string): Promise<Goal | null> {
    return notWired("getGoal");
  },
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async listMilestones(_goalId: string): Promise<Milestone[]> {
    return notWired("listMilestones");
  },
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async listInbox(_ownerId: string, _since?: string): Promise<Notification[]> {
    return notWired("listInbox");
  },
};

/** Write-path placeholder. */
export const placeholderIngest: EvidenceIngestPort = {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async ingest(_input: IngestEvidenceInput): Promise<Evidence> {
    // TODO(v1a-live): forward to repo.ingestEvidence (service_role), enforcing
    // idempotency on (emitter_id, source_event_id).
    throw new Error("evidence ingest not wired: needs the live supabase-js adapter");
  },
};
