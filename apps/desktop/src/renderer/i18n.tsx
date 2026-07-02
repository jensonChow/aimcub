/**
 * Tiny i18n for the desktop renderer. English is the source-of-truth; `zh` is a
 * translation locale. No dependency — a flat dictionary + a context + a `t()` helper.
 * Default locale follows the OS language and the last choice is remembered (localStorage).
 *
 * Keys, code, and comments stay English (per the project rule); only the `zh` VALUES are
 * Chinese, which is inherent to bilingual UI.
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

  "shell.subtitle": { en: "Aim OS for desktop planning", zh: "桌面端 Aim OS" },
  "shell.aims": { en: "Aims", zh: "目标" },
  "shell.searchAims": { en: "Search aims", zh: "搜索目标" },
  "shell.noSearchResults": { en: "No matching aims.", zh: "没有匹配的目标。" },
  "shell.pendingContext_one": { en: "{n} pending context item", zh: "{n} 条待处理上下文" },
  "shell.pendingContext_other": { en: "{n} pending context items", zh: "{n} 条待处理上下文" },
  "shell.inspector": { en: "Workbench", zh: "工作台" },
  "shell.auditLayer": { en: "planning layers", zh: "规划层" },
  "shell.tab.process": { en: "Process", zh: "过程" },
  "shell.tab.context": { en: "Context", zh: "上下文" },
  "shell.tab.quality": { en: "Quality", zh: "质量" },
  "shell.tab.activity": { en: "Activity", zh: "活动" },
  "shell.context.pending": { en: "Pending", zh: "待处理" },
  "shell.context.sources": { en: "Sources", zh: "来源" },
  "shell.context.usedMissing": { en: "Used / Missing", zh: "已使用 / 缺失" },
  "shell.context.learned": { en: "Learned / Health", zh: "学习 / 健康度" },
  "shell.noProcess": { en: "No process yet", zh: "暂无过程" },
  "shell.noProcessBody": { en: "Planning trace appears here after you start drafting or refining an aim.", zh: "开始生成或优化目标后,过程轨迹会出现在这里。" },
  "shell.noContext": { en: "No context yet", zh: "暂无上下文" },
  "shell.noContextBody": { en: "Context selected, missing, learned, and pending items will appear here.", zh: "已使用、缺失、学习到和待处理的上下文会出现在这里。" },
  "shell.noQuality": { en: "No quality review yet", zh: "暂无质量审查" },
  "shell.noQualityBody": { en: "Plan review and decomposition strategy will appear after Aimcub drafts a plan.", zh: "Aimcub 生成计划后,计划审查和拆分策略会出现在这里。" },
  "shell.noActivity": { en: "No activity yet", zh: "暂无活动" },
  "shell.noActivityBody": { en: "Learning, capture fulfillment, and lineage activity appear after an aim is saved or reviewed.", zh: "保存或审查目标后,学习、上下文收集和链路活动会出现在这里。" },
  "shell.currentAim": { en: "Current aim", zh: "当前目标" },
  "shell.savedAim": { en: "Saved aim", zh: "已保存目标" },
  "shell.untitledAim": { en: "Untitled aim", zh: "未命名目标" },
  "shell.progress": { en: "Progress", zh: "进度" },
  "shell.progressValue": { en: "{done}/{total} completed", zh: "已完成 {done}/{total}" },
  "shell.nextAction": { en: "Next:", zh: "下一步:" },
  "shell.noNextAction": { en: "No next action yet", zh: "暂无下一步" },
  "shell.pending": { en: "Pending", zh: "待处理" },
  "shell.processLivesInInspector": { en: "The detailed planning trace is visible in the Process dock below.", zh: "详细拆分过程在下方「过程」工作台中展示。" },

  "home.aim_one": { en: "{n} aim", zh: "{n} 个目标" },
  "home.aim_other": { en: "{n} aims", zh: "{n} 个目标" },
  "home.none": { en: "No aims yet.", zh: "还没有目标。" },
  "home.recent": { en: "Active and recent aims", zh: "当前与近期目标" },
  "home.new": { en: "+ New aim", zh: "+ 新目标" },
  "home.emptyTitle": { en: "Create your first aim", zh: "创建第一个目标" },
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
  "context.source.memory": { en: "Memory", zh: "记忆" },
  "context.source.memoryBody": { en: "{n} active local context rows available.", zh: "{n} 条本地上下文可用。" },
  "context.source.folder": { en: "Folder", zh: "文件夹" },
  "context.source.folderBody": { en: "Folder import and workspace scan entry point.", zh: "文件夹导入和工作区扫描入口。" },
  "context.source.folderBodyActive": { en: "{n} local file/workspace observations used.", zh: "已使用 {n} 条本地文件/工作区观察。" },
  "context.source.connector": { en: "MCP / Notion", zh: "MCP / Notion" },
  "context.source.connectorBody": { en: "Personal databases such as Notion will attach through external connectors.", zh: "Notion 等个人数据库会通过外部连接器接入。" },
  "context.source.web": { en: "Web research", zh: "Web 研究" },
  "context.source.webBody": { en: "Optional first-party search/fetch, enabled by runtime configuration.", zh: "可选的一方 search/fetch，由运行时配置开启。" },
  "context.source.webBodyActive": { en: "{n} web observations used for this plan.", zh: "本次计划已使用 {n} 条 Web 观察。" },
  "context.source.webBodyBlocked": { en: "{n} web attempt blocked or unavailable.", zh: "{n} 次 Web 尝试被阻止或不可用。" },
  "context.source.active": { en: "active", zh: "已启用" },
  "context.source.ready": { en: "ready", zh: "已就绪" },
  "context.source.comingSoon": { en: "coming soon", zh: "即将接入" },
  "context.source.optional": { en: "optional", zh: "可选" },
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

  "trace.title": { en: "Planning process", zh: "计划过程" },
  "trace.count": { en: "{n}/{total} done", zh: "{n}/{total} 已完成" },
  "trace.context": { en: "Read local context", zh: "读取本地上下文" },
  "trace.contextPending": {
    en: "Selecting memories, intake gaps, and prior decomposition lessons.",
    zh: "正在选择记忆、目标缺口和历史拆分经验。",
  },
  "trace.contextDone": {
    en: "{selected} context rows selected · {ignored} ignored · intake {score}/100",
    zh: "选中 {selected} 条上下文 · 忽略 {ignored} 条 · 预检 {score}/100",
  },
  "trace.draft": { en: "Draft first-pass plan", zh: "起草初版计划" },
  "trace.draftPending": { en: "Calling {provider} with schema-bound decomposition.", zh: "正在调用 {provider} 进行结构化拆分。" },
  "trace.draftDone_one": { en: "{n} milestone drafted · {summary}", zh: "已生成 {n} 个里程碑 · {summary}" },
  "trace.draftDone_other": { en: "{n} milestones drafted · {summary}", zh: "已生成 {n} 个里程碑 · {summary}" },
  "trace.quality": { en: "Review plan quality", zh: "审查计划质量" },
  "trace.qualityPending": { en: "Checking verifiability, granularity, distinctness, and context fit.", zh: "正在检查可验证性、粒度、区分度和上下文匹配。" },
  "trace.qualityNone": { en: "No quality report was returned.", zh: "没有返回质量报告。" },
  "trace.qualityDone": { en: "{grade} · {score}/100 · {retry}", zh: "{grade} · {score}/100 · {retry}" },
  "trace.retryYes": { en: "retried {attempts} passes", zh: "已重试 {attempts} 轮" },
  "trace.retryNo": { en: "{attempts} pass", zh: "{attempts} 轮" },
  "trace.clarify": { en: "Prepare clarifying questions", zh: "准备澄清问题" },
  "trace.clarifyPending": { en: "Waiting for the draft before asking targeted questions.", zh: "等待初稿完成后生成针对性问题。" },
  "trace.clarifyRunning": { en: "Looking for high-impact gaps and useful assumptions.", zh: "正在寻找高影响缺口和可用假设。" },
  "trace.clarifyDone_one": { en: "{n} clarifying question ready.", zh: "已准备 {n} 个澄清问题。" },
  "trace.clarifyDone_other": { en: "{n} clarifying questions ready.", zh: "已准备 {n} 个澄清问题。" },
  "trace.refine": { en: "Refine plan", zh: "优化计划" },
  "trace.refinePending": {
    en: "Applying {answers} answers and {review} review prompts.",
    zh: "正在应用 {answers} 个回答和 {review} 条审查提示。",
  },
  "trace.acceptDraft": { en: "Accept draft", zh: "接受初稿" },
  "trace.acceptDraftDone": { en: "Using the current draft without another model pass.", zh: "不再调用模型，直接使用当前初稿。" },
  "trace.tool.memory": { en: "Read memory", zh: "读取记忆" },
  "trace.tool.local": { en: "Read local workspace", zh: "读取本地工作区" },
  "trace.tool.context": { en: "Distill context", zh: "归纳上下文" },
  "trace.tool.web": { en: "Research web", zh: "Web 研究" },
  "trace.tool.observation": { en: "Tool observation", zh: "工具观察" },
  "trace.tool.failure": { en: "Tool unavailable", zh: "工具不可用" },
  "trace.tool.sources": { en: "{n} sources", zh: "{n} 个来源" },
  "trace.tool.warnings": { en: "{n} warnings", zh: "{n} 条警告" },
  "trace.tool.missing": { en: "{n} missing questions", zh: "{n} 个缺失问题" },
  "trace.tool.candidates": { en: "{n} memory candidates", zh: "{n} 条记忆候选" },

  "spinner.live": { en: "Live planning action", zh: "实时规划动作" },
  "spinner.drafting.reading": { en: "Reading", zh: "读取" },
  "spinner.drafting.readingDetail": { en: "local memory and aim context", zh: "本地记忆和目标上下文" },
  "spinner.drafting.selecting": { en: "Selecting", zh: "筛选" },
  "spinner.drafting.selectingDetail": { en: "useful constraints and prior lessons", zh: "有用约束和历史经验" },
  "spinner.drafting.shaping": { en: "Shaping", zh: "塑造" },
  "spinner.drafting.shapingDetail": { en: "milestone boundaries and owner routing", zh: "里程碑边界和执行路由" },
  "spinner.drafting.checking": { en: "Checking", zh: "检查" },
  "spinner.drafting.checkingDetail": { en: "completion signals and evidence fit", zh: "完成信号和证据贴合度" },
  "spinner.clarifying.reviewing": { en: "Reviewing", zh: "复核" },
  "spinner.clarifying.reviewingDetail": { en: "the draft's weakest assumptions", zh: "初稿里最薄弱的假设" },
  "spinner.clarifying.finding": { en: "Finding", zh: "寻找" },
  "spinner.clarifying.findingDetail": { en: "questions that can change the plan", zh: "会改变计划的问题" },
  "spinner.clarifying.compressing": { en: "Compressing", zh: "压缩" },
  "spinner.clarifying.compressingDetail": { en: "review signals into readable choices", zh: "审查信号为可读选项" },
  "spinner.clarifying.preparing": { en: "Preparing", zh: "准备" },
  "spinner.clarifying.preparingDetail": { en: "short options with clear tradeoffs", zh: "带清晰取舍的短选项" },
  "spinner.refining.applying": { en: "Applying", zh: "应用" },
  "spinner.refining.applyingDetail": { en: "your answers to the draft", zh: "你的回答到初稿里" },
  "spinner.refining.rebalancing": { en: "Rebalancing", zh: "调整" },
  "spinner.refining.rebalancingDetail": { en: "milestones, owners, and dependencies", zh: "里程碑、负责人和依赖" },
  "spinner.refining.tightening": { en: "Tightening", zh: "收紧" },
  "spinner.refining.tighteningDetail": { en: "completion standards and context gaps", zh: "完成标准和上下文缺口" },
  "spinner.refining.reviewing": { en: "Reviewing", zh: "审查" },
  "spinner.refining.reviewingDetail": { en: "the updated plan before showing it", zh: "展示前的更新计划" },

  "status.drafting": { en: "Sketching a first-pass plan…", zh: "正在起草初版计划…" },
  "status.clarifying": { en: "Draft ready. Preparing clarifying questions…", zh: "初稿已生成，正在准备澄清问题…" },
  "status.refining": { en: "Refining with your answers…", zh: "正在根据你的回答优化…" },

  "q.intro": { en: "A rough plan is ready. Answer a couple of questions to sharpen it.", zh: "初步计划已就绪。回答几个问题让它更精准。" },
  "q.none": { en: "No clarifying questions — the plan is ready.", zh: "没有需要澄清的问题——计划已就绪。" },
  "q.askedBecause": { en: "Asked because:", zh: "提问原因:" },
  "q.details": { en: "Why this matters", zh: "为什么问" },
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
  "plan.details": { en: "Details", zh: "详情" },
  "plan.hideDetails": { en: "Hide", zh: "收起" },
  "plan.contract": { en: "Contract", zh: "契约" },
  "plan.completionStandard": { en: "Done when:", zh: "完成标准:" },
  "plan.contractDone": { en: "Done:", zh: "完成:" },
  "plan.contractEvidence": { en: "Evidence:", zh: "证据:" },
  "plan.contractEval": { en: "Eval:", zh: "评估:" },
  "plan.contractGap": { en: "Gap:", zh: "缺口:" },
  "plan.owner.human": { en: "Human", zh: "人" },
  "plan.owner.agent": { en: "Agent", zh: "代理" },
  "plan.owner.either": { en: "Either", zh: "都可以" },
  "plan.owner.mixed": { en: "Mixed", zh: "混合" },
  "plan.ownerUnknown": { en: "Owner TBD", zh: "负责人待定" },

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
    en: "Choose a provider and model. Your key stays on this Mac — it never leaves the main process.",
    zh: "选择提供方和模型。你的密钥只留在这台 Mac——永不离开主进程。",
  },
  "pf.providerLabel": { en: "Provider", zh: "提供方" },
  "pf.model": { en: "Model", zh: "模型" },
  "pf.modelId": { en: "Model ID: {id}", zh: "模型 ID:{id}" },
  "pf.customModel": { en: "Custom model ID", zh: "自定义模型 ID" },
  "pf.modelPlaceholder": { en: "e.g. deepseek-v4-pro, MiniMax-M3, glm-5.2, or qwen-plus", zh: "例如 deepseek-v4-pro、MiniMax-M3、glm-5.2 或 qwen-plus" },
  "pf.endpoint": { en: "Endpoint", zh: "接口地址" },
  "pf.endpointPlaceholder": { en: "OpenAI-compatible /v1 root", zh: "OpenAI-compatible /v1 根地址" },
  "pf.endpointHint": { en: "Advanced: override only when your provider account requires a regional or workspace-specific endpoint.", zh: "高级选项: 仅在账号需要区域或 workspace 专属接口时覆盖。" },
  "pf.apiKey": { en: "API key", zh: "API 密钥" },
  "pf.keyKeep": { en: "•••• leave blank to keep current key", zh: "•••• 留空则保留当前密钥" },
  "pf.notUsableKey": { en: "That config isn't usable yet — check the key.", zh: "该配置还不可用——检查密钥。" },
  "pf.notUsableKeyModel": { en: "That config isn't usable yet — check the key and model.", zh: "该配置还不可用——检查密钥和模型。" },
  "pf.testProvider": { en: "Test model", zh: "测试模型" },
  "pf.testing": { en: "Testing…", zh: "测试中…" },
  "pf.testOk": { en: "Connection test passed in {ms} ms.", zh: "连接测试通过,耗时 {ms} ms。" },
  "pf.testFailed": { en: "Connection test failed.", zh: "连接测试失败。" },
  "pf.saving": { en: "Saving…", zh: "保存中…" },
  "pf.saveProvider": { en: "Save provider", zh: "保存提供方" },

  "err.draft": { en: "could not draft a plan", zh: "无法生成计划" },
  "err.draftTimeout": { en: "draft request timed out after {seconds}s — check the provider/model or try a faster model", zh: "生成计划超过 {seconds} 秒没有响应——请检查模型/接口，或先换成更快的模型" },
  "err.clarify": { en: "couldn't generate clarifying questions — the draft is still usable", zh: "无法生成澄清问题——初稿仍可用" },
  "err.clarifyTimeout": { en: "clarifying questions timed out after {seconds}s — continuing with the draft", zh: "澄清问题超过 {seconds} 秒没有响应——已先使用初稿继续" },
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
