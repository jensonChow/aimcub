import { describe, expect, it, vi } from "vitest";

import type { AimDraft } from "@core/types";
import type { UpsertAimDraftRequest } from "../../shared/ipc";

import { createDraftPersistenceId, createDraftPersistenceQueue } from "./draftPersistenceQueue";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function savedDraft(id: string, title: string): AimDraft {
  return {
    id,
    owner_id: "00000000-0000-4000-8000-000000000001",
    title,
    description: "",
    parent_goal_id: null,
    parent_milestone_id: null,
    current_stage: "aim",
    phase: null,
    status: "draft",
    context_note: "",
    intake_questions: [],
    intake_answers: [],
    clarify_questions: [],
    clarify_answers: [],
    clarify_assumptions: [],
    draft_plan: null,
    final_plan: null,
    save_block: null,
    created_at: "2026-07-10T00:00:00.000Z",
    updated_at: "2026-07-10T00:00:00.000Z",
  };
}

describe("draft persistence queue", () => {
  it("creates store-compatible draft ids", () => {
    expect(createDraftPersistenceId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("preallocates one draft id and serializes concurrent writes within the session", async () => {
    const firstWrite = deferred<AimDraft>();
    const requests: UpsertAimDraftRequest[] = [];
    const persist = vi.fn(async (request: UpsertAimDraftRequest) => {
      requests.push(request);
      if (requests.length === 1) return firstWrite.promise;
      return savedDraft(request.id!, request.title ?? "");
    });
    const queue = createDraftPersistenceQueue(persist, {
      createDraftId: () => "00000000-0000-4000-8000-000000000101",
    });

    const session = queue.beginSession();
    const first = queue.enqueue({ title: "First snapshot" });
    const second = queue.enqueue({ title: "Second snapshot" });

    await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(1));
    expect(session.draftId).toBe("00000000-0000-4000-8000-000000000101");
    expect(requests[0]?.id).toBe(session.draftId);

    firstWrite.resolve(savedDraft(session.draftId, "First snapshot"));
    await expect(first).resolves.toMatchObject({ status: "persisted", draftId: session.draftId });
    await expect(second).resolves.toMatchObject({ status: "persisted", draftId: session.draftId });
    expect(requests.map((request) => request.id)).toEqual([session.draftId, session.draftId]);
    expect(requests.map((request) => request.title)).toEqual(["First snapshot", "Second snapshot"]);
  });

  it("skips queued work from an invalidated session and marks its in-flight response stale", async () => {
    const firstWrite = deferred<AimDraft>();
    const requests: UpsertAimDraftRequest[] = [];
    const persist = vi.fn(async (request: UpsertAimDraftRequest) => {
      requests.push(request);
      if (requests.length === 1) return firstWrite.promise;
      return savedDraft(request.id!, request.title ?? "");
    });
    const ids = [
      "00000000-0000-4000-8000-000000000201",
      "00000000-0000-4000-8000-000000000202",
    ];
    const queue = createDraftPersistenceQueue(persist, { createDraftId: () => ids.shift()! });

    const oldSession = queue.beginSession();
    const inFlight = queue.enqueue({ title: "Old in flight" });
    const queued = queue.enqueue({ title: "Old queued" });
    await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(1));

    const newSession = queue.beginSession();
    const current = queue.enqueue({ title: "Current session" });
    firstWrite.resolve(savedDraft(oldSession.draftId, "Old in flight"));

    await expect(inFlight).resolves.toMatchObject({ status: "stale", draftId: oldSession.draftId });
    await expect(queued).resolves.toEqual({
      status: "skipped",
      draftId: oldSession.draftId,
      reason: "session_invalidated",
    });
    await expect(current).resolves.toMatchObject({ status: "persisted", draftId: newSession.draftId });
    expect(requests.map((request) => request.title)).toEqual(["Old in flight", "Current session"]);
    expect(requests[1]?.id).toBe(newSession.draftId);
  });

  it("pauses autosave while allowing a forced navigation flush", async () => {
    const requests: UpsertAimDraftRequest[] = [];
    const persist = vi.fn(async (request: UpsertAimDraftRequest) => {
      requests.push(request);
      return savedDraft(request.id!, request.title ?? "");
    });
    const queue = createDraftPersistenceQueue(persist, {
      createDraftId: () => "00000000-0000-4000-8000-000000000301",
    });
    const { draftId } = queue.beginSession();

    queue.pauseAutosave();
    expect(queue.autosaveIsPaused()).toBe(true);
    await expect(queue.enqueue({ title: "Paused autosave" })).resolves.toEqual({
      status: "skipped",
      draftId,
      reason: "autosave_paused",
    });
    await expect(queue.flushForNavigation({ title: "Navigation snapshot" })).resolves.toMatchObject({
      status: "persisted",
      draftId,
    });
    expect(requests.map((request) => request.title)).toEqual(["Navigation snapshot"]);

    queue.resumeAutosave();
    expect(queue.autosaveIsPaused()).toBe(false);
    await expect(queue.enqueue({ title: "Resumed autosave" })).resolves.toMatchObject({
      status: "persisted",
      draftId,
    });
    expect(requests.map((request) => request.id)).toEqual([draftId, draftId]);
  });

  it("keeps the queue usable after a failed write", async () => {
    const persist = vi.fn()
      .mockRejectedValueOnce(new Error("disk unavailable"))
      .mockImplementationOnce(async (request: UpsertAimDraftRequest) => savedDraft(request.id!, "Recovered"));
    const queue = createDraftPersistenceQueue(persist, {
      createDraftId: () => "00000000-0000-4000-8000-000000000401",
    });
    queue.beginSession();

    await expect(queue.enqueue({ title: "Fails" })).rejects.toThrow("disk unavailable");
    await expect(queue.enqueue({ title: "Retries" })).resolves.toMatchObject({
      status: "persisted",
      draft: { title: "Recovered" },
    });
  });

  it("keeps the same draft session recoverable after a navigation checkpoint fails", async () => {
    const persist = vi.fn()
      .mockRejectedValueOnce(new Error("checkpoint unavailable"))
      .mockImplementationOnce(async (request: UpsertAimDraftRequest) => savedDraft(request.id!, "Recovered draft"));
    const queue = createDraftPersistenceQueue(persist, {
      createDraftId: () => "00000000-0000-4000-8000-000000000501",
    });
    const { draftId } = queue.beginSession();

    queue.pauseAutosave();
    await expect(queue.flushForNavigation({ title: "Latest navigation snapshot" })).rejects.toThrow("checkpoint unavailable");
    expect(queue.currentDraftId()).toBe(draftId);

    queue.resumeAutosave();
    await expect(queue.enqueue({ title: "Retry after staying put" })).resolves.toMatchObject({
      status: "persisted",
      draftId,
      draft: { title: "Recovered draft" },
    });
  });
});
