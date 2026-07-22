import type { ManualEvidenceRequiredItem, Milestone } from "@aimcub/types";
import type { ConfirmMilestoneRequest } from "../../shared/ipc";

export type EvidenceSubmissionDraft = {
  proofNote: string;
  url: string;
  filePaths: string[];
  requiredEvidence: ManualEvidenceRequiredItem[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

export function requiredEvidenceForMilestone(milestone: Milestone): string[] {
  const contract = asRecord(milestone.metadata?.decomposition_contract);
  return stringArray(contract?.required_evidence);
}

export function emptyEvidenceDraft(milestone: Milestone): EvidenceSubmissionDraft {
  return {
    proofNote: "",
    url: "",
    filePaths: [],
    requiredEvidence: requiredEvidenceForMilestone(milestone).map((text) => ({ text, satisfied: false })),
  };
}

export function proofUrlsFromDraft(url: string): string[] {
  return url.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean);
}

export function evidenceDraftIsSubmittable(draft: EvidenceSubmissionDraft): boolean {
  const hasProof = draft.proofNote.trim().length > 0
    || proofUrlsFromDraft(draft.url).length > 0
    || draft.filePaths.length > 0;
  const requiredOk = draft.requiredEvidence.length === 0
    || draft.requiredEvidence.some((item) => item.satisfied);
  return hasProof && requiredOk;
}

export function evidenceSubmissionPayload(
  draft: EvidenceSubmissionDraft,
): Omit<ConfirmMilestoneRequest, "goalId" | "milestoneId"> {
  return {
    proofNote: draft.proofNote.trim(),
    urls: proofUrlsFromDraft(draft.url),
    filePaths: draft.filePaths,
    requiredEvidence: draft.requiredEvidence,
  };
}
