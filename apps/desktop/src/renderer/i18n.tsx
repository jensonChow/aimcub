/**
 * Tiny i18n for the desktop renderer. English is the source-of-truth; `zh` is a
 * translation locale. No dependency — a flat dictionary + a context + a `t()` helper.
 * Default locale follows the OS language and the last choice is remembered (localStorage).
 *
 * Keys, code, and comments stay English (per the project rule); only the `zh` VALUES are
 * Chinese, which is inherent to bilingual UI. `summarizeRule` (acceptance-rule text) is a
 * derived technical expression and is intentionally left English for now.
 */
import { createContext, useCallback, useContext, useState } from "react";
import type { ReactNode } from "react";

export type Lang = "en" | "zh";

/** Source-of-truth string table. Add a key here, reference it via `t(...)`. */
export const STRINGS = {
  "provider.setup": { en: "Set up a provider", zh: "设置模型提供方" },
  "provider.anthropicShort": { en: "Anthropic", zh: "Anthropic" },
  "provider.openaiShort": { en: "OpenAI-compatible", zh: "OpenAI 兼容" },

  "common.delete": { en: "Delete", zh: "删除" },
  "common.cancel": { en: "Cancel", zh: "取消" },
  "common.back": { en: "← Back", zh: "← 返回" },
  "common.close": { en: "Close", zh: "关闭" },
  "common.milestone_one": { en: "{n} milestone", zh: "{n} 个里程碑" },
  "common.milestone_other": { en: "{n} milestones", zh: "{n} 个里程碑" },

  "home.aim_one": { en: "{n} aim", zh: "{n} 个目标" },
  "home.aim_other": { en: "{n} aims", zh: "{n} 个目标" },
  "home.none": { en: "No aims yet.", zh: "还没有目标。" },
  "home.new": { en: "+ New aim", zh: "+ 新目标" },
  "home.emptyHelp": {
    en: "Set an aim and Aimcub breaks it into verifiable milestones. Start with “+ New aim”.",
    zh: "设定一个目标,Aimcub 会把它拆成可验证的里程碑。点「+ 新目标」开始。",
  },

  "context.inbox": { en: "Context inbox", zh: "上下文收件箱" },
  "context.pending_one": { en: "{n} pending", zh: "{n} 条待处理" },
  "context.pending_other": { en: "{n} pending", zh: "{n} 条待处理" },
  "context.scopeAim": { en: "This aim", zh: "当前目标" },
  "context.scopeGlobal": { en: "Global", zh: "全局" },
  "context.recommended": { en: "(recommended)", zh: "(推荐)" },
  "context.accept": { en: "Accept", zh: "接受" },
  "context.reject": { en: "Reject", zh: "拒绝" },
  "context.editRequired": {
    en: "Edit this prompt into an actual answer before accepting it as context.",
    zh: "请先把这条提示改成真实答案,再接受为上下文。",
  },
  "context.profile": { en: "Context profile", zh: "上下文画像" },
  "context.profileScore": { en: "{score}/100 coverage", zh: "覆盖度 {score}/100" },
  "context.profileNext": { en: "Next:", zh: "下一步:" },
  "context.profile.strong": { en: "Strong", zh: "强" },
  "context.profile.ready": { en: "Ready", zh: "可用" },
  "context.profile.thin": { en: "Thin", zh: "薄弱" },
  "context.profile.missing": { en: "Missing", zh: "缺失" },
  "context.category.evalSignal": { en: "Eval signal", zh: "评估信号" },
  "context.category.projectFact": { en: "Project fact", zh: "项目事实" },
  "context.category.preference": { en: "Preference", zh: "偏好" },
  "context.category.constraint": { en: "Constraint", zh: "约束" },
  "context.category.capability": { en: "Capability", zh: "能力" },
  "context.category.procedure": { en: "Procedure", zh: "流程" },
  "context.trace": { en: "Planning context", zh: "拆分上下文" },
  "context.traceCounts": {
    en: "{selected} selected · {ignored} ignored · limit {limit}",
    zh: "选中 {selected} 条 · 忽略 {ignored} 条 · 上限 {limit}",
  },
  "context.learning": { en: "Clarify learning", zh: "澄清学习" },
  "context.learningCounts": {
    en: "{answered} answered · {impacted} impacted",
    zh: "{answered} 次回答 · {impacted} 次影响计划",
  },
  "context.learning.askMore": { en: "Ask more", zh: "多问" },
  "context.learning.askSelectively": { en: "Ask selectively", zh: "选择性询问" },
  "context.learning.askLess": { en: "Ask less", zh: "少问" },
  "context.lineageLearning": { en: "Lineage learning", zh: "链路学习" },
  "context.lineageLearningCounts": {
    en: "{questions} questions · {captured} captured · {impacted} impacted · {pending} pending",
    zh: "{questions} 个问题 · {captured} 已收集 · {impacted} 已影响计划 · {pending} 待确认",
  },
  "context.lineageLearning.reusePattern": { en: "Reuse pattern", zh: "复用模式" },
  "context.lineageLearning.fixCapture": { en: "Fix capture", zh: "修复收集" },
  "context.lineageLearning.resolvePending": { en: "Resolve pending", zh: "处理待确认" },
  "context.lineageLearningPending": { en: "{n} pending", zh: "{n} 待确认" },
  "context.lineageLearningAccepted": { en: "{n} accepted", zh: "{n} 已接受" },
  "context.lineageLearningRejected": { en: "{n} rejected/deprioritized", zh: "{n} 已拒绝/降权" },
  "context.decompositionLearning": { en: "Decomposition learning", zh: "拆分学习" },
  "context.decompositionLearningCounts": {
    en: "{aims} aims · {completed}/{total} milestones completed · {issues} quality issues · {evidence} evidence attributions",
    zh: "{aims} 个目标 · {completed}/{total} 个里程碑已完成 · {issues} 个质量问题 · {evidence} 个证据归因",
  },
  "context.decompositionLearningContext": {
    en: "{accepted} accepted · {rejected} rejected/deprioritized",
    zh: "{accepted} 已接受 · {rejected} 已拒绝/降权",
  },
  "context.decompositionLearningEvidence": {
    en: "{evidence} via {evaluator}",
    zh: "{evidence} 通过 {evaluator}",
  },
  "context.decompositionLearningContract": { en: "Contract", zh: "契约" },
  "context.decompositionLearning.reusePattern": { en: "Reuse pattern", zh: "复用模式" },
  "context.decompositionLearning.tightenContract": { en: "Tighten contract", zh: "收紧契约" },
  "context.decompositionLearning.askContextEarlier": { en: "Ask earlier", zh: "提前询问" },
  "context.decompositionLearning.improveAcceptance": { en: "Improve acceptance", zh: "改进验收" },
  "context.decompositionLearning.reconsiderGranularity": { en: "Reconsider granularity", zh: "重估粒度" },
  "context.decompositionStrategy": { en: "Decomposition strategy", zh: "拆分策略" },
  "context.decompositionStrategyCounts": { en: "{actions} actions", zh: "{actions} 个动作" },
  "context.decompositionStrategySource_one": { en: "{n} source row", zh: "{n} 条来源" },
  "context.decompositionStrategySource_other": { en: "{n} source rows", zh: "{n} 条来源" },
  "context.decompositionStrategy.verifiability": { en: "Verifiability", zh: "可验证性" },
  "context.decompositionStrategy.granularity": { en: "Granularity", zh: "粒度" },
  "context.decompositionStrategy.contextFit": { en: "Context fit", zh: "上下文匹配" },
  "context.decompositionStrategy.evidencePattern": { en: "Evidence pattern", zh: "证据模式" },
  "context.decompositionStrategy.contractSpecificity": { en: "Contract specificity", zh: "契约清晰度" },
  "context.decompositionStrategy.high": { en: "High", zh: "高" },
  "context.decompositionStrategy.medium": { en: "Medium", zh: "中" },
  "context.decompositionStrategy.low": { en: "Low", zh: "低" },
  "context.selected": { en: "Selected", zh: "已选中" },
  "context.ignored": { en: "Ignored", zh: "已忽略" },
  "context.health": { en: "Context health", zh: "上下文健康度" },
  "context.healthClean": {
    en: "Context health is clean. {traced}/{total} rows have planning trace.",
    zh: "上下文健康度正常。{traced}/{total} 条已有拆分轨迹。",
  },
  "context.healthAttention_one": { en: "{n} row needs attention", zh: "{n} 条需要处理" },
  "context.healthAttention_other": { en: "{n} rows need attention", zh: "{n} 条需要处理" },
  "context.healthCounts": { en: "{selected} selected / {ignored} ignored", zh: "选中 {selected} / 忽略 {ignored}" },
  "context.health.action.keep": { en: "Keep", zh: "保留" },
  "context.health.action.review": { en: "Review", zh: "复核" },
  "context.health.action.deprioritize": { en: "Deprioritize", zh: "降权" },
  "context.health.action.archive_candidate": { en: "Archive candidate", zh: "归档候选" },
  "context.health.deprioritize": { en: "Deprioritize", zh: "降权" },
  "context.health.archive": { en: "Archive", zh: "归档" },
  "context.health.reason.memory_confidence_below_planning_threshold": {
    en: "Confidence is below the planning threshold.",
    zh: "置信度低于拆分阈值。",
  },
  "context.health.reason.aim_scoped_context_repeatedly_unrelated": {
    en: "Aim-scoped context has been repeatedly unrelated.",
    zh: "当前目标范围的上下文多次被判定无关。",
  },
  "context.health.reason.global_context_repeatedly_unrelated": {
    en: "Global context has been repeatedly unrelated.",
    zh: "全局上下文多次被判定无关。",
  },
  "context.health.reason.ignored_without_selection": {
    en: "This context has been ignored without being selected.",
    zh: "这条上下文多次被忽略且未被选中。",
  },
  "context.health.reason.empty_memory": { en: "Memory content is empty.", zh: "记忆内容为空。" },

  "intake.title": { en: "Aim intake", zh: "目标预检" },
  "intake.ready": { en: "Ready", zh: "就绪" },
  "intake.needsContext": { en: "Needs context", zh: "需要上下文" },
  "intake.needsRefinement": { en: "Needs refinement", zh: "需要优化" },
  "intake.profile": { en: "profile {score}/100", zh: "画像 {score}/100" },
  "intake.selected": { en: "{n} selected", zh: "已选 {n} 条" },
  "intake.missingCore": { en: "Missing:", zh: "缺失:" },
  "intake.question": { en: "Question", zh: "问题" },
  "intake.action": { en: "Next:", zh: "下一步:" },
  "intake.source.aimText": { en: "aim text", zh: "目标文本" },
  "intake.source.contextProfile": { en: "context profile", zh: "上下文画像" },
  "intake.source.planningContext": { en: "planning context", zh: "拆分上下文" },
  "intake.source.draftReview": { en: "draft review", zh: "草稿审查" },

  "aimLearning.title": { en: "Aim learning", zh: "目标学习" },
  "aimLearning.counts": {
    en: "{learned} learned · {pending} pending · {gaps} gaps",
    zh: "已学习 {learned} 条 · 待确认 {pending} 条 · 缺口 {gaps} 条",
  },
  "aimLearning.intake": {
    en: "Intake: {readiness} · {score}/100 · {questions} questions",
    zh: "预检:{readiness} · {score}/100 · {questions} 个问题",
  },
  "aimLearning.clarify": {
    en: "Clarify: {answered} answered · {impacted} impacted · {changed} nodes changed",
    zh: "澄清:{answered} 次回答 · {impacted} 次影响计划 · {changed} 个节点变化",
  },
  "aimLearning.next": { en: "Next:", zh: "下一步:" },
  "aimLearning.source.clarifyAnswer": { en: "clarify answer", zh: "澄清回答" },
  "aimLearning.source.reviewedContext": { en: "reviewed context", zh: "已审上下文" },
  "aimLearning.source.pendingContext": { en: "pending context", zh: "待确认上下文" },
  "aimLearning.source.intakeGap": { en: "intake gap", zh: "预检缺口" },
  "aimLearning.source.reviewGap": { en: "review gap", zh: "审查缺口" },

  "capture.label": {
    en: "Capture: {scope} · {category} · {purpose} · improves {dimension}",
    zh: "收集:{scope} · {category} · {purpose} · 改善 {dimension}",
  },
  "capture.originNode": { en: "from {node}", zh: "来自 {node}" },
  "capture.originRoi": { en: "roi {score}", zh: "ROI {score}" },
  "capture.purpose.shapePlan": { en: "shape plan", zh: "塑造计划" },
  "capture.purpose.defineEval": { en: "define eval", zh: "定义评估" },
  "capture.purpose.routeWork": { en: "route work", zh: "分配工作" },
  "capture.purpose.reusePreference": { en: "reuse preference", zh: "复用偏好" },
  "capture.purpose.documentProcedure": { en: "document procedure", zh: "记录流程" },

  "impact.title": { en: "Answer impact", zh: "回答影响" },
  "impact.counts": {
    en: "{answered} answered · {impacted} impacted · {changed} milestones changed",
    zh: "{answered} 次回答 · {impacted} 次影响计划 · {changed} 个里程碑变化",
  },
  "impact.changed": { en: "Changed:", zh: "影响:" },
  "impact.eval": { en: "Eval:", zh: "评估:" },
  "impact.signals": { en: "Signals:", zh: "信号:" },
  "impact.signal.qualityImproved": { en: "quality improved", zh: "质量提升" },
  "impact.signal.milestoneAdded": { en: "milestone added", zh: "新增里程碑" },
  "impact.signal.milestoneChanged": { en: "milestone changed", zh: "里程碑变化" },
  "impact.signal.acceptanceChanged": { en: "acceptance changed", zh: "验收规则变化" },
  "impact.signal.answerMatched": { en: "answer matched", zh: "回答命中" },
  "impact.signal.questionMatched": { en: "question matched", zh: "问题命中" },

  "fulfillment.title": { en: "Capture fulfillment", zh: "上下文兑现" },
  "fulfillment.counts": {
    en: "{answered}/{total} answered · {captured} captured · {impacted} impacted",
    zh: "{answered}/{total} 已回答 · {captured} 已收集 · {impacted} 已影响计划",
  },
  "fulfillment.impacted": { en: "Impacted:", zh: "影响:" },
  "fulfillment.status.capturedAndImpacted": { en: "Captured + impacted", zh: "已收集且影响计划" },
  "fulfillment.status.captured": { en: "Captured", zh: "已收集" },
  "fulfillment.status.answeredNoMemory": { en: "Answered, not captured", zh: "已回答但未收集" },
  "fulfillment.status.unanswered": { en: "Unanswered", zh: "未回答" },

  "lineage.title": { en: "Context lineage", zh: "上下文链路" },
  "lineage.counts": {
    en: "{total} questions · {captured} captured · {impacted} impacted · {pending} pending",
    zh: "{total} 个问题 · {captured} 已收集 · {impacted} 已影响计划 · {pending} 待确认",
  },
  "lineage.from": { en: "From:", zh: "来源:" },
  "lineage.affects": { en: "Affects:", zh: "影响:" },
  "lineage.question": { en: "Q:", zh: "问:" },
  "lineage.answer": { en: "A:", zh: "答:" },
  "lineage.memory": { en: "Memory:", zh: "记忆:" },
  "lineage.pending": { en: "Pending:", zh: "待确认:" },
  "lineage.next": { en: "Next:", zh: "下一步:" },

  "aim.titleLabel": { en: "What do you want to accomplish?", zh: "你想达成什么?" },
  "aim.titlePlaceholder": { en: "e.g. Build a CLI todo app with tests + CI", zh: "例如:做一个带测试和 CI 的命令行待办应用" },
  "aim.descLabel": { en: "A little more context (optional)", zh: "补充一点背景(可选)" },
  "aim.descPlaceholder": { en: "Constraints, scope, anything that shapes the plan.", zh: "约束、范围,任何会影响计划的信息。" },
  "aim.draft": { en: "Draft a plan →", zh: "生成计划 →" },
  "aim.needProvider": { en: "Set up an LLM provider above to generate a plan.", zh: "先在上方设置模型提供方才能生成计划。" },

  "status.drafting": { en: "Sketching a first-pass plan…", zh: "正在起草初版计划…" },
  "status.refining": { en: "Refining with your answers…", zh: "正在根据你的回答优化…" },

  "q.intro": { en: "A rough plan is ready. Answer a couple of questions to sharpen it.", zh: "初步计划已就绪。回答几个问题让它更精准。" },
  "q.none": { en: "No clarifying questions — the plan is ready.", zh: "没有需要澄清的问题——计划已就绪。" },
  "q.askedBecause": { en: "Asked because:", zh: "提问原因:" },
  "q.why.reviewGap": { en: "review gap", zh: "审查缺口" },
  "q.why.qualityDimension": { en: "quality dimension", zh: "质量维度" },
  "q.why.historicalLearning": { en: "historical learning", zh: "历史学习" },
  "q.why.aimIntake": { en: "aim intake", zh: "目标预检" },
  "q.why.contextLineage": { en: "context lineage", zh: "上下文链路" },
  "q.why.decompositionStrategy": { en: "decomposition strategy", zh: "拆分策略" },
  "q.other": { en: "Something else…", zh: "其他…" },
  "q.assuming": { en: "Assuming (change anything that's wrong above):", zh: "默认假设(上方有不对的可以改):" },
  "q.refine": { en: "Refine plan →", zh: "优化计划 →" },
  "q.useDraft": { en: "Use the draft as-is", zh: "直接用初稿" },

  "plan.summary_one": { en: "{n} milestone · it lights up when its acceptance rule is met.", zh: "{n} 个里程碑 · 满足验收规则时点亮。" },
  "plan.summary_other": { en: "{n} milestones · each lights up when its acceptance rule is met.", zh: "{n} 个里程碑 · 每个在满足验收规则时点亮。" },
  "plan.saved": { en: "✓ Saved locally", zh: "✓ 已保存到本地" },
  "plan.contextCandidates_one": { en: "{n} context candidate pending review", zh: "{n} 条上下文候选待审查" },
  "plan.contextCandidates_other": { en: "{n} context candidates pending review", zh: "{n} 条上下文候选待审查" },
  "plan.backToAims": { en: "Back to aims", zh: "返回目标列表" },
  "plan.save": { en: "Save plan", zh: "保存计划" },
  "plan.refineReview": { en: "Refine with review", zh: "按审查优化" },
  "plan.startOver": { en: "Start over", zh: "重新开始" },
  "plan.contract": { en: "Contract", zh: "契约" },
  "plan.contractDone": { en: "Done:", zh: "完成:" },
  "plan.contractEvidence": { en: "Evidence:", zh: "证据:" },
  "plan.contractEval": { en: "Eval:", zh: "评估:" },
  "plan.contractGap": { en: "Gap:", zh: "缺口:" },
  "plan.owner.human": { en: "Human", zh: "人" },
  "plan.owner.agent": { en: "Agent", zh: "代理" },
  "plan.owner.either": { en: "Either", zh: "都可以" },
  "plan.owner.mixed": { en: "Mixed", zh: "混合" },

  "review.quality": { en: "Quality", zh: "质量" },
  "review.scorecard": { en: "Scorecard", zh: "评分维度" },
  "review.dimension.verifiability": { en: "Verifiability", zh: "可验证性" },
  "review.dimension.granularity": { en: "Granularity", zh: "拆分粒度" },
  "review.dimension.distinctness": { en: "Distinctness", zh: "证据区分度" },
  "review.dimension.contextFit": { en: "Context fit", zh: "上下文贴合度" },
  "review.context": { en: "Context", zh: "上下文" },
  "review.contextCounts": {
    en: "{applied} applied · {unapplied} unapplied",
    zh: "{applied} 条已应用 · {unapplied} 条未应用",
  },
  "review.noGuidance": { en: "No review notes.", zh: "没有审查提示。" },
  "review.notes_one": { en: "{n} review note", zh: "{n} 条审查提示" },
  "review.notes_other": { en: "{n} review notes", zh: "{n} 条审查提示" },
  "review.actions_one": { en: "{n} suggested action", zh: "{n} 个建议动作" },
  "review.actions_other": { en: "{n} suggested actions", zh: "{n} 个建议动作" },
  "review.action.fix_quality_errors": { en: "Fix quality errors before saving", zh: "保存前先修正质量错误" },
  "review.action.refine_with_unapplied_context": { en: "Refine with unapplied context", zh: "用未应用的上下文优化" },
  "review.action.review_quality_warnings": { en: "Review quality warnings", zh: "检查质量警告" },
  "review.action.capture_initial_context": { en: "Capture context as you work", zh: "在工作中积累上下文" },
  "review.action.accept_plan": { en: "Ready to save", zh: "可以保存" },

  "saved.count_one": { en: "{n} milestone.", zh: "{n} 个里程碑。" },
  "saved.count_other": { en: "{n} milestones.", zh: "{n} 个里程碑。" },
  "saved.noPlan": { en: "This aim has no stored plan.", zh: "该目标没有已保存的计划。" },

  "pf.title": { en: "LLM provider", zh: "模型提供方" },
  "pf.blurb": {
    en: "Your key stays on this Mac — it never leaves the main process. No offline templates; real decomposition only.",
    zh: "你的密钥只留在这台 Mac——永不离开主进程。没有离线模板,只做真实拆解。",
  },
  "pf.providerLabel": { en: "Provider", zh: "提供方" },
  "pf.anthropic": { en: "Anthropic (Claude)", zh: "Anthropic(Claude)" },
  "pf.openai": { en: "OpenAI-compatible", zh: "OpenAI 兼容" },
  "pf.anthropicDesc": { en: "Native Claude API.", zh: "原生 Claude API。" },
  "pf.openaiDesc": { en: "OpenRouter, DeepSeek, Qwen, local Ollama/vLLM…", zh: "OpenRouter、DeepSeek、Qwen、本地 Ollama/vLLM…" },
  "pf.presets": { en: "Endpoint presets", zh: "接口预设" },
  "pf.openaiCompatibleHint": {
    en: "Blank Base URL means OpenAI. If your key is from another provider, pick its preset or paste that provider's OpenAI-compatible /v1 endpoint.",
    zh: "Base URL 留空会请求 OpenAI。如果密钥来自其他提供方,请选择对应预设,或填写该提供方的 OpenAI-compatible /v1 接口。",
  },
  "pf.baseUrl": { en: "Base URL (optional)", zh: "Base URL(可选)" },
  "pf.useOpenRouter": { en: "Use OpenRouter", zh: "用 OpenRouter" },
  "pf.baseUrlPlaceholder": { en: "https://api.openai.com/v1 (default)", zh: "https://api.openai.com/v1(默认)" },
  "pf.model": { en: "Model", zh: "模型" },
  "pf.modelPlaceholder": { en: "e.g. deepseek/deepseek-chat or anthropic/claude-sonnet-4", zh: "例如 deepseek/deepseek-chat 或 anthropic/claude-sonnet-4" },
  "pf.apiKey": { en: "API key", zh: "API 密钥" },
  "pf.keyKeep": { en: "•••• leave blank to keep current key", zh: "•••• 留空则保留当前密钥" },
  "pf.notUsableKey": { en: "That config isn't usable yet — check the key.", zh: "该配置还不可用——检查密钥。" },
  "pf.notUsableKeyModel": { en: "That config isn't usable yet — check the key and model.", zh: "该配置还不可用——检查密钥和模型。" },
  "pf.saving": { en: "Saving…", zh: "保存中…" },
  "pf.saveProvider": { en: "Save provider", zh: "保存提供方" },

  "err.draft": { en: "could not draft a plan", zh: "无法生成计划" },
  "err.clarify": { en: "couldn't generate clarifying questions — the draft is still usable", zh: "无法生成澄清问题——初稿仍可用" },
  "err.refine": { en: "couldn't refine the plan — try again or use the draft as-is", zh: "无法优化计划——重试或直接用初稿" },
} as const satisfies Record<string, Record<Lang, string>>;

export type StringKey = keyof typeof STRINGS;

type Vars = Record<string, string | number>;

function interpolate(s: string, vars?: Vars): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`));
}

export function translate(lang: Lang, key: StringKey, vars?: Vars): string {
  const entry = STRINGS[key];
  return interpolate(entry[lang] ?? entry.en, vars);
}

const STORAGE_KEY = "aimcub.lang";

function detectLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "zh") return saved;
    return (navigator.language || "en").toLowerCase().startsWith("zh") ? "zh" : "en";
  } catch {
    return "en";
  }
}

function persistLang(lang: Lang): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // ignore (private mode / no storage)
  }
}

export interface I18n {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: StringKey, vars?: Vars) => string;
}

const I18nContext = createContext<I18n | null>(null);

export function useI18n(): I18n {
  const v = useContext(I18nContext);
  if (!v) throw new Error("useI18n must be used inside <I18nProvider>");
  return v;
}

export function I18nProvider(props: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectLang);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    persistLang(l);
  }, []);
  const t = useCallback((key: StringKey, vars?: Vars) => translate(lang, key, vars), [lang]);
  return <I18nContext.Provider value={{ lang, setLang, t }}>{props.children}</I18nContext.Provider>;
}
