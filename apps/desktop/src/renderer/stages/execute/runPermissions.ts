/**
 * The per-run permission the user consents to before a local agent starts.
 *
 * Pure state + validation for the consent control. The main process re-checks everything here
 * (see `main/run-queue.ts`) — this exists so the cockpit can say what a run will be allowed to do
 * and refuse to start one whose grant is incomplete, not because the renderer is trusted.
 */
import type { DesktopRunSandbox, RunPermissionConsent } from "../../../shared/ipc";

/** What the control is editing. The workspace survives a toggle back to read-only, so flipping
 * between the two levels does not make the user pick the folder again. */
export interface RunPermissionDraft {
  sandbox: DesktopRunSandbox;
  network: boolean;
  workspace: string | null;
}

/** Look, don't touch, no network — every sub-aim starts here. */
export const DEFAULT_RUN_PERMISSION_DRAFT: RunPermissionDraft = {
  sandbox: "read-only",
  network: false,
  workspace: null,
};

/** The two levels the cockpit offers. `danger-full-access` is not one of them, by design. */
export const RUN_SANDBOX_OPTIONS: readonly DesktopRunSandbox[] = ["read-only", "workspace-write"];

/** A `workspace-write` grant is incomplete until the user has picked the folder it applies to. */
export function runPermissionBlockedReason(draft: RunPermissionDraft): "workspace_required" | null {
  if (draft.sandbox !== "workspace-write") return null;
  return draft.workspace?.trim() ? null : "workspace_required";
}

export function isRunPermissionReady(draft: RunPermissionDraft): boolean {
  return runPermissionBlockedReason(draft) === null;
}

/** True when the draft asks for more than the safe default — i.e. it is a real escalation. */
export function isRunPermissionEscalated(draft: RunPermissionDraft): boolean {
  return draft.sandbox !== "read-only" || draft.network;
}

/** The consent to send over IPC. A read-only run never carries a workspace, granted or not. */
export function runPermissionRequest(draft: RunPermissionDraft): RunPermissionConsent {
  return draft.sandbox === "workspace-write"
    ? { sandbox: "workspace-write", network: draft.network, workspace: draft.workspace?.trim() || null }
    : { sandbox: "read-only", network: draft.network, workspace: null };
}

/** Shorten a folder path for a one-line control without hiding which folder it is. */
export function shortWorkspacePath(path: string, max = 46): string {
  const trimmed = path.trim();
  if (trimmed.length <= max) return trimmed;
  return `…${trimmed.slice(trimmed.length - (max - 1))}`;
}
