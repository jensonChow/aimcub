import type { ContextCategory, Memory, MemoryKind } from "@core/types";
import {
  inferContextCategory,
  reviewContextProfile,
  type ContextProfileCategoryRow,
  type ContextProfileReport,
} from "./context";
import type {
  PlanContextGapSource,
  PlanContextGapRoiSignal,
  PlanContextGapPriority,
  PlanQualityDimension,
  PlanQualityContext,
  PlanQualityIssueCode,
  PlanReviewReport,
} from "./plan-quality";
import type { ContextLineageLearningReport, ContextLineageLearningRow } from "./context-lineage";
import type { ChoiceSelectionReason } from "./choice-selection";

export type AimIntakeReadiness = "ready" | "needs_targeted_context" | "needs_plan_refinement";
export type AimIntakeQuestionSource = "aim_text" | "context_profile" | "planning_context" | "draft_review";
export type ContextCaptureOriginSource = AimIntakeQuestionSource | "clarify" | "review_gap" | "decomposition_strategy";
export type ContextCaptureScope = "aim" | "global";
export type ContextCapturePurpose =
  | "shape_plan"
  | "define_eval"
  | "route_work"
  | "reuse_preference"
  | "document_procedure";
export type ContextAcquisitionChannel =
  | "local_workspace"
  | "personal_database"
  | "web_research"
  | "conversation"
  | "questionnaire";
export type ContextAcquisitionScope = "aim" | "global" | "mixed";
export type ContextIntakeRuntimeBoundary = "first_party" | "external_connector" | "user";
export type ContextIntakeStepStatus = "ready" | "needs_permission" | "needs_connector" | "needs_user";
export type ContextIntakeStepRepeatMode = "once" | "until_context_ready" | "until_answered_or_skipped";
export type ContextIntakeOutputKind = "aim_context" | "durable_memory_candidate" | "clarifying_answer";

export interface ContextCaptureOrigin {
  source: ContextCaptureOriginSource;
  reason: string;
  prompt?: string;
  gapSource?: PlanContextGapSource;
  nodeKey?: string;
  nodeTitle?: string;
  roiScore?: number;
  roiSignals?: PlanContextGapRoiSignal[];
  issueCodes?: PlanQualityIssueCode[];
}

export interface ContextCaptureContract {
  category: ContextCategory;
  scope: ContextCaptureScope;
  purpose: ContextCapturePurpose;
  improvesDimension: PlanQualityDimension;
  reason: string;
  origin?: ContextCaptureOrigin;
}

export interface ContextAcquisitionMemoryTarget {
  scope: ContextCaptureScope;
  kind: MemoryKind;
  categories: ContextCategory[];
}

export interface ContextAcquisitionRecommendation {
  id: string;
  channel: ContextAcquisitionChannel;
  priority: PlanContextGapPriority;
  scope: ContextAcquisitionScope;
  categories: ContextCategory[];
  reason: string;
  action: string;
  suggestedTools: string[];
  memoryTargets: ContextAcquisitionMemoryTarget[];
}

export interface ContextIntakeToolCallPlan {
  name: string;
  boundary: ContextIntakeRuntimeBoundary;
  reason: string;
}

export interface ContextIntakeMemoryPlan extends ContextAcquisitionMemoryTarget {
  source: "tool_observation" | "user_answer" | "completion_evidence";
}

export interface ContextIntakeLoopStep {
  id: string;
  acquisitionId: string;
  channel: ContextAcquisitionChannel;
  priority: PlanContextGapPriority;
  status: ContextIntakeStepStatus;
  action: string;
  reason: string;
  toolCalls: ContextIntakeToolCallPlan[];
  memoryPlan: ContextIntakeMemoryPlan[];
  outputs: ContextIntakeOutputKind[];
  repeatMode: ContextIntakeStepRepeatMode;
  blocksPlanAcceptance: boolean;
}

export interface ContextIntakeLoopReport {
  version: 1;
  shouldContinue: boolean;
  nextStepId: string | null;
  stopCondition: string;
  steps: ContextIntakeLoopStep[];
  aimContextTargets: ContextCategory[];
  durableMemoryTargets: ContextCategory[];
}

export interface AimIntakeQuestion {
  id: string;
  category: ContextCategory;
  priority: PlanContextGapPriority;
  source: AimIntakeQuestionSource;
  reason: string;
  prompt: string;
  whyHighImpact?: string;
  selectionMode?: "single" | "multiple";
  selectionModeReason?: ChoiceSelectionReason;
  options?: AimIntakeQuestionOption[];
  capture?: ContextCaptureContract;
  gapSource?: PlanContextGapSource;
  nodeKey?: string;
  nodeTitle?: string;
  roiScore?: number;
  roiSignals?: PlanContextGapRoiSignal[];
  issueCodes?: PlanQualityIssueCode[];
}

export interface AimIntakeQuestionOption {
  label: string;
  tradeoff: string;
}

export interface AimIntakeSelectedContextRow {
  category: ContextCategory;
  count: number;
  highConfidenceCount: number;
}

export interface AimIntakeContextCoverage {
  profile: ContextProfileReport;
  selectedTotal: number;
  selectedByCategory: AimIntakeSelectedContextRow[];
  missingCoreCategories: ContextCategory[];
}

export interface AimIntakeReport {
  title: string;
  readiness: AimIntakeReadiness;
  score: number;
  coverage: AimIntakeContextCoverage;
  questions: AimIntakeQuestion[];
  acquisition: ContextAcquisitionRecommendation[];
  loop: ContextIntakeLoopReport;
  nextActions: string[];
}

export interface ReviewAimIntakeInput {
  title: string;
  description?: string | null;
  memories?: readonly Pick<Memory, "content" | "category" | "confidence" | "goal_id" | "status">[];
  selectedContext?: readonly PlanQualityContext[];
  draftReview?: PlanReviewReport | null;
  lineageLearning?: ContextLineageLearningReport | null;
  maxQuestions?: number;
}

const CORE_CONTEXT_CATEGORIES: readonly ContextCategory[] = ["eval_signal", "constraint", "procedure"];
const QUESTION_SOURCE_RANK: Record<AimIntakeQuestionSource, number> = {
  draft_review: 0,
  aim_text: 1,
  planning_context: 2,
  context_profile: 3,
};
const PRIORITY_RANK: Record<PlanContextGapPriority, number> = {
  high: 0,
  medium: 1,
  low: 2,
};
const PRIORITY_PENALTY: Record<PlanContextGapPriority, number> = {
  high: 24,
  medium: 12,
  low: 5,
};

function cleanText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function contextCategory(row: { content: string; category?: string | null; kind?: MemoryKind | string }): ContextCategory {
  if (
    row.category === "preference" ||
    row.category === "constraint" ||
    row.category === "capability" ||
    row.category === "eval_signal" ||
    row.category === "project_fact" ||
    row.category === "procedure"
  ) {
    return row.category;
  }
  return inferContextCategory(row.content, row.kind === "procedural" ? "procedure" : "project_fact");
}

function categoryPrompt(category: ContextCategory): string {
  switch (category) {
    case "eval_signal":
      return "What would make this aim count as genuinely complete in the real world, and what proof or final confirmation would show it worked?";
    case "constraint":
      return "Which required accounts, permissions, platform/store rules, privacy limits, budget, deadline, legal/policy constraints, or quality bars are non-negotiable?";
    case "procedure":
      return "Which existing workflow, checklist, command, artifact, source material, review path, or approval process should this aim follow?";
    case "capability":
      return "What human expertise, domain experience, access, authority, or agent capability is available and would change who should do the work?";
    case "preference":
      return "Which stable preferences should shape the audience, scope, interaction style, tone, or default tradeoffs?";
    case "project_fact":
      return "Who is the target user, what scenario are they in, what outcome should exist, where will it be distributed, and what current state facts matter?";
  }
}

function contextCaptureScope(category: ContextCategory): ContextCaptureScope {
  switch (category) {
    case "project_fact":
    case "procedure":
      return "aim";
    case "preference":
    case "constraint":
    case "capability":
    case "eval_signal":
      return "global";
  }
}

function contextCapturePurpose(category: ContextCategory): ContextCapturePurpose {
  switch (category) {
    case "eval_signal":
      return "define_eval";
    case "capability":
      return "route_work";
    case "preference":
      return "reuse_preference";
    case "procedure":
      return "document_procedure";
    case "constraint":
    case "project_fact":
      return "shape_plan";
  }
}

function contextCaptureDimension(category: ContextCategory): PlanQualityDimension {
  switch (category) {
    case "eval_signal":
    case "procedure":
      return "verifiability";
    case "constraint":
      return "granularity";
    case "preference":
    case "capability":
    case "project_fact":
      return "context_fit";
  }
}

export function contextCaptureForCategory(
  category: ContextCategory,
  reason = "question_answer",
  improvesDimension?: PlanQualityDimension,
  origin?: ContextCaptureOrigin,
): ContextCaptureContract {
  return {
    category,
    scope: contextCaptureScope(category),
    purpose: contextCapturePurpose(category),
    improvesDimension: improvesDimension ?? contextCaptureDimension(category),
    reason,
    ...(origin ? { origin } : {}),
  };
}

function profilePriority(row: ContextProfileCategoryRow): PlanContextGapPriority {
  if (row.category === "eval_signal" && row.strength === "missing") return "high";
  if (row.strength === "missing") return "medium";
  if (row.pendingCount > 0) return "medium";
  return "low";
}

function selectedContextRows(selectedContext: readonly PlanQualityContext[]): AimIntakeSelectedContextRow[] {
  const byCategory = new Map<ContextCategory, { count: number; highConfidenceCount: number }>();
  for (const row of selectedContext) {
    if (cleanText(row.content).length === 0) continue;
    if (typeof row.confidence === "number" && row.confidence < 0.6) continue;
    const category = contextCategory(row);
    const current = byCategory.get(category) ?? { count: 0, highConfidenceCount: 0 };
    current.count += 1;
    if (typeof row.confidence !== "number" || row.confidence >= 0.75) current.highConfidenceCount += 1;
    byCategory.set(category, current);
  }
  return [...byCategory.entries()]
    .map(([category, stats]) => ({ category, ...stats }))
    .sort((a, b) => a.category.localeCompare(b.category));
}

function uniqueCategories(categories: readonly ContextCategory[]): ContextCategory[] {
  return [...new Set(categories)].sort((a, b) => a.localeCompare(b));
}

function acquisitionScope(targets: readonly ContextAcquisitionMemoryTarget[]): ContextAcquisitionScope {
  const scopes = new Set(targets.map((target) => target.scope));
  if (scopes.size > 1) return "mixed";
  return targets[0]?.scope ?? "aim";
}

function priorityValue(priority: PlanContextGapPriority): number {
  return priority === "high" ? 0 : priority === "medium" ? 1 : 2;
}

function strongestPriority(priorities: readonly PlanContextGapPriority[], fallback: PlanContextGapPriority): PlanContextGapPriority {
  return priorities.length > 0
    ? [...priorities].sort((a, b) => priorityValue(a) - priorityValue(b))[0]!
    : fallback;
}

function searchableText(input: ReviewAimIntakeInput): string {
  return `${cleanText(input.title)} ${cleanText(input.description)}`.toLowerCase();
}

function hasLocalWorkspaceSignal(text: string): boolean {
  return /\b(repo|codebase|workspace|local|folder|file|project|app|desktop|web|cli|implementation|existing|current state)\b/.test(text) ||
    /仓库|代码|项目|本地|文件|文件夹|目录|现有|当前实现|桌面端|客户端|工作区/.test(text);
}

function hasPersonalDatabaseSignal(text: string): boolean {
  return /\b(notion|gmail|calendar|slack|linear|jira|drive|docs|notes|email|personal database|knowledge base|crm)\b/.test(text) ||
    /notion|gmail|日历|邮件|笔记|个人数据库|知识库|文档库|资料库|私有资料/.test(text);
}

function hasWebResearchSignal(text: string): boolean {
  return /\b(latest|current|recent|today|market|competitor|pricing|docs|api|regulation|law|policy|guideline|app store|play store|apple developer|developer account|store review|distribution|travel|visa|flight|hotel|research|search|compare|benchmark|tarot|astrology|wellness|health|finance|education|coaching)\b/.test(text) ||
    /最新|当前|最近|市场|竞品|价格|文档|资料|法规|法律|政策|指南|应用商店|苹果开发者|开发者账号|上架|审核|分发|旅行|旅游|签证|航班|酒店|调研|搜索|比较|对比|塔罗|占星|疗愈|健康|财务|教育|学习|教练|咨询/.test(text);
}

function hasConsumerAppSignal(text: string): boolean {
  return /\b(app|application|mobile|ios|iphone|ipad|android|consumer|customer|user|users|launch|publish|store|subscription|payment|onboarding)\b/.test(text) ||
    /app|应用|小程序|移动端|手机|苹果|安卓|用户|消费者|上线|发布|上架|订阅|付费|支付|注册|塔罗/.test(text);
}

function hasAccountOrDistributionSignal(text: string): boolean {
  return hasConsumerAppSignal(text) ||
    /\b(account|developer account|apple developer|app store|play store|publish|distribution|payment|stripe|login|oauth|permission|credential|secret)\b/.test(text) ||
    /账号|账户|开发者账号|苹果开发者|应用商店|上架|发布|支付|权限|凭证|密钥|审核/.test(text);
}

function hasDomainExpertiseSignal(text: string): boolean {
  return /\b(tarot|astrology|wellness|health|medical|legal|finance|education|learning|coaching|therapy|fitness|travel|recipe|language|content|creator|community|game|music|spiritual|advice)\b/.test(text) ||
    /塔罗|占星|玄学|疗愈|健康|医疗|法律|财务|金融|教育|学习|教练|咨询|治疗|健身|旅行|旅游|食谱|语言|内容|创作|社区|游戏|音乐|经验|专业/.test(text);
}

function hasTrustOrAdvisorySignal(text: string): boolean {
  return /\b(tarot|astrology|wellness|health|medical|legal|finance|coaching|therapy|advice|recommendation|prediction|diagnosis|privacy|personal data)\b/.test(text) ||
    /塔罗|占星|疗愈|健康|医疗|法律|财务|金融|教练|咨询|建议|推荐|预测|诊断|隐私|个人数据/.test(text);
}

function addAcquisition(
  rows: ContextAcquisitionRecommendation[],
  seen: Set<ContextAcquisitionChannel>,
  row: Omit<ContextAcquisitionRecommendation, "id" | "scope" | "categories"> & {
    categories: readonly ContextCategory[];
  },
): void {
  if (seen.has(row.channel)) return;
  seen.add(row.channel);
  const memoryTargets = row.memoryTargets.map((target) => ({
    ...target,
    categories: uniqueCategories(target.categories),
  }));
  rows.push({
    ...row,
    id: "",
    categories: uniqueCategories(row.categories),
    scope: acquisitionScope(memoryTargets),
    memoryTargets,
  });
}

function questionCategories(questions: readonly AimIntakeQuestion[]): ContextCategory[] {
  return uniqueCategories(questions.map((question) => question.category));
}

function acquisitionRecommendations(input: {
  aim: ReviewAimIntakeInput;
  readiness: AimIntakeReadiness;
  coverage: AimIntakeContextCoverage;
  questions: readonly AimIntakeQuestion[];
  draftReview?: PlanReviewReport | null;
}): ContextAcquisitionRecommendation[] {
  const text = searchableText(input.aim);
  const categoriesFromQuestions = questionCategories(input.questions);
  const missingCore = uniqueCategories(input.coverage.missingCoreCategories);
  const categoriesNeedingWork = uniqueCategories([...categoriesFromQuestions, ...missingCore]);
  const hasQuestions = input.questions.length > 0;
  const hasNoSelectedContext = input.coverage.selectedTotal === 0;
  const hasPendingContext = input.coverage.profile.totalPending > 0;
  const needsRefinement = input.readiness === "needs_plan_refinement" ||
    input.draftReview?.quality.grade === "fail" ||
    input.draftReview?.actions.some((action) => action.priority === "high") === true;
  const rows: ContextAcquisitionRecommendation[] = [];
  const seen = new Set<ContextAcquisitionChannel>();

  if (hasLocalWorkspaceSignal(text) || hasNoSelectedContext || categoriesNeedingWork.includes("procedure") || categoriesNeedingWork.includes("project_fact")) {
    addAcquisition(rows, seen, {
      channel: "local_workspace",
      priority: hasNoSelectedContext || categoriesNeedingWork.includes("procedure") ? "high" : "medium",
      categories: uniqueCategories(["project_fact", "procedure", ...categoriesNeedingWork.filter((category) => category === "capability")]),
      reason: hasNoSelectedContext
        ? "The aim has little selected context, so the planner should inspect local files, folders, or workspace state before assuming scope."
        : "Local artifacts can turn vague project facts and procedures into aim-scoped context.",
      action: "Attach or scan the relevant local folder/workspace so Aimcub can ground the plan in real files and workflows.",
      suggestedTools: ["local.scan_workspace", "local.glob", "local.search", "local.read"],
      memoryTargets: [{
        scope: "aim",
        kind: "semantic",
        categories: ["project_fact", "procedure"],
      }],
    });
  }

  if (hasPersonalDatabaseSignal(text) || hasPendingContext || categoriesNeedingWork.some((category) => category === "preference" || category === "constraint" || category === "capability")) {
    addAcquisition(rows, seen, {
      channel: "personal_database",
      priority: hasPendingContext || categoriesNeedingWork.includes("constraint") ? "medium" : "low",
      categories: uniqueCategories(["preference", "constraint", "capability", ...categoriesNeedingWork.filter((category) => category === "project_fact" || category === "procedure")]),
      reason: hasPendingContext
        ? "There is pending or thin personal context that should be resolved before asking the user to repeat themselves."
        : "Personal sources can supply durable preferences, constraints, capabilities, and prior workflow context.",
      action: "Connect or search a personal knowledge source such as Notion, docs, calendar, email, or another user-owned database.",
      suggestedTools: ["memory.search", "context.ask_user", "external.notion", "external.gmail", "external.calendar"],
      memoryTargets: [
        {
          scope: "global",
          kind: "semantic",
          categories: ["preference", "constraint", "capability"],
        },
        {
          scope: "aim",
          kind: "semantic",
          categories: ["project_fact", "procedure"],
        },
      ],
    });
  }

  if (hasWebResearchSignal(text) || categoriesNeedingWork.includes("project_fact") || categoriesNeedingWork.includes("procedure")) {
    addAcquisition(rows, seen, {
      channel: "web_research",
      priority: hasWebResearchSignal(text) ? "high" : "medium",
      categories: uniqueCategories(["project_fact", "procedure", "eval_signal", ...categoriesNeedingWork.filter((category) => category === "constraint")]),
      reason: hasWebResearchSignal(text)
        ? "The aim depends on current or external facts, docs, market information, or travel/research data."
        : "External documentation or public facts may sharpen assumptions before decomposition.",
      action: "Run first-party web research and fetch authoritative sources before finalizing milestones.",
      suggestedTools: ["web.search", "web.fetch", "memory.write_candidate"],
      memoryTargets: [{
        scope: "aim",
        kind: "semantic",
        categories: ["project_fact", "procedure", "eval_signal"],
      }],
    });
  }

  if (hasQuestions || needsRefinement) {
    addAcquisition(rows, seen, {
      channel: "conversation",
      priority: needsRefinement ? "high" : "medium",
      categories: categoriesNeedingWork.length > 0 ? categoriesNeedingWork : ["project_fact", "eval_signal"],
      reason: needsRefinement
        ? "The draft needs refinement, so iterative conversation should resolve what changes plan boundaries, evidence, or owner routing."
        : "The aim still has context gaps that may be easiest to resolve through a short back-and-forth conversation.",
      action: "Keep a conversational intake open until the missing context either becomes aim-local context or durable memory.",
      suggestedTools: ["context.ask_user", "memory.write_candidate"],
      memoryTargets: [
        {
          scope: "aim",
          kind: "semantic",
          categories: ["project_fact", "procedure"],
        },
        {
          scope: "global",
          kind: "semantic",
          categories: ["preference", "constraint", "capability", "eval_signal"],
        },
      ],
    });
  }

  if (hasQuestions) {
    addAcquisition(rows, seen, {
      channel: "questionnaire",
      priority: strongestPriority(input.questions.map((question) => question.priority), "medium"),
      categories: categoriesFromQuestions,
      reason: "High-ROI intake questions already identify the smallest user input needed to improve the plan.",
      action: "Ask the targeted multiple-choice questions with an always-available free-text answer.",
      suggestedTools: ["context.ask_user", "memory.write_candidate"],
      memoryTargets: input.questions.map((question) => ({
        scope: question.capture?.scope ?? contextCaptureScope(question.category),
        kind: "semantic",
        categories: [question.category],
      })),
    });
  }

  return rows
    .sort((a, b) =>
      priorityValue(a.priority) - priorityValue(b.priority) ||
      a.channel.localeCompare(b.channel),
    )
    .slice(0, 5)
    .map((row, index) => ({ ...row, id: `acq_${index + 1}` }));
}

function toolBoundary(name: string): ContextIntakeRuntimeBoundary {
  if (name.startsWith("external.")) return "external_connector";
  if (name === "context.ask_user") return "user";
  return "first_party";
}

function toolCallReason(channel: ContextAcquisitionChannel, name: string): string {
  switch (name) {
    case "local.scan_workspace":
      return "Build an aim-local inventory of the selected workspace before decomposition.";
    case "local.glob":
      return "Find candidate files and folders without reading arbitrary content.";
    case "local.search":
      return "Search approved local context for terms that shape scope, procedure, or evidence.";
    case "local.read":
      return "Read only the selected files needed to turn local artifacts into planning context.";
    case "memory.search":
      return "Reuse active memory before asking the user to repeat known context.";
    case "memory.write_candidate":
      return "Save newly collected context as a pending candidate instead of silently changing memory.";
    case "web.search":
      return "Find current external sources related to the aim.";
    case "web.fetch":
      return "Fetch bounded source text from selected web results for citation-grade context.";
    case "context.ask_user":
      return channel === "questionnaire"
        ? "Ask the highest-ROI structured questions with a free-text escape hatch."
        : "Keep the conversation open for missing context that tools cannot infer.";
    case "external.notion":
      return "Search the user's connected Notion or equivalent personal database through the external connector boundary.";
    case "external.gmail":
      return "Search user-owned email context through the external connector boundary when relevant.";
    case "external.calendar":
      return "Search user-owned calendar context through the external connector boundary when relevant.";
    default:
      return "Collect context for this aim through the configured runtime boundary.";
  }
}

function stepStatus(channel: ContextAcquisitionChannel, tools: readonly string[]): ContextIntakeStepStatus {
  if (channel === "conversation" || channel === "questionnaire") return "needs_user";
  if (tools.some((tool) => tool.startsWith("external."))) return "needs_connector";
  if (tools.some((tool) => tool.startsWith("local.") || tool.startsWith("web.") || tool === "memory.write_candidate")) return "needs_permission";
  return "ready";
}

function stepRepeatMode(channel: ContextAcquisitionChannel): ContextIntakeStepRepeatMode {
  switch (channel) {
    case "conversation":
    case "questionnaire":
      return "until_answered_or_skipped";
    case "local_workspace":
    case "personal_database":
    case "web_research":
      return "until_context_ready";
  }
}

function outputsForAcquisition(row: ContextAcquisitionRecommendation): ContextIntakeOutputKind[] {
  const outputs = new Set<ContextIntakeOutputKind>();
  for (const target of row.memoryTargets) {
    outputs.add(target.scope === "aim" ? "aim_context" : "durable_memory_candidate");
  }
  if (row.channel === "conversation" || row.channel === "questionnaire") outputs.add("clarifying_answer");
  return [...outputs];
}

function memorySourceForChannel(channel: ContextAcquisitionChannel): ContextIntakeMemoryPlan["source"] {
  switch (channel) {
    case "conversation":
    case "questionnaire":
      return "user_answer";
    case "local_workspace":
    case "personal_database":
    case "web_research":
      return "tool_observation";
  }
}

function blocksAcceptance(
  row: ContextAcquisitionRecommendation,
  readiness: AimIntakeReadiness,
): boolean {
  return readiness === "needs_plan_refinement" || row.priority === "high" || row.categories.includes("eval_signal");
}

export function buildContextIntakeLoop(input: {
  readiness: AimIntakeReadiness;
  acquisition: readonly ContextAcquisitionRecommendation[];
}): ContextIntakeLoopReport {
  const steps = input.acquisition.map((row, index): ContextIntakeLoopStep => ({
    id: `loop_${index + 1}`,
    acquisitionId: row.id,
    channel: row.channel,
    priority: row.priority,
    status: stepStatus(row.channel, row.suggestedTools),
    action: row.action,
    reason: row.reason,
    toolCalls: row.suggestedTools.map((name) => ({
      name,
      boundary: toolBoundary(name),
      reason: toolCallReason(row.channel, name),
    })),
    memoryPlan: row.memoryTargets.map((target) => ({
      ...target,
      source: memorySourceForChannel(row.channel),
    })),
    outputs: outputsForAcquisition(row),
    repeatMode: stepRepeatMode(row.channel),
    blocksPlanAcceptance: blocksAcceptance(row, input.readiness),
  }));
  const nextStep = steps.find((step) => step.blocksPlanAcceptance) ?? steps[0] ?? null;
  const shouldContinue = input.readiness !== "ready" && steps.length > 0;
  return {
    version: 1,
    shouldContinue,
    nextStepId: shouldContinue ? nextStep?.id ?? null : null,
    stopCondition: shouldContinue
      ? "Continue context intake until high-priority gaps are answered, skipped, or converted into aim-local context or pending durable memory candidates."
      : "Context is sufficient for decomposition; continue collecting eval signals from evidence after execution.",
    steps,
    aimContextTargets: uniqueCategories(steps.flatMap((step) =>
      step.memoryPlan
        .filter((target) => target.scope === "aim")
        .flatMap((target) => target.categories),
    )),
    durableMemoryTargets: uniqueCategories(steps.flatMap((step) =>
      step.memoryPlan
        .filter((target) => target.scope === "global")
        .flatMap((target) => target.categories),
    )),
  };
}

function actionPriorityValue(priority: "high" | "medium" | "low"): number {
  return priority === "high" ? 0 : priority === "medium" ? 1 : 2;
}

function sortQuestions(a: AimIntakeQuestion, b: AimIntakeQuestion): number {
  return (b.roiScore ?? 0) - (a.roiScore ?? 0) ||
    PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
    QUESTION_SOURCE_RANK[a.source] - QUESTION_SOURCE_RANK[b.source] ||
    a.category.localeCompare(b.category) ||
    a.prompt.localeCompare(b.prompt);
}

function uniqueRoiSignals(signals: readonly PlanContextGapRoiSignal[]): PlanContextGapRoiSignal[] {
  return [...new Set(signals)];
}

function lineageRecommendationBonus(row: ContextLineageLearningRow): number {
  switch (row.recommendation) {
    case "reuse_pattern":
      return 20 + Math.min(12, row.impactedCount * 3);
    case "resolve_pending":
      return 14 + Math.min(8, row.pendingContextCount * 2);
    case "ask_selectively":
      return 5;
    case "fix_capture":
      return -8;
  }
}

function bestLineageLearningRow(
  question: Omit<AimIntakeQuestion, "id">,
  learning: ContextLineageLearningReport | null | undefined,
): ContextLineageLearningRow | null {
  if (!learning || learning.totalQuestions === 0) return null;
  const rows = learning.rows.filter((row) => {
    if (row.askedCount === 0 || row.category !== question.category) return false;
    if (question.gapSource && row.gapSource && question.gapSource !== row.gapSource) return false;
    return true;
  });
  if (rows.length === 0) return null;
  return [...rows].sort((a, b) =>
    lineageRecommendationBonus(b) - lineageRecommendationBonus(a) ||
    b.impactedCount - a.impactedCount ||
    b.memoryCapturedCount - a.memoryCapturedCount ||
    b.pendingContextCount - a.pendingContextCount,
  )[0]!;
}

function applyLineageLearning(
  question: Omit<AimIntakeQuestion, "id">,
  learning: ContextLineageLearningReport | null | undefined,
): Omit<AimIntakeQuestion, "id"> {
  const row = bestLineageLearningRow(question, learning);
  if (!row) return question;
  const bonus = lineageRecommendationBonus(row);
  const baseScore = question.roiScore ?? PRIORITY_PENALTY[question.priority];
  const nextPriority = question.priority === "medium" && (row.recommendation === "reuse_pattern" || row.recommendation === "resolve_pending")
    ? "high"
    : question.priority;
  return {
    ...question,
    priority: nextPriority,
    roiScore: Math.max(0, Math.round(baseScore + bonus)),
    roiSignals: uniqueRoiSignals([
      ...(question.roiSignals ?? []),
      "lineage_learning",
      ...(row.category === "eval_signal" ? ["eval_signal" as const] : []),
      ...(row.category === "procedure" ? ["procedure" as const] : []),
      ...(row.category === "constraint" ? ["constraint" as const] : []),
    ]),
  };
}

function scoreQuestions(questions: readonly AimIntakeQuestion[], draftReview: PlanReviewReport | null | undefined): number {
  const questionPenalty = questions.reduce((sum, question) => sum + PRIORITY_PENALTY[question.priority], 0);
  const reviewPenalty = draftReview?.quality.grade === "fail" ? 20 : draftReview?.quality.grade === "warn" ? 8 : 0;
  return Math.max(0, 100 - questionPenalty - reviewPenalty);
}

function readiness(input: {
  questions: readonly AimIntakeQuestion[];
  draftReview?: PlanReviewReport | null;
}): AimIntakeReadiness {
  if (
    input.draftReview?.quality.grade === "fail" ||
    input.draftReview?.actions.some((action) => action.priority === "high") ||
    input.questions.some((question) => question.source === "draft_review" && question.priority === "high")
  ) {
    return "needs_plan_refinement";
  }
  if (input.questions.some((question) => question.priority === "high" || question.priority === "medium")) {
    return "needs_targeted_context";
  }
  return "ready";
}

function addQuestion(
  questions: AimIntakeQuestion[],
  seen: Set<string>,
  question: Omit<AimIntakeQuestion, "id">,
): void {
  const key = `${question.category}\u0000${question.source}\u0000${question.prompt}`;
  if (seen.has(key)) return;
  seen.add(key);
  questions.push({
    ...question,
    id: "",
    capture: question.capture ?? contextCaptureForCategory(question.category, question.reason, undefined, {
      source: question.source,
      reason: question.reason,
      prompt: question.prompt,
      ...(question.gapSource ? { gapSource: question.gapSource } : {}),
      ...(question.nodeKey ? { nodeKey: question.nodeKey } : {}),
      ...(question.nodeTitle ? { nodeTitle: question.nodeTitle } : {}),
      ...(typeof question.roiScore === "number" ? { roiScore: question.roiScore } : {}),
      ...(question.roiSignals ? { roiSignals: question.roiSignals } : {}),
      ...(question.issueCodes ? { issueCodes: question.issueCodes } : {}),
    }),
  });
}

function aimTextQuestions(input: ReviewAimIntakeInput): Omit<AimIntakeQuestion, "id">[] {
  const title = cleanText(input.title);
  const description = cleanText(input.description);
  const titleTokens = title.split(/\s+/).filter(Boolean);
  if (description.length >= 40 || titleTokens.length >= 8) return [];
  return [{
    category: "project_fact",
    priority: description.length === 0 && titleTokens.length <= 4 ? "high" : "medium",
    source: "aim_text",
    reason: "thin_aim_statement",
    prompt: categoryPrompt("project_fact"),
  }];
}

function realWorldContextQuestions(input: ReviewAimIntakeInput): Omit<AimIntakeQuestion, "id">[] {
  const text = searchableText(input);
  const questions: Omit<AimIntakeQuestion, "id">[] = [];

  if (hasConsumerAppSignal(text)) {
    questions.push({
      category: "project_fact",
      priority: "medium",
      source: "aim_text",
      reason: "consumer_product_context_missing",
      prompt: "Who is the first real user, what situation are they in, and where will this product/app actually be distributed or used?",
      roiScore: 42,
      roiSignals: ["medium_priority", "missing_context"],
    });
  }

  if (hasAccountOrDistributionSignal(text)) {
    questions.push({
      category: "constraint",
      priority: "high",
      source: "aim_text",
      reason: "account_access_distribution_prerequisite",
      prompt: "Which required accounts, permissions, store/distribution paths, payments, credentials, or approvals already exist? For an iOS app, include whether the user has an Apple Developer account.",
      roiScore: 58,
      roiSignals: ["high_priority", "constraint", "missing_context"],
    });
  }

  if (hasDomainExpertiseSignal(text)) {
    questions.push({
      category: "capability",
      priority: "high",
      source: "aim_text",
      reason: "domain_expertise_and_source_material_missing",
      prompt: "What tarot knowledge, deck or interpretation source material, personal taste, or external expert input should shape this app, and which parts require human judgment instead of agent invention?",
      roiScore: 54,
      roiSignals: ["high_priority", "capability", "missing_context"],
    });
  }

  if (hasTrustOrAdvisorySignal(text)) {
    questions.push({
      category: "eval_signal",
      priority: "medium",
      source: "aim_text",
      reason: "trust_safety_quality_standard_missing",
      prompt: "What quality, trust, safety, privacy, or ethical standard must the result satisfy before it can be considered acceptable in the real world?",
      roiScore: 38,
      roiSignals: ["medium_priority", "eval_signal", "missing_context"],
    });
  }

  return questions;
}

function profileQuestions(input: {
  profile: ContextProfileReport;
  selectedCategories: Set<ContextCategory>;
}): Omit<AimIntakeQuestion, "id">[] {
  const questions: Omit<AimIntakeQuestion, "id">[] = [];
  for (const row of input.profile.rows) {
    if (!CORE_CONTEXT_CATEGORIES.includes(row.category)) continue;
    if (input.selectedCategories.has(row.category)) continue;
    if (row.strength === "ready" || row.strength === "strong") continue;
    questions.push({
      category: row.category,
      priority: profilePriority(row),
      source: row.pendingCount > 0 ? "planning_context" : "context_profile",
      reason: row.pendingCount > 0 ? "pending_context_not_selected" : `profile_${row.strength}`,
      prompt: row.pendingCount > 0
        ? `Review pending ${row.category} context before decomposing, or answer directly: ${categoryPrompt(row.category)}`
        : categoryPrompt(row.category),
    });
  }
  return questions;
}

function draftReviewQuestions(review: PlanReviewReport | null | undefined): Omit<AimIntakeQuestion, "id">[] {
  if (!review) return [];
  return review.context.gaps.map((gap) => ({
    category: gap.category,
    priority: gap.priority,
    source: "draft_review",
    reason: gap.reason,
    prompt: gap.prompt,
    gapSource: gap.source,
    nodeKey: gap.nodeKey,
    nodeTitle: gap.nodeTitle,
    roiScore: gap.roiScore,
    roiSignals: gap.roiSignals,
    issueCodes: gap.issueCodes,
  }));
}

function nextActions(input: {
  report: Omit<AimIntakeReport, "nextActions">;
  draftReview?: PlanReviewReport | null;
}): string[] {
  const actions: string[] = [];
  const highQuestions = input.report.questions.filter((question) => question.priority === "high").length;
  const mediumQuestions = input.report.questions.filter((question) => question.priority === "medium").length;
  const pendingRows = input.report.coverage.profile.totalPending;

  if (input.report.readiness === "needs_plan_refinement") {
    actions.push("Refine the draft before accepting the decomposition.");
  }
  for (const action of [...(input.draftReview?.actions ?? [])].sort((a, b) => actionPriorityValue(a.priority) - actionPriorityValue(b.priority)).slice(0, 3)) {
    actions.push(action.reason);
  }
  if (highQuestions > 0) {
    actions.push(`Answer ${highQuestions} high-priority intake question${highQuestions === 1 ? "" : "s"} before accepting a plan.`);
  } else if (mediumQuestions > 0) {
    actions.push(`Answer ${mediumQuestions} targeted intake question${mediumQuestions === 1 ? "" : "s"} if the answer would change scope or evidence.`);
  }
  if (pendingRows > 0) {
    actions.push("Review pending context candidates so future aims need fewer questions.");
  }
  const topAcquisition = input.report.acquisition[0];
  if (topAcquisition && input.report.readiness !== "ready") {
    actions.push(topAcquisition.action);
  }
  const nextStep = input.report.loop.steps.find((step) => step.id === input.report.loop.nextStepId);
  if (nextStep && nextStep.action !== topAcquisition?.action) {
    actions.push(nextStep.action);
  }
  if (input.report.coverage.selectedTotal === 0) {
    actions.push("Let answers and completion evidence from this aim seed the user's context profile.");
  }
  if (actions.length === 0) {
    actions.push("Proceed with decomposition and keep collecting eval signals from evidence.");
  }
  return [...new Set(actions)];
}

export function reviewAimIntake(input: ReviewAimIntakeInput): AimIntakeReport {
  const profile = reviewContextProfile({ memories: input.memories ?? [] });
  const selectedByCategory = selectedContextRows(input.selectedContext ?? []);
  const selectedCategories = new Set(selectedByCategory.map((row) => row.category));
  const missingCoreCategories = CORE_CONTEXT_CATEGORIES.filter((category) => !selectedCategories.has(category));
  const seen = new Set<string>();
  const questions: AimIntakeQuestion[] = [];

  for (const question of [
    ...aimTextQuestions(input),
    ...realWorldContextQuestions(input),
    ...profileQuestions({ profile, selectedCategories }),
    ...draftReviewQuestions(input.draftReview),
  ]) {
    addQuestion(questions, seen, applyLineageLearning(question, input.lineageLearning));
  }

  const sortedQuestions = questions
    .sort(sortQuestions)
    .slice(0, Math.max(1, Math.min(8, Math.floor(input.maxQuestions ?? 5))))
    .map((question, index) => ({ ...question, id: `intake_${index + 1}` }));
  const coverage: AimIntakeContextCoverage = {
    profile,
    selectedTotal: selectedByCategory.reduce((sum, row) => sum + row.count, 0),
    selectedByCategory,
    missingCoreCategories,
  };
  const partialWithoutAcquisition = {
    title: cleanText(input.title),
    readiness: readiness({ questions: sortedQuestions, draftReview: input.draftReview }),
    score: scoreQuestions(sortedQuestions, input.draftReview),
    coverage,
    questions: sortedQuestions,
  };
  const acquisition = acquisitionRecommendations({
    aim: input,
    readiness: partialWithoutAcquisition.readiness,
    coverage,
    questions: sortedQuestions,
    draftReview: input.draftReview,
  });
  const partial = {
    ...partialWithoutAcquisition,
    acquisition,
    loop: buildContextIntakeLoop({
      readiness: partialWithoutAcquisition.readiness,
      acquisition,
    }),
  };
  return {
    ...partial,
    nextActions: nextActions({ report: partial, draftReview: input.draftReview }),
  };
}
