/**
 * Seeding the two conditions.
 *
 * Both conditions are built the same way as `examples/local-alpha`: a snapshot is assembled in a
 * throwaway build directory against a deterministic id factory and clock, then imported into the
 * target data directory with `replace`. Same fixture in, same bytes out — which is what makes the
 * benchmark re-runnable and diffable by anyone.
 *
 * The contexted condition never writes context directly into "planning memory". It replays the
 * product's own sedimentation path: prior aims are planned, worked, and proven through evidence;
 * agent-inferred and evidence-derived context enters the inbox as a candidate and only becomes
 * active by being accepted; one candidate stays pending and one row is deprioritized. That is the
 * honest way context accrues, and it is the only way this fixture is allowed to accrue it.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  createJsonFileStore,
  type AimStore,
  type DecompositionOutput,
  type LocalStore,
} from "./core.ts";
import type {
  BenchmarkAim,
  ConditionId,
  FixtureContext,
  FixturePriorAim,
  FixturePriorMilestone,
  SeededCondition,
} from "./types.ts";

/** Fixed emitter for the fixture's trusted commit evidence, mirroring the local-alpha demo. */
const EVAL_MOAT_EMITTER_ID = "00000000-0000-4000-8000-0000000000eb";

function deterministicIdFactory(): () => string {
  let counter = 4096;
  return () => {
    counter += 1;
    return `00000000-0000-4000-8000-${counter.toString(16).padStart(12, "0")}`;
  };
}

function deterministicClock(): () => string {
  const start = Date.UTC(2026, 0, 6, 9, 0, 0);
  let tick = -1;
  return () => {
    tick += 1;
    return new Date(start + tick * 60_000).toISOString();
  };
}

function acceptanceRule(milestone: FixturePriorMilestone): DecompositionOutput["nodes"][number]["acceptance_rule"] {
  if (milestone.proof.kind === "commit") {
    return {
      logic: "all",
      threshold: 1,
      completion_mode: "auto_then_confirm",
      clauses: [{
        evaluator: "commit_pattern",
        auto_verifiable: true,
        match: { message_pattern: milestone.proof.messagePattern, path_glob: milestone.proof.pathGlob, min_files: 1 },
      }],
    };
  }
  return {
    logic: "all",
    threshold: 1,
    completion_mode: "manual",
    clauses: [{ evaluator: "manual_confirm", auto_verifiable: false, match: {} }],
  };
}

function priorPlan(prior: FixturePriorAim): DecompositionOutput {
  return {
    goal_summary: prior.summary,
    domain: prior.domain,
    rationale: prior.rationale,
    nodes: prior.milestones.map((milestone) => ({
      key: milestone.key,
      title: milestone.title,
      description: milestone.description,
      est_effort: "m" as const,
      xp_reward: 20,
      acceptance_rule: acceptanceRule(milestone),
      decomposition_contract: {
        why: milestone.why,
        definition_of_done: milestone.definitionOfDone,
        required_evidence: milestone.requiredEvidence,
        likely_owner: milestone.owner,
        context_gaps: [],
        eval_signal: milestone.evalSignal,
      },
      routing_override: null,
    })),
    edges: prior.milestones.slice(1).map((milestone, index) => ({
      from: prior.milestones[index]!.key,
      to: milestone.key,
    })),
  };
}

async function milestoneId(store: AimStore, goalId: string, planKey: string): Promise<string> {
  const got = await store.getGoal(goalId);
  const milestone = got?.milestones.find((row) => row.metadata.plan_key === planKey);
  if (!milestone) throw new Error(`Fixture milestone not found: ${goalId}/${planKey}`);
  return milestone.id;
}

/** Write one context row through the path the product would actually have written it. */
async function sedimentContext(
  store: AimStore,
  row: FixtureContext,
  goalIdForRow: string | null,
  captureGoalId: string | null,
): Promise<void> {
  const status = row.status ?? "active";
  const shared = {
    content: row.content,
    kind: row.kind,
    category: row.category,
    confidence: row.confidence,
    source: row.source,
  };

  // Something the user said outright never needs review; it is saved as active context directly.
  if (row.source === "user_stated" && status === "active") {
    await store.addMemory({ ...shared, goalId: goalIdForRow });
    return;
  }

  // Everything else arrives as a candidate in the context inbox, scoped to the aim it came from.
  const candidate = await store.addMemoryCandidate({ ...shared, goalId: captureGoalId ?? goalIdForRow });
  if (status === "pending") return;

  // Accepting with a different goal id is how a candidate is promoted to global context on review.
  const accepted = await store.acceptMemoryCandidate({
    id: candidate.id,
    content: row.content,
    kind: row.kind,
    category: row.category,
    confidence: row.confidence,
    source: row.source,
    goalId: goalIdForRow,
  });
  if (!accepted) throw new Error(`Fixture context could not be accepted: ${row.content.slice(0, 40)}`);
  if (status === "deprioritized") await store.deprioritizeMemory({ id: accepted.id });
}

async function proveMilestone(
  store: AimStore,
  goalId: string,
  milestone: FixturePriorMilestone,
  id: string,
): Promise<void> {
  if (milestone.proof.kind === "commit") {
    await store.addEvidence({
      goalId,
      milestoneId: id,
      emitterId: EVAL_MOAT_EMITTER_ID,
      kind: "git_commit",
      sourceEventId: `eval-moat-${milestone.key}`,
      summary: milestone.proof.message,
      payload: {
        sha: milestone.proof.sha,
        message: milestone.proof.message,
        branch: "main",
        files: milestone.proof.files,
      },
      trustScore: 1,
    });
    return;
  }
  if (milestone.proof.kind === "manual") {
    await store.confirmMilestone({
      goalId,
      milestoneId: id,
      summary: milestone.proof.summary,
      proofNote: milestone.proof.proofNote,
      // The human checks off the evidence the contract asked for — the store rejects a bare "done".
      requiredEvidence: milestone.requiredEvidence.map((text) => ({ text, satisfied: true })),
    });
  }
}

/**
 * Build the on-disk snapshot for one condition. Pure with respect to its inputs: the same aim and
 * condition always produce the same snapshot object, so two runs write identical bytes.
 */
export async function buildConditionSnapshot(
  aim: BenchmarkAim,
  condition: ConditionId,
): Promise<{ goalId: string; snapshot: LocalStore }> {
  const buildDir = mkdtempSync(resolve(tmpdir(), "aimcub-eval-moat-build-"));
  const store = createJsonFileStore(buildDir, {
    idFactory: deterministicIdFactory(),
    now: deterministicClock(),
  });

  const priorGoalIds = new Map<string, string>();

  if (condition === "contexted") {
    for (const prior of aim.priorAims) {
      const { goal } = await store.createGoal({
        title: prior.title,
        description: prior.description,
        domain: prior.domain,
        plan: priorPlan(prior),
        metadata: { eval_moat_fixture: aim.id, prior_aim: prior.key },
      });
      priorGoalIds.set(prior.key, goal.id);
      for (const milestone of prior.milestones) {
        await proveMilestone(store, goal.id, milestone, await milestoneId(store, goal.id, milestone.key));
      }
    }

    for (const other of aim.otherAims) {
      const { goal } = await store.createAimShell({
        title: other.title,
        description: other.description,
        domain: aim.domain,
        metadata: { eval_moat_fixture: aim.id, other_aim: other.key },
      });
      priorGoalIds.set(other.key, goal.id);
    }

    const captureGoalId = aim.priorAims[0] ? priorGoalIds.get(aim.priorAims[0].key) ?? null : null;
    for (const row of aim.context) {
      const scoped = row.priorAim ? priorGoalIds.get(row.priorAim) ?? null : null;
      if (row.priorAim && !scoped) throw new Error(`Fixture context references unknown aim: ${row.priorAim}`);
      await sedimentContext(store, row, scoped, row.priorAim ? scoped : captureGoalId);
    }
  }

  // The aim under test exists in BOTH conditions as a plan-less shell: identical title, identical
  // description, no aim-scoped context. Everything that differs sits in the history behind it.
  const { goal } = await store.createAimShell({
    title: aim.title,
    description: aim.description,
    domain: aim.domain,
    metadata: { eval_moat_fixture: aim.id, condition },
  });

  return { goalId: goal.id, snapshot: await store.exportData() };
}

/** Seed one condition into its own isolated data directory. */
export async function seedCondition(
  aim: BenchmarkAim,
  condition: ConditionId,
  dataDir: string,
): Promise<SeededCondition> {
  const { goalId, snapshot } = await buildConditionSnapshot(aim, condition);
  const store = createJsonFileStore(dataDir);
  const imported = await store.importData(snapshot, "replace");
  return {
    condition,
    dataDir,
    goalId,
    counts: {
      goals: imported.goals,
      memories: imported.memories,
      evidence: imported.evidence,
      completions: imported.completions,
    },
  };
}
