/**
 * @core/store — platform-neutral local persistence for aims/milestones/memories.
 *
 * One JSON file under a data directory that BOTH the desktop app and the CLI point at
 * (default ~/.aimcub), so a person's aims are one set of rows with two faces. Shapes reuse
 * @core/types 1:1 so a later Supabase sync is transform-free.
 *
 * The {@link AimStore} interface is ASYNC on purpose: the current implementation
 * ({@link createJsonFileStore}) does synchronous fs under the hood, but a future Supabase
 * adapter is genuinely async — coding to the async interface now means swapping adapters
 * later is a one-line change at call sites, not a rewrite (the "design for C" decision).
 *
 * This package is NOT in the purity-guarded kernel (that is only @core/domain + @core/types),
 * so it may do node fs/os/path/crypto I/O. @core/domain must never import this.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { planMerge, validatePlan } from "@core/domain";
// DecompositionOutput is imported as a VALUE (the Zod schema) so the store can re-validate
// the SHAPE of any plan it is asked to persist — the gatekeeper for untrusted input.
import { DecompositionOutput } from "@core/types";
import type { Goal, GoalDomain, Memory, Milestone, MilestoneStatus, PlanNode } from "@core/types";

/** Fixed local owner for the single-user local app (matches the web demo owner). */
export const DEFAULT_OWNER = "00000000-0000-4000-8000-000000000001";

/** The on-disk shape. */
export interface LocalStore {
  ownerId: string;
  goals: Goal[];
  milestonesByGoal: Record<string, Milestone[]>;
  memories: Memory[];
}

/** A memory to persist alongside a new goal (e.g. derived from clarifying answers). */
export interface NewMemory {
  content: string;
  /** Defaults to `user_stated`. */
  source?: Memory["source"];
}

export interface CreateGoalInput {
  ownerId?: string;
  title: string;
  description?: string;
  domain?: GoalDomain;
  /** The validated decomposition; milestones are materialized from it. */
  plan: DecompositionOutput;
  memories?: NewMemory[];
}

/** Re-plan an existing aim: swap in a new decomposition while preserving finished work. */
export interface UpdateGoalInput {
  id: string;
  /** Optional rename; omitted/blank keeps the current title. */
  title?: string;
  /** Optional new description; omitted keeps the current one (`""` clears it). */
  description?: string;
  /** The new decomposition; merged via `planMerge` (completed milestones frozen). */
  plan: DecompositionOutput;
}

/** The persistence surface. Async so a Supabase adapter can implement the same contract. */
export interface AimStore {
  listGoals(): Promise<Goal[]>;
  getGoal(id: string): Promise<{ goal: Goal; milestones: Milestone[] } | null>;
  createGoal(input: CreateGoalInput): Promise<{ goal: Goal; milestones: Milestone[] }>;
  /**
   * Re-plan an existing aim. Returns the updated goal + milestones, or `null` if no aim
   * has that id. Throws if the new plan is structurally invalid (mirrors `materialize`).
   */
  updateGoal(input: UpdateGoalInput): Promise<{ goal: Goal; milestones: Milestone[] } | null>;
  deleteGoal(id: string): Promise<void>;
}

/** Default data dir: `$AIMCUB_HOME` or `~/.aimcub` (shared by desktop + CLI). */
export function defaultDataDir(): string {
  const override = process.env.AIMCUB_HOME?.trim();
  return override && override.length > 0 ? override : join(homedir(), ".aimcub");
}

/**
 * The store's single validation gate for any plan it is asked to persist. Runs the Zod SHAPE
 * check (the same gate the LLM `decompose` path uses — required key/title/acceptance_rule and
 * field types) AND the semantic invariants Zod can't express (unique keys, acyclic, edge
 * refs). Returns the parsed value with defaults applied. Throws `invalid decomposition: …` on
 * any failure. This is what stops a hand-edited (`aim edit`) or otherwise untrusted plan from
 * persisting a structurally broken milestone (e.g. one with no acceptance_rule, which could
 * never be evaluated — corrupting derived state).
 */
function parseDecomposition(plan: DecompositionOutput): DecompositionOutput {
  const parsed = DecompositionOutput.safeParse(plan);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new Error(`invalid decomposition: ${issues}`);
  }
  const semantic = validatePlan(parsed.data);
  if (!semantic.ok) {
    throw new Error(`invalid decomposition: ${semantic.errors.join("; ")}`);
  }
  return parsed.data;
}

/**
 * Validate a DecompositionOutput and materialize it into linear Milestone rows.
 * Routes through {@link parseDecomposition} (shape + semantic gate, identical to web/desktop).
 */
export function materialize(
  decomposition: DecompositionOutput,
  goalId: string,
  ownerId: string,
  statuses: MilestoneStatus[] = [],
): Milestone[] {
  const plan = parseDecomposition(decomposition);

  const idByKey = new Map<string, string>();
  for (const node of plan.nodes) idByKey.set(node.key, randomUUID());
  const dependsOn = new Map<string, string>(); // to -> from id
  for (const edge of plan.edges) {
    const fromId = idByKey.get(edge.from);
    if (fromId) dependsOn.set(edge.to, fromId);
  }

  return plan.nodes.map((node, i) => {
    const status = statuses[i] ?? "pending";
    return {
      id: idByKey.get(node.key)!,
      goal_id: goalId,
      owner_id: ownerId,
      title: node.title,
      description: node.description,
      status,
      order_index: i,
      depends_on_id: dependsOn.get(node.key) ?? null,
      acceptance_rule: node.acceptance_rule,
      xp_reward: node.xp_reward,
      completed_at: null,
      metadata: { est_effort: node.est_effort, plan_key: node.key },
    } satisfies Milestone;
  });
}

/**
 * Re-plan: merge a new decomposition into a goal's existing milestones, preserving
 * finished work. Delegates the freeze/update/add/skip decision to `@core/domain`'s
 * `planMerge` (the single source of the re-plan invariant) and materializes the result
 * into Milestone rows:
 *  - freeze  → keep the completed row verbatim (its id, status, content, completed_at).
 *  - update  → reuse the stable id + status + completed_at; take title/desc/rule/xp/effort
 *              from the new node.
 *  - add     → a fresh `pending` milestone with a new id.
 *  - skip    → an unfinished milestone the new plan dropped; kept as a `skipped` row
 *              (soft delete — finished/in-flight history is never silently lost).
 * Order follows the merged order (new nodes in plan order, then retired rows). `depends_on`
 * is rebuilt from the new plan's edges for keyed rows; retired rows depend on nothing.
 */
export function mergeMilestones(
  existing: Milestone[],
  goalId: string,
  ownerId: string,
  next: DecompositionOutput,
): Milestone[] {
  const plan = parseDecomposition(next);

  const merged = planMerge(
    existing.map((m) => ({ id: m.id, title: m.title, status: m.status })),
    plan,
  );
  const existingById = new Map(existing.map((m) => [m.id, m]));
  const nodeByKey = new Map<string, PlanNode>(plan.nodes.map((n) => [n.key, n]));

  // Stable id per surviving node key (existing id for update/freeze, fresh for add), so the
  // new plan's edges can resolve to milestone ids.
  const idByKey = new Map<string, string>();
  for (const item of merged) {
    if (item.nodeKey) idByKey.set(item.nodeKey, item.existingId ?? randomUUID());
  }
  const dependsOn = new Map<string, string>(); // node key (`to`) -> prerequisite milestone id
  for (const edge of plan.edges) {
    const fromId = idByKey.get(edge.from);
    if (fromId) dependsOn.set(edge.to, fromId);
  }

  const milestones: Milestone[] = [];
  merged.forEach((item, order) => {
    const node = item.nodeKey ? nodeByKey.get(item.nodeKey) : undefined;
    const prev = item.existingId ? existingById.get(item.existingId) : undefined;

    if (item.action === "add" && node) {
      milestones.push({
        id: idByKey.get(node.key)!,
        goal_id: goalId,
        owner_id: ownerId,
        title: node.title,
        description: node.description,
        status: "pending",
        order_index: order,
        depends_on_id: dependsOn.get(node.key) ?? null,
        acceptance_rule: node.acceptance_rule,
        xp_reward: node.xp_reward,
        completed_at: null,
        metadata: { est_effort: node.est_effort, plan_key: node.key },
      });
    } else if (item.action === "update" && node && prev) {
      // Reuse the stable id, status, and completed_at; refresh the plan-authored content.
      milestones.push({
        ...prev,
        title: node.title,
        description: node.description,
        order_index: order,
        depends_on_id: dependsOn.get(node.key) ?? null,
        acceptance_rule: node.acceptance_rule,
        xp_reward: node.xp_reward,
        metadata: { ...prev.metadata, est_effort: node.est_effort, plan_key: node.key },
      });
    } else if (item.action === "freeze" && prev) {
      // A completed milestone — never overwrite its content; just re-thread order/deps.
      milestones.push({
        ...prev,
        order_index: order,
        depends_on_id: item.nodeKey ? (dependsOn.get(item.nodeKey) ?? null) : null,
        metadata: item.nodeKey ? { ...prev.metadata, plan_key: item.nodeKey } : prev.metadata,
      });
    } else if (item.action === "skip" && prev) {
      // Unfinished but dropped from the new plan — retire as a soft-deleted row.
      milestones.push({ ...prev, status: "skipped", order_index: order, depends_on_id: null });
    }
  });

  return milestones;
}

function emptyStore(): LocalStore {
  return { ownerId: DEFAULT_OWNER, goals: [], milestonesByGoal: {}, memories: [] };
}

/**
 * A JSON-file-backed {@link AimStore} rooted at `dataDir` (default {@link defaultDataDir}).
 * Each operation loads → mutates → saves; fine for a single user. (If concurrent desktop +
 * CLI writes ever become real, move to SQLite — last-writer-wins is the known limitation.)
 */
export function createJsonFileStore(dataDir: string = defaultDataDir()): AimStore {
  const file = join(dataDir, "store.json");

  function load(): LocalStore {
    try {
      if (!existsSync(file)) return emptyStore();
      const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<LocalStore>;
      return {
        ownerId: parsed.ownerId ?? DEFAULT_OWNER,
        goals: parsed.goals ?? [],
        milestonesByGoal: parsed.milestonesByGoal ?? {},
        memories: parsed.memories ?? [],
      };
    } catch {
      return emptyStore();
    }
  }

  function save(store: LocalStore): void {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(file, JSON.stringify(store, null, 2), "utf8");
  }

  return {
    async listGoals(): Promise<Goal[]> {
      return load().goals.slice().sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
    },

    async getGoal(id: string): Promise<{ goal: Goal; milestones: Milestone[] } | null> {
      const store = load();
      const goal = store.goals.find((g) => g.id === id);
      if (!goal) return null;
      return { goal, milestones: store.milestonesByGoal[id] ?? [] };
    },

    async createGoal(input: CreateGoalInput): Promise<{ goal: Goal; milestones: Milestone[] }> {
      const store = load();
      const now = new Date().toISOString();
      const ownerId = input.ownerId ?? store.ownerId ?? DEFAULT_OWNER;
      const goalId = randomUUID();

      const goal: Goal = {
        id: goalId,
        owner_id: ownerId,
        title: input.title,
        description: input.description ?? "",
        domain: input.domain ?? "software",
        status: "active",
        target_date: null,
        plan_json: input.plan,
        metadata: {},
        created_at: now,
      };

      const milestones = materialize(input.plan, goalId, ownerId);

      const memories: Memory[] = (input.memories ?? [])
        .filter((m) => m.content.trim().length > 0)
        .map((m) => ({
          id: randomUUID(),
          owner_id: ownerId,
          goal_id: goalId,
          kind: "semantic",
          content: m.content,
          confidence: 1,
          source: m.source ?? "user_stated",
          status: "active",
          superseded_by: null,
          created_at: now,
        } satisfies Memory));

      store.goals.push(goal);
      store.milestonesByGoal[goalId] = milestones;
      store.memories.push(...memories);
      save(store);

      return { goal, milestones };
    },

    async updateGoal(input: UpdateGoalInput): Promise<{ goal: Goal; milestones: Milestone[] } | null> {
      const store = load();
      const goal = store.goals.find((g) => g.id === input.id);
      if (!goal) return null;

      const existing = store.milestonesByGoal[input.id] ?? [];
      const milestones = mergeMilestones(existing, goal.id, goal.owner_id, input.plan);

      const title = input.title?.trim();
      if (title) goal.title = title;
      if (input.description !== undefined) goal.description = input.description;
      goal.plan_json = input.plan;

      store.milestonesByGoal[goal.id] = milestones;
      save(store);
      return { goal, milestones };
    },

    async deleteGoal(id: string): Promise<void> {
      const store = load();
      store.goals = store.goals.filter((g) => g.id !== id);
      delete store.milestonesByGoal[id];
      store.memories = store.memories.filter((m) => m.goal_id !== id);
      save(store);
    },
  };
}
