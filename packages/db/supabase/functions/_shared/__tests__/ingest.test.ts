/**
 * Unit tests for the pure evidence-ingest handler (`handleIngest`).
 *
 * Decoupling: a LOCAL in-memory repo (memory-repo.ts) implements the ports — no
 * import of `@core/api-client`. All I/O is injected; no network, no Supabase, no
 * Deno.
 */
import { describe, expect, it } from "vitest";
import { handleIngest, judgeJobDedupKey, type IngestDeps } from "../ingest.ts";
import type { AuthContext, AuthCredential } from "../ports.ts";
import { createMemoryRepo, type MemoryRepo } from "./memory-repo.ts";

const FIXED_NOW = new Date("2026-06-09T12:00:00.000Z");
const OWNER = "00000000-0000-4000-8000-000000000001";
const EMITTER = "00000000-0000-4000-8000-0000000000a1";
const GOAL = "00000000-0000-4000-8000-0000000000b1";
const MILESTONE = "00000000-0000-4000-8000-0000000000c1";

function depsWith(
  repo: MemoryRepo,
  verify: (c: AuthCredential) => Promise<AuthContext | null> = async () => ({
    ownerId: OWNER,
    emitterId: EMITTER,
  }),
): IngestDeps {
  return { repo, verifyAuth: verify, now: () => FIXED_NOW };
}

describe("handleIngest — auth", () => {
  it("returns 401 when the credential cannot be verified", async () => {
    const repo = createMemoryRepo(() => FIXED_NOW);
    const deps = depsWith(repo, async () => null);
    const res = await handleIngest(deps, {
      source: "commit",
      credential: { token: "bogus" },
      goalId: GOAL,
      commit: { sha: "abc", message: "feat: x", verified: true },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(401);
    expect(repo.state.evidence).toHaveLength(0);
    expect(repo.state.jobs).toHaveLength(0);
  });

  it("never trusts a caller-supplied owner — owner comes from the verifier", async () => {
    const repo = createMemoryRepo(() => FIXED_NOW);
    const deps = depsWith(repo, async () => ({ ownerId: OWNER, emitterId: EMITTER }));
    const res = await handleIngest(deps, {
      source: "commit",
      credential: { token: "t" },
      goalId: GOAL,
      commit: { sha: "abc", message: "feat: x", verified: true },
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.evidence.owner_id).toBe(OWNER);
  });
});

describe("handleIngest — normalization correctness", () => {
  it("normalizes a verified commit into git_commit evidence with trust 1.0", async () => {
    const repo = createMemoryRepo(() => FIXED_NOW);
    const res = await handleIngest(depsWith(repo), {
      source: "commit",
      credential: { token: "t" },
      goalId: GOAL,
      milestoneId: MILESTONE,
      commit: {
        sha: "deadbeef",
        message: "feat: ship login\n\nbody text",
        branch: "main",
        files: ["src/login.ts"],
        verified: true,
      },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const e = res.evidence;
    expect(e.kind).toBe("git_commit");
    expect(e.source_event_id).toBe("deadbeef");
    expect(e.summary).toBe("feat: ship login"); // first line only
    expect(e.trust_score).toBe(1);
    expect(e.milestone_id).toBe(MILESTONE);
    expect(e.payload.branch).toBe("main");
    expect(res.status).toBe(201);
  });

  it("lowers trust to 0.7 for an unverified commit", async () => {
    const repo = createMemoryRepo(() => FIXED_NOW);
    const res = await handleIngest(depsWith(repo), {
      source: "commit",
      credential: { token: "t" },
      goalId: GOAL,
      commit: { sha: "wip1", message: "wip" },
    });
    expect(res.ok && res.evidence.trust_score).toBe(0.7);
  });

  it("normalizes a successful CI run into ci_passed evidence with trust 1.0", async () => {
    const repo = createMemoryRepo(() => FIXED_NOW);
    const res = await handleIngest(depsWith(repo), {
      source: "ci",
      credential: { token: "t" },
      goalId: GOAL,
      run: { workflow: "test", conclusion: "success", runId: "run-9" },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.evidence.kind).toBe("ci_passed");
    expect(res.evidence.source_event_id).toBe("run-9");
    expect(res.evidence.trust_score).toBe(1);
  });

  it("normalizes a failed CI run into ci_failed evidence", async () => {
    const repo = createMemoryRepo(() => FIXED_NOW);
    const res = await handleIngest(depsWith(repo), {
      source: "ci",
      credential: { token: "t" },
      goalId: GOAL,
      run: { workflow: "test", conclusion: "failure", runId: "run-10" },
    });
    expect(res.ok && res.evidence.kind).toBe("ci_failed");
  });

  it("falls back to deps.now() for occurred_at when not supplied", async () => {
    const repo = createMemoryRepo(() => FIXED_NOW);
    const res = await handleIngest(depsWith(repo), {
      source: "commit",
      credential: { token: "t" },
      goalId: GOAL,
      commit: { sha: "z", message: "m", verified: true },
    });
    expect(res.ok && res.evidence.occurred_at).toBe(FIXED_NOW.toISOString());
  });
});

describe("handleIngest — idempotent dedup", () => {
  it("ingests the same (emitter, source_event_id) only once and enqueues judging once", async () => {
    const repo = createMemoryRepo(() => FIXED_NOW);
    const deps = depsWith(repo);
    const input = {
      source: "commit" as const,
      credential: { token: "t" },
      goalId: GOAL,
      milestoneId: MILESTONE,
      commit: { sha: "same-sha", message: "feat: x", verified: true },
    };

    const first = await handleIngest(deps, input);
    const second = await handleIngest(deps, input);

    expect(first.ok && first.deduped).toBe(false);
    expect(first.ok && first.status).toBe(201);
    expect(second.ok && second.deduped).toBe(true);
    expect(second.ok && second.status).toBe(200);
    if (first.ok && second.ok) {
      expect(second.evidence.id).toBe(first.evidence.id); // same row returned
    }

    expect(repo.state.evidence).toHaveLength(1);
    // exactly one judge job, with the evidence-derived dedup key
    expect(repo.state.jobs).toHaveLength(1);
    const job = repo.state.jobs[0]!;
    expect(job.type).toBe("judge_evidence");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(job.dedup_key).toBe(judgeJobDedupKey(first.evidence.id));
    expect(job.payload.evidence_id).toBe(first.evidence.id);
  });

  it("treats events from different emitters as distinct even with the same source id", async () => {
    const repo = createMemoryRepo(() => FIXED_NOW);
    const e1 = "00000000-0000-4000-8000-0000000000e1";
    const e2 = "00000000-0000-4000-8000-0000000000e2";
    const mk = (emitterId: string) =>
      depsWith(repo, async () => ({ ownerId: OWNER, emitterId }));
    const input = {
      source: "commit" as const,
      credential: { token: "t" },
      goalId: GOAL,
      commit: { sha: "shared", message: "m", verified: true },
    };
    await handleIngest(mk(e1), input);
    await handleIngest(mk(e2), input);
    expect(repo.state.evidence).toHaveLength(2);
    expect(repo.state.jobs).toHaveLength(2);
  });
});
