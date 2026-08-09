import { mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { parse, resolve, sep } from "node:path";

import type { DecompositionOutput } from "@aimcub/types";
import {
  createJsonFileStore,
  type AimStore,
  type ImportStoreResult,
  type LocalStore,
} from "@aimcub/store";

export const LOCAL_ALPHA_DEMO_GOAL_TITLE = "Dogfood the local alpha open-source loop";
export const LOCAL_ALPHA_DEMO_SLUG = "local-alpha-demo";
export const LOCAL_ALPHA_DEMO_EMITTER_ID = "00000000-0000-4000-8000-0000000000da";

export interface LocalAlphaDemoSnapshot {
  goalId: string;
  snapshot: LocalStore;
}

export interface LocalAlphaDemoSeedResult {
  dataDir: string;
  goalId: string;
  title: string;
  imported: ImportStoreResult;
}

export interface ResolveLocalAlphaDemoTargetInput {
  targetDir?: string | null;
  env?: Record<string, string | undefined>;
  cwd?: string;
  homeDir?: string;
  force?: boolean;
}

function commitRule(messagePattern: string, pathGlob: string): DecompositionOutput["nodes"][number]["acceptance_rule"] {
  return {
    logic: "all",
    threshold: 1,
    completion_mode: "auto_then_confirm",
    clauses: [{
      evaluator: "commit_pattern",
      auto_verifiable: true,
      match: { message_pattern: messagePattern, path_glob: pathGlob, min_files: 1 },
    }],
  };
}

function manualRule(): DecompositionOutput["nodes"][number]["acceptance_rule"] {
  return {
    logic: "all",
    threshold: 1,
    completion_mode: "manual",
    clauses: [{ evaluator: "manual_confirm", auto_verifiable: false, match: {} }],
  };
}

function contract(input: {
  why: string;
  done: string;
  evidence: string[];
  owner: NonNullable<DecompositionOutput["nodes"][number]["decomposition_contract"]>["likely_owner"];
  evalSignal: string;
}): NonNullable<DecompositionOutput["nodes"][number]["decomposition_contract"]> {
  return {
    why: input.why,
    definition_of_done: input.done,
    required_evidence: input.evidence,
    likely_owner: input.owner,
    context_gaps: [],
    eval_signal: input.evalSignal,
  };
}

export function localAlphaDemoPlan(): DecompositionOutput {
  return {
    goal_summary: "Use an offline deterministic seed to inspect the local alpha loop.",
    domain: "software",
    rationale: "The demo keeps provider-free visual QA focused on context, routing, execution evidence, eval trust, and context review.",
    nodes: [
      {
        key: "context-contract",
        title: "Collect useful project context",
        description: "Read local alpha docs, product constraints, and store behavior before explaining the loop.",
        est_effort: "s",
        xp_reward: 10,
        acceptance_rule: commitRule("local alpha demo context", "docs/**"),
        decomposition_contract: contract({
          why: "Context is the product, so the demo needs visible project and user constraints before execution.",
          done: "The seed includes project context, local alpha constraints, and a trusted evidence trail.",
          evidence: ["Trusted commit touching local alpha docs or examples."],
          owner: "agent",
          evalSignal: "Trusted evidence proves the demo context was collected before execution.",
        }),
        routing_override: null,
      },
      {
        key: "agent-seed-fixture",
        title: "Build deterministic seed fixture",
        description: "Create the reusable store fixture and seed entry point for isolated visual QA.",
        est_effort: "m",
        xp_reward: 20,
        acceptance_rule: commitRule("seed fixture", "packages/store/**"),
        decomposition_contract: contract({
          why: "A local agent can implement the deterministic fixture without provider keys.",
          done: "The seed fixture can be re-run against an isolated data directory and produce the same local loop state.",
          evidence: ["Trusted commit touching the store seed fixture."],
          owner: "agent",
          evalSignal: "Done means trusted code evidence proves the fixture exists.",
        }),
        routing_override: null,
      },
      {
        key: "human-demo-review",
        title: "Review demo narrative with the user",
        description: "Confirm the story is accurate before presenting the local alpha loop.",
        est_effort: "s",
        xp_reward: 10,
        acceptance_rule: manualRule(),
        decomposition_contract: contract({
          why: "The final explanation depends on user judgment and product taste.",
          done: "The user approves the wording and confirms it represents the local alpha promise.",
          evidence: ["Approval note from the user."],
          owner: "human",
          evalSignal: "Done means the user explicitly approves the demo narrative.",
        }),
        routing_override: null,
      },
      {
        key: "low-trust-proof-review",
        title: "Review low-trust agent proof",
        description: "Inspect an agent self-report that should not complete the sub-aim by itself.",
        est_effort: "s",
        xp_reward: 10,
        acceptance_rule: commitRule("visual qa walkthrough", "examples/local-alpha/**"),
        decomposition_contract: contract({
          why: "Eval must distinguish trusted proof from an agent self-report.",
          done: "A trusted walkthrough artifact exists, or a human explicitly accepts the low-trust proof.",
          evidence: ["Trusted commit or artifact for the visual QA walkthrough."],
          owner: "agent",
          evalSignal: "Done means eval sees trusted evidence, not only a low-trust self-report.",
        }),
        routing_override: null,
      },
    ],
    // Not a chain: the seed exists to exercise real read-model states, and "everything waits
    // for the previous row" can only ever show ONE actionable sub-aim. Branching the human
    // review off the finished contract puts agent work and human work in flight AT THE SAME
    // TIME, and leaves one genuinely waiting row so the waiting state is demoable too.
    edges: [
      { from: "context-contract", to: "agent-seed-fixture" },
      { from: "context-contract", to: "human-demo-review" },
      { from: "agent-seed-fixture", to: "low-trust-proof-review" },
    ],
  };
}

function deterministicIdFactory(): () => string {
  let counter = 256;
  return () => {
    counter += 1;
    return `00000000-0000-4000-8000-${counter.toString(16).padStart(12, "0")}`;
  };
}

function deterministicClock(): () => string {
  const start = Date.UTC(2026, 6, 8, 9, 0, 0);
  let tick = -1;
  return () => {
    tick += 1;
    return new Date(start + tick * 60_000).toISOString();
  };
}

function milestoneByKey(snapshot: LocalStore, goalId: string, key: string) {
  const milestone = (snapshot.milestonesByGoal[goalId] ?? []).find((row) => row.metadata.plan_key === key);
  if (!milestone) throw new Error(`Local alpha demo milestone not found: ${key}`);
  return milestone;
}

async function assignmentFor(store: AimStore, goalId: string, milestoneId: string) {
  const assignment = (await store.listAssignments(goalId)).find((row) => row.milestone_id === milestoneId);
  if (!assignment) throw new Error(`Local alpha demo assignment not found for milestone ${milestoneId}.`);
  return assignment;
}

export async function buildLocalAlphaDemoSnapshot(): Promise<LocalAlphaDemoSnapshot> {
  const buildDir = mkdtempSync(resolve(tmpdir(), "aimcub-local-alpha-demo-build-"));
  const store = createJsonFileStore(buildDir, {
    idFactory: deterministicIdFactory(),
    now: deterministicClock(),
  });

  const agent = await store.addActor({
    kind: "agent",
    displayName: "Codex CLI",
    capabilities: ["software", "research", "writing"],
    agentKind: "codex",
    runMode: "local_cli",
    model: "gpt-5",
    connectionRef: "local://codex",
  });
  const human = await store.addActor({
    kind: "human",
    displayName: "Jenson",
    capabilities: ["human_judgment", "approval", "product_taste"],
  });
  const localDocsTrace = await store.recordToolTrace({
    toolName: "local.read",
    status: "succeeded",
    summary: "Read AGENTS.md, local alpha docs, v1 spec, store APIs, and Desktop stage surfaces.",
    sources: [
      { path: "AGENTS.md" },
      { path: "docs/local-alpha.md" },
      { path: "packages/store/src/index.ts" },
      { path: "apps/desktop/src/renderer/stages/eval/EvalStage.tsx" },
    ],
  });
  const memoryTrace = await store.recordToolTrace({
    toolName: "memory.lookup",
    status: "succeeded",
    summary: "Loaded Aimcub memory about the five-stage local loop and evidence trust behavior.",
    sources: [{ path: "docs/memory/product.md" }, { path: "docs/memory/architecture.md" }],
  });

  const { goal } = await store.createGoal({
    title: LOCAL_ALPHA_DEMO_GOAL_TITLE,
    description: "A provider-free demo aim with context, plan contracts, mixed human/agent routing, evidence trust states, and context review.",
    plan: localAlphaDemoPlan(),
    metadata: {
      demo: LOCAL_ALPHA_DEMO_SLUG,
      deterministic: true,
      provider_keys_required: false,
      local_agents_required: false,
    },
    memories: [
      {
        content: "Constraint: Local alpha demo must run from an isolated AIMCUB_HOME and must not depend on provider keys or live local agents.",
        kind: "semantic",
        category: "constraint",
        confidence: 1,
      },
      {
        content: "Project fact: The local alpha loop is Aim -> Context -> Plan/Contracts -> Execute -> Eval.",
        kind: "semantic",
        category: "project_fact",
        confidence: 0.96,
      },
    ],
  });

  await store.createContextIntakeSession({
    goalId: goal.id,
    aimTitle: goal.title,
    aimDescription: goal.description,
    readiness: "Ready: local docs, architecture memory, and Desktop stage contracts were collected.",
    toolTraceIds: [localDocsTrace.id, memoryTrace.id],
  });

  const initial = await store.exportData();
  const completedMilestone = milestoneByKey(initial, goal.id, "context-contract");
  const lowTrustMilestone = milestoneByKey(initial, goal.id, "low-trust-proof-review");
  const completedAssignment = await assignmentFor(store, goal.id, completedMilestone.id);
  const lowTrustAssignment = await assignmentFor(store, goal.id, lowTrustMilestone.id);

  const completedRun = await store.createRun({
    goalId: goal.id,
    milestoneId: completedMilestone.id,
    assignmentId: completedAssignment.id,
    actorKind: "agent",
    actorId: agent.id,
    status: "running",
    workspaceRoot: "/tmp/aimcub-local-alpha-demo-workspace",
    sandbox: "workspace-write",
    networkEnabled: false,
    model: "gpt-5",
    reasoning: "medium",
    summary: "Codex collected local alpha context and prepared trusted demo evidence.",
  });
  await store.appendRunEvent({
    runId: completedRun.id,
    type: "tool.finished",
    summary: "Read local alpha docs, architecture memory, and Desktop Eval behavior.",
  });
  await store.finishRun({
    runId: completedRun.id,
    status: "completed",
    summary: "Local alpha context is ready for the offline demo.",
  });
  await store.addEvidence({
    goalId: goal.id,
    milestoneId: completedMilestone.id,
    emitterId: LOCAL_ALPHA_DEMO_EMITTER_ID,
    kind: "git_commit",
    sourceEventId: "local-alpha-demo-context",
    summary: "Trusted local alpha demo context evidence",
    payload: {
      sha: "demo-context",
      message: "local alpha demo context",
      branch: "local-alpha-demo",
      files: ["docs/local-alpha.md", "examples/local-alpha/README.md"],
    },
    trustScore: 1,
    runId: completedRun.id,
    assignmentId: completedAssignment.id,
  });

  const lowTrustRun = await store.createRun({
    goalId: goal.id,
    milestoneId: lowTrustMilestone.id,
    assignmentId: lowTrustAssignment.id,
    actorKind: "agent",
    actorId: agent.id,
    status: "running",
    workspaceRoot: "/tmp/aimcub-local-alpha-demo-workspace",
    sandbox: "workspace-write",
    networkEnabled: false,
    model: "gpt-5",
    reasoning: "medium",
    summary: "Codex reported a visual QA walkthrough without trusted evidence.",
  });
  await store.appendRunEvent({
    runId: lowTrustRun.id,
    type: "tool.finished",
    summary: "Generated a self-report that still needs trusted proof.",
  });
  await store.finishRun({
    runId: lowTrustRun.id,
    status: "completed",
    summary: "Self-reported visual QA walkthrough; trusted artifact is still missing.",
  });
  await store.addEvidence({
    goalId: goal.id,
    milestoneId: lowTrustMilestone.id,
    kind: "mcp_report",
    sourceEventId: "local-alpha-demo-low-trust-report",
    summary: "Agent self-report says visual QA passed, but no trusted artifact was attached.",
    payload: {
      agent_id: "codex",
      model: "gpt-5",
      events: [
        { type: "agent.run.started", summary: "Started visual QA from the seeded local alpha aim." },
        { type: "agent.tool.finished", summary: "Reported screenshots and walkthrough notes." },
        { type: "agent.run.completed", summary: "Self-report completed without a trusted commit or file artifact." },
      ],
    },
    trustScore: 0.55,
    runId: lowTrustRun.id,
    assignmentId: lowTrustAssignment.id,
  });

  await store.addMemory({
    goalId: null,
    content: "Constraint: Demo seeds should be written only to explicit isolated data directories.",
    category: "constraint",
    confidence: 1,
  });
  const acceptedCandidate = await store.addMemoryCandidate({
    goalId: goal.id,
    content: "Eval signal: A local alpha demo is credible only when trusted evidence, low-trust evidence, and no-evidence gaps are all inspectable.",
    category: "eval_signal",
    source: "evidence_derived",
    confidence: 0.78,
  });
  await store.acceptMemoryCandidate({
    id: acceptedCandidate.id,
    content: "Eval signal: Demo readiness requires trusted proof, low-trust review, and visible no-evidence gaps.",
    goalId: goal.id,
    category: "eval_signal",
    source: "evidence_derived",
    confidence: 0.92,
  });
  await store.addMemoryCandidate({
    goalId: goal.id,
    content: "Procedure: Before presenting local alpha, seed an isolated AIMCUB_HOME and inspect Execute/Eval mixed states.",
    kind: "procedural",
    category: "procedure",
    source: "agent_inferred",
    confidence: 0.74,
  });

  const snapshot = await store.exportData();
  const assignments = snapshot.assignments.filter((row) => row.goal_id === goal.id);
  if (!assignments.some((row) => row.actor_id === human.id && row.actor_kind === "human")) {
    throw new Error("Local alpha demo did not materialize a human-routed sub-aim.");
  }
  return { goalId: goal.id, snapshot };
}

export async function seedLocalAlphaDemo(dataDir: string): Promise<LocalAlphaDemoSeedResult> {
  const { goalId, snapshot } = await buildLocalAlphaDemoSnapshot();
  const store = createJsonFileStore(dataDir);
  const imported = await store.importData(snapshot, "replace");
  return {
    dataDir,
    goalId,
    title: LOCAL_ALPHA_DEMO_GOAL_TITLE,
    imported,
  };
}

function pathInside(parent: string, child: string): boolean {
  return child === parent || child.startsWith(`${parent}${sep}`);
}

export function resolveLocalAlphaDemoTarget(input: ResolveLocalAlphaDemoTargetInput = {}): string {
  const env = input.env ?? process.env;
  const rawTarget = input.targetDir?.trim() || env.AIMCUB_HOME?.trim();
  if (!rawTarget) {
    throw new Error("Provide --target <dir> or set AIMCUB_HOME to an isolated demo directory.");
  }

  const cwd = input.cwd ?? process.cwd();
  const home = resolve(input.homeDir ?? homedir());
  const target = resolve(cwd, rawTarget);
  const homeAimcub = resolve(home, ".aimcub");
  const root = parse(target).root;
  const force = input.force === true;

  if (!force && (target === root || target === home || pathInside(homeAimcub, target))) {
    throw new Error(`Refusing to seed dangerous Aimcub data directory: ${target}. Use an isolated directory or pass --force.`);
  }

  return target;
}
