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

import { validatePlan } from "@core/domain";
import type {
  DecompositionOutput,
  Goal,
  GoalDomain,
  Memory,
  Milestone,
  MilestoneStatus,
} from "@core/types";

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

/** The persistence surface. Async so a Supabase adapter can implement the same contract. */
export interface AimStore {
  listGoals(): Promise<Goal[]>;
  getGoal(id: string): Promise<{ goal: Goal; milestones: Milestone[] } | null>;
  createGoal(input: CreateGoalInput): Promise<{ goal: Goal; milestones: Milestone[] }>;
  deleteGoal(id: string): Promise<void>;
}

/** Default data dir: `$AIMCUB_HOME` or `~/.aimcub` (shared by desktop + CLI). */
export function defaultDataDir(): string {
  const override = process.env.AIMCUB_HOME?.trim();
  return override && override.length > 0 ? override : join(homedir(), ".aimcub");
}

/**
 * Validate a DecompositionOutput and materialize it into linear Milestone rows.
 * Reuses `@core/domain` validatePlan as the gate (identical to the web/desktop path).
 */
export function materialize(
  decomposition: DecompositionOutput,
  goalId: string,
  ownerId: string,
  statuses: MilestoneStatus[] = [],
): Milestone[] {
  const result = validatePlan(decomposition);
  if (!result.ok) {
    throw new Error(`invalid decomposition: ${result.errors.join("; ")}`);
  }

  const idByKey = new Map<string, string>();
  for (const node of decomposition.nodes) idByKey.set(node.key, randomUUID());
  const dependsOn = new Map<string, string>(); // to -> from id
  for (const edge of decomposition.edges) {
    const fromId = idByKey.get(edge.from);
    if (fromId) dependsOn.set(edge.to, fromId);
  }

  return decomposition.nodes.map((node, i) => {
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

    async deleteGoal(id: string): Promise<void> {
      const store = load();
      store.goals = store.goals.filter((g) => g.id !== id);
      delete store.milestonesByGoal[id];
      store.memories = store.memories.filter((m) => m.goal_id !== id);
      save(store);
    },
  };
}
