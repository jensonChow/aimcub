import { describe, expect, it } from "vitest";

import { executeStatusLine, type ExecuteMilestoneRow } from "./executePrimaryAction";

/**
 * The expanded row's ONE state sentence. The old detail told the same story as a blocked
 * banner + a run-state card + an evidence card; a human needs it told once, in product words,
 * and a quiet ready row needs no sentence at all.
 */

const t = (key: string, vars?: Record<string, string | number>) => {
  const table: Record<string, string> = {
    "execute.blockedDefault": "Something failed and needs a person.",
    "execute.runStatus.queued": "Queued",
    "execute.runStatus.running": "Running",
    "execute.runQueuedAt": `Queued ${String(vars?.time ?? "")}`,
    "execute.runStartedAt": `Started ${String(vars?.time ?? "")}`,
    "execute.evidenceLowTrustDetail": `${String(vars?.lowTrust ?? "")}/${String(vars?.total ?? "")} below the trust floor`,
    "execute.evidenceMatchedDetail": `${String(vars?.matched ?? "")}/${String(vars?.total ?? "")} matched at ${String(vars?.trust ?? "")}`,
    "execute.evidenceNeedsEvalDetail": `${String(vars?.total ?? "")} awaiting eval`,
  };
  return table[key] ?? key;
};

function row(overrides: Partial<ExecuteMilestoneRow>): ExecuteMilestoneRow {
  return {
    milestone: { id: "m1", title: "Do the work", status: "pending" },
    assignment: null,
    latest_run: null,
    child_relations: [],
    eval_review: { passed: false, matched_evidence_ids: [], trust_score: 0, reason: "", next_action: "" },
    evaluator_results: [],
    evidence: [],
    evidence_count: 0,
    completed: false,
    blocked: false,
    ready: true,
    waiting_on: [],
    next_action: "",
    ...overrides,
  } as unknown as ExecuteMilestoneRow;
}

function evidenceItem(status: string) {
  return { evidence: { payload: {} }, rule_matches: [], status, review_note: "" } as unknown as ExecuteMilestoneRow["evidence"][number];
}

describe("executeStatusLine", () => {
  it("says nothing for a quiet ready row with no history", () => {
    expect(executeStatusLine(row({}), t)).toBeNull();
  });

  it("tells a blocked row's story in one danger sentence, using the run's own error", () => {
    const line = executeStatusLine(
      row({
        blocked: true,
        latest_run: { status: "failed", error: "Local agent run timed out." } as ExecuteMilestoneRow["latest_run"],
      }),
      t,
    );
    expect(line).toEqual({ tone: "danger", text: "Local agent run timed out." });
  });

  it("reports an in-flight run with its timing, quietly", () => {
    const line = executeStatusLine(
      row({ latest_run: { status: "queued", queued_at: "2026-08-14T02:00:00.000Z" } as ExecuteMilestoneRow["latest_run"] }),
      t,
    );
    expect(line?.tone).toBe("");
    expect(line?.text).toMatch(/^Queued · Queued /);
  });

  it("turns low-trust evidence into one warn sentence", () => {
    const line = executeStatusLine(
      row({ evidence: [evidenceItem("low_trust"), evidenceItem("low_trust")], evidence_count: 2 }),
      t,
    );
    expect(line).toEqual({ tone: "warn", text: "2/2 below the trust floor" });
  });

  it("turns matched evidence into one success sentence with the trust score", () => {
    const line = executeStatusLine(
      row({
        evidence: [evidenceItem("matched")],
        evidence_count: 1,
        eval_review: { passed: true, matched_evidence_ids: ["e"], trust_score: 0.82, reason: "", next_action: "" },
      }),
      t,
    );
    expect(line).toEqual({ tone: "success", text: "1/1 matched at 82%" });
  });
});
