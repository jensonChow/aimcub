/**
 * @core/types — GoalPet 领域模型的「单一事实源」。
 *
 * 纯 zod schema + 推导出的 TS 类型。零平台依赖(只依赖 zod,一个纯校验库)。
 * 四端(web / ios / mcp / extension)与 Edge Function 全部从这里取类型。
 * DB schema(packages/db)与本文件用 CI 校验对齐(generate_typescript_types)。
 */
import { z } from "zod";

// ──────────────────────────────────────────────────────────────────────────
// 基础枚举
// ──────────────────────────────────────────────────────────────────────────

export const GoalStatus = z.enum(["draft", "active", "paused", "achieved", "abandoned"]);
export type GoalStatus = z.infer<typeof GoalStatus>;

/** 目标领域 —— MVP 只填 software,其余为「先开发者后通用」预留。 */
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

/** v1 三阶段:蛋 → 幼体 → 成体。其余阶段为后续预留(stageForXp 暂不产出)。 */
export const PetStage = z.enum(["egg", "baby", "adult", "juvenile", "elder", "ascended"]);
export type PetStage = z.infer<typeof PetStage>;

/** 进化分支:由该 goal 完成里程碑的领域分布决定(后端多→龙,前端多→鸟)。 */
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
// AcceptanceRule —— 统一判定 DSL(评审强制收敛:三份文档的同一概念)
// 取并集:logic(any/all/weighted) + clauses[evaluator + auto_verifiable] + completion_mode
// ──────────────────────────────────────────────────────────────────────────

/** v1 实现的 evaluator。`manual_*` 等为通用化(v3)预留。 */
export const Evaluator = z.enum([
  "commit_pattern", // v1
  "ci_status", // v1
  "manual_confirm", // v3 预留
  "file_uploaded", // v3 预留
  "url", // v3 预留
  "llm_judge", // v3 预留
]);
export type Evaluator = z.infer<typeof Evaluator>;

export const CommitPatternMatch = z.object({
  /** glob,匹配 commit 改动的文件路径(例:匹配 migrations 目录下的迁移文件)。 */
  path_glob: z.string().optional(),
  /** 至少改动 N 个匹配文件 —— 防「空提交刷分」。 */
  min_files: z.number().int().positive().optional(),
  /** commit message 须匹配的(子串/正则源)。 */
  message_pattern: z.string().optional(),
  /** 限定分支。 */
  branch: z.string().optional(),
});
export type CommitPatternMatch = z.infer<typeof CommitPatternMatch>;

export const CiStatusMatch = z.object({
  workflow: z.string().optional(),
  conclusion: z.enum(["success", "failure", "cancelled", "timed_out", "skipped"]).default("success"),
});
export type CiStatusMatch = z.infer<typeof CiStatusMatch>;

const clauseBase = {
  /** 该子句是否可由验签 webhook / 鉴权 MCP 自动确认(驱动防伪:弱来源不单独触发自动完成)。 */
  auto_verifiable: z.boolean().default(true),
  /** weighted 逻辑下的权重(0~1)。 */
  weight: z.number().min(0).optional(),
};

export const AcceptanceClause = z.discriminatedUnion("evaluator", [
  z.object({ evaluator: z.literal("commit_pattern"), ...clauseBase, match: CommitPatternMatch }),
  z.object({ evaluator: z.literal("ci_status"), ...clauseBase, match: CiStatusMatch }),
  // ↓ v3 预留:schema 先存在以保持前向兼容,evaluate() 暂未实现这些 evaluator。
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
  /** weighted 逻辑达成阈值(累计 weight ≥ threshold 即满足)。 */
  threshold: z.number().min(0).default(1),
  completion_mode: CompletionMode.default("auto_then_confirm"),
});
export type AcceptanceRule = z.infer<typeof AcceptanceRule>;

// ──────────────────────────────────────────────────────────────────────────
// Evidence —— append-only 事实流;归一化后的统一信封
// ──────────────────────────────────────────────────────────────────────────

/** git_commit 证据的 payload 形态(归一化后)。 */
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

/** ci_passed / ci_failed 证据的 payload 形态。 */
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
  /** 上游事件原生 ID;与 emitter_id 组成幂等键。 */
  source_event_id: z.string().nullable(),
  /** 事件真实发生时间(ISO 8601),非入库时间。 */
  occurred_at: z.string(),
  summary: z.string().default(""),
  payload: z.record(z.unknown()).default({}),
  /** 来源可信度:verified commit / CI > MCP 自报 > manual。 */
  trust_score: z.number().min(0).max(1).default(1),
  created_at: z.string().optional(),
});
export type Evidence = z.infer<typeof Evidence>;

// ──────────────────────────────────────────────────────────────────────────
// Goal / Milestone / Plan(拆解)
// ──────────────────────────────────────────────────────────────────────────

export const Goal = z.object({
  id: z.string().uuid(),
  owner_id: z.string().uuid(),
  title: z.string().min(1),
  description: z.string().default(""),
  domain: GoalDomain.default("software"),
  status: GoalStatus.default("draft"),
  target_date: z.string().nullable().default(null),
  /** 当前拆解快照(代替重型 milestone_versions 表)。 */
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
  /** 单父依赖(线性/浅树);v3 通用化再升 DAG 边表。null = 无前置。 */
  depends_on_id: z.string().uuid().nullable().default(null),
  acceptance_rule: AcceptanceRule,
  xp_reward: z.number().int().positive().default(10),
  rarity: Rarity.default("common"),
  completed_at: z.string().nullable().default(null),
  metadata: z.record(z.unknown()).default({}),
});
export type Milestone = z.infer<typeof Milestone>;

/**
 * LLM 拆解输出(Structured Output)。因 Anthropic Structured Outputs 不支持递归
 * schema,节点图用「扁平 nodes 数组 + edges 邻接表」而非嵌套自引用。
 * edge {from, to} 语义:from 必须先完成,to 才能开始(to 依赖 from)。
 */
export const PlanNode = z.object({
  key: z.string().min(1), // plan 内局部 id(LLM 生成,后处理映射成稳定 milestone.id)
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
// Pet(每目标一只)/ Collectible
// ──────────────────────────────────────────────────────────────────────────

export const Pet = z.object({
  id: z.string().uuid(),
  owner_id: z.string().uuid(),
  goal_id: z.string().uuid(), // ★ 每目标一只(UNIQUE)
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
  rarity: Rarity, // 确定性 = 该里程碑难度等级,不随机
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
  /** 幂等键:同一逻辑事件只入一次。 */
  dedup_key: z.string().nullable().default(null),
  run_after: z.string().optional(),
  attempts: z.number().int().nonnegative().default(0),
  last_error: z.string().nullable().default(null),
  created_at: z.string().optional(),
});
export type Job = z.infer<typeof Job>;
