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
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { evaluate, inferContextCategory, isPromptLikeContextCandidate, planMerge, validatePlan } from "@core/domain";
// DecompositionOutput is imported as a VALUE (the Zod schema) so the store can re-validate
// the SHAPE of any plan it is asked to persist — the gatekeeper for untrusted input.
import { AcceptanceRule, DecompositionOutput } from "@core/types";
import type {
  ContextCategory,
  Evidence,
  EvidenceKind,
  Goal,
  GoalDomain,
  Memory,
  MemoryKind,
  Milestone,
  MilestoneCompletion,
  MilestoneStatus,
  PlanNode,
} from "@core/types";

/** Fixed local owner for the single-user local app (matches the web demo owner). */
export const DEFAULT_OWNER = "00000000-0000-4000-8000-000000000001";

/** The on-disk shape. */
export interface LocalStore {
  ownerId: string;
  goals: Goal[];
  milestonesByGoal: Record<string, Milestone[]>;
  memories: Memory[];
  evidence: Evidence[];
  completions: MilestoneCompletion[];
}

/** A memory to persist alongside a new goal (e.g. derived from clarifying answers). */
export interface NewMemory {
  content: string;
  /** Defaults to `semantic`. */
  kind?: MemoryKind;
  /** Defaults from the text prefix, then `project_fact`. */
  category?: ContextCategory;
  /** Defaults to `1`. */
  confidence?: number;
  /** Defaults to `user_stated`. */
  source?: Memory["source"];
}

export interface CreateGoalInput {
  ownerId?: string;
  title: string;
  description?: string;
  domain?: GoalDomain;
  metadata?: Record<string, unknown>;
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
  /** Optional metadata patch merged into the existing goal metadata. */
  metadata?: Record<string, unknown>;
  /** The new decomposition; merged via `planMerge` (completed milestones frozen). */
  plan: DecompositionOutput;
}

export interface AddEvidenceInput {
  ownerId?: string;
  goalId: string;
  milestoneId?: string | null;
  emitterId?: string | null;
  kind: EvidenceKind;
  sourceEventId?: string | null;
  occurredAt?: string;
  summary?: string;
  payload?: Record<string, unknown>;
  trustScore?: number;
}

export interface AddEvidenceResult {
  evidence: Evidence;
  /** True when the idempotency key already existed and no new row was appended. */
  deduped: boolean;
  /** Completion rows created by evaluating the affected milestone(s). */
  completions: MilestoneCompletion[];
}

export interface ConfirmMilestoneInput {
  goalId: string;
  milestoneId: string;
  ownerId?: string;
  summary?: string;
}

export interface ConfirmMilestoneResult {
  evidence: Evidence | null;
  completion: MilestoneCompletion | null;
  alreadyCompleted: boolean;
}

export interface AddMemoryInput extends NewMemory {
  ownerId?: string;
  goalId?: string | null;
}

export interface AddMemoryCandidateInput extends NewMemory {
  ownerId?: string;
  goalId?: string | null;
}

export interface AcceptMemoryCandidateInput {
  id: string;
  content?: string;
  kind?: MemoryKind;
  category?: ContextCategory;
  confidence?: number;
  source?: Memory["source"];
  /** Omit to keep the candidate's current scope; null promotes it to global context. */
  goalId?: string | null;
}

export interface DeprioritizeMemoryInput {
  id: string;
  /** Defaults to 0.5, below the planning selection threshold. */
  confidence?: number;
}

export interface ImportStoreResult {
  goals: number;
  milestones: number;
  memories: number;
  evidence: number;
  completions: number;
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
  listEvidence(goalId: string): Promise<Evidence[]>;
  addEvidence(input: AddEvidenceInput): Promise<AddEvidenceResult>;
  confirmMilestone(input: ConfirmMilestoneInput): Promise<ConfirmMilestoneResult | null>;
  listMemories(goalId?: string | null): Promise<Memory[]>;
  listMemoryHistory(goalId?: string | null): Promise<Memory[]>;
  addMemory(input: AddMemoryInput): Promise<Memory>;
  listMemoryCandidates(goalId?: string | null): Promise<Memory[]>;
  addMemoryCandidate(input: AddMemoryCandidateInput): Promise<Memory>;
  acceptMemoryCandidate(input: AcceptMemoryCandidateInput): Promise<Memory | null>;
  rejectMemoryCandidate(id: string): Promise<Memory | null>;
  archiveMemory(id: string): Promise<Memory | null>;
  deprioritizeMemory(input: DeprioritizeMemoryInput): Promise<Memory | null>;
  exportData(): Promise<LocalStore>;
  importData(snapshot: LocalStore, mode?: "merge" | "replace"): Promise<ImportStoreResult>;
}

/** Default data dir: `$AIMCUB_HOME` or `~/.aimcub` (shared by desktop + CLI). */
export function defaultDataDir(): string {
  const override = process.env.AIMCUB_HOME?.trim();
  return override && override.length > 0 ? override : join(homedir(), ".aimcub");
}

// ──────────────────────────────────────────────────────────────────────────
// Provider settings — the LLM config (which endpoint, which key, which model).
//
// Persisted to `settings.json` SIBLING to the aim store, so the desktop app and the CLI
// (`aim setup` / `aim config`) read+write ONE provider config — the same "two faces over one
// store" idea as the aims. Lives here (not in a shell) because it is local fs persistence,
// the same class of thing `createJsonFileStore` does; `@core/domain` must never import it.
// ──────────────────────────────────────────────────────────────────────────

/** Persisted LLM provider config. Structurally the desktop's `ProviderConfig`. */
export type ProviderSettingsProvider =
  | "anthropic"
  | "openai"
  | "deepseek"
  | "minimax"
  | "zai"
  | "google"
  | "qwen"
  | "openai-compatible";

const PROVIDER_SETTINGS_PROVIDERS: readonly ProviderSettingsProvider[] = [
  "anthropic",
  "openai",
  "deepseek",
  "minimax",
  "zai",
  "google",
  "qwen",
  "openai-compatible",
];

export interface ProviderSettings {
  provider: ProviderSettingsProvider;
  apiKey: string;
  /** Endpoint root for OpenAI-compatible providers; omitted ⇒ provider default. */
  baseURL?: string;
  /** Model id selected for the provider. */
  model?: string;
}

export type WebResearchSettingsProvider = "brave";

export interface WebResearchSettings {
  provider: WebResearchSettingsProvider;
  apiKey: string;
  enabled: boolean;
  fetchPages: boolean;
}

function isProviderSettingsProvider(value: unknown): value is ProviderSettingsProvider {
  return typeof value === "string" && PROVIDER_SETTINGS_PROVIDERS.includes(value as ProviderSettingsProvider);
}

/** Path to the provider settings file (sibling to the aim store). */
export function settingsPath(dataDir: string = defaultDataDir()): string {
  return join(dataDir, "settings.json");
}

/** Path to first-party web research provider settings. */
export function webResearchSettingsPath(dataDir: string = defaultDataDir()): string {
  return join(dataDir, "web-settings.json");
}

/**
 * Load provider settings from settings.json. Migrates the legacy `{ anthropicApiKey }` shape
 * (the first key-only desktop slice) into the multi-provider shape. Returns null when nothing
 * usable is on file (missing, unparsable, or an unknown provider).
 */
export function loadSettings(dataDir: string = defaultDataDir()): ProviderSettings | null {
  try {
    const p = settingsPath(dataDir);
    if (!existsSync(p)) return null;
    const s = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;

    // Legacy migration: an Anthropic-only key blob from the first desktop slice.
    if (typeof s.anthropicApiKey === "string" && s.anthropicApiKey.trim() && !s.provider) {
      return { provider: "anthropic", apiKey: s.anthropicApiKey.trim() };
    }

    const provider = s.provider;
    if (!isProviderSettingsProvider(provider)) return null;
    return {
      provider,
      apiKey: typeof s.apiKey === "string" ? s.apiKey : "",
      baseURL: typeof s.baseURL === "string" && s.baseURL.trim() ? s.baseURL.trim() : undefined,
      model: typeof s.model === "string" && s.model.trim() ? s.model.trim() : undefined,
    };
  } catch {
    return null;
  }
}

/** Persist provider settings to settings.json with owner-only (0600) perms — it holds a key. */
export function saveSettings(config: ProviderSettings, dataDir: string = defaultDataDir()): void {
  mkdirSync(dataDir, { recursive: true });
  const p = settingsPath(dataDir);
  writeFileSync(p, JSON.stringify(config, null, 2), { encoding: "utf8", mode: 0o600 });
  // mode on writeFileSync only applies on create; enforce it on overwrite too.
  try {
    chmodSync(p, 0o600);
  } catch {
    /* best-effort (e.g. Windows) */
  }
}

export function loadWebResearchSettings(dataDir: string = defaultDataDir()): WebResearchSettings | null {
  try {
    const p = webResearchSettingsPath(dataDir);
    if (!existsSync(p)) return null;
    const s = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
    if (s.provider !== "brave") return null;
    return {
      provider: "brave",
      apiKey: typeof s.apiKey === "string" ? s.apiKey : "",
      enabled: typeof s.enabled === "boolean" ? s.enabled : Boolean(typeof s.apiKey === "string" && s.apiKey.trim()),
      fetchPages: typeof s.fetchPages === "boolean" ? s.fetchPages : true,
    };
  } catch {
    return null;
  }
}

export function saveWebResearchSettings(config: WebResearchSettings, dataDir: string = defaultDataDir()): void {
  mkdirSync(dataDir, { recursive: true });
  const p = webResearchSettingsPath(dataDir);
  writeFileSync(p, JSON.stringify(config, null, 2), { encoding: "utf8", mode: 0o600 });
  try {
    chmodSync(p, 0o600);
  } catch {
    /* best-effort (e.g. Windows) */
  }
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

function planNodeMetadata(node: PlanNode): Record<string, unknown> {
  return {
    est_effort: node.est_effort,
    plan_key: node.key,
    ...(node.decomposition_contract ? { decomposition_contract: node.decomposition_contract } : {}),
  };
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
      metadata: planNodeMetadata(node),
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
        metadata: planNodeMetadata(node),
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
        metadata: { ...prev.metadata, ...planNodeMetadata(node) },
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

const MANUAL_CONFIRM_RULE = AcceptanceRule.parse({
  logic: "all",
  completion_mode: "manual",
  clauses: [{ evaluator: "manual_confirm", auto_verifiable: false, match: {} }],
});

function allMilestones(store: LocalStore): Milestone[] {
  return Object.values(store.milestonesByGoal).flat();
}

function evidenceForMilestone(store: LocalStore, milestone: Milestone): Evidence[] {
  return store.evidence.filter(
    (ev) =>
      ev.goal_id === milestone.goal_id &&
      (ev.milestone_id === null || ev.milestone_id === milestone.id),
  );
}

function hasCompletion(store: LocalStore, milestoneId: string): boolean {
  return store.completions.some((c) => c.milestone_id === milestoneId);
}

function canUserConfirm(rule: ReturnType<typeof AcceptanceRule.parse>): boolean {
  return (
    rule.completion_mode !== "auto" ||
    rule.clauses.some((clause) => clause.evaluator === "manual_confirm")
  );
}

function insertCompletion(
  store: LocalStore,
  milestone: Milestone,
  decidedBy: MilestoneCompletion["decided_by"],
  triggeringEvidenceIds: string[],
  now: string,
): MilestoneCompletion | null {
  if (hasCompletion(store, milestone.id)) return null;
  const completion: MilestoneCompletion = {
    id: randomUUID(),
    milestone_id: milestone.id,
    owner_id: milestone.owner_id,
    decided_by: decidedBy,
    triggering_evidence_ids: triggeringEvidenceIds,
    awarded_xp: milestone.xp_reward,
    created_at: now,
  };
  store.completions.push(completion);
  milestone.status = "completed";
  milestone.completed_at = now;
  return completion;
}

function evaluateGoal(store: LocalStore, goalId: string, now: string): MilestoneCompletion[] {
  const created: MilestoneCompletion[] = [];
  const milestones = store.milestonesByGoal[goalId] ?? [];
  for (const milestone of milestones) {
    if (milestone.status === "completed" || hasCompletion(store, milestone.id)) continue;
    const parsedRule = AcceptanceRule.safeParse(milestone.acceptance_rule);
    if (!parsedRule.success) continue;
    const rule = parsedRule.data;
    const evidence = evidenceForMilestone(store, milestone);
    const result = evaluate(rule, evidence);
    if (result.passed) {
      const matched = evidence.filter((ev) => result.matchedEvidenceIds.includes(ev.id));
      const hasManual = matched.some((ev) => ev.kind === "manual_check");
      if (rule.completion_mode === "manual" && !hasManual) continue;
      const completion = insertCompletion(
        store,
        milestone,
        hasManual ? "user_confirm" : "rule_auto",
        result.matchedEvidenceIds,
        now,
      );
      if (completion) created.push(completion);
      continue;
    }

    const manualEvidence = evidence.filter((ev) => ev.kind === "manual_check");
    const manualResult = evaluate(MANUAL_CONFIRM_RULE, manualEvidence);
    if (manualResult.passed && canUserConfirm(rule)) {
      const completion = insertCompletion(
        store,
        milestone,
        "user_confirm",
        manualResult.matchedEvidenceIds,
        now,
      );
      if (completion) created.push(completion);
    }
  }
  return created;
}

function emptyStore(): LocalStore {
  return { ownerId: DEFAULT_OWNER, goals: [], milestonesByGoal: {}, memories: [], evidence: [], completions: [] };
}

function normalizeMemoryContent(content: string): string {
  return content.replace(/\s+/g, " ").trim();
}

function memoryDedupeKey(content: string): string {
  return normalizeMemoryContent(content).toLowerCase();
}

function findDuplicateMemory(store: LocalStore, content: string, goalId: string | null, excludeId?: string): Memory | undefined {
  const key = memoryDedupeKey(content);
  return store.memories.find(
    (m) => m.id !== excludeId && m.status !== "deleted" && m.goal_id === goalId && memoryDedupeKey(m.content) === key,
  );
}

function sortMemoriesNewestFirst(rows: Memory[]): Memory[] {
  return rows.slice().sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
}

function defaultCategoryForMemory(content: string, kind: MemoryKind): ContextCategory {
  return inferContextCategory(content, kind === "procedural" ? "procedure" : "project_fact");
}

function normalizeMemoryRow(row: Memory): Memory {
  const memory = row as Memory & { category?: ContextCategory };
  return {
    ...memory,
    category: memory.category ?? defaultCategoryForMemory(memory.content, memory.kind),
  };
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
        memories: (parsed.memories ?? []).map(normalizeMemoryRow),
        evidence: parsed.evidence ?? [],
        completions: parsed.completions ?? [],
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
        metadata: input.metadata ?? {},
        created_at: now,
      };

      const milestones = materialize(input.plan, goalId, ownerId);

      const memories: Memory[] = (input.memories ?? [])
        .filter((m) => m.content.trim().length > 0)
        .map((m) => ({
          id: randomUUID(),
          owner_id: ownerId,
          goal_id: goalId,
          kind: m.kind ?? "semantic",
          category: m.category ?? defaultCategoryForMemory(m.content, m.kind ?? "semantic"),
          content: m.content,
          confidence: m.confidence ?? 1,
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
      if (input.metadata) goal.metadata = { ...goal.metadata, ...input.metadata };

      store.milestonesByGoal[goal.id] = milestones;
      save(store);
      return { goal, milestones };
    },

    async deleteGoal(id: string): Promise<void> {
      const store = load();
      const milestoneIds = new Set((store.milestonesByGoal[id] ?? []).map((m) => m.id));
      store.goals = store.goals.filter((g) => g.id !== id);
      delete store.milestonesByGoal[id];
      store.memories = store.memories.filter((m) => m.goal_id !== id);
      store.evidence = store.evidence.filter((ev) => ev.goal_id !== id);
      store.completions = store.completions.filter((c) => !milestoneIds.has(c.milestone_id));
      save(store);
    },

    async listEvidence(goalId: string): Promise<Evidence[]> {
      return load()
        .evidence.filter((ev) => ev.goal_id === goalId)
        .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
    },

    async addEvidence(input: AddEvidenceInput): Promise<AddEvidenceResult> {
      const store = load();
      const goal = store.goals.find((g) => g.id === input.goalId);
      if (!goal) throw new Error(`Aim ${input.goalId} not found.`);
      if (input.milestoneId) {
        const milestone = (store.milestonesByGoal[input.goalId] ?? []).find((m) => m.id === input.milestoneId);
        if (!milestone) throw new Error(`Milestone ${input.milestoneId} not found on aim ${input.goalId}.`);
      }

      const emitterId = input.emitterId ?? null;
      const sourceEventId = input.sourceEventId ?? null;
      if (emitterId !== null && sourceEventId !== null) {
        const existing = store.evidence.find(
          (ev) => ev.emitter_id === emitterId && ev.source_event_id === sourceEventId,
        );
        if (existing) {
          return { evidence: existing, deduped: true, completions: [] };
        }
      }

      const now = new Date().toISOString();
      const evidence: Evidence = {
        id: randomUUID(),
        owner_id: input.ownerId ?? goal.owner_id ?? store.ownerId,
        goal_id: input.goalId,
        milestone_id: input.milestoneId ?? null,
        emitter_id: emitterId,
        kind: input.kind,
        source_event_id: sourceEventId,
        occurred_at: input.occurredAt ?? now,
        summary: input.summary ?? "",
        payload: input.payload ?? {},
        trust_score: input.trustScore ?? 1,
        created_at: now,
      };

      store.evidence.push(evidence);
      const completions = evaluateGoal(store, input.goalId, now);
      save(store);
      return { evidence, deduped: false, completions };
    },

    async confirmMilestone(input: ConfirmMilestoneInput): Promise<ConfirmMilestoneResult | null> {
      const store = load();
      const goal = store.goals.find((g) => g.id === input.goalId);
      if (!goal) return null;
      const milestone = (store.milestonesByGoal[input.goalId] ?? []).find((m) => m.id === input.milestoneId);
      if (!milestone) return null;
      const existing = store.completions.find((c) => c.milestone_id === milestone.id) ?? null;
      if (existing) {
        return {
          evidence: store.evidence.find((ev) => existing.triggering_evidence_ids.includes(ev.id)) ?? null,
          completion: existing,
          alreadyCompleted: true,
        };
      }

      const now = new Date().toISOString();
      const evidence: Evidence = {
        id: randomUUID(),
        owner_id: input.ownerId ?? milestone.owner_id,
        goal_id: input.goalId,
        milestone_id: milestone.id,
        emitter_id: null,
        kind: "manual_check",
        source_event_id: null,
        occurred_at: now,
        summary: input.summary ?? `Confirmed: ${milestone.title}`,
        payload: { confirmed: true, milestone_id: milestone.id },
        trust_score: 1,
        created_at: now,
      };
      store.evidence.push(evidence);
      const completions = evaluateGoal(store, input.goalId, now);
      const completion = completions.find((c) => c.milestone_id === milestone.id) ?? null;
      save(store);
      return { evidence, completion, alreadyCompleted: false };
    },

    async listMemories(goalId: string | null = null): Promise<Memory[]> {
      const rows = load().memories.filter((m) => {
        if (m.status !== "active") return false;
        return goalId === null || m.goal_id === goalId;
      });
      return sortMemoriesNewestFirst(rows);
    },

    async listMemoryHistory(goalId: string | null = null): Promise<Memory[]> {
      const rows = load().memories.filter((m) => goalId === null || m.goal_id === goalId);
      return sortMemoriesNewestFirst(rows);
    },

    async addMemory(input: AddMemoryInput): Promise<Memory> {
      const store = load();
      const content = normalizeMemoryContent(input.content);
      if (!content) throw new Error("Memory content is required.");
      if (input.goalId) {
        const goal = store.goals.find((g) => g.id === input.goalId);
        if (!goal) throw new Error(`Aim ${input.goalId} not found.`);
      }
      const goalId = input.goalId ?? null;
      const duplicate = findDuplicateMemory(store, content, goalId);
      if (duplicate) {
        if (duplicate.status === "pending" || duplicate.status === "deprioritized") {
          duplicate.kind = input.kind ?? duplicate.kind;
          duplicate.category = input.category ?? defaultCategoryForMemory(content, duplicate.kind);
          duplicate.confidence = input.confidence ?? 1;
          duplicate.source = input.source ?? "user_stated";
          duplicate.status = "active";
          save(store);
        }
        return duplicate;
      }
      const now = new Date().toISOString();
      const memory: Memory = {
        id: randomUUID(),
        owner_id: input.ownerId ?? store.ownerId,
        goal_id: goalId,
        kind: input.kind ?? "semantic",
        category: input.category ?? defaultCategoryForMemory(content, input.kind ?? "semantic"),
        content,
        confidence: input.confidence ?? 1,
        source: input.source ?? "user_stated",
        status: "active",
        superseded_by: null,
        created_at: now,
      };
      store.memories.push(memory);
      save(store);
      return memory;
    },

    async listMemoryCandidates(goalId: string | null = null): Promise<Memory[]> {
      const rows = load().memories.filter((m) => {
        if (m.status !== "pending") return false;
        return goalId === null || m.goal_id === goalId;
      });
      return sortMemoriesNewestFirst(rows);
    },

    async addMemoryCandidate(input: AddMemoryCandidateInput): Promise<Memory> {
      const store = load();
      const content = normalizeMemoryContent(input.content);
      if (!content) throw new Error("Memory content is required.");
      if (input.goalId) {
        const goal = store.goals.find((g) => g.id === input.goalId);
        if (!goal) throw new Error(`Aim ${input.goalId} not found.`);
      }
      const goalId = input.goalId ?? null;
      const duplicate = findDuplicateMemory(store, content, goalId);
      if (duplicate) return duplicate;
      const now = new Date().toISOString();
      const memory: Memory = {
        id: randomUUID(),
        owner_id: input.ownerId ?? store.ownerId,
        goal_id: goalId,
        kind: input.kind ?? "semantic",
        category: input.category ?? defaultCategoryForMemory(content, input.kind ?? "semantic"),
        content,
        confidence: input.confidence ?? 0.7,
        source: input.source ?? "agent_inferred",
        status: "pending",
        superseded_by: null,
        created_at: now,
      };
      store.memories.push(memory);
      save(store);
      return memory;
    },

    async acceptMemoryCandidate(input: AcceptMemoryCandidateInput): Promise<Memory | null> {
      const store = load();
      const memory = store.memories.find((m) => m.id === input.id && m.status === "pending");
      if (!memory) return null;
      const content = input.content !== undefined ? normalizeMemoryContent(input.content) : memory.content;
      if (!content) throw new Error("Memory content is required.");
      if (isPromptLikeContextCandidate(content)) {
        throw new Error("Context candidate must be edited into an actual answer before it can be accepted.");
      }
      if (input.goalId) {
        const goal = store.goals.find((g) => g.id === input.goalId);
        if (!goal) throw new Error(`Aim ${input.goalId} not found.`);
      }
      const goalId = input.goalId !== undefined ? input.goalId : memory.goal_id;
      const confidence = input.confidence ?? Math.max(memory.confidence, 0.9);
      const duplicate = findDuplicateMemory(store, content, goalId, memory.id);
      if (duplicate) {
        if (duplicate.status === "pending" || duplicate.status === "deprioritized") {
          duplicate.content = content;
          duplicate.kind = input.kind ?? duplicate.kind;
          duplicate.category = input.category ?? defaultCategoryForMemory(content, duplicate.kind);
          duplicate.confidence = confidence;
          if (input.source) duplicate.source = input.source;
          duplicate.status = "active";
        } else if (duplicate.status === "active") {
          if (input.kind) duplicate.kind = input.kind;
          if (input.category) duplicate.category = input.category;
          duplicate.confidence = Math.max(duplicate.confidence, confidence);
          if (input.source) duplicate.source = input.source;
        }
        memory.status = "deleted";
        memory.superseded_by = duplicate.id;
        save(store);
        return duplicate;
      }
      memory.content = content;
      memory.goal_id = goalId;
      if (input.kind) memory.kind = input.kind;
      memory.category = input.category ?? defaultCategoryForMemory(content, memory.kind);
      memory.confidence = confidence;
      if (input.source) memory.source = input.source;
      memory.status = "active";
      save(store);
      return memory;
    },

    async rejectMemoryCandidate(id: string): Promise<Memory | null> {
      const store = load();
      const memory = store.memories.find((m) => m.id === id && m.status === "pending");
      if (!memory) return null;
      memory.status = "deleted";
      save(store);
      return memory;
    },

    async archiveMemory(id: string): Promise<Memory | null> {
      const store = load();
      const memory = store.memories.find((m) => m.id === id && m.status === "active");
      if (!memory) return null;
      memory.status = "deleted";
      save(store);
      return memory;
    },

    async deprioritizeMemory(input: DeprioritizeMemoryInput): Promise<Memory | null> {
      const store = load();
      const memory = store.memories.find((m) => m.id === input.id && m.status === "active");
      if (!memory) return null;
      const confidence = input.confidence ?? 0.5;
      if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
        throw new Error("Memory confidence must be a number from 0 to 1.");
      }
      memory.confidence = Math.min(memory.confidence, confidence);
      memory.status = "deprioritized";
      save(store);
      return memory;
    },

    async exportData(): Promise<LocalStore> {
      return load();
    },

    async importData(snapshot: LocalStore, mode: "merge" | "replace" = "merge"): Promise<ImportStoreResult> {
      const incoming: LocalStore = {
        ownerId: snapshot.ownerId ?? DEFAULT_OWNER,
        goals: snapshot.goals ?? [],
        milestonesByGoal: snapshot.milestonesByGoal ?? {},
        memories: (snapshot.memories ?? []).map(normalizeMemoryRow),
        evidence: snapshot.evidence ?? [],
        completions: snapshot.completions ?? [],
      };
      if (mode === "replace") {
        save(incoming);
        return {
          goals: incoming.goals.length,
          milestones: allMilestones(incoming).length,
          memories: incoming.memories.length,
          evidence: incoming.evidence.length,
          completions: incoming.completions.length,
        };
      }

      const store = load();
      const mergeRows = <T extends { id: string }>(current: T[], next: T[]): number => {
        let added = 0;
        const byId = new Map(current.map((row) => [row.id, row]));
        for (const row of next) {
          if (!byId.has(row.id)) {
            current.push(row);
            added += 1;
          }
        }
        return added;
      };

      const goals = mergeRows(store.goals, incoming.goals);
      const memories = mergeRows(store.memories, incoming.memories);
      const evidence = mergeRows(store.evidence, incoming.evidence);
      const completions = mergeRows(store.completions, incoming.completions);
      let milestones = 0;
      for (const [goalId, nextRows] of Object.entries(incoming.milestonesByGoal)) {
        store.milestonesByGoal[goalId] ??= [];
        milestones += mergeRows(store.milestonesByGoal[goalId], nextRows);
      }
      save(store);
      return { goals, milestones, memories, evidence, completions };
    },
  };
}
