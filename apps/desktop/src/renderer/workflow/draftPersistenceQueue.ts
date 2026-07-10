import type { AimDraft } from "@core/types";

import type { UpsertAimDraftRequest } from "../../shared/ipc";

export type DraftPersistenceSkipReason = "autosave_paused" | "session_invalidated";

export type DraftPersistenceResult =
  | {
      status: "persisted";
      draftId: string;
      draft: AimDraft;
    }
  | {
      status: "stale";
      draftId: string;
      draft: AimDraft;
    }
  | {
      status: "skipped";
      draftId: string;
      reason: DraftPersistenceSkipReason;
    };

export interface DraftPersistenceSession {
  draftId: string;
}

export interface DraftPersistenceQueue {
  beginSession(draftId?: string | null): DraftPersistenceSession;
  invalidateSession(): void;
  currentDraftId(): string | null;
  pauseAutosave(): void;
  resumeAutosave(): void;
  autosaveIsPaused(): boolean;
  enqueue(request: UpsertAimDraftRequest): Promise<DraftPersistenceResult>;
  flushForNavigation(request: UpsertAimDraftRequest): Promise<DraftPersistenceResult>;
}

export interface DraftPersistenceQueueOptions {
  createDraftId?: () => string;
}

type PersistAimDraft = (request: UpsertAimDraftRequest) => Promise<AimDraft>;

interface ActiveSession extends DraftPersistenceSession {
  generation: number;
}

export function createDraftPersistenceId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();

  const randomHex = (length: number) => Array.from(
    { length },
    () => Math.floor(Math.random() * 16).toString(16),
  ).join("");
  return `${randomHex(8)}-${randomHex(4)}-4${randomHex(3)}-${(8 + Math.floor(Math.random() * 4)).toString(16)}${randomHex(3)}-${randomHex(12)}`;
}

export function createDraftPersistenceQueue(
  persist: PersistAimDraft,
  options: DraftPersistenceQueueOptions = {},
): DraftPersistenceQueue {
  const createDraftId = options.createDraftId ?? createDraftPersistenceId;
  let generation = 0;
  let activeSession: ActiveSession | null = null;
  let autosavePaused = false;
  let tail: Promise<void> = Promise.resolve();

  const isCurrent = (session: ActiveSession): boolean => activeSession?.generation === session.generation;

  const skipped = (
    session: ActiveSession,
    reason: DraftPersistenceSkipReason,
  ): DraftPersistenceResult => ({
    status: "skipped",
    draftId: session.draftId,
    reason,
  });

  const schedule = (
    request: UpsertAimDraftRequest,
    kind: "autosave" | "navigation",
  ): Promise<DraftPersistenceResult> => {
    const session = activeSession;
    if (!session) {
      return Promise.reject(new Error("Begin a draft persistence session before enqueueing work."));
    }

    if (kind === "autosave" && autosavePaused) {
      return Promise.resolve(skipped(session, "autosave_paused"));
    }

    const run = tail.then(async (): Promise<DraftPersistenceResult> => {
      if (!isCurrent(session)) return skipped(session, "session_invalidated");
      if (kind === "autosave" && autosavePaused) return skipped(session, "autosave_paused");

      const draft = await persist({ ...request, id: session.draftId });
      return isCurrent(session)
        ? { status: "persisted", draftId: session.draftId, draft }
        : { status: "stale", draftId: session.draftId, draft };
    });

    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  return {
    beginSession(draftId) {
      generation += 1;
      const normalizedId = draftId?.trim();
      activeSession = {
        generation,
        draftId: normalizedId || createDraftId(),
      };
      autosavePaused = false;
      return { draftId: activeSession.draftId };
    },

    invalidateSession() {
      generation += 1;
      activeSession = null;
      autosavePaused = true;
    },

    currentDraftId() {
      return activeSession?.draftId ?? null;
    },

    pauseAutosave() {
      autosavePaused = true;
    },

    resumeAutosave() {
      autosavePaused = false;
    },

    autosaveIsPaused() {
      return autosavePaused;
    },

    enqueue(request) {
      return schedule(request, "autosave");
    },

    flushForNavigation(request) {
      return schedule(request, "navigation");
    },
  };
}
