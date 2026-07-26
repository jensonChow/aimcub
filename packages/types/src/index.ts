/**
 * @aimcub/types — the single source of truth for the Aimcub domain model.
 *
 * Pure zod schemas + the TS types inferred from them. Zero platform dependencies
 * (depends only on zod, a pure validation library). Desktop, CLI, MCP, and the
 * Edge Functions pull their types from here.
 * The DB schema (packages/db) is kept aligned with this file via a CI check
 * (generate_typescript_types).
 */
import { z } from "zod";

const DbId = z.string().guid();

// ──────────────────────────────────────────────────────────────────────────
// Base enums
// ──────────────────────────────────────────────────────────────────────────

export const GoalStatus = z.enum(["draft", "active", "paused", "achieved", "abandoned"]);
export type GoalStatus = z.infer<typeof GoalStatus>;

/**
 * Goal domain — optional classification. No creation surface asks for it, so it stays null
 * until a planning brain infers it (submit_plan carries it; plan landing writes it back).
 * A stated-but-wrong domain misleads research, so absence is always preferred over a guess.
 */
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

export const MemoryKind = z.enum(["episodic", "semantic", "procedural"]);
export type MemoryKind = z.infer<typeof MemoryKind>;

export const ContextCategory = z.enum([
  "preference",
  "constraint",
  "capability",
  "eval_signal",
  "project_fact",
  "procedure",
]);
export type ContextCategory = z.infer<typeof ContextCategory>;

export const MemoryStatus = z.enum(["active", "pending", "deprioritized", "deleted"]);
export type MemoryStatus = z.infer<typeof MemoryStatus>;

/** Background work derived from the evidence stream. `judge_evidence` evaluates milestones against their acceptance_rule; `extract_memory` distills durable context (the memory pillar). */
export const JobType = z.enum(["judge_evidence", "extract_memory"]);
export type JobType = z.infer<typeof JobType>;

export const JobStatus = z.enum(["queued", "running", "done", "failed"]);
export type JobStatus = z.infer<typeof JobStatus>;

export const SubscriptionSource = z.enum(["stripe", "appstore", "playstore"]);
export type SubscriptionSource = z.infer<typeof SubscriptionSource>;

export const SubscriptionTier = z.enum(["free", "pro"]);
export type SubscriptionTier = z.infer<typeof SubscriptionTier>;

export const DecidedBy = z.enum(["rule_auto", "user_confirm", "agent_suggest"]);
export type DecidedBy = z.infer<typeof DecidedBy>;

export const ActorKind = z.enum(["human", "agent"]);
export type ActorKind = z.infer<typeof ActorKind>;

export const ActorStatus = z.enum(["active", "inactive", "revoked"]);
export type ActorStatus = z.infer<typeof ActorStatus>;

export const AgentRunMode = z.enum(["local_cli", "mcp", "remote"]);
export type AgentRunMode = z.infer<typeof AgentRunMode>;

export const SubAimRelationStatus = z.enum(["active", "completed", "blocked", "abandoned"]);
export type SubAimRelationStatus = z.infer<typeof SubAimRelationStatus>;

export const AssignmentStatus = z.enum(["proposed", "assigned", "running", "blocked", "completed", "cancelled"]);
export type AssignmentStatus = z.infer<typeof AssignmentStatus>;

export const AssignmentSource = z.enum(["routing", "user_override", "system"]);
export type AssignmentSource = z.infer<typeof AssignmentSource>;

export const RunKind = z.enum(["agent", "human"]);
export type RunKind = z.infer<typeof RunKind>;

export const RunStatus = z.enum(["queued", "running", "blocked", "completed", "failed", "cancelled"]);
export type RunStatus = z.infer<typeof RunStatus>;

export const RunEventType = z.enum([
  "run.queued",
  "run.started",
  "run.log",
  "tool.started",
  "tool.finished",
  "artifact.created",
  "evidence.reported",
  "run.completed",
  "run.failed",
  "run.cancelled",
]);
export type RunEventType = z.infer<typeof RunEventType>;

export const RunArtifactKind = z.enum(["file", "url", "diff", "commit", "ci", "note", "screenshot", "other"]);
export type RunArtifactKind = z.infer<typeof RunArtifactKind>;

export const ContextIntakeSessionStatus = z.enum(["collecting", "needs_user", "blocked", "ready", "closed"]);
export type ContextIntakeSessionStatus = z.infer<typeof ContextIntakeSessionStatus>;

export const ToolTraceStatus = z.enum(["pending", "running", "succeeded", "failed", "blocked", "skipped"]);
export type ToolTraceStatus = z.infer<typeof ToolTraceStatus>;

export const EvaluatorRuntimeStatus = z.enum(["passed", "failed", "unsupported", "needs_human", "error"]);
export type EvaluatorRuntimeStatus = z.infer<typeof EvaluatorRuntimeStatus>;

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
  id: DbId,
  owner_id: DbId,
  goal_id: DbId,
  milestone_id: DbId.nullable().default(null),
  emitter_id: DbId.nullable(),
  kind: EvidenceKind,
  /** Native ID of the upstream event; together with emitter_id forms the idempotency key. */
  source_event_id: z.string().nullable(),
  /** When the event actually occurred (ISO 8601), not when it was persisted. */
  occurred_at: z.string(),
  summary: z.string().default(""),
  payload: z.record(z.string(), z.unknown()).default({}),
  /** Source trustworthiness: verified commit / CI > MCP self-report > manual. */
  trust_score: z.number().min(0).max(1).default(1),
  created_at: z.string().optional(),
});
export type Evidence = z.infer<typeof Evidence>;

export const ManualEvidenceRequiredItem = z.object({
  text: z.string().min(1),
  satisfied: z.boolean().default(false),
});
export type ManualEvidenceRequiredItem = z.infer<typeof ManualEvidenceRequiredItem>;

export const ManualEvidencePayload = z.object({
  confirmed: z.literal(true).default(true),
  milestone_id: DbId,
  proof_note: z.string().min(1).optional(),
  urls: z.array(z.string().url()).default([]),
  file_paths: z.array(z.string().min(1)).default([]),
  required_evidence: z.array(ManualEvidenceRequiredItem).default([]),
});
export type ManualEvidencePayload = z.infer<typeof ManualEvidencePayload>;

// ──────────────────────────────────────────────────────────────────────────
// Goal / Milestone / Plan (decomposition)
// ──────────────────────────────────────────────────────────────────────────

export const Goal = z.object({
  id: DbId,
  owner_id: DbId,
  title: z.string().min(1),
  description: z.string().default(""),
  domain: GoalDomain.nullable().default(null),
  status: GoalStatus.default("draft"),
  target_date: z.string().nullable().default(null),
  /** Snapshot of the current decomposition (replaces a heavyweight milestone_versions table). */
  plan_json: z.unknown().nullable().default(null),
  metadata: z.record(z.string(), z.unknown()).default({}),
  created_at: z.string().optional(),
});
export type Goal = z.infer<typeof Goal>;

export const Milestone = z.object({
  id: DbId,
  goal_id: DbId,
  owner_id: DbId,
  title: z.string().min(1),
  description: z.string().default(""),
  status: MilestoneStatus.default("pending"),
  order_index: z.number().int().nonnegative(),
  /** Single-parent dependency (linear / shallow tree); upgraded to a DAG edge table when goals generalize. null = no prerequisite. */
  depends_on_id: DbId.nullable().default(null),
  acceptance_rule: AcceptanceRule,
  /** Neutral effort/contribution weight (sums into goal progress; an input to eval weighting). Not a gamification score. */
  xp_reward: z.number().int().positive().default(10),
  completed_at: z.string().nullable().default(null),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type Milestone = z.infer<typeof Milestone>;

/**
 * LLM decomposition output (Structured Output). Because Anthropic Structured Outputs
 * does not support recursive schemas, the node graph uses a "flat nodes array + edges
 * adjacency list" instead of nested self-references.
 * Semantics of edge {from, to}: `from` must complete before `to` can start (`to` depends on `from`).
 */
export const DecompositionOwner = z.enum(["human", "agent", "either", "mixed"]);
export type DecompositionOwner = z.infer<typeof DecompositionOwner>;

export const PlanRoutingOwner = z.enum(["human", "agent"]);
export type PlanRoutingOwner = z.infer<typeof PlanRoutingOwner>;

export const PlanRoutingOverride = z.object({
  owner: PlanRoutingOwner,
  agent_id: z.string().min(1).nullable().default(null),
  agent_label: z.string().min(1).nullable().default(null),
  run_mode: AgentRunMode.nullable().default(null),
  model: z.string().min(1).nullable().default(null),
  model_label: z.string().min(1).nullable().default(null),
  reason: z.string().default("User routing override."),
});
export type PlanRoutingOverride = z.infer<typeof PlanRoutingOverride>;

export const DecompositionContextGap = z.object({
  category: ContextCategory,
  question: z.string().min(1),
  reason: z.string().default(""),
});
export type DecompositionContextGap = z.infer<typeof DecompositionContextGap>;

/**
 * The per-milestone contract that makes decomposition inspectable: why this
 * milestone exists, what "done" means, which evidence should prove it, who is
 * likely to move it, and which missing context would materially change it.
 */
export const DecompositionContract = z.object({
  why: z.string().min(1),
  definition_of_done: z.string().min(1),
  required_evidence: z.array(z.string().min(1)).min(1),
  likely_owner: DecompositionOwner.default("either"),
  context_gaps: z.array(DecompositionContextGap).default([]),
  eval_signal: z.string().min(1),
});
export type DecompositionContract = z.infer<typeof DecompositionContract>;

export const PlanNode = z.object({
  key: z.string().min(1), // local id within the plan (generated by the LLM, mapped to a stable milestone.id in post-processing)
  title: z.string().min(1),
  description: z.string().default(""),
  est_effort: EstEffort.default("m"),
  xp_reward: z.number().int().positive().default(10),
  acceptance_rule: AcceptanceRule,
  decomposition_contract: DecompositionContract.nullable().default(null),
  routing_override: PlanRoutingOverride.nullable().default(null),
});
export type PlanNode = z.infer<typeof PlanNode>;

export const PlanEdge = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
});
export type PlanEdge = z.infer<typeof PlanEdge>;

export const DecompositionOutput = z.object({
  goal_summary: z.string().default(""),
  /** The brain's honest classification of the aim; null when it did not commit to one. */
  domain: GoalDomain.nullable().default(null),
  rationale: z.string().default(""),
  nodes: z.array(PlanNode).min(1).max(15),
  edges: z.array(PlanEdge).default([]),
});
export type DecompositionOutput = z.infer<typeof DecompositionOutput>;

export const AimDraftStage = z.enum(["aim", "context", "contracts"]);
export type AimDraftStage = z.infer<typeof AimDraftStage>;

export const AimDraftPhase = z.enum(["intake", "post_draft"]).nullable().default(null);
export type AimDraftPhase = z.infer<typeof AimDraftPhase>;

export const AimDraftStatus = z.enum(["draft", "context_needed", "plan_ready", "save_blocked"]);
export type AimDraftStatus = z.infer<typeof AimDraftStatus>;

export const AimDraftSurface = z.enum(["compose", "summary"]);
export type AimDraftSurface = z.infer<typeof AimDraftSurface>;

export const AimDraftQuestionOption = z.object({
  label: z.string(),
  tradeoff: z.string().default(""),
});
export type AimDraftQuestionOption = z.infer<typeof AimDraftQuestionOption>;

export const AimDraftQuestion = z.object({
  id: z.string(),
  question: z.string(),
  why_high_impact: z.string().default(""),
  kind: z.enum(["scope", "involvement", "assumption", "constraint", "capability"]).default("assumption"),
  source_dimension: z.enum(["verifiability", "granularity", "distinctness", "context_fit"]).nullable().default(null),
  allow_other: z.boolean().default(true),
  selection_mode: z.enum(["single", "multiple"]).nullable().default(null),
  selection_mode_reason: z.enum([
    "mutually_exclusive",
    "primary_choice_requested",
    "compatible_options",
    "unclear_defaults_multiple",
  ]).nullable().default(null),
  options: z.array(AimDraftQuestionOption).default([]),
});
export type AimDraftQuestion = z.infer<typeof AimDraftQuestion>;

export const AimDraftAnswer = z.object({
  question_id: z.string(),
  selected_label: z.string().nullable().default(null),
  selected_labels: z.array(z.string()).nullable().default(null),
  other_text: z.string().nullable().default(null),
});
export type AimDraftAnswer = z.infer<typeof AimDraftAnswer>;

export const AimDraftSaveBlock = z.object({
  title: z.string().default(""),
  message: z.string().default(""),
  recovery: z.string().default(""),
  issues: z.array(z.string()).default([]),
});
export type AimDraftSaveBlock = z.infer<typeof AimDraftSaveBlock>;

/**
 * Persisted state of an embedded planning-agent session — a "planning pass". The
 * transcript entries follow `@aimcub/llm`'s PlanningSessionTranscriptEntry
 * structurally; this schema stays permissive on purpose — the protocol
 * validates at runtime, persistence only needs a faithful round-trip.
 *
 * A pass is checkpointed WHILE it runs (not only at landing) so quitting the app
 * pauses planning instead of erasing it: `Goal.metadata.planning_session` carries
 * the last checkpoint, and a reopened aim describes and resumes that pass rather
 * than greeting its owner as if nothing ever happened. Every field below is
 * defaulted, so passes persisted before checkpointing existed still parse.
 */
export const AimDraftPlanningSession = z.object({
  agent_id: z.string(),
  phase: z.string(),
  updated_at: z.string().default(""),
  /** The brain's model for this pass, when the runtime advertised one. */
  model: z.string().default(""),
  /** When the pass first started — preserved across resumes. */
  started_at: z.string().default(""),
  /** "" while the pass is live; else `app_quit` | `failed` | `canceled` | `landed`. */
  stopped_reason: z.string().default(""),
  /** How many times this pass was resumed after being stopped. */
  resumed_count: z.number().int().nonnegative().default(0),
  /**
   * The RUNTIME's own session/thread id (Claude `session_id`, Codex `thread_id`), so a resume can
   * reopen the brain's own conversation instead of only replaying Aimcub's reconstruction of it.
   * The process is gone either way; this restores its memory of the work.
   */
  runtime_session_id: z.string().default(""),
  /** True when size bounding dropped the oldest transcript entries or findings. */
  truncated: z.boolean().default(false),
  /**
   * The plan the brain drafted, once it reached `draft_ready`. Persisted because quitting one
   * click before adopting a finished plan must not throw it away: the plan is the most
   * expensive thing the pass produced, and re-running a brain to regenerate it is not a
   * recovery. Quality and review are NOT stored — `critiquePlan`/`reviewPlan` recompute them
   * from this plan plus the aim's memories.
   */
  draft_plan: DecompositionOutput.nullable().default(null),
  transcript: z.array(z.record(z.string(), z.unknown())).default([]),
  research_findings: z.array(z.record(z.string(), z.unknown())).default([]),
  research_gaps: z.array(z.string()).default([]),
  research_summary: z.string().default(""),
  assumptions: z.array(z.object({
    statement: z.string(),
    default_value: z.string().default(""),
  })).default([]),
  open_questions: z.array(z.string()).default([]),
  memory_candidates: z.array(z.object({
    content: z.string(),
    category: z.string(),
    scope: z.string(),
  })).default([]),
});
export type AimDraftPlanningSession = z.infer<typeof AimDraftPlanningSession>;

export const AimDraft = z.object({
  id: DbId,
  owner_id: DbId,
  title: z.string().default(""),
  description: z.string().default(""),
  parent_goal_id: DbId.nullable().default(null),
  parent_milestone_id: DbId.nullable().default(null),
  current_stage: AimDraftStage.default("aim"),
  phase: AimDraftPhase,
  status: AimDraftStatus.default("draft"),
  aim_surface: AimDraftSurface.nullable().default(null),
  context_note: z.string().default(""),
  intake_questions: z.array(AimDraftQuestion).default([]),
  intake_answers: z.array(AimDraftAnswer).default([]),
  clarify_questions: z.array(AimDraftQuestion).default([]),
  clarify_answers: z.array(AimDraftAnswer).default([]),
  clarify_assumptions: z.array(z.object({
    statement: z.string(),
    default_value: z.string().default(""),
  })).default([]),
  draft_plan: DecompositionOutput.nullable().default(null),
  final_plan: DecompositionOutput.nullable().default(null),
  planning_session: AimDraftPlanningSession.nullable().default(null),
  save_block: AimDraftSaveBlock.nullable().default(null),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});
export type AimDraft = z.infer<typeof AimDraft>;

// ──────────────────────────────────────────────────────────────────────────
// Emitter / MilestoneCompletion
// ──────────────────────────────────────────────────────────────────────────

export const Emitter = z.object({
  id: DbId,
  owner_id: DbId,
  kind: EmitterKind,
  display_name: z.string().default(""),
  token_hash: z.string().nullable().default(null),
  revoked_at: z.string().nullable().default(null),
  created_at: z.string().optional(),
});
export type Emitter = z.infer<typeof Emitter>;

export const MilestoneCompletion = z.object({
  id: DbId,
  milestone_id: DbId,
  owner_id: DbId,
  decided_by: DecidedBy,
  triggering_evidence_ids: z.array(DbId).default([]),
  /** Effort/contribution weight credited by this completion (mirrors the milestone's xp_reward). */
  awarded_xp: z.number().int().nonnegative().default(0),
  created_at: z.string().optional(),
});
export type MilestoneCompletion = z.infer<typeof MilestoneCompletion>;

// ──────────────────────────────────────────────────────────────────────────
// Aim OS orchestration model
// ──────────────────────────────────────────────────────────────────────────

const ActorBase = {
  id: DbId,
  owner_id: DbId,
  display_name: z.string().default(""),
  capabilities: z.array(z.string()).default([]),
  status: ActorStatus.default("active"),
  created_at: z.string().optional(),
};

export const HumanActor = z.object({
  ...ActorBase,
  kind: z.literal("human"),
  user_id: DbId.nullable().default(null),
});
export type HumanActor = z.infer<typeof HumanActor>;

export const AgentProfile = z.object({
  ...ActorBase,
  kind: z.literal("agent"),
  agent_kind: z.string().default("local_cli"),
  run_mode: AgentRunMode.default("local_cli"),
  model: z.string().nullable().default(null),
  connection_ref: z.string().nullable().default(null),
});
export type AgentProfile = z.infer<typeof AgentProfile>;

export const Actor = z.discriminatedUnion("kind", [HumanActor, AgentProfile]);
export type Actor = z.infer<typeof Actor>;

export const SubAimRelation = z.object({
  id: DbId,
  owner_id: DbId,
  parent_goal_id: DbId,
  parent_milestone_id: DbId,
  child_goal_id: DbId,
  status: SubAimRelationStatus.default("active"),
  reason: z.string().default(""),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});
export type SubAimRelation = z.infer<typeof SubAimRelation>;

export const Assignment = z.object({
  id: DbId,
  owner_id: DbId,
  goal_id: DbId,
  milestone_id: DbId,
  actor_kind: ActorKind,
  actor_id: DbId.nullable().default(null),
  status: AssignmentStatus.default("assigned"),
  source: AssignmentSource.default("routing"),
  reason: z.string().default(""),
  capability_tags: z.array(z.string()).default([]),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});
export type Assignment = z.infer<typeof Assignment>;

export const Run = z.object({
  id: DbId,
  owner_id: DbId,
  goal_id: DbId,
  milestone_id: DbId,
  assignment_id: DbId.nullable().default(null),
  actor_kind: ActorKind,
  actor_id: DbId.nullable().default(null),
  kind: RunKind,
  status: RunStatus.default("queued"),
  attempt: z.number().int().positive().default(1),
  workspace_root: z.string().nullable().default(null),
  sandbox: z.string().nullable().default(null),
  network_enabled: z.boolean().default(false),
  model: z.string().nullable().default(null),
  reasoning: z.string().nullable().default(null),
  summary: z.string().default(""),
  error: z.string().nullable().default(null),
  queued_at: z.string().optional(),
  started_at: z.string().nullable().default(null),
  finished_at: z.string().nullable().default(null),
  created_at: z.string().optional(),
});
export type Run = z.infer<typeof Run>;

export const RunEvent = z.object({
  id: DbId,
  owner_id: DbId,
  run_id: DbId,
  type: RunEventType,
  summary: z.string().default(""),
  payload: z.record(z.string(), z.unknown()).default({}),
  created_at: z.string().optional(),
});
export type RunEvent = z.infer<typeof RunEvent>;

export const RunArtifact = z.object({
  id: DbId,
  owner_id: DbId,
  run_id: DbId,
  kind: RunArtifactKind,
  uri: z.string().default(""),
  path: z.string().nullable().default(null),
  summary: z.string().default(""),
  evidence_id: DbId.nullable().default(null),
  created_at: z.string().optional(),
});
export type RunArtifact = z.infer<typeof RunArtifact>;

export const ToolTrace = z.object({
  id: DbId,
  owner_id: DbId,
  session_id: DbId.nullable().default(null),
  tool_name: z.string(),
  status: ToolTraceStatus,
  summary: z.string().default(""),
  sources: z.array(z.record(z.string(), z.unknown())).default([]),
  error: z.string().nullable().default(null),
  started_at: z.string().nullable().default(null),
  finished_at: z.string().nullable().default(null),
  created_at: z.string().optional(),
});
export type ToolTrace = z.infer<typeof ToolTrace>;

export const ContextIntakeSession = z.object({
  id: DbId,
  owner_id: DbId,
  goal_id: DbId.nullable().default(null),
  aim_title: z.string(),
  aim_description: z.string().default(""),
  status: ContextIntakeSessionStatus.default("collecting"),
  readiness: z.string().default(""),
  can_continue: z.boolean().default(false),
  should_pause: z.boolean().default(false),
  missing_questions: z.array(z.string()).default([]),
  blocked_reasons: z.array(z.string()).default([]),
  tool_trace_ids: z.array(DbId).default([]),
  started_at: z.string().optional(),
  closed_at: z.string().nullable().default(null),
  created_at: z.string().optional(),
});
export type ContextIntakeSession = z.infer<typeof ContextIntakeSession>;

export const EvidenceAttribution = z.object({
  id: DbId,
  owner_id: DbId,
  evidence_id: DbId,
  goal_id: DbId,
  milestone_id: DbId.nullable().default(null),
  run_id: DbId.nullable().default(null),
  assignment_id: DbId.nullable().default(null),
  actor_kind: ActorKind.nullable().default(null),
  actor_id: DbId.nullable().default(null),
  trust_score: z.number().min(0).max(1).default(0),
  reason: z.string().default(""),
  created_at: z.string().optional(),
});
export type EvidenceAttribution = z.infer<typeof EvidenceAttribution>;

export const EvaluatorRuntimeResult = z.object({
  evaluator: Evaluator,
  status: EvaluatorRuntimeStatus,
  matched_evidence_ids: z.array(DbId).default([]),
  trust_score: z.number().min(0).max(1).default(0),
  explanation: z.string().default(""),
  failure_reason: z.string().nullable().default(null),
  requires_human_confirmation: z.boolean().default(false),
});
export type EvaluatorRuntimeResult = z.infer<typeof EvaluatorRuntimeResult>;

export const EvaluationReview = z.object({
  passed: z.boolean().default(false),
  matched_evidence_ids: z.array(DbId).default([]),
  trust_score: z.number().min(0).max(1).default(0),
  reason: z.string().default(""),
  next_action: z.string().default(""),
});
export type EvaluationReview = z.infer<typeof EvaluationReview>;

export const EvidenceReviewStatus = z.enum(["matched", "unmatched", "low_trust"]);
export type EvidenceReviewStatus = z.infer<typeof EvidenceReviewStatus>;

export const EvidenceRuleMatch = z.object({
  clause_index: z.number().int().nonnegative(),
  evaluator: Evaluator,
});
export type EvidenceRuleMatch = z.infer<typeof EvidenceRuleMatch>;

export const EvidenceReviewItem = z.object({
  evidence: Evidence,
  rule_matches: z.array(EvidenceRuleMatch).default([]),
  status: EvidenceReviewStatus.default("unmatched"),
  review_note: z.string().default(""),
});
export type EvidenceReviewItem = z.infer<typeof EvidenceReviewItem>;

export const AimProgressMilestoneRead = z.object({
  milestone: Milestone,
  assignment: Assignment.nullable().default(null),
  latest_run: Run.nullable().default(null),
  child_relations: z.array(SubAimRelation).default([]),
  eval_review: EvaluationReview.default({
    passed: false,
    matched_evidence_ids: [],
    trust_score: 0,
    reason: "",
    next_action: "",
  }),
  evaluator_results: z.array(EvaluatorRuntimeResult).default([]),
  evidence: z.array(EvidenceReviewItem).default([]),
  evidence_count: z.number().int().nonnegative().default(0),
  completed: z.boolean().default(false),
  blocked: z.boolean().default(false),
  next_action: z.string().default(""),
});
export type AimProgressMilestoneRead = z.infer<typeof AimProgressMilestoneRead>;

// ──────────────────────────────────────────────────────────────────────────
// Memory / Subscription / Job
// ──────────────────────────────────────────────────────────────────────────

export const Memory = z.object({
  id: DbId,
  owner_id: DbId,
  goal_id: DbId.nullable().default(null),
  kind: MemoryKind,
  category: ContextCategory.default("project_fact"),
  content: z.string(),
  confidence: z.number().min(0).max(1).default(1),
  source: z.enum(["agent_inferred", "user_stated", "evidence_derived"]).default("agent_inferred"),
  status: MemoryStatus.default("active"),
  superseded_by: DbId.nullable().default(null),
  created_at: z.string().optional(),
});
export type Memory = z.infer<typeof Memory>;

export const AimCompletionRecapEvidenceRead = z.object({
  id: DbId,
  milestone_id: DbId.nullable().default(null),
  kind: EvidenceKind,
  summary: z.string().default(""),
  occurred_at: z.string(),
  trust_score: z.number().min(0).max(1).default(0),
});
export type AimCompletionRecapEvidenceRead = z.infer<typeof AimCompletionRecapEvidenceRead>;

export const AimCompletionRecapEvalRead = z.object({
  milestone_id: DbId,
  evaluator: Evaluator,
  status: EvaluatorRuntimeStatus,
  explanation: z.string().default(""),
  trust_score: z.number().min(0).max(1).default(0),
  matched_evidence_ids: z.array(DbId).default([]),
});
export type AimCompletionRecapEvalRead = z.infer<typeof AimCompletionRecapEvalRead>;

export const AimCompletionRecapSubAimRead = z.object({
  milestone_id: DbId,
  title: z.string(),
  outcome: z.string().default(""),
  completed_at: z.string().nullable().default(null),
  decided_by: DecidedBy.nullable().default(null),
  evidence_ids: z.array(DbId).default([]),
  eval_status: EvaluatorRuntimeStatus.nullable().default(null),
});
export type AimCompletionRecapSubAimRead = z.infer<typeof AimCompletionRecapSubAimRead>;

export const AimCompletionRecapMemoryRead = z.object({
  id: DbId,
  content: z.string(),
  category: ContextCategory,
  source: z.enum(["agent_inferred", "user_stated", "evidence_derived"]),
  status: MemoryStatus,
  scope: z.enum(["aim", "global"]),
  confidence: z.number().min(0).max(1).default(0),
});
export type AimCompletionRecapMemoryRead = z.infer<typeof AimCompletionRecapMemoryRead>;

export const AimCompletionRecapRead = z.object({
  complete: z.boolean().default(false),
  final_outcome: z.string().default(""),
  completed_sub_aims: z.array(AimCompletionRecapSubAimRead).default([]),
  passing_evidence: z.array(AimCompletionRecapEvidenceRead).default([]),
  eval_results: z.array(AimCompletionRecapEvalRead).default([]),
  learned_context: z.array(AimCompletionRecapMemoryRead).default([]),
  evidence_empty_reason: z.string().default(""),
  context_empty_reason: z.string().default(""),
});
export type AimCompletionRecapRead = z.infer<typeof AimCompletionRecapRead>;

export const AimProgressReadModel = z.object({
  goal: Goal,
  milestones: z.array(AimProgressMilestoneRead),
  actors: z.array(Actor).default([]),
  assignments: z.array(Assignment).default([]),
  runs: z.array(Run).default([]),
  sub_aim_relations: z.array(SubAimRelation).default([]),
  context_candidates: z.array(Memory).default([]),
  completion_recap: AimCompletionRecapRead.nullable().default(null),
  completed_milestones: z.number().int().nonnegative().default(0),
  total_milestones: z.number().int().nonnegative().default(0),
  blocked_count: z.number().int().nonnegative().default(0),
  next_action: z.string().default(""),
});
export type AimProgressReadModel = z.infer<typeof AimProgressReadModel>;

export const AimProgressSummaryStatus = z.enum([
  "planning",
  "needs_you",
  "running",
  "blocked",
  "complete",
]);
export type AimProgressSummaryStatus = z.infer<typeof AimProgressSummaryStatus>;

/**
 * A coarse per-aim progress rollup for list surfaces (sidebar rows, Home cards).
 * Cheap to compute in one pass so a batch endpoint can summarize every aim without
 * running the full `evaluate()` pipeline per milestone — the derivation lives in
 * `@aimcub/core` (`summarizeAimProgress`), never in the app shell.
 */
export const AimProgressSummary = z.object({
  goal_id: DbId,
  status: AimProgressSummaryStatus,
  total: z.number().int().nonnegative().default(0),
  completed: z.number().int().nonnegative().default(0),
  blocked: z.number().int().nonnegative().default(0),
  running: z.number().int().nonnegative().default(0),
});
export type AimProgressSummary = z.infer<typeof AimProgressSummary>;

export const Subscription = z.object({
  owner_id: DbId,
  source: SubscriptionSource,
  tier: SubscriptionTier.default("free"),
  expires_at: z.string().nullable().default(null),
});
export type Subscription = z.infer<typeof Subscription>;

export const Job = z.object({
  id: DbId,
  type: JobType,
  payload: z.record(z.string(), z.unknown()).default({}),
  status: JobStatus.default("queued"),
  /** Idempotency key: the same logical event is enqueued only once. */
  dedup_key: z.string().nullable().default(null),
  run_after: z.string().optional(),
  attempts: z.number().int().nonnegative().default(0),
  last_error: z.string().nullable().default(null),
  created_at: z.string().optional(),
});
export type Job = z.infer<typeof Job>;
