/**
 * @core/types — the single source of truth for the GoalPet domain model.
 *
 * Pure zod schemas + the TS types inferred from them. Zero platform dependencies
 * (depends only on zod, a pure validation library). All four clients
 * (web / ios / mcp / extension) and the Edge Functions pull their types from here.
 * The DB schema (packages/db) is kept aligned with this file via a CI check
 * (generate_typescript_types).
 */
import { z } from "zod";

// ──────────────────────────────────────────────────────────────────────────
// Base enums
// ──────────────────────────────────────────────────────────────────────────

export const GoalStatus = z.enum(["draft", "active", "paused", "achieved", "abandoned"]);
export type GoalStatus = z.infer<typeof GoalStatus>;

/** Goal domain — the MVP only uses `software`; the rest are reserved for the "developers first, then general" rollout. */
export const GoalDomain = z.enum(["software", "career", "learning", "health", "creative", "custom"]);
export type GoalDomain = z.infer<typeof GoalDomain>;

export const MilestoneStatus = z.enum(["pending", "in_progress", "completed", "skipped", "blocked"]);
export type MilestoneStatus = z.infer<typeof MilestoneStatus>;

export const EvidenceKind = z.enum([
  "git_commit",
  "pr_opened",
  "pr_merged",
  "ci_passed",
  "ci_failed",
  "mcp_report",
  "manual_check",
  "file_artifact",
  "external_event",
  "note",
]);
export type EvidenceKind = z.infer<typeof EvidenceKind>;

export const EmitterKind = z.enum(["mcp_agent", "github", "ci", "manual", "calendar", "custom_webhook"]);
export type EmitterKind = z.infer<typeof EmitterKind>;

export const EstEffort = z.enum(["xs", "s", "m", "l", "xl"]);
export type EstEffort = z.infer<typeof EstEffort>;

export const Rarity = z.enum(["common", "uncommon", "rare", "epic", "legendary"]);
export type Rarity = z.infer<typeof Rarity>;

/** v1 has three stages: egg → baby → adult. The remaining stages are reserved for later (stageForXp does not produce them yet). */
export const PetStage = z.enum(["egg", "baby", "adult", "juvenile", "elder", "ascended"]);
export type PetStage = z.infer<typeof PetStage>;

/** Evolution branch: determined by the domain distribution of the goal's completed milestones (mostly backend → dragon, mostly frontend → bird). */
export const PetBranch = z.enum(["unset", "dragon", "bird", "turtle", "fox"]);
export type PetBranch = z.infer<typeof PetBranch>;

export const MemoryKind = z.enum(["episodic", "semantic", "procedural"]);
export type MemoryKind = z.infer<typeof MemoryKind>;

export const MemoryStatus = z.enum(["active", "pending", "deleted"]);
export type MemoryStatus = z.infer<typeof MemoryStatus>;

export const NotificationChannel = z.enum(["in_app", "email", "agent_inbox", "push", "web_push"]);
export type NotificationChannel = z.infer<typeof NotificationChannel>;

export const NotificationStatus = z.enum(["queued", "sent", "delivered", "failed", "suppressed"]);
export type NotificationStatus = z.infer<typeof NotificationStatus>;

export const NotificationTrigger = z.enum(["milestone_done", "goal_done", "stale", "deadline_near", "scheduled"]);
export type NotificationTrigger = z.infer<typeof NotificationTrigger>;

export const JobType = z.enum(["judge_evidence", "grow_pet", "mint_collectible", "deliver_notification", "extract_memory"]);
export type JobType = z.infer<typeof JobType>;

export const JobStatus = z.enum(["queued", "running", "done", "failed"]);
export type JobStatus = z.infer<typeof JobStatus>;

export const SubscriptionSource = z.enum(["stripe", "appstore", "playstore"]);
export type SubscriptionSource = z.infer<typeof SubscriptionSource>;

export const SubscriptionTier = z.enum(["free", "pro"]);
export type SubscriptionTier = z.infer<typeof SubscriptionTier>;

export const DecidedBy = z.enum(["rule_auto", "user_confirm", "agent_suggest"]);
export type DecidedBy = z.infer<typeof DecidedBy>;

// ──────────────────────────────────────────────────────────────────────────
// AcceptanceRule — the unified evaluation DSL (forced to converge during review: the same concept across all three design docs)
// Taken as the union: logic(any/all/weighted) + clauses[evaluator + auto_verifiable] + completion_mode
// ──────────────────────────────────────────────────────────────────────────

/** Evaluators implemented in v1. `manual_*` and friends are reserved for the generalization phase (v3). */
export const Evaluator = z.enum([
  "commit_pattern", // v1
  "ci_status", // v1
  "manual_confirm", // reserved for v3
  "file_uploaded", // reserved for v3
  "url", // reserved for v3
  "llm_judge", // reserved for v3
]);
export type Evaluator = z.infer<typeof Evaluator>;

export const CommitPatternMatch = z.object({
  /** glob matched against the file paths changed by the commit (e.g. match migration files under the migrations directory). */
  path_glob: z.string().optional(),
  /** Require at least N matching files to be changed — guards against "empty-commit XP farming". */
  min_files: z.number().int().positive().optional(),
  /** Pattern the commit message must match (substring / regex source). */
  message_pattern: z.string().optional(),
  /** Restrict to a specific branch. */
  branch: z.string().optional(),
});
export type CommitPatternMatch = z.infer<typeof CommitPatternMatch>;

export const CiStatusMatch = z.object({
  workflow: z.string().optional(),
  conclusion: z.enum(["success", "failure", "cancelled", "timed_out", "skipped"]).default("success"),
});
export type CiStatusMatch = z.infer<typeof CiStatusMatch>;

const clauseBase = {
  /** Whether this clause can be auto-confirmed by a signature-verified webhook / authenticated MCP (anti-spoofing: weak sources cannot trigger auto-completion on their own). */
  auto_verifiable: z.boolean().default(true),
  /** Weight under the `weighted` logic (0~1). */
  weight: z.number().min(0).optional(),
};

export const AcceptanceClause = z.discriminatedUnion("evaluator", [
  z.object({ evaluator: z.literal("commit_pattern"), ...clauseBase, match: CommitPatternMatch }),
  z.object({ evaluator: z.literal("ci_status"), ...clauseBase, match: CiStatusMatch }),
  // ↓ Reserved for v3: the schema exists up front for forward compatibility; evaluate() does not implement these evaluators yet.
  z.object({ evaluator: z.literal("manual_confirm"), ...clauseBase, auto_verifiable: z.literal(false).default(false), match: z.object({}).default({}) }),
  z.object({ evaluator: z.literal("file_uploaded"), ...clauseBase, match: z.object({ min_count: z.number().int().positive().default(1) }) }),
  z.object({ evaluator: z.literal("url"), ...clauseBase, match: z.object({ pattern: z.string().optional() }) }),
  z.object({ evaluator: z.literal("llm_judge"), ...clauseBase, match: z.object({ prompt: z.string() }) }),
]);
export type AcceptanceClause = z.infer<typeof AcceptanceClause>;

export const CompletionMode = z.enum(["auto", "manual", "auto_then_confirm"]);
export type CompletionMode = z.infer<typeof CompletionMode>;

export const AcceptanceRule = z.object({
  logic: z.enum(["any", "all", "weighted"]).default("all"),
  clauses: z.array(AcceptanceClause).min(1),
  /** Threshold for the `weighted` logic (satisfied once the accumulated weight ≥ threshold). */
  threshold: z.number().min(0).default(1),
  completion_mode: CompletionMode.default("auto_then_confirm"),
});
export type AcceptanceRule = z.infer<typeof AcceptanceRule>;

// ──────────────────────────────────────────────────────────────────────────
// Evidence — append-only stream of facts; the unified envelope after normalization
// ──────────────────────────────────────────────────────────────────────────

/** Payload shape of `git_commit` evidence (after normalization). */
export const GitCommitPayload = z.object({
  sha: z.string(),
  message: z.string().default(""),
  branch: z.string().optional(),
  files: z.array(z.string()).default([]),
  additions: z.number().int().nonnegative().optional(),
  deletions: z.number().int().nonnegative().optional(),
  verified: z.boolean().optional(),
});
export type GitCommitPayload = z.infer<typeof GitCommitPayload>;

/** Payload shape of `ci_passed` / `ci_failed` evidence. */
export const CiPayload = z.object({
  workflow: z.string().optional(),
  conclusion: z.string(),
  run_id: z.string().optional(),
  branch: z.string().optional(),
});
export type CiPayload = z.infer<typeof CiPayload>;

export const Evidence = z.object({
  id: z.string().uuid(),
  owner_id: z.string().uuid(),
  goal_id: z.string().uuid(),
  milestone_id: z.string().uuid().nullable().default(null),
  emitter_id: z.string().uuid().nullable(),
  kind: EvidenceKind,
  /** Native ID of the upstream event; together with emitter_id forms the idempotency key. */
  source_event_id: z.string().nullable(),
  /** When the event actually occurred (ISO 8601), not when it was persisted. */
  occurred_at: z.string(),
  summary: z.string().default(""),
  payload: z.record(z.unknown()).default({}),
  /** Source trustworthiness: verified commit / CI > MCP self-report > manual. */
  trust_score: z.number().min(0).max(1).default(1),
  created_at: z.string().optional(),
});
export type Evidence = z.infer<typeof Evidence>;

// ──────────────────────────────────────────────────────────────────────────
// Goal / Milestone / Plan (decomposition)
// ──────────────────────────────────────────────────────────────────────────

export const Goal = z.object({
  id: z.string().uuid(),
  owner_id: z.string().uuid(),
  title: z.string().min(1),
  description: z.string().default(""),
  domain: GoalDomain.default("software"),
  status: GoalStatus.default("draft"),
  target_date: z.string().nullable().default(null),
  /** Snapshot of the current decomposition (replaces a heavyweight milestone_versions table). */
  plan_json: z.unknown().nullable().default(null),
  metadata: z.record(z.unknown()).default({}),
  created_at: z.string().optional(),
});
export type Goal = z.infer<typeof Goal>;

export const Milestone = z.object({
  id: z.string().uuid(),
  goal_id: z.string().uuid(),
  owner_id: z.string().uuid(),
  title: z.string().min(1),
  description: z.string().default(""),
  status: MilestoneStatus.default("pending"),
  order_index: z.number().int().nonnegative(),
  /** Single-parent dependency (linear / shallow tree); upgraded to a DAG edge table during the v3 generalization. null = no prerequisite. */
  depends_on_id: z.string().uuid().nullable().default(null),
  acceptance_rule: AcceptanceRule,
  xp_reward: z.number().int().positive().default(10),
  rarity: Rarity.default("common"),
  completed_at: z.string().nullable().default(null),
  metadata: z.record(z.unknown()).default({}),
});
export type Milestone = z.infer<typeof Milestone>;

/**
 * LLM decomposition output (Structured Output). Because Anthropic Structured Outputs
 * does not support recursive schemas, the node graph uses a "flat nodes array + edges
 * adjacency list" instead of nested self-references.
 * Semantics of edge {from, to}: `from` must complete before `to` can start (`to` depends on `from`).
 */
export const PlanNode = z.object({
  key: z.string().min(1), // local id within the plan (generated by the LLM, mapped to a stable milestone.id in post-processing)
  title: z.string().min(1),
  description: z.string().default(""),
  est_effort: EstEffort.default("m"),
  xp_reward: z.number().int().positive().default(10),
  rarity: Rarity.default("common"),
  acceptance_rule: AcceptanceRule,
});
export type PlanNode = z.infer<typeof PlanNode>;

export const PlanEdge = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
});
export type PlanEdge = z.infer<typeof PlanEdge>;

export const DecompositionOutput = z.object({
  goal_summary: z.string().default(""),
  domain: GoalDomain.default("software"),
  rationale: z.string().default(""),
  nodes: z.array(PlanNode).min(1).max(15),
  edges: z.array(PlanEdge).default([]),
});
export type DecompositionOutput = z.infer<typeof DecompositionOutput>;

// ──────────────────────────────────────────────────────────────────────────
// Emitter / MilestoneCompletion
// ──────────────────────────────────────────────────────────────────────────

export const Emitter = z.object({
  id: z.string().uuid(),
  owner_id: z.string().uuid(),
  kind: EmitterKind,
  display_name: z.string().default(""),
  token_hash: z.string().nullable().default(null),
  revoked_at: z.string().nullable().default(null),
  created_at: z.string().optional(),
});
export type Emitter = z.infer<typeof Emitter>;

export const MilestoneCompletion = z.object({
  id: z.string().uuid(),
  milestone_id: z.string().uuid(),
  owner_id: z.string().uuid(),
  decided_by: DecidedBy,
  triggering_evidence_ids: z.array(z.string().uuid()).default([]),
  awarded_xp: z.number().int().nonnegative().default(0),
  minted_collectible_id: z.string().uuid().nullable().default(null),
  created_at: z.string().optional(),
});
export type MilestoneCompletion = z.infer<typeof MilestoneCompletion>;

// ──────────────────────────────────────────────────────────────────────────
// Pet (one per goal) / Collectible
// ──────────────────────────────────────────────────────────────────────────

export const Pet = z.object({
  id: z.string().uuid(),
  owner_id: z.string().uuid(),
  goal_id: z.string().uuid(), // ★ one pet per goal (UNIQUE)
  species: z.string().default("default"),
  branch: PetBranch.default("unset"),
  stage: PetStage.default("egg"),
  xp: z.number().int().nonnegative().default(0),
  mood: z.number().min(0).max(1).default(0.7),
  sprite_set: z.string().default("default"),
  updated_at: z.string().optional(),
});
export type Pet = z.infer<typeof Pet>;

export const Collectible = z.object({
  id: z.string().uuid(),
  owner_id: z.string().uuid(),
  goal_id: z.string().uuid().nullable().default(null),
  milestone_id: z.string().uuid().nullable().default(null),
  kind: z.enum(["milestone_badge", "goal_trophy", "achievement", "seasonal"]).default("milestone_badge"),
  rarity: Rarity, // deterministic = the milestone's difficulty tier, not random
  metadata: z.record(z.unknown()).default({}),
  image_url: z.string().nullable().default(null),
  minted_at: z.string().optional(),
});
export type Collectible = z.infer<typeof Collectible>;

// ──────────────────────────────────────────────────────────────────────────
// Memory / Notification / Subscription / Job
// ──────────────────────────────────────────────────────────────────────────

export const Memory = z.object({
  id: z.string().uuid(),
  owner_id: z.string().uuid(),
  goal_id: z.string().uuid().nullable().default(null),
  kind: MemoryKind,
  content: z.string(),
  confidence: z.number().min(0).max(1).default(1),
  source: z.enum(["agent_inferred", "user_stated", "evidence_derived"]).default("agent_inferred"),
  status: MemoryStatus.default("active"),
  superseded_by: z.string().uuid().nullable().default(null),
  created_at: z.string().optional(),
});
export type Memory = z.infer<typeof Memory>;

export const Notification = z.object({
  id: z.string().uuid(),
  owner_id: z.string().uuid(),
  trigger: NotificationTrigger,
  channels: z.array(NotificationChannel).default([]),
  dedup_key: z.string().nullable().default(null),
  ref_goal_id: z.string().uuid().nullable().default(null),
  ref_milestone_id: z.string().uuid().nullable().default(null),
  persona_msg: z.string().default(""),
  status: NotificationStatus.default("queued"),
  scheduled_for: z.string().optional(),
  created_at: z.string().optional(),
});
export type Notification = z.infer<typeof Notification>;

export const Subscription = z.object({
  owner_id: z.string().uuid(),
  source: SubscriptionSource,
  tier: SubscriptionTier.default("free"),
  expires_at: z.string().nullable().default(null),
});
export type Subscription = z.infer<typeof Subscription>;

export const Job = z.object({
  id: z.string().uuid(),
  type: JobType,
  payload: z.record(z.unknown()).default({}),
  status: JobStatus.default("queued"),
  /** Idempotency key: the same logical event is enqueued only once. */
  dedup_key: z.string().nullable().default(null),
  run_after: z.string().optional(),
  attempts: z.number().int().nonnegative().default(0),
  last_error: z.string().nullable().default(null),
  created_at: z.string().optional(),
});
export type Job = z.infer<typeof Job>;
