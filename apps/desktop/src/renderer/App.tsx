import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

import {
  AcceptanceRule,
  mergePlanNodes,
  movePlanNode,
  routingOverrideForMilestone,
  routingRecommendationForPlanNode,
  splitPlanNode,
  updatePlanNode,
  validateExecutablePlan,
  validatePlanRouting,
  type AimIntakeReport,
  type AimProgressReadModel,
  type PlanRoutingValidation,
  type RoutingRuntimeAgentOption,
} from "@core/domain";
import type { ClarifyAnswer, ClarifyOutput, ClarifyQuestion, ClarifySelectionMode } from "@core/llm";
import type {
  AcceptanceRule as AcceptanceRuleType,
  ContextCategory,
  DecompositionContract,
  DecompositionOutput,
  Evidence,
  Goal,
  ManualEvidenceRequiredItem,
  Milestone,
  PlanNode,
  PlanRoutingOverride,
  PlanRoutingOwner,
} from "@core/types";
import type {
  ClarifyIpcResult,
  ConfirmMilestoneRequest,
  ContextSourceStatus,
  GoalDetail,
  LocalAgentDetection,
  PlanningDebugTrace,
  PlanningLiveEvent,
  PlanResult,
  ProviderStatus,
  WebResearchStatus,
} from "../shared/ipc";

import { CockpitShell, type CockpitStage } from "./CockpitShell";
import { ContextSourcesPanel } from "./ContextSourcesPanel";
import { buildContextBundleReview, type ContextBundleReview, type ContextReviewItem } from "./contextReview";
import {
  deriveAimHelperProfile,
  hasPlanningRuntime,
  routeAfterAimSubmit,
  routeAfterRefresh,
  type AimHelperProfile,
} from "./firstRunFlow";
import { I18nProvider, useI18n } from "./i18n";
import {
  aimIntakeOf,
  contextCategoryLabel,
  planningContextOf,
  planningToolsOf,
  reviewOf,
} from "./labels";
import { LocalAgentForm } from "./LocalAgentForm";
import { Notice } from "./Notice";
import { mergePlanningDebugTraces } from "./PlanningDebugPanel";
import { ProviderForm } from "./ProviderForm";
import { WebResearchForm } from "./WebResearchForm";
import { C, inputStyle, primaryButton, secondaryButton } from "./styles";

type AppMode = "cockpit" | "contexting" | "drafting" | "answering" | "reviewing" | "settings";
type ClarifyPhase = "intake" | "postDraft" | null;
type AnswerMap = Record<string, { labels: string[]; other: string }>;
type ProgressMilestoneRow = AimProgressReadModel["milestones"][number];
type EvalState = "passed" | "failed" | "needs_human" | "unsupported" | "error" | "pending";
type EvidenceSubmissionDraft = {
  proofNote: string;
  url: string;
  filePaths: string[];
  requiredEvidence: ManualEvidenceRequiredItem[];
};

function shortText(value: string | undefined | null, max = 120): string {
  const cleaned = (value ?? "").replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1).trim()}…`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function requiredEvidenceForMilestone(milestone: Milestone): string[] {
  const contract = asRecord(milestone.metadata?.decomposition_contract);
  return stringArray(contract?.required_evidence);
}

function emptyEvidenceDraft(milestone: Milestone): EvidenceSubmissionDraft {
  return {
    proofNote: "",
    url: "",
    filePaths: [],
    requiredEvidence: requiredEvidenceForMilestone(milestone).map((text) => ({ text, satisfied: false })),
  };
}

function proofUrlsFromDraft(url: string): string[] {
  return url.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean);
}

function evidenceDraftIsSubmittable(draft: EvidenceSubmissionDraft): boolean {
  const hasProof = draft.proofNote.trim().length > 0 || proofUrlsFromDraft(draft.url).length > 0 || draft.filePaths.length > 0;
  const requiredOk = draft.requiredEvidence.length === 0 || draft.requiredEvidence.some((item) => item.satisfied);
  return hasProof && requiredOk;
}

function evidenceSubmissionPayload(
  draft: EvidenceSubmissionDraft,
): Omit<ConfirmMilestoneRequest, "goalId" | "milestoneId"> {
  return {
    proofNote: draft.proofNote.trim(),
    urls: proofUrlsFromDraft(draft.url),
    filePaths: draft.filePaths,
    requiredEvidence: draft.requiredEvidence,
  };
}

function manualPayloadField(evidence: Evidence, key: string): unknown {
  return asRecord(evidence.payload)?.[key];
}

function evidenceReferenceMeta(evidence: Evidence): string {
  const urls = stringArray(manualPayloadField(evidence, "urls"));
  const files = stringArray(manualPayloadField(evidence, "file_paths"));
  const required = Array.isArray(manualPayloadField(evidence, "required_evidence"))
    ? (manualPayloadField(evidence, "required_evidence") as unknown[])
      .map(asRecord)
      .filter((item): item is Record<string, unknown> => Boolean(item))
    : [];
  const checked = required.filter((item) => item.satisfied === true).length;
  return [
    evidence.kind,
    urls.length ? `${urls.length} URL${urls.length === 1 ? "" : "s"}` : "",
    files.length ? `${files.length} file${files.length === 1 ? "" : "s"}` : "",
    required.length ? `${checked}/${required.length} required` : "",
  ].filter(Boolean).join(" · ");
}

function evidenceDisplaySummary(evidence: Evidence): string {
  const proofNote = manualPayloadField(evidence, "proof_note");
  return typeof proofNote === "string" && proofNote.trim() ? proofNote : evidence.summary;
}

function pct(done: number, total: number): number {
  return total <= 0 ? 0 : Math.round((done / total) * 100);
}

function planNodeForMilestone(plan: DecompositionOutput | null | undefined, milestone: Milestone) {
  const key = typeof milestone.metadata?.plan_key === "string" ? milestone.metadata.plan_key : null;
  return plan?.nodes.find((node) => node.key === key) ?? plan?.nodes.find((node) => node.title === milestone.title) ?? null;
}

function formatAcceptanceRule(rule: AcceptanceRuleType): string {
  return JSON.stringify(rule, null, 2);
}

function defaultContractForNode(node: PlanNode): DecompositionContract {
  return {
    why: "This sub-aim supports the aim.",
    definition_of_done: node.description.trim() || node.title,
    required_evidence: ["Evidence that the sub-aim is complete."],
    likely_owner: "either",
    context_gaps: [],
    eval_signal: "Evidence confirms the sub-aim is complete.",
  };
}

function editableContractForNode(node: PlanNode): DecompositionContract {
  return node.decomposition_contract ?? defaultContractForNode(node);
}

function evidenceLines(value: string): string[] {
  const lines = value.split(/\r?\n/g).map((line) => line.trim()).filter(Boolean);
  return lines.length > 0 ? lines : ["Evidence that the sub-aim is complete."];
}

function createPlanningRunId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `renderer:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function hasCjkText(value: string): boolean {
  return /[\u3400-\u9fff]/.test(value);
}

function intakeQuestionKind(category: ContextCategory): ClarifyQuestion["kind"] {
  if (category === "capability") return "capability";
  if (category === "constraint") return "constraint";
  if (category === "preference") return "scope";
  return "assumption";
}

function intakeQuestionDimension(category: ContextCategory): ClarifyQuestion["source_dimension"] {
  if (category === "eval_signal" || category === "procedure") return "verifiability";
  if (category === "constraint") return "granularity";
  return "context_fit";
}

function intakeQuestionSelectionMode(category: ContextCategory): ClarifySelectionMode {
  return category === "preference" ? "single" : "multiple";
}

function intakeOptions(category: ContextCategory, zh: boolean): ClarifyQuestion["options"] {
  if (zh) {
    switch (category) {
      case "eval_signal":
        return [
          { label: "自动证据", tradeoff: "后续进度可以尽量由 CI、文件或运行结果证明。" },
          { label: "人工确认", tradeoff: "保留主观验收，但需要你最终确认。" },
          { label: "可交付物", tradeoff: "用明确产物作为完成标准。" },
        ];
      case "constraint":
        return [
          { label: "账号/权限前置", tradeoff: "会先处理开发者账号、授权、凭证或审批。" },
          { label: "平台/工具限制", tradeoff: "会影响技术路线和执行方式。" },
          { label: "时间/预算限制", tradeoff: "会影响里程碑粒度和取舍。" },
          { label: "隐私/质量限制", tradeoff: "会影响验收标准和可委派范围。" },
        ];
      case "procedure":
        return [
          { label: "已有工作流", tradeoff: "计划会复用现有步骤和命令。" },
          { label: "已有材料", tradeoff: "需要先读材料再拆目标。" },
          { label: "需要新流程", tradeoff: "计划会包含流程定义。" },
        ];
      case "capability":
        return [
          { label: "agent 可执行", tradeoff: "数字化工作优先交给 agent。" },
          { label: "我有领域经验", tradeoff: "计划会复用你的经验、品味和判断。" },
          { label: "需要你决策", tradeoff: "关键选择会保留给人。" },
          { label: "需要外部专家/素材", tradeoff: "计划会先处理专业输入、access 或素材。" },
        ];
      case "project_fact":
        return [
          { label: "用户/场景明确", tradeoff: "可以围绕真实使用场景拆分。" },
          { label: "目标范围已明确", tradeoff: "可以更快拆分。" },
          { label: "当前状态需要检查", tradeoff: "先收集现状再拆分。" },
          { label: "交付形式待定", tradeoff: "需要先确定产物。" },
        ];
      case "preference":
        return [
          { label: "速度优先", tradeoff: "计划会偏向较小可交付版本。" },
          { label: "质量优先", tradeoff: "计划会加入更多验证步骤。" },
        ];
    }
  }

  switch (category) {
    case "eval_signal":
      return [
        { label: "Automated evidence", tradeoff: "Progress can be proven by CI, files, or run results." },
        { label: "Manual approval", tradeoff: "Subjective acceptance stays with you." },
        { label: "Deliverable artifact", tradeoff: "Completion is tied to a concrete artifact." },
      ];
    case "constraint":
      return [
        { label: "Account/access prerequisites", tradeoff: "Developer accounts, credentials, approvals, or permissions become prerequisites." },
        { label: "Platform/tool limits", tradeoff: "Changes the technical route and execution surface." },
        { label: "Time/budget limits", tradeoff: "Changes milestone size and tradeoffs." },
        { label: "Privacy/quality limits", tradeoff: "Changes acceptance rules and delegation." },
      ];
    case "procedure":
      return [
        { label: "Existing workflow", tradeoff: "The plan should reuse known steps and commands." },
        { label: "Existing materials", tradeoff: "Aimcub should inspect source material before planning." },
        { label: "New procedure needed", tradeoff: "The plan should include defining the workflow." },
      ];
    case "capability":
      return [
        { label: "Agent can execute", tradeoff: "Digital work should route to an agent first." },
        { label: "I have domain expertise", tradeoff: "The plan should reuse your experience, taste, and judgment." },
        { label: "You must decide", tradeoff: "Key decisions should stay human-owned." },
        { label: "External expert/material needed", tradeoff: "Expert input, access, assets, or vendors become prerequisites." },
      ];
    case "project_fact":
      return [
        { label: "User/scenario is clear", tradeoff: "The plan can decompose around the real usage situation." },
        { label: "Scope is clear", tradeoff: "Aimcub can decompose faster." },
        { label: "Current state needs inspection", tradeoff: "Context should be gathered before decomposition." },
        { label: "Deliverable is undecided", tradeoff: "The plan should first pin down the artifact." },
      ];
    case "preference":
      return [
        { label: "Move fast", tradeoff: "The plan favors a smaller deliverable." },
        { label: "Optimize quality", tradeoff: "The plan adds more verification." },
      ];
  }
}

function intakeToClarifyOutput(intake: AimIntakeReport, zh: boolean): ClarifyOutput {
  return {
    questions: intake.questions.map((question): ClarifyQuestion => ({
      id: `intake_${question.id}`,
      question: question.prompt,
      why_high_impact: question.whyHighImpact ?? question.reason,
      kind: intakeQuestionKind(question.category),
      source_dimension: intakeQuestionDimension(question.category),
      why_asked: [{
        code: "aim_intake",
        detail: question.reason,
        category: question.category,
        priority: question.priority,
        ...(question.gapSource ? { gapSource: question.gapSource } : {}),
        ...(question.nodeKey ? { nodeKey: question.nodeKey } : {}),
        ...(question.nodeTitle ? { nodeTitle: question.nodeTitle } : {}),
      }],
      capture: question.capture,
      allow_other: true,
      selection_mode: question.selectionMode ?? intakeQuestionSelectionMode(question.category),
      options: question.options?.length ? question.options : intakeOptions(question.category, zh),
    })),
    assumptions: [],
  };
}

function shouldBlockForIntake(intake: AimIntakeReport): boolean {
  return intake.loop.shouldContinue || intake.questions.some((question) => question.priority === "high" || question.priority === "medium");
}

function answerText(answer: ClarifyAnswer): string {
  const selected = Array.isArray(answer.selected_labels) && answer.selected_labels.length > 0
    ? answer.selected_labels.join("; ")
    : answer.selected_label ?? "";
  return [selected, answer.other_text ?? ""].filter((part) => part.trim().length > 0).join(selected ? "; " : "");
}

function cockpitStageFor(mode: AppMode, selected: Goal | null, activePlan: DecompositionOutput | null): CockpitStage {
  if (mode === "settings") return "settings";
  if (mode === "contexting" || mode === "answering") return "context";
  if (mode === "reviewing" || (!selected && activePlan)) return "contracts";
  if (selected) return "run";
  return "aim";
}

function progressRows(detail: GoalDetail, progress: AimProgressReadModel | null): ProgressMilestoneRow[] {
  return progress?.milestones ?? detail.milestones.map((milestone): ProgressMilestoneRow => ({
    milestone,
    assignment: null,
    latest_run: null,
    child_relations: [],
    evaluator_results: [],
    evidence: [],
    evidence_count: 0,
    completed: milestone.status === "completed",
    blocked: milestone.status === "blocked",
    next_action: "",
  }));
}

function routingAgentsFromDetections(agents: readonly LocalAgentDetection[]): RoutingRuntimeAgentOption[] {
  return agents.map((agent) => ({
    id: agent.id,
    label: agent.name,
    available: agent.available,
    authenticated: agent.authStatus !== "missing",
    models: agent.models,
    unavailableReason: agent.authMessage ?? agent.diagnostics[0] ?? null,
  }));
}

function readyRoutingAgents(agents: readonly RoutingRuntimeAgentOption[]): RoutingRuntimeAgentOption[] {
  return agents.filter((agent) => agent.available && agent.authenticated);
}

function findRoutingAgent(agents: readonly RoutingRuntimeAgentOption[], id: string | null | undefined): RoutingRuntimeAgentOption | null {
  return id ? agents.find((agent) => agent.id === id) ?? null : null;
}

function firstModel(agent: RoutingRuntimeAgentOption | null | undefined): string | null {
  return agent?.models[0]?.id ?? null;
}

function modelLabel(agent: RoutingRuntimeAgentOption | null | undefined, modelId: string | null | undefined): string | null {
  if (!agent || !modelId) return modelId ?? null;
  return agent.models.find((model) => model.id === modelId)?.label ?? modelId;
}

function makeRoutingOverride(input: {
  owner: PlanRoutingOwner;
  agents: readonly RoutingRuntimeAgentOption[];
  agentId?: string | null;
  model?: string | null;
}): PlanRoutingOverride {
  if (input.owner === "human") {
    return {
      owner: "human",
      agent_id: null,
      agent_label: null,
      run_mode: null,
      model: null,
      model_label: null,
      reason: "User selected the human route.",
    };
  }
  const ready = readyRoutingAgents(input.agents);
  const agent = findRoutingAgent(ready, input.agentId) ?? ready[0] ?? null;
  const selectedModel = input.model ?? firstModel(agent);
  return {
    owner: "agent",
    agent_id: agent?.id ?? input.agentId ?? null,
    agent_label: agent?.label ?? null,
    run_mode: "local_cli",
    model: selectedModel,
    model_label: modelLabel(agent, selectedModel),
    reason: "User selected the agent route.",
  };
}

function formatRoutingValidation(validation: PlanRoutingValidation): string {
  return validation.issues.map((issue) => `${issue.title}: ${issue.message}`).join("\n");
}

function evalStateOf(row: ProgressMilestoneRow): EvalState {
  const statuses = row.evaluator_results.map((result) => result.status);
  if (statuses.includes("error")) return "error";
  if (statuses.includes("needs_human")) return "needs_human";
  if (statuses.includes("unsupported")) return "unsupported";
  if (statuses.includes("failed")) return "failed";
  if (statuses.length > 0 && statuses.every((status) => status === "passed")) return "passed";
  if (row.completed) return "passed";
  return "pending";
}

function evalToneClass(state: EvalState): string {
  if (state === "passed") return "success";
  if (state === "failed" || state === "error") return "danger";
  if (state === "needs_human" || state === "unsupported") return "warn";
  return "";
}

function shortId(value: string): string {
  return value.length <= 8 ? value : value.slice(0, 8);
}

function latestLiveValue<T>(
  events: readonly PlanningLiveEvent[],
  pick: (event: PlanningLiveEvent) => T | null | undefined,
): T | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const value = pick(events[index]!);
    if (value !== null && value !== undefined) return value;
  }
  return null;
}

function formatTrust(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function App() {
  return (
    <I18nProvider>
      <AimOsApp />
    </I18nProvider>
  );
}

function AimOsApp() {
  const { t } = useI18n();
  const [mode, setMode] = useState<AppMode>("cockpit");
  const [goals, setGoals] = useState<Goal[]>([]);
  const [selected, setSelected] = useState<Goal | null>(null);
  const [detail, setDetail] = useState<GoalDetail | null>(null);
  const [progress, setProgress] = useState<AimProgressReadModel | null>(null);
  const [provider, setProvider] = useState<ProviderStatus | null>(null);
  const [webResearch, setWebResearch] = useState<WebResearchStatus | null>(null);
  const [contextSources, setContextSources] = useState<ContextSourceStatus | null>(null);
  const [localAgents, setLocalAgents] = useState<LocalAgentDetection[]>([]);
  const [aimTitle, setAimTitle] = useState("");
  const [aimDescription, setAimDescription] = useState("");
  const [parent, setParent] = useState<{ goalId: string; milestoneId: string } | null>(null);
  const [draft, setDraft] = useState<DecompositionOutput | null>(null);
  const [finalPlan, setFinalPlan] = useState<DecompositionOutput | null>(null);
  const [planResult, setPlanResult] = useState<PlanResult | null>(null);
  const [planningDebugTraces, setPlanningDebugTraces] = useState<PlanningDebugTrace[]>([]);
  const [planningLiveEvents, setPlanningLiveEvents] = useState<PlanningLiveEvent[]>([]);
  const [intakeClarify, setIntakeClarify] = useState<ClarifyOutput | null>(null);
  const [intakeAnswers, setIntakeAnswers] = useState<AnswerMap>({});
  const [clarifyPhase, setClarifyPhase] = useState<ClarifyPhase>(null);
  const [clarify, setClarify] = useState<ClarifyOutput | null>(null);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [contextNote, setContextNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [stageOverride, setStageOverride] = useState<CockpitStage | null>(null);
  const [runtimeGuidanceVisible, setRuntimeGuidanceVisible] = useState(false);
  const planningRunIdRef = useRef<string | null>(null);

  useEffect(() => {
    void refreshAll();
  }, []);

  useEffect(() => {
    return window.aimcub.onPlanningLiveEvent((event) => {
      const activeRunId = planningRunIdRef.current;
      if (!activeRunId || event.runId !== activeRunId) return;
      setPlanningLiveEvents((current) => [...current, event].slice(-80));
    });
  }, []);

  function startPlanningRun(): string {
    const runId = createPlanningRunId();
    planningRunIdRef.current = runId;
    setPlanningLiveEvents([]);
    return runId;
  }

  function clearPlanningRun() {
    planningRunIdRef.current = null;
  }

  async function refreshAll() {
    const [nextGoals, nextProvider, nextWeb, nextSources, nextAgents] = await Promise.all([
      window.aimcub.listGoals().catch(() => []),
      window.aimcub.getProviderConfig().catch(() => null),
      window.aimcub.getWebResearchConfig().catch(() => null),
      window.aimcub.getContextSourceConfig().catch(() => null),
      window.aimcub.listLocalAgents().catch(() => []),
    ]);
    setGoals(nextGoals);
    setProvider(nextProvider);
    setWebResearch(nextWeb);
    setContextSources(nextSources);
    setLocalAgents(nextAgents);
    const route = routeAfterRefresh({ hasSelectedAim: Boolean(selected), hasGoals: nextGoals.length > 0 });
    if (route.autoOpenFirstGoal && nextGoals[0]) void openGoal(nextGoals[0]);
    if (route.stageOverride) {
      setMode("cockpit");
      setStageOverride(route.stageOverride);
    }
  }

  async function openGoal(goal: Goal) {
    setSelected(goal);
    setMode("cockpit");
    setStageOverride("aim");
    setError(null);
    setDraft(null);
    setFinalPlan(null);
    setPlanResult(null);
    setPlanningDebugTraces([]);
    setPlanningLiveEvents([]);
    clearPlanningRun();
    setIntakeClarify(null);
    setIntakeAnswers({});
    setClarifyPhase(null);
    setClarify(null);
    setAnswers({});
    setRuntimeGuidanceVisible(false);
    setContextNote("");
    const [nextDetail, nextProgress] = await Promise.all([
      window.aimcub.getGoal(goal.id),
      window.aimcub.getAimProgress(goal.id),
    ]);
    setDetail(nextDetail);
    setProgress(nextProgress);
  }

  function resetComposer() {
    setStageOverride("aim");
    setAimTitle("");
    setAimDescription("");
    setParent(null);
    setDraft(null);
    setFinalPlan(null);
    setPlanResult(null);
    setPlanningDebugTraces([]);
    setPlanningLiveEvents([]);
    clearPlanningRun();
    setIntakeClarify(null);
    setIntakeAnswers({});
    setClarifyPhase(null);
    setClarify(null);
    setAnswers({});
    setRuntimeGuidanceVisible(false);
    setContextNote("");
    setSelected(null);
    setDetail(null);
    setProgress(null);
    setError(null);
  }

  function answersFor(output: ClarifyOutput | null, answerMap: AnswerMap): ClarifyAnswer[] {
    const questions = output?.questions ?? [];
    return questions.flatMap((question) => {
      const answer = answerMap[question.id];
      const labels = answer?.labels.map((label) => label.trim()).filter(Boolean) ?? [];
      const selectedLabel = labels[0] ?? null;
      const other = answer?.other.trim() || null;
      if (labels.length === 0 && !other) return [];
      return [{
        question_id: question.id,
        selected_label: selectedLabel,
        selected_labels: labels,
        other_text: other,
      }];
    });
  }

  function descriptionWithContext(): string | undefined {
    const base = aimDescription.trim();
    const contextLines: string[] = [];
    const intakeQuestions = new Map((intakeClarify?.questions ?? []).map((question) => [question.id, question.question]));
    for (const answer of answersFor(intakeClarify, intakeAnswers)) {
      const text = answerText(answer);
      if (!text) continue;
      contextLines.push(`- ${intakeQuestions.get(answer.question_id) ?? answer.question_id}: ${text}`);
    }
    if (contextNote.trim()) contextLines.push(`- Additional context: ${contextNote.trim()}`);
    const contextBlock = contextLines.length > 0
      ? ["Context collected before decomposition:", ...contextLines].join("\n")
      : "";
    return [base, contextBlock].filter((part) => part.trim().length > 0).join("\n\n") || undefined;
  }

  async function startDraft(options: { skipIntakeGate?: boolean } = {}) {
    const title = aimTitle.trim();
    const route = routeAfterAimSubmit({ title, provider, localAgents });
    if (route === "missing_aim") return;
    if (route === "show_helper_guidance") {
      setError(null);
      setRuntimeGuidanceVisible(true);
      setMode("cockpit");
      setStageOverride("aim");
      return;
    }
    setRuntimeGuidanceVisible(false);
    setError(null);
    setPlanningDebugTraces([]);
    const runId = startPlanningRun();
    try {
      if (!options.skipIntakeGate) {
        setBusy(t("os.busy.context"));
        setMode("contexting");
        setStageOverride("context");
        const intake = await window.aimcub.intake({ title, description: aimDescription.trim() || undefined, clientRunId: runId });
        setPlanResult({ ok: false, output: null, errors: [], intake });
        if (shouldBlockForIntake(intake) && intake.questions.length > 0) {
          const intakeOutput = intakeToClarifyOutput(intake, hasCjkText(`${title}\n${aimDescription}`));
          setIntakeClarify(intakeOutput);
          setClarify(intakeOutput);
          setClarifyPhase("intake");
          setBusy(null);
          return;
        }
      }

      setBusy(t("os.busy.draft"));
      setMode("drafting");
      setStageOverride("contracts");
      const req = { title, description: descriptionWithContext(), clientRunId: runId };
      const nextDraft = await window.aimcub.draft(req);
      if (!nextDraft.ok || !nextDraft.output) throw new Error(nextDraft.errors.join("; ") || t("os.err.draft"));
      setDraft(nextDraft.output);
      setFinalPlan(nextDraft.output);
      setPlanResult(nextDraft);
      setPlanningDebugTraces(nextDraft.debugTrace ? [nextDraft.debugTrace] : []);
      const nextClarify: ClarifyIpcResult = await window.aimcub.clarify({ ...req, draft: nextDraft.output }).catch((err: unknown) => ({
        ok: false,
        output: null,
        errors: [err instanceof Error ? err.message : String(err)],
      }));
      const clarifyTrace = nextClarify.debugTrace;
      if (clarifyTrace) {
        setPlanningDebugTraces((current) => [...current, clarifyTrace]);
      }
      setClarify(nextClarify.output ?? { questions: [], assumptions: [] });
      setClarifyPhase("postDraft");
      setAnswers({});
      setMode("answering");
      setStageOverride("context");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setMode("cockpit");
      setStageOverride("aim");
    } finally {
      setBusy(null);
    }
  }

  const builtAnswers = useMemo<ClarifyAnswer[]>(() => {
    return answersFor(clarifyPhase === "postDraft" ? clarify : null, answers);
  }, [answers, clarify, clarifyPhase]);

  const builtIntakeAnswers = useMemo<ClarifyAnswer[]>(() => {
    return answersFor(intakeClarify, intakeAnswers);
  }, [intakeAnswers, intakeClarify]);

  async function continueFromContext() {
    await startDraft({ skipIntakeGate: true });
  }

  async function refinePlan() {
    if (!draft) return;
    setBusy(t("os.busy.refine"));
    setError(null);
    const runId = startPlanningRun();
    try {
      const refined = await window.aimcub.refine({
        title: aimTitle.trim(),
        description: descriptionWithContext(),
        draft,
        questions: clarify?.questions ?? [],
        answers: builtAnswers,
        clientRunId: runId,
      });
      if (!refined.ok || !refined.output) throw new Error(refined.errors.join("; ") || t("os.err.refine"));
      setFinalPlan(refined.output);
      setPlanResult(refined);
      const refineTrace = refined.debugTrace;
      if (refineTrace) {
        setPlanningDebugTraces((current) => [...current, refineTrace]);
      }
      setMode("reviewing");
      setStageOverride("contracts");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function savePlan() {
    const plan = finalPlan ?? draft;
    if (!plan) return;
    const validation = validateExecutablePlan(plan);
    if (!validation.ok) {
      setError(t("plan.validationFailed", { errors: validation.errors.join("; ") }));
      setMode("reviewing");
      setStageOverride("contracts");
      return;
    }
    const routingValidation = validatePlanRouting({
      plan,
      agents: routingAgentsFromDetections(localAgents),
      allowHuman: true,
    });
    if (!routingValidation.ok) {
      setError(formatRoutingValidation(routingValidation));
      setStageOverride("contracts");
      setMode("reviewing");
      return;
    }
    setBusy(t("os.busy.save"));
    setError(null);
    try {
      const saved = await window.aimcub.saveGoal({
        title: aimTitle.trim(),
        description: aimDescription.trim() || undefined,
        parentGoalId: parent?.goalId,
        parentMilestoneId: parent?.milestoneId,
        draft,
        plan,
        quality: planResult?.quality ?? null,
        review: planResult?.review ?? null,
        qualityRetry: planResult?.qualityRetry ?? undefined,
        debugTrace: mergePlanningDebugTraces(planningDebugTraces.length ? planningDebugTraces : [planResult?.debugTrace]),
        questions: [
          ...(intakeClarify?.questions ?? []),
          ...(clarifyPhase === "postDraft" ? clarify?.questions ?? [] : []),
        ],
        answers: [...builtIntakeAnswers, ...builtAnswers],
        assumptions: clarify?.assumptions ?? [],
      });
      resetComposer();
      await refreshAll();
      await openGoal(saved.goal);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function runAgent(milestone: Milestone) {
    if (!selected) return;
    setBusy(t("os.busy.agent"));
    setError(null);
    try {
      const result = await window.aimcub.runMilestoneAgent({ goalId: selected.id, milestoneId: milestone.id });
      if (!result.ok && result.error) setError(result.error);
      const [nextDetail, nextProgress] = await Promise.all([
        window.aimcub.getGoal(selected.id),
        window.aimcub.getAimProgress(selected.id),
      ]);
      setDetail(nextDetail);
      setProgress(nextProgress);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function confirmMilestone(milestone: Milestone, submission: Omit<ConfirmMilestoneRequest, "goalId" | "milestoneId">) {
    if (!selected) return;
    setBusy(t("os.busy.confirm"));
    setError(null);
    try {
      const nextDetail = await window.aimcub.confirmMilestone({
        goalId: selected.id,
        milestoneId: milestone.id,
        ...submission,
      });
      const nextProgress = await window.aimcub.getAimProgress(selected.id);
      setDetail(nextDetail);
      setProgress(nextProgress);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  function breakDown(milestone: Milestone) {
    const plan = detail?.goal.plan_json as DecompositionOutput | null | undefined;
    const node = planNodeForMilestone(plan, milestone);
    resetComposer();
    setParent({ goalId: milestone.goal_id, milestoneId: milestone.id });
    setAimTitle(milestone.title);
    setAimDescription([
      selected ? `Parent aim: ${selected.title}` : "",
      milestone.description ? `Sub-aim context: ${milestone.description}` : "",
      node?.decomposition_contract?.definition_of_done
        ? `Definition of done: ${node.decomposition_contract.definition_of_done}`
        : "",
      node?.decomposition_contract?.required_evidence?.length
        ? `Required evidence: ${node.decomposition_contract.required_evidence.join("; ")}`
        : "",
      node?.decomposition_contract?.eval_signal ? `Eval signal: ${node.decomposition_contract.eval_signal}` : "",
      "Break this sub-aim into smaller sub-aims with concrete eval rules.",
    ].filter(Boolean).join("\n"));
    setMode("cockpit");
    setStageOverride("aim");
  }

  const activePlan = (finalPlan ?? draft ?? detail?.goal.plan_json ?? null) as DecompositionOutput | null;
  const activePlanValidation = activePlan ? validateExecutablePlan(activePlan) : null;
  const routingAgents = useMemo(() => routingAgentsFromDetections(localAgents), [localAgents]);
  const planRoutingValidation = useMemo(
    () => activePlan ? validatePlanRouting({ plan: activePlan, agents: routingAgents, allowHuman: true }) : null,
    [activePlan, routingAgents],
  );
  const completed = progress?.completed_milestones ?? detail?.milestones.filter((m) => m.status === "completed").length ?? 0;
  const total = progress?.total_milestones ?? detail?.milestones.length ?? 0;
  const hasUnsavedAim = aimTitle.trim().length > 0;
  const activeStage = stageOverride ?? cockpitStageFor(mode, selected, activePlan);
  const planningRuntimeReady = hasPlanningRuntime(provider, localAgents);
  const activeAimTitle = selected?.title ?? aimTitle.trim();
  const activeAimDescription = selected?.description ?? aimDescription;
  const activeAimHelper = useMemo(
    () => deriveAimHelperProfile({ title: activeAimTitle, description: activeAimDescription }),
    [activeAimDescription, activeAimTitle],
  );
  const livePlanningContext = latestLiveValue(planningLiveEvents, (event) => event.planningContext);
  const livePlanningTools = latestLiveValue(planningLiveEvents, (event) => event.planningTools);
  const liveIntake = latestLiveValue(planningLiveEvents, (event) => event.intake);
  const currentPlanningContext = planResult?.planningContext ?? livePlanningContext ?? (selected ? planningContextOf(selected) : null);
  const currentPlanningTools = planResult?.planningTools ?? livePlanningTools ?? (selected ? planningToolsOf(selected) : null);
  const currentIntake = planResult?.intake ?? liveIntake ?? (selected ? aimIntakeOf(selected) : null);
  const currentReview = planResult?.review ?? (selected ? reviewOf(selected) : null);
  const contextReview = useMemo(() => buildContextBundleReview({
    planningContext: currentPlanningContext,
    planningTools: currentPlanningTools,
    intake: currentIntake,
    review: currentReview,
    plan: activePlan,
    answeredQuestionIds: [...builtIntakeAnswers, ...builtAnswers].map((answer) => answer.question_id),
  }), [activePlan, builtAnswers, builtIntakeAnswers, currentIntake, currentPlanningContext, currentPlanningTools, currentReview]);

  function applyPlanEdit(nextPlan: DecompositionOutput) {
    setFinalPlan(nextPlan);
    setPlanResult((current) => (current ? { ...current, output: nextPlan } : current));
  }

  function openCockpitStage(stage: CockpitStage) {
    setStageOverride(stage);
    if (stage === "settings") {
      setMode("settings");
      return;
    }
    if (stage === "context") {
      setMode("contexting");
      return;
    }
    if (stage === "contracts") {
      setMode(activePlan ? "reviewing" : "contexting");
      return;
    }
    if (stage === "run" || stage === "eval") {
      setMode(selected || activePlan ? "reviewing" : "cockpit");
      return;
    }
    setMode("cockpit");
  }

  function startNewAim() {
    resetComposer();
    setMode("cockpit");
    setStageOverride("aim");
  }

  function openSettingsForAim() {
    setMode("settings");
    setStageOverride("settings");
  }

  function returnToAim() {
    if (planningRuntimeReady) setRuntimeGuidanceVisible(false);
    setMode("cockpit");
    setStageOverride("aim");
  }

  const composerPanel = (
    <ComposerPanel
      title={aimTitle}
      description={aimDescription}
      parent={parent}
      mode={mode}
      disabled={Boolean(busy)}
      onTitle={setAimTitle}
      onDescription={setAimDescription}
      onDraft={() => void startDraft()}
    />
  );

  const clarifyPanel = clarify && (mode === "contexting" || mode === "answering" || mode === "reviewing") ? (
    <ClarifyPanel
      clarify={clarify}
      phase={clarifyPhase}
      answers={clarifyPhase === "intake" ? intakeAnswers : answers}
      contextNote={contextNote}
      conversationEnabled={clarifyPhase !== "intake" || contextSources?.userSession.enabled !== false}
      questionnaireEnabled={clarifyPhase !== "intake" || contextSources?.questionnaire.enabled !== false}
      disabled={Boolean(busy)}
      onAnswer={(id, value) => {
        if (clarifyPhase === "intake") {
          setIntakeAnswers((current) => ({ ...current, [id]: value }));
        } else {
          setAnswers((current) => ({ ...current, [id]: value }));
        }
      }}
      onContextNote={setContextNote}
      onRefine={() => void (clarifyPhase === "intake" ? continueFromContext() : refinePlan())}
      onSkip={clarifyPhase === "intake" ? undefined : () => setMode("reviewing")}
    />
  ) : null;

  const planPanel = activePlan ? (
    <PlanPanel
      plan={activePlan}
      quality={planResult?.quality ?? null}
      review={planResult?.review ?? null}
      saved={Boolean(selected)}
      disabled={Boolean(busy) || activePlanValidation?.ok === false}
      validationErrors={activePlanValidation?.errors ?? []}
      routingAgents={routingAgents}
      routingValidation={planRoutingValidation}
      onChange={selected ? undefined : applyPlanEdit}
      onSave={() => void savePlan()}
    />
  ) : null;

  const executePanel = selected && detail ? (
    <ExecutePanel
      detail={detail}
      progress={progress}
      disabled={Boolean(busy)}
      onRunAgent={(milestone) => void runAgent(milestone)}
      onConfirm={confirmMilestone}
      onPickFiles={async () => {
        const result = await window.aimcub.pickLocalContextFiles();
        return result.canceled ? [] : result.paths;
      }}
      onBreakDown={breakDown}
    />
  ) : null;

  const evalPanel = selected && detail ? (
    <EvalPanel
      detail={detail}
      progress={progress}
    />
  ) : null;

  const settingsPanel = (
    <SettingsPanel
      provider={provider}
      webResearch={webResearch}
      contextSources={contextSources}
      localAgents={localAgents}
      onProvider={setProvider}
      onWeb={setWebResearch}
      onContextSources={setContextSources}
      onRefreshAgents={async () => setLocalAgents(await window.aimcub.listLocalAgents())}
      aimContext={activeAimTitle ? {
        title: activeAimTitle,
        profile: activeAimHelper,
        runtimeReady: planningRuntimeReady,
      } : null}
      onReturnToAim={activeAimTitle ? returnToAim : undefined}
    />
  );

  const mainStageContent = (() => {
    if (activeStage === "settings") return settingsPanel;
    if (activeStage === "context") {
      if (!selected && !parent && !hasUnsavedAim) {
        return (
          <LockedStagePanel
            eyebrow={t("os.stepContext")}
            title={t("cockpit.contextLockedTitle")}
            body={t("cockpit.contextLockedBody")}
            action={t("os.stepAim")}
            onAction={() => openCockpitStage("aim")}
          />
        );
      }
      return (
        <>
          {parent ? composerPanel : (
            <ContextAimSummaryPanel
              title={selected?.title ?? aimTitle}
              description={selected?.description ?? aimDescription}
              saved={Boolean(selected)}
              onEdit={selected ? undefined : () => openCockpitStage("aim")}
            />
          )}
          <ContextSourcesPanel status={contextSources} disabled={Boolean(busy)} onSaved={setContextSources} />
          <ContextReviewPanel bundle={contextReview} running={mode === "contexting" && Boolean(busy)} />
          {clarifyPanel}
        </>
      );
    }
    if (activeStage === "contracts") {
      return planPanel ? (
        <>
          <ContextReviewPanel bundle={contextReview} running={mode === "drafting" && Boolean(busy)} />
          {planPanel}
        </>
      ) : (
        <LockedStagePanel
          eyebrow={t("os.stepPlan")}
          title={t("cockpit.contractsLockedTitle")}
          body={t("cockpit.contractsLockedBody")}
          action={t("cockpit.next.context")}
          onAction={() => openCockpitStage("context")}
        />
      );
    }
    if (activeStage === "run") {
      return executePanel ?? planPanel ?? (
        <LockedStagePanel
          eyebrow={t("os.stepExecute")}
          title={t("cockpit.runLockedTitle")}
          body={t("cockpit.runLockedBody")}
          action={t("os.stepAim")}
          onAction={() => openCockpitStage("aim")}
        />
      );
    }
    if (activeStage === "eval") {
      return evalPanel ?? planPanel ?? (
        <LockedStagePanel
          eyebrow={t("os.stepEval")}
          title={t("cockpit.runLockedTitle")}
          body={t("cockpit.runLockedBody")}
          action={t("os.stepAim")}
          onAction={() => openCockpitStage("aim")}
        />
      );
    }
    return (
      selected && !draft && !parent ? (
        <AimOverviewPanel
          goal={selected}
          progress={progress}
          completed={completed}
          total={total}
          onContext={() => openCockpitStage("context")}
          onNewAim={startNewAim}
        />
      ) : (
        <AimIntakePanel
          title={aimTitle}
          description={aimDescription}
          parent={parent}
          mode={mode}
          disabled={Boolean(busy)}
          onTitle={setAimTitle}
          onDescription={setAimDescription}
          onDraft={() => void startDraft()}
          runtimeGuidance={runtimeGuidanceVisible && !planningRuntimeReady ? activeAimHelper : null}
          onOpenSettings={openSettingsForAim}
          onKeepEditing={() => setRuntimeGuidanceVisible(false)}
        />
      )
    );
  })();

  return (
    <CockpitShell
      goals={goals}
      selected={selected}
      activeStage={activeStage}
      busy={busy}
      error={error}
      onNewAim={startNewAim}
      onOpenGoal={(goal) => void openGoal(goal)}
      onStage={openCockpitStage}
      main={(
        <>
          {error ? <Notice tone="error">{error}</Notice> : null}
          {busy ? <Notice tone="info">{busy}</Notice> : null}
          {mainStageContent}
        </>
      )}
    />
  );
}

function ContextReviewPanel(props: {
  bundle: ContextBundleReview;
  running: boolean;
}) {
  const { t } = useI18n();
  const totalItems = props.bundle.usedContext.length
    + props.bundle.skippedContext.length
    + props.bundle.permissionGaps.length
    + props.bundle.decompositionRisks.length;
  return (
    <section className="od-context-review">
      <div className="od-stage-panel-head">
        <div>
          <div className="od-stage-kicker">{t("contextReview.eyebrow")}</div>
          <h2>{t("contextReview.title")}</h2>
          <p>{t(totalItems === 0 ? "contextReview.emptyBody" : "contextReview.body")}</p>
        </div>
        {props.running ? <span className="od-pill blue">{t("debug.pending")}</span> : null}
      </div>

      <div className="od-stage-metrics" aria-label={t("contextReview.title")}>
        <StageMetric label={t("contextReview.metric.used")} value={String(props.bundle.usedContext.length)} />
        <StageMetric label={t("contextReview.metric.skipped")} value={String(props.bundle.skippedContext.length)} />
        <StageMetric label={t("contextReview.metric.gaps")} value={String(props.bundle.permissionGaps.length)} />
      </div>

      <div className="od-context-review-grid">
        <ContextReviewBucket
          title={t("contextReview.used")}
          items={props.bundle.usedContext}
          empty={t("contextReview.empty.used")}
        />
        <ContextReviewBucket
          title={t("contextReview.skipped")}
          items={props.bundle.skippedContext}
          empty={t("contextReview.empty.skipped")}
        />
        <ContextReviewBucket
          title={t("contextReview.permissions")}
          items={props.bundle.permissionGaps}
          empty={t("contextReview.empty.permissions")}
        />
        <ContextReviewBucket
          title={t("contextReview.risks")}
          items={props.bundle.decompositionRisks}
          empty={t("contextReview.empty.risks")}
        />
      </div>
    </section>
  );
}

function ContextReviewBucket(props: {
  title: string;
  items: ContextReviewItem[];
  empty: string;
}) {
  const { t } = useI18n();
  const visible = props.items.slice(0, 4);
  const extra = Math.max(0, props.items.length - visible.length);
  return (
    <section className="od-context-review-bucket">
      <div className="od-card-head">
        <h3>{props.title}</h3>
        <span className="od-pill">{String(props.items.length)}</span>
      </div>
      {visible.length === 0 ? (
        <div className="od-empty-inline">{props.empty}</div>
      ) : (
        <div className="od-context-review-list">
          {visible.map((item) => (
            <article key={item.id} className={`od-context-review-item ${contextReviewToneClass(item.tone)}`}>
              <div className="od-context-review-item-head">
                <strong>{item.title}</strong>
                {item.category ? <span className="od-pill">{contextCategoryLabel(item.category, t)}</span> : null}
              </div>
              <p>{shortText(item.body, 220)}</p>
              {item.meta.length ? <small>{item.meta.filter(Boolean).slice(0, 3).join(" · ")}</small> : null}
            </article>
          ))}
          {extra > 0 ? <div className="od-context-review-more">{t("contextReview.more", { n: extra })}</div> : null}
        </div>
      )}
    </section>
  );
}

function contextReviewToneClass(tone: ContextReviewItem["tone"]): string {
  if (tone === "success") return "success";
  if (tone === "warn") return "warn";
  if (tone === "danger") return "danger";
  return "";
}

function AimOverviewPanel(props: {
  goal: Goal;
  progress: AimProgressReadModel | null;
  completed: number;
  total: number;
  onContext: () => void;
  onNewAim: () => void;
}) {
  const { t } = useI18n();
  const completion = pct(props.completed, props.total);
  const nextAction = props.progress?.next_action || t("shell.noNextAction");
  const summary = props.goal.description?.trim() || nextAction;
  return (
    <section className="od-aim-overview">
      <div className="od-aim-intake-head">
        <div>
          <div className="od-aim-kicker">{t("shell.currentAim")}</div>
          <h1>{props.goal.title}</h1>
          <p>{shortText(summary, 260)}</p>
        </div>
        <ProgressDonut done={props.completed} total={props.total} />
      </div>

      <div className="od-aim-overview-strip">
        <div>
          <span>{t("shell.progress")}</span>
          <strong>{completion}%</strong>
          <small>{t("shell.progressValue", { done: props.completed, total: props.total })}</small>
        </div>
        <div>
          <span>{t("shell.nextAction")}</span>
          <strong>{shortText(nextAction, 120)}</strong>
          <small>{t("aimIntake.contextGate")}</small>
        </div>
      </div>

      <div className="od-aim-intake-footer">
        <p>{t("aimIntake.currentHint")}</p>
        <div className="od-aim-intake-actions">
          <button className="od-aim-secondary" type="button" onClick={props.onNewAim}>
            {t("os.newAim")}
          </button>
          <button className="od-aim-primary" type="button" onClick={props.onContext}>
            {t("aimIntake.cta")}
          </button>
        </div>
      </div>
    </section>
  );
}

function AimIntakePanel(props: {
  title: string;
  description: string;
  parent: { goalId: string; milestoneId: string } | null;
  mode: AppMode;
  disabled: boolean;
  runtimeGuidance: AimHelperProfile | null;
  onTitle: (value: string) => void;
  onDescription: (value: string) => void;
  onDraft: () => void;
  onOpenSettings: () => void;
  onKeepEditing: () => void;
}) {
  const { t } = useI18n();
  const hasAim = props.title.trim().length > 0;
  const submitting = props.mode === "contexting" || props.mode === "drafting";
  const disabled = props.disabled || !hasAim;
  return (
    <section className="od-aim-intake">
      <div className="od-aim-intake-head">
        <div>
          <div className="od-aim-kicker">{props.parent ? t("os.subAimMode") : t("os.newAim")}</div>
          <h1>{props.parent ? t("os.breakdownTitle") : t("os.heroTitle")}</h1>
          <p>{props.parent ? t("aimIntake.subAimBody") : t("aimIntake.body")}</p>
        </div>
      </div>

      <div className="od-aim-intake-form">
        <div className="od-field-head">
          <label htmlFor="aim-title">{t("aimIntake.titleLabel")}</label>
          <span>{hasAim ? t("aimIntake.ready") : t("aimIntake.empty")}</span>
        </div>
        <input
          id="aim-title"
          className="od-aim-title-input"
          value={props.title}
          onChange={(event) => props.onTitle(event.target.value)}
          placeholder={t("os.aimPlaceholder")}
        />

        <div className="od-field-head">
          <label htmlFor="aim-context">{t("aimIntake.contextLabel")}</label>
          <span>{t("aimIntake.optional")}</span>
        </div>
        <textarea
          id="aim-context"
          className="od-aim-context-input"
          value={props.description}
          onChange={(event) => props.onDescription(event.target.value)}
          placeholder={t("os.contextPlaceholder")}
          rows={5}
        />
      </div>

      <div className="od-aim-intake-footer">
        <p>{hasAim ? t("aimIntake.contextGate") : t("aimIntake.unsaved")}</p>
        <button className="od-aim-primary" type="button" onClick={props.onDraft} disabled={disabled}>
          {submitting ? t("os.drafting") : t("aimIntake.cta")}
        </button>
      </div>

      {props.runtimeGuidance ? (
        <AimHelperGuidancePanel
          title={props.title}
          profile={props.runtimeGuidance}
          onOpenSettings={props.onOpenSettings}
          onKeepEditing={props.onKeepEditing}
        />
      ) : null}
    </section>
  );
}

function helperCapabilityLabel(profile: AimHelperProfile, t: ReturnType<typeof useI18n>["t"]): string {
  switch (profile.capability) {
    case "code_execution":
      return t("firstRun.capability.code");
    case "current_research":
      return t("firstRun.capability.research");
    case "source_context":
      return t("firstRun.capability.context");
    case "general_planning":
      return t("firstRun.capability.planning");
  }
}

function helperPreferenceLabel(profile: AimHelperProfile, t: ReturnType<typeof useI18n>["t"]): string {
  switch (profile.preferredHelper) {
    case "local_agent":
      return t("firstRun.helper.localAgent");
    case "provider_with_web":
      return t("firstRun.helper.providerWithWeb");
    case "provider":
      return t("firstRun.helper.provider");
    case "either":
      return t("firstRun.helper.either");
  }
}

function helperReason(profile: AimHelperProfile, t: ReturnType<typeof useI18n>["t"]): string {
  switch (profile.capability) {
    case "code_execution":
      return t("firstRun.reason.code");
    case "current_research":
      return t("firstRun.reason.research");
    case "source_context":
      return t("firstRun.reason.context");
    case "general_planning":
      return t("firstRun.reason.planning");
  }
}

function AimHelperGuidancePanel(props: {
  title: string;
  profile: AimHelperProfile;
  onOpenSettings: () => void;
  onKeepEditing: () => void;
}) {
  const { t } = useI18n();
  return (
    <section className="od-first-run-helper">
      <div className="od-first-run-helper-head">
        <div>
          <div className="od-aim-kicker">{t("firstRun.eyebrow")}</div>
          <h2>{t("firstRun.heading")}</h2>
          <p>{t("firstRun.body", { aim: shortText(props.title, 120) })}</p>
        </div>
      </div>
      <div className="od-first-run-helper-grid">
        <HelperFact label={t("firstRun.requiredLabel")} value={t("firstRun.requiredValue")} />
        <HelperFact label={t("firstRun.capabilityLabel")} value={helperCapabilityLabel(props.profile, t)} />
        <HelperFact label={t("firstRun.bestHelperLabel")} value={helperPreferenceLabel(props.profile, t)} />
      </div>
      <p className="od-first-run-helper-reason">{helperReason(props.profile, t)}</p>
      <div className="od-aim-intake-actions">
        <button className="od-aim-primary" type="button" onClick={props.onOpenSettings}>
          {t("firstRun.openSettings")}
        </button>
        <button className="od-aim-secondary" type="button" onClick={props.onKeepEditing}>
          {t("firstRun.keepEditing")}
        </button>
      </div>
    </section>
  );
}

function HelperFact(props: { label: string; value: string }) {
  return (
    <div className="od-first-run-helper-fact">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function ContextAimSummaryPanel(props: {
  title: string;
  description: string | undefined | null;
  saved: boolean;
  onEdit?: () => void;
}) {
  const { t } = useI18n();
  const description = props.description?.trim();
  return (
    <section className="od-aim-context-summary">
      <div>
        <div className="od-aim-kicker">{props.saved ? t("shell.savedAim") : t("os.stepContext")}</div>
        <h2>{props.title}</h2>
        <p>{description ? shortText(description, 260) : t("aimContext.noDescription")}</p>
      </div>
      <div className="od-aim-context-actions">
        <span>{t(props.saved ? "aimContext.savedBody" : "aimContext.body")}</span>
        {props.onEdit ? (
          <button className="od-aim-secondary" type="button" onClick={props.onEdit}>
            {t("aimContext.edit")}
          </button>
        ) : null}
      </div>
    </section>
  );
}

function LockedStagePanel(props: {
  eyebrow: string;
  title: string;
  body: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <section style={panelStyle()}>
      <div style={sectionHeaderStyle()}>
        <div>
          <div style={eyebrowStyle()}>{props.eyebrow}</div>
          <h2 style={sectionTitleStyle()}>{props.title}</h2>
        </div>
        <button type="button" onClick={props.onAction} style={{ ...primaryButton(false), marginTop: 0 }}>
          {props.action}
        </button>
      </div>
      <p style={mutedTextStyle()}>{props.body}</p>
    </section>
  );
}

function ComposerPanel(props: {
  title: string;
  description: string;
  parent: { goalId: string; milestoneId: string } | null;
  mode: AppMode;
  disabled: boolean;
  onTitle: (value: string) => void;
  onDescription: (value: string) => void;
  onDraft: () => void;
}) {
  const { t } = useI18n();
  return (
    <section style={panelStyle()}>
      <div style={sectionHeaderStyle()}>
        <div>
          <div style={eyebrowStyle()}>{props.parent ? t("os.subAimMode") : t("os.stepAim")}</div>
          <h2 style={sectionTitleStyle()}>{props.parent ? t("os.subAimHeading") : t("os.composeHeading")}</h2>
        </div>
        <button
          onClick={props.onDraft}
          disabled={props.disabled || !props.title.trim()}
          style={{ ...primaryButton(props.disabled || !props.title.trim()), marginTop: 0 }}
        >
          {props.mode === "contexting" ? t("os.stepContext") : props.mode === "drafting" ? t("os.drafting") : t("os.startPlanning")}
        </button>
      </div>
      <input
        value={props.title}
        onChange={(event) => props.onTitle(event.target.value)}
        placeholder={t("os.aimPlaceholder")}
        style={inputStyle()}
      />
      <textarea
        value={props.description}
        onChange={(event) => props.onDescription(event.target.value)}
        placeholder={t("os.contextPlaceholder")}
        rows={4}
        style={{ ...inputStyle(), marginTop: 10, resize: "vertical" }}
      />
    </section>
  );
}

function ClarifyPanel(props: {
  clarify: ClarifyOutput;
  phase: ClarifyPhase;
  answers: AnswerMap;
  contextNote: string;
  conversationEnabled: boolean;
  questionnaireEnabled: boolean;
  disabled: boolean;
  onAnswer: (id: string, value: { labels: string[]; other: string }) => void;
  onContextNote: (value: string) => void;
  onRefine: () => void;
  onSkip?: () => void;
}) {
  const { t } = useI18n();
  const intake = props.phase === "intake";
  const questions = intake && !props.questionnaireEnabled ? [] : props.clarify.questions;
  const hasQuestionAnswer = Object.values(props.answers).some((answer) => answer.other.trim() || answer.labels.length > 0);
  const hasContextAnswer = (props.conversationEnabled && props.contextNote.trim().length > 0)
    || hasQuestionAnswer;
  const primaryAcceptsDraft = !intake && !hasQuestionAnswer && Boolean(props.onSkip);
  const primaryAction = primaryAcceptsDraft && props.onSkip ? props.onSkip : props.onRefine;
  const primaryLabel = intake ? t("os.generateFromContext") : primaryAcceptsDraft ? t("os.acceptDraft") : t("os.refineDraft");
  const secondaryLabel = hasQuestionAnswer ? t("os.acceptDraft") : t("os.skipRefinement");
  const primaryDisabled = props.disabled || (intake && !hasContextAnswer);
  const body = intake
    ? t("os.contextIntakeBody")
    : questions.length
      ? t("os.clarifyBody")
      : t("os.noQuestionsBody");
  return (
    <section style={panelStyle()}>
      <div style={sectionHeaderStyle()}>
        <div>
          <div style={eyebrowStyle()}>{t(intake ? "os.contextIntakeEyebrow" : "os.draftRefinementEyebrow")}</div>
          <h2 style={sectionTitleStyle()}>
            {intake ? t("os.contextIntakeHeading") : questions.length ? t("os.clarifyHeading") : t("os.noQuestionsHeading")}
          </h2>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {props.onSkip && !primaryAcceptsDraft ? <button onClick={props.onSkip} style={{ ...secondaryButton(), marginTop: 0 }}>{secondaryLabel}</button> : null}
          <button onClick={primaryAction} disabled={primaryDisabled} style={{ ...primaryButton(primaryDisabled), marginTop: 0 }}>
            {primaryLabel}
          </button>
        </div>
      </div>
      <p style={mutedTextStyle()}>{body}</p>
      <div style={{ display: "grid", gap: 12 }}>
        {questions.map((question) => {
          const answer = props.answers[question.id] ?? { labels: [], other: "" };
          const multi = question.selection_mode === "multiple";
          return (
            <div key={question.id} style={questionStyle()}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                <div style={{ fontWeight: 750 }}>{question.question}</div>
                <span style={badgeStyle("#f6f7f7", C.muted)}>{t(multi ? "os.multiSelect" : "os.singleSelect")}</span>
              </div>
              <div style={{ color: C.muted, fontSize: 13, marginTop: 4 }}>{question.why_high_impact}</div>
              <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                {question.options.map((option) => (
                  <button
                    key={option.label}
                    onClick={() => {
                      const selected = answer.labels.includes(option.label);
                      const labels = multi
                        ? selected
                          ? answer.labels.filter((label) => label !== option.label)
                          : [...answer.labels, option.label]
                        : [option.label];
                      props.onAnswer(question.id, { ...answer, labels });
                    }}
                    style={choiceStyle(answer.labels.includes(option.label))}
                  >
                    <strong>{option.label}</strong>
                    <span>{option.tradeoff}</span>
                  </button>
                ))}
              </div>
              <input
                value={answer.other}
                onChange={(event) => props.onAnswer(question.id, { ...answer, other: event.target.value })}
                placeholder={t("os.otherAnswer")}
                style={{ ...inputStyle(), marginTop: 10 }}
              />
            </div>
          );
        })}
        {intake && props.conversationEnabled ? (
          <div style={questionStyle()}>
            <div style={{ fontWeight: 750 }}>{t("os.contextConversation")}</div>
            <div style={{ color: C.muted, fontSize: 13, marginTop: 4 }}>{t("os.contextConversationBody")}</div>
            <textarea
              value={props.contextNote}
              onChange={(event) => props.onContextNote(event.target.value)}
              placeholder={t("os.contextConversationPlaceholder")}
              rows={4}
              style={{ ...inputStyle(), marginTop: 10, resize: "vertical" }}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}

function PlanPanel(props: {
  plan: DecompositionOutput;
  quality: PlanResult["quality"] | null;
  review: PlanResult["review"] | null;
  saved: boolean;
  disabled: boolean;
  validationErrors: string[];
  routingAgents: RoutingRuntimeAgentOption[];
  routingValidation: PlanRoutingValidation | null;
  onChange?: (plan: DecompositionOutput) => void;
  onSave: () => void;
}) {
  const { t } = useI18n();
  const editable = !props.saved && Boolean(props.onChange);
  const [ruleDrafts, setRuleDrafts] = useState<Record<string, string>>({});
  const [ruleErrors, setRuleErrors] = useState<Record<string, string>>({});
  const hasRuleErrors = Object.keys(ruleErrors).length > 0;
  const validation = props.routingValidation ?? validatePlanRouting({ plan: props.plan, agents: props.routingAgents, allowHuman: true });
  const readyAgents = readyRoutingAgents(props.routingAgents);
  const issuesByNode = new Map<string, string[]>();
  for (const issue of validation.issues) {
    const rows = issuesByNode.get(issue.nodeKey) ?? [];
    rows.push(issue.message);
    issuesByNode.set(issue.nodeKey, rows);
  }
  const saveDisabled = props.disabled || hasRuleErrors || props.validationErrors.length > 0 || !validation.ok;

  useEffect(() => {
    const keys = new Set(props.plan.nodes.map((node) => node.key));
    setRuleDrafts((current) => {
      const next: Record<string, string> = {};
      for (const node of props.plan.nodes) {
        next[node.key] = current[node.key] ?? formatAcceptanceRule(node.acceptance_rule);
      }
      return next;
    });
    setRuleErrors((current) => {
      const next: Record<string, string> = {};
      for (const [key, value] of Object.entries(current)) {
        if (keys.has(key)) next[key] = value;
      }
      return next;
    });
  }, [props.plan.nodes]);

  function apply(nextPlan: DecompositionOutput) {
    props.onChange?.(nextPlan);
  }

  function applyStructureEdit(nextPlan: DecompositionOutput) {
    setRuleDrafts({});
    setRuleErrors({});
    apply(nextPlan);
  }

  function updateNode(node: PlanNode, patch: Parameters<typeof updatePlanNode>[2]) {
    apply(updatePlanNode(props.plan, node.key, patch));
  }

  function updateContract(node: PlanNode, patch: Partial<DecompositionContract>) {
    updateNode(node, {
      decomposition_contract: {
        ...editableContractForNode(node),
        ...patch,
      },
    });
  }

  function ruleTextFor(node: PlanNode): string {
    return ruleDrafts[node.key] ?? formatAcceptanceRule(node.acceptance_rule);
  }

  function parseRuleText(text: string): AcceptanceRuleType | string {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
    const parsed = AcceptanceRule.safeParse(value);
    if (!parsed.success) {
      return parsed.error.issues.map((issue) => `${issue.path.join(".") || "rule"}: ${issue.message}`).join("; ");
    }
    return parsed.data;
  }

  function applyRuleText(node: PlanNode, text: string) {
    const parsed = parseRuleText(text);
    if (typeof parsed === "string") {
      setRuleErrors((current) => ({ ...current, [node.key]: t("plan.ruleInvalid", { error: parsed }) }));
      return;
    }
    setRuleErrors((current) => {
      const next = { ...current };
      delete next[node.key];
      return next;
    });
    updateNode(node, { acceptance_rule: parsed });
  }

  function commitRule(node: PlanNode) {
    applyRuleText(node, ruleTextFor(node));
  }

  function applyOverride(node: PlanNode, override: PlanRoutingOverride | null) {
    apply(updatePlanNode(props.plan, node.key, { routing_override: override }));
  }

  function chooseOwner(node: PlanNode, owner: PlanRoutingOwner) {
    applyOverride(node, makeRoutingOverride({ owner, agents: props.routingAgents }));
  }

  function chooseAgent(node: PlanNode, agentId: string) {
    const current = node.routing_override;
    const agent = findRoutingAgent(props.routingAgents, agentId);
    applyOverride(node, makeRoutingOverride({
      owner: "agent",
      agents: props.routingAgents,
      agentId,
      model: agent?.models.some((model) => model.id === current?.model) ? current?.model : firstModel(agent),
    }));
  }

  function chooseModel(node: PlanNode, model: string) {
    const currentAgentId = node.routing_override?.agent_id ?? readyAgents[0]?.id ?? null;
    applyOverride(node, makeRoutingOverride({
      owner: "agent",
      agents: props.routingAgents,
      agentId: currentAgentId,
      model,
    }));
  }

  return (
    <section className="od-stage-panel od-plan-editor">
      <div className="od-stage-panel-head">
        <div>
          <div className="od-stage-kicker">{t("os.stepPlan")}</div>
          <h2>{t("os.planHeading")}</h2>
          <p>{editable ? t("plan.editBody") : t("plan.reviewBody")}</p>
        </div>
        {!props.saved ? (
          <button className="od-aim-primary" type="button" onClick={props.onSave} disabled={saveDisabled}>
            {t("os.saveAim")}
          </button>
        ) : null}
      </div>

      <div className="od-stage-metrics">
        <StageMetric label={t("os.metricSubAims")} value={String(props.plan.nodes.length)} />
        <StageMetric label={t("os.metricQuality")} value={props.quality ? `${props.quality.grade} · ${props.quality.score}` : "-"} />
        <StageMetric label={t("os.metricActions")} value={String(props.review?.actions.length ?? 0)} />
      </div>

      {props.validationErrors.length > 0 ? (
        <div className="od-plan-validation" role="status">
          <strong>{t("plan.validationIssues")}</strong>
          <span>{props.validationErrors.join("; ")}</span>
        </div>
      ) : null}

      {!validation.ok ? (
        <div className="od-routing-alert">
          <strong>{t("routing.validationTitle")}</strong>
          <span>{validation.issues[0]?.message ?? t("routing.validationBody")}</span>
        </div>
      ) : null}

      <div className="od-plan-list">
        {props.plan.nodes.map((node, index) => {
          const contract = editableContractForNode(node);
          const recommendation = routingRecommendationForPlanNode(node);
          const override = node.routing_override;
          const owner = override?.owner ?? recommendation.recommendedOwner;
          const selectedAgent = findRoutingAgent(props.routingAgents, override?.agent_id) ?? readyAgents[0] ?? null;
          const selectedModel = override?.model ?? firstModel(selectedAgent) ?? "";
          const nodeIssues = issuesByNode.get(node.key) ?? [];
          return (
            <article key={node.key} className={`od-plan-card${nodeIssues.length ? " has-warning" : ""}`}>
              <div className="od-plan-card-index">{index + 1}</div>
              <div className="od-plan-card-main">
                <div className="od-plan-card-head">
                  <div className="od-work-title">
                    <strong>{node.title}</strong>
                    <span className="od-pill">{node.acceptance_rule.completion_mode}</span>
                    <span className="od-pill blue">{t("routing.likely", { owner: recommendation.likelyOwner })}</span>
                    <span className="od-pill">{t("routing.recommended", { owner: recommendation.recommendedOwner })}</span>
                    {override ? <span className="od-pill warn">{t("routing.override")}</span> : null}
                  </div>
                  {editable ? (
                    <div className="od-plan-actions">
                      <button type="button" onClick={() => applyStructureEdit(movePlanNode(props.plan, node.key, index - 1))} disabled={index === 0}>
                        {t("plan.moveUp")}
                      </button>
                      <button type="button" onClick={() => applyStructureEdit(movePlanNode(props.plan, node.key, index + 1))} disabled={index >= props.plan.nodes.length - 1}>
                        {t("plan.moveDown")}
                      </button>
                      <button
                        type="button"
                        onClick={() => applyStructureEdit(mergePlanNodes(props.plan, props.plan.nodes[index - 1]!.key, node.key))}
                        disabled={index === 0}
                      >
                        {t("plan.mergeUp")}
                      </button>
                      <button
                        type="button"
                        onClick={() => applyStructureEdit(mergePlanNodes(props.plan, node.key, props.plan.nodes[index + 1]!.key))}
                        disabled={index >= props.plan.nodes.length - 1}
                      >
                        {t("plan.mergeDown")}
                      </button>
                      <button type="button" onClick={() => applyStructureEdit(splitPlanNode(props.plan, node.key))} disabled={props.plan.nodes.length >= 15}>
                        {t("plan.split")}
                      </button>
                    </div>
                  ) : null}
                </div>

                {editable ? (
                  <div className="od-plan-edit-grid">
                    <label className="od-plan-field">
                      <span>{t("subAim.title")}</span>
                      <input value={node.title} onChange={(event) => updateNode(node, { title: event.target.value })} />
                    </label>
                    <label className="od-plan-field">
                      <span>{t("subAim.body")}</span>
                      <textarea
                        value={node.description}
                        onChange={(event) => updateNode(node, { description: event.target.value })}
                        rows={3}
                      />
                    </label>
                    <label className="od-plan-field">
                      <span>{t("plan.contractDone")}</span>
                      <textarea
                        value={contract.definition_of_done}
                        onChange={(event) => updateContract(node, { definition_of_done: event.target.value })}
                        rows={2}
                      />
                    </label>
                    <label className="od-plan-field">
                      <span>{t("plan.contractEvidence")}</span>
                      <textarea
                        value={contract.required_evidence.join("\n")}
                        onChange={(event) => updateContract(node, { required_evidence: evidenceLines(event.target.value) })}
                        rows={2}
                      />
                    </label>
                    <label className="od-plan-field od-plan-field-wide">
                      <span>{t("plan.contractEval")}</span>
                      <input value={contract.eval_signal} onChange={(event) => updateContract(node, { eval_signal: event.target.value })} />
                    </label>
                    <div className="od-plan-field od-plan-field-wide">
                      <div className="od-plan-field-head">
                        <span>{t("plan.acceptanceRule")}</span>
                        <button type="button" onClick={() => commitRule(node)}>
                          {t("plan.applyRule")}
                        </button>
                      </div>
                      <textarea
                        aria-label={t("plan.acceptanceRule")}
                        className="od-plan-rule-input"
                        value={ruleTextFor(node)}
                        onBlur={() => commitRule(node)}
                        onChange={(event) => {
                          const text = event.target.value;
                          setRuleDrafts((current) => ({ ...current, [node.key]: text }));
                          applyRuleText(node, text);
                        }}
                        rows={8}
                        spellCheck={false}
                      />
                      {ruleErrors[node.key] ? <small className="od-plan-error">{ruleErrors[node.key]}</small> : null}
                    </div>
                  </div>
                ) : (
                  <>
                    {node.description ? <p>{shortText(node.description, 220)}</p> : null}
                    <div className="od-work-note">
                      <strong>{t("plan.contractEval")}</strong>
                      <span>{node.decomposition_contract?.eval_signal ?? node.acceptance_rule.clauses.map((clause) => clause.evaluator).join(" + ")}</span>
                    </div>
                  </>
                )}

                <div className="od-routing-rationale">
                  <span>{t("routing.rationale")}</span>
                  <strong>{recommendation.rationale}</strong>
                </div>

                <div className="od-routing-controls" aria-label={t("routing.controls")}>
                  <div className="od-routing-owner" role="group" aria-label={t("routing.owner")}>
                    <button
                      type="button"
                      className={owner === "human" ? "active" : ""}
                      disabled={!editable || props.disabled}
                      onClick={() => chooseOwner(node, "human")}
                    >
                      {t("os.actorHuman")}
                    </button>
                    <button
                      type="button"
                      className={owner === "agent" ? "active" : ""}
                      disabled={!editable || props.disabled}
                      onClick={() => chooseOwner(node, "agent")}
                    >
                      {t("os.actorAgent")}
                    </button>
                  </div>

                  {owner === "agent" ? (
                    <div className="od-routing-selects">
                      <label>
                        <span>{t("routing.agent")}</span>
                        <select
                          value={selectedAgent?.id ?? ""}
                          disabled={!editable || props.disabled || readyAgents.length === 0}
                          onChange={(event) => chooseAgent(node, event.target.value)}
                        >
                          {readyAgents.length === 0 ? <option value="">{t("routing.noAgents")}</option> : null}
                          {readyAgents.map((agent) => (
                            <option key={agent.id} value={agent.id}>{agent.label}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>{t("routing.model")}</span>
                        <select
                          value={selectedModel}
                          disabled={!editable || props.disabled || !selectedAgent || selectedAgent.models.length === 0}
                          onChange={(event) => chooseModel(node, event.target.value)}
                        >
                          {selectedAgent?.models.length ? selectedAgent.models.map((model) => (
                            <option key={model.id} value={model.id}>{model.label ?? model.id}</option>
                          )) : <option value="">{t("routing.noModels")}</option>}
                        </select>
                      </label>
                    </div>
                  ) : null}

                  {override && editable ? (
                    <button
                      className="od-routing-reset"
                      type="button"
                      disabled={props.disabled}
                      onClick={() => applyOverride(node, null)}
                    >
                      {t("routing.useRecommendation")}
                    </button>
                  ) : null}
                </div>

                <div className="od-plan-contract-line">
                  <span>{node.acceptance_rule.completion_mode}</span>
                  <span>{node.acceptance_rule.clauses.map((clause) => clause.evaluator).join(" + ")}</span>
                  {override?.owner === "agent" && override.agent_label ? (
                    <span>{[override.agent_label, override.model_label ?? override.model].filter(Boolean).join(" / ")}</span>
                  ) : null}
                </div>

                {nodeIssues.length ? (
                  <div className="od-routing-issue">{nodeIssues[0]}</div>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ExecutePanel(props: {
  detail: GoalDetail;
  progress: AimProgressReadModel | null;
  disabled: boolean;
  onRunAgent: (milestone: Milestone) => void;
  onConfirm: (milestone: Milestone, submission: Omit<ConfirmMilestoneRequest, "goalId" | "milestoneId">) => Promise<void>;
  onPickFiles: () => Promise<string[]>;
  onBreakDown: (milestone: Milestone) => void;
}) {
  const { t } = useI18n();
  const rows = progressRows(props.detail, props.progress);
  const openRows = rows.filter((row) => !row.completed);
  const agentAssignments = rows.filter((row) => row.assignment?.actor_kind === "agent").length;
  const humanAssignments = rows.filter((row) => row.assignment?.actor_kind === "human").length;
  const [activeProofId, setActiveProofId] = useState<string | null>(null);
  const [proofDrafts, setProofDrafts] = useState<Record<string, EvidenceSubmissionDraft>>({});
  const [pickingFilesFor, setPickingFilesFor] = useState<string | null>(null);

  function proofDraftFor(milestone: Milestone): EvidenceSubmissionDraft {
    return proofDrafts[milestone.id] ?? emptyEvidenceDraft(milestone);
  }

  function updateProofDraft(milestone: Milestone, updater: (draft: EvidenceSubmissionDraft) => EvidenceSubmissionDraft): void {
    setProofDrafts((current) => ({
      ...current,
      [milestone.id]: updater(current[milestone.id] ?? emptyEvidenceDraft(milestone)),
    }));
  }

  function openProof(milestone: Milestone): void {
    setActiveProofId(milestone.id);
    setProofDrafts((current) => current[milestone.id] ? current : { ...current, [milestone.id]: emptyEvidenceDraft(milestone) });
  }

  async function pickProofFiles(milestone: Milestone): Promise<void> {
    setPickingFilesFor(milestone.id);
    try {
      const paths = await props.onPickFiles();
      if (paths.length === 0) return;
      updateProofDraft(milestone, (draft) => ({
        ...draft,
        filePaths: [...new Set([...draft.filePaths, ...paths.map((path) => path.trim()).filter(Boolean)])],
      }));
    } finally {
      setPickingFilesFor(null);
    }
  }

  async function submitProof(milestone: Milestone): Promise<void> {
    const draft = proofDraftFor(milestone);
    if (!evidenceDraftIsSubmittable(draft)) return;
    await props.onConfirm(milestone, evidenceSubmissionPayload(draft));
    setActiveProofId(null);
    setProofDrafts((current) => {
      const next = { ...current };
      delete next[milestone.id];
      return next;
    });
  }

  function actorLabel(row: ProgressMilestoneRow): string {
    const override = routingOverrideForMilestone(row.milestone);
    if (override?.owner === "human") return t("os.actorHuman");
    if (override?.owner === "agent") {
      const agent = override.agent_label || override.agent_id || t("os.actorAgent");
      const model = override.model_label || override.model;
      return model ? `${t("os.actorAgent")} · ${agent} / ${model}` : `${t("os.actorAgent")} · ${agent}`;
    }
    if (!row.assignment) return t("os.unassigned");
    const kind = row.assignment.actor_kind === "human" ? t("os.actorHuman") : t("os.actorAgent");
    const actor = row.assignment.actor_id
      ? props.progress?.actors.find((item) => item.id === row.assignment?.actor_id)
      : null;
    return actor?.display_name ? `${kind} · ${actor.display_name}` : kind;
  }

  function assignmentMeta(row: ProgressMilestoneRow): string {
    if (!row.assignment) return t("os.noAssignment");
    return [row.assignment.status, row.assignment.source].filter(Boolean).join(" · ");
  }

  function latestRunSummary(row: ProgressMilestoneRow): string {
    if (!row.latest_run) return t("os.notStarted");
    return shortText(row.latest_run.summary || row.latest_run.error || t("os.noRun"), 160);
  }

  return (
    <section className="od-stage-panel">
      <div className="od-stage-panel-head">
        <div>
          <div className="od-stage-kicker">{t("os.stepExecute")}</div>
          <h2>{t("os.executeHeading")}</h2>
          <p>{t("os.executeBody")}</p>
        </div>
      </div>

      <div className="od-stage-metrics" aria-label={t("os.executeHeading")}>
        <StageMetric label={t("os.activeWork")} value={String(openRows.length)} />
        <StageMetric label={t("os.agentAssignments")} value={String(agentAssignments)} />
        <StageMetric label={t("os.humanAssignments")} value={String(humanAssignments)} />
      </div>

      <div className="od-work-list">
        {rows.map((row) => (
          <article key={row.milestone.id} className={`od-work-card${row.completed ? " is-complete" : ""}`}>
            <div className="od-work-card-main">
              <div className="od-work-card-head">
                <div className="od-work-title">
                  <strong>{row.milestone.title}</strong>
                  <span className={`od-pill ${row.completed ? "success" : row.blocked ? "danger" : ""}`}>
                    {row.completed ? t("os.done") : row.milestone.status}
                  </span>
                  <span className="od-pill blue">{actorLabel(row)}</span>
                </div>
              </div>

              {row.milestone.description ? <p>{shortText(row.milestone.description, 220)}</p> : null}

              <div className="od-work-detail-grid">
                <div>
                  <span>{t("os.assignment")}</span>
                  <strong>{actorLabel(row)}</strong>
                  <small>{assignmentMeta(row)}</small>
                </div>
                <div>
                  <span>{t("os.latestRun")}</span>
                  <strong>{row.latest_run?.status ?? t("os.noRun")}</strong>
                  <small>{latestRunSummary(row)}</small>
                </div>
              </div>

              {row.assignment?.reason ? <div className="od-work-note">{shortText(row.assignment.reason, 220)}</div> : null}

              {row.child_relations.length ? (
                <div className="od-work-note">
                  <strong>{t("os.childBreakdown", { n: row.child_relations.length })}</strong>
                  <span>{row.child_relations.map((item) => item.status).join(", ")}</span>
                </div>
              ) : null}

              <div className="od-next-work">
                <span>{t("os.nextWork")}</span>
                <strong>{row.next_action || t("shell.noNextAction")}</strong>
              </div>
            </div>

            <div className="od-work-actions">
              <button
                className="od-aim-secondary"
                type="button"
                disabled={props.disabled || row.completed || row.assignment?.actor_kind === "human"}
                onClick={() => props.onRunAgent(row.milestone)}
              >
                {t("os.runAgent")}
              </button>
              <button
                className="od-aim-secondary"
                type="button"
                disabled={props.disabled || row.completed}
                onClick={() => openProof(row.milestone)}
              >
                {t("os.confirmProof")}
              </button>
              <button
                className="od-aim-secondary"
                type="button"
                disabled={props.disabled || row.completed}
                onClick={() => props.onBreakDown(row.milestone)}
              >
                {t("os.breakDown")}
              </button>
            </div>

            {activeProofId === row.milestone.id ? (
              <EvidenceSubmissionForm
                milestone={row.milestone}
                draft={proofDraftFor(row.milestone)}
                disabled={props.disabled}
                pickingFiles={pickingFilesFor === row.milestone.id}
                onChange={(next) => updateProofDraft(row.milestone, () => next)}
                onPickFiles={() => void pickProofFiles(row.milestone)}
                onCancel={() => setActiveProofId(null)}
                onSubmit={() => void submitProof(row.milestone)}
              />
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

export function EvidenceSubmissionForm(props: {
  milestone: Milestone;
  draft: EvidenceSubmissionDraft;
  disabled: boolean;
  pickingFiles: boolean;
  onChange: (draft: EvidenceSubmissionDraft) => void;
  onPickFiles: () => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const { t } = useI18n();
  const hasProof = props.draft.proofNote.trim().length > 0
    || proofUrlsFromDraft(props.draft.url).length > 0
    || props.draft.filePaths.length > 0;
  const requiredOk = props.draft.requiredEvidence.length === 0
    || props.draft.requiredEvidence.some((item) => item.satisfied);
  const canSubmit = hasProof && requiredOk;

  function setRequiredEvidence(text: string, satisfied: boolean): void {
    props.onChange({
      ...props.draft,
      requiredEvidence: props.draft.requiredEvidence.map((item) =>
        item.text === text ? { ...item, satisfied } : item,
      ),
    });
  }

  function removeFile(path: string): void {
    props.onChange({
      ...props.draft,
      filePaths: props.draft.filePaths.filter((item) => item !== path),
    });
  }

  return (
    <form
      className="od-proof-form"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSubmit();
      }}
    >
      <div className="od-proof-head">
        <div>
          <strong>{t("os.proofHeading")}</strong>
          <span>{t("os.proofBody")}</span>
        </div>
        <span className="od-pill">{shortText(props.milestone.title, 48)}</span>
      </div>

      <label className="od-proof-field">
        <span>{t("os.proofNote")}</span>
        <textarea
          value={props.draft.proofNote}
          disabled={props.disabled}
          rows={3}
          placeholder={t("os.proofNotePlaceholder")}
          onChange={(event) => props.onChange({ ...props.draft, proofNote: event.currentTarget.value })}
        />
      </label>

      <label className="od-proof-field">
        <span>{t("os.proofUrl")}</span>
        <textarea
          value={props.draft.url}
          disabled={props.disabled}
          rows={2}
          placeholder={t("os.proofUrlPlaceholder")}
          onChange={(event) => props.onChange({ ...props.draft, url: event.currentTarget.value })}
        />
      </label>

      <div className="od-proof-field">
        <span>{t("os.proofFiles")}</span>
        <div className="od-proof-file-actions">
          <button
            className="od-aim-secondary"
            type="button"
            disabled={props.disabled || props.pickingFiles}
            onClick={props.onPickFiles}
          >
            {props.pickingFiles ? t("os.proofPickingFiles") : t("os.proofAddFiles")}
          </button>
          <small>{t("os.proofFilesHint")}</small>
        </div>
        {props.draft.filePaths.length === 0 ? (
          <div className="od-empty-inline">{t("os.proofNoFiles")}</div>
        ) : (
          <div className="od-proof-file-list">
            {props.draft.filePaths.map((path) => (
              <div key={path} className="od-proof-file-row">
                <span>{path}</span>
                <button
                  type="button"
                  disabled={props.disabled}
                  aria-label={`${t("os.proofRemoveFile")}: ${path}`}
                  onClick={() => removeFile(path)}
                >
                  {t("os.proofRemoveFile")}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <fieldset className="od-proof-required">
        <legend>{t("os.proofRequiredEvidence")}</legend>
        {props.draft.requiredEvidence.length === 0 ? (
          <div className="od-empty-inline">{t("os.proofNoRequiredEvidence")}</div>
        ) : (
          <div className="od-proof-required-list">
            {props.draft.requiredEvidence.map((item) => (
              <label key={item.text} className="od-proof-check-row">
                <input
                  type="checkbox"
                  checked={item.satisfied}
                  disabled={props.disabled}
                  onChange={(event) => setRequiredEvidence(item.text, event.currentTarget.checked)}
                />
                <span>{item.text}</span>
              </label>
            ))}
          </div>
        )}
      </fieldset>

      {!canSubmit ? (
        <div className="od-proof-validation">
          {!hasProof ? t("os.proofNeedsDetail") : t("os.proofNeedsRequired")}
        </div>
      ) : null}

      <div className="od-proof-actions">
        <button className="od-aim-secondary" type="button" disabled={props.disabled} onClick={props.onCancel}>
          {t("common.cancel")}
        </button>
        <button className="od-aim-primary" type="submit" disabled={props.disabled || !canSubmit}>
          {t("os.submitProof")}
        </button>
      </div>
    </form>
  );
}

function EvalPanel(props: {
  detail: GoalDetail;
  progress: AimProgressReadModel | null;
}) {
  const { t } = useI18n();
  const rows = progressRows(props.detail, props.progress);
  const evidenceTotal = rows.reduce((sum, row) => sum + row.evidence_count, 0);
  const evaluatorResults = rows.flatMap((row) => row.evaluator_results);
  const satisfiedRows = rows.filter((row) => evalStateOf(row) === "passed").length;
  const pendingCandidates = props.progress?.context_candidates.filter((candidate) => candidate.status === "pending") ?? [];
  const reviewItems = evaluatorResults.filter((result) => result.status !== "passed").length + pendingCandidates.length;

  function evalLabel(state: EvalState): string {
    switch (state) {
      case "passed":
        return t("os.evalStatus.passed");
      case "failed":
        return t("os.evalStatus.failed");
      case "needs_human":
        return t("os.evalStatus.needsHuman");
      case "unsupported":
        return t("os.evalStatus.unsupported");
      case "error":
        return t("os.evalStatus.error");
      case "pending":
        return t("os.evalStatus.pending");
    }
  }

  return (
    <section className="od-stage-panel od-eval-panel">
      <div className="od-stage-panel-head">
        <div>
          <div className="od-stage-kicker">{t("os.stepEval")}</div>
          <h2>{t("os.evalHeading")}</h2>
          <p>{t("os.evalBody")}</p>
        </div>
      </div>

      <div className="od-stage-metrics" aria-label={t("os.evalHeading")}>
        <StageMetric label={t("os.evalEvidenceTotal")} value={String(evidenceTotal)} />
        <StageMetric label={t("os.evalSatisfied")} value={`${satisfiedRows}/${rows.length}`} />
        <StageMetric label={t("os.evalNeedsReview")} value={String(reviewItems)} />
      </div>

      <div className="od-work-list">
        {rows.map((row) => {
          const state = evalStateOf(row);
          const matchedIds = [...new Set(row.evaluator_results.flatMap((result) => result.matched_evidence_ids))];
          return (
            <article key={row.milestone.id} className={`od-work-card od-eval-card${row.completed ? " is-complete" : ""}`}>
              <div className="od-work-card-main">
                <div className="od-work-card-head">
                  <div className="od-work-title">
                    <strong>{row.milestone.title}</strong>
                    <span className={`od-pill ${evalToneClass(state)}`}>{evalLabel(state)}</span>
                    <span className="od-pill">{t("os.evidenceCount", { n: row.evidence_count })}</span>
                  </div>
                </div>

                <div className="od-work-detail-grid">
                  <div>
                    <span>{t("os.evalRule")}</span>
                    <strong>{row.milestone.acceptance_rule.logic}</strong>
                    <small>{row.milestone.acceptance_rule.completion_mode}</small>
                  </div>
                  <div>
                    <span>{t("os.evalMatchedEvidence")}</span>
                    <strong>{String(matchedIds.length)}</strong>
                    <small>{matchedIds.length ? matchedIds.slice(0, 4).map(shortId).join(", ") : t("os.evalNoMatchedEvidence")}</small>
                  </div>
                </div>

                <div className="od-evaluator-list">
                  {row.evaluator_results.length === 0 ? (
                    <div className="od-empty-inline">{t("os.evalNoResults")}</div>
                  ) : row.evaluator_results.map((result, index) => (
                    <div key={`${result.evaluator}-${index}`} className="od-evaluator-row">
                      <div className="od-evaluator-head">
                        <strong>{result.evaluator}</strong>
                        <span className={`od-pill ${evalToneClass(result.status)}`}>{evalLabel(result.status)}</span>
                      </div>
                      <p>{result.explanation || result.failure_reason || t("os.noEval")}</p>
                      <small>
                        {t("os.evalTrust", { n: formatTrust(result.trust_score) })}
                        {" · "}
                        {t("os.evalMatchedCount", { n: result.matched_evidence_ids.length })}
                        {result.requires_human_confirmation ? ` · ${t("os.evalHumanConfirmation")}` : ""}
                      </small>
                    </div>
                  ))}
                </div>

                <div className="od-evidence-list">
                  <div className="od-evidence-list-head">
                    <strong>{t("os.evalEvidenceItems")}</strong>
                    <span>{t("os.evidenceCount", { n: row.evidence.length })}</span>
                  </div>
                  {row.evidence.length === 0 ? (
                    <div className="od-empty-inline">{t("os.evalNoEvidenceItems")}</div>
                  ) : row.evidence.slice().reverse().slice(0, 4).map((evidence) => (
                    <div key={evidence.id} className="od-evidence-row">
                      <strong>{shortText(evidenceDisplaySummary(evidence), 180)}</strong>
                      <span>{evidenceReferenceMeta(evidence)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <div className="od-eval-context">
        <div className="od-card-head">
          <h3>{t("os.evalPendingCandidates")}</h3>
          <span className="od-pill">{String(pendingCandidates.length)}</span>
        </div>
        {pendingCandidates.length === 0 ? (
          <div className="od-empty-inline">{t("os.evalNoPendingCandidates")}</div>
        ) : (
          <div className="od-eval-context-list">
            {pendingCandidates.slice(0, 6).map((candidate) => (
              <div key={candidate.id} className="od-eval-candidate">
                <strong>{shortText(candidate.content, 160)}</strong>
                <span>
                  {[candidate.category, candidate.source, formatTrust(candidate.confidence)].filter(Boolean).join(" · ")}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function StageMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="od-stage-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SettingsPanel(props: {
  provider: ProviderStatus | null;
  webResearch: WebResearchStatus | null;
  contextSources: ContextSourceStatus | null;
  localAgents: LocalAgentDetection[];
  aimContext: {
    title: string;
    profile: AimHelperProfile;
    runtimeReady: boolean;
  } | null;
  onProvider: (status: ProviderStatus) => void;
  onWeb: (status: WebResearchStatus) => void;
  onContextSources: (status: ContextSourceStatus) => void;
  onRefreshAgents: () => Promise<void>;
  onReturnToAim?: () => void;
}) {
  const { t } = useI18n();
  const providerReady = Boolean(props.provider?.configured);
  const readyLocalAgents = props.localAgents.filter((agent) => agent.available && agent.authStatus !== "missing");
  const availableLocalAgents = props.localAgents.filter((agent) => agent.available);
  const localAgentReady = readyLocalAgents.length > 0;
  const planningReady = providerReady || localAgentReady;
  const webResearchReady = Boolean(props.webResearch?.configured);
  const webResearchEnabled = props.webResearch?.enabled ?? false;
  const contextSourceCount = activeContextSourceCount(props.contextSources);
  const contextReady = contextSourceCount >= 4;
  const contextHasAnySource = contextSourceCount > 0;
  const providerRuntime = [props.provider?.provider, props.provider?.model].filter(Boolean).join(" / ");

  const providerHelper = {
    title: t("settings.helper.provider.title"),
    body: t("settings.helper.provider.body"),
    status: providerReady ? t("intake.ready") : localAgentReady ? t("context.sources.status.optional") : t("os.blocked"),
    tone: providerReady ? "success" : localAgentReady ? "" : "warn",
    next: providerReady
      ? t("settings.provider.next.ready", { provider: providerRuntime || t("settings.provider.saved") })
      : localAgentReady
        ? t("settings.provider.next.optional")
        : t("settings.provider.next.blocked"),
  } satisfies SettingsHelper;

  const localAgentHelper = {
    title: t("settings.helper.local.title"),
    body: t("settings.helper.local.body"),
    status: localAgentReady ? t("intake.ready") : providerReady ? t("context.sources.status.optional") : t("os.blocked"),
    tone: localAgentReady ? "success" : providerReady ? "" : "warn",
    next: localAgentReady
      ? t("settings.local.next.ready", { n: readyLocalAgents.length })
      : availableLocalAgents.length > 0
        ? t("settings.local.next.auth")
        : t("settings.local.next.install"),
  } satisfies SettingsHelper;

  const webResearchHelper = {
    title: t("settings.helper.web.title"),
    body: t("settings.helper.web.body"),
    status: webResearchReady ? t("intake.ready") : webResearchEnabled ? t("os.blocked") : t("context.sources.status.optional"),
    tone: webResearchReady ? "success" : webResearchEnabled ? "warn" : "",
    next: webResearchReady
      ? t("settings.web.next.ready")
      : webResearchEnabled
        ? t("settings.web.next.blocked")
        : t("settings.web.next.optional"),
  } satisfies SettingsHelper;

  const contextHelper = {
    title: t("settings.helper.context.title"),
    body: t("settings.helper.context.body"),
    status: contextReady ? t("intake.ready") : contextHasAnySource ? t("settings.status.partial") : t("os.blocked"),
    tone: contextReady ? "success" : "warn",
    next: contextReady
      ? t("settings.context.next.ready")
      : contextHasAnySource
        ? t("settings.context.next.partial")
        : t("settings.context.next.blocked"),
  } satisfies SettingsHelper;

  const helpers = [providerHelper, localAgentHelper, webResearchHelper, contextHelper];
  const overallNext = !planningReady
    ? t("settings.overall.next.runtime")
    : !contextReady
      ? t("settings.overall.next.context")
      : !webResearchReady
        ? t("settings.overall.next.web")
        : t("settings.overall.next.aim");

  return (
    <section style={panelStyle()}>
      <div className="od-helper-intro">
        <div>
          <div style={eyebrowStyle()}>{t("settings.eyebrow")}</div>
          <h2>{t("settings.heading")}</h2>
          <p>{t("settings.body")}</p>
        </div>
      </div>

      {props.aimContext ? (
        <SettingsAimContextPanel
          title={props.aimContext.title}
          profile={props.aimContext.profile}
          runtimeReady={props.aimContext.runtimeReady}
          onReturnToAim={props.onReturnToAim}
        />
      ) : null}

      <div className="od-helper-callout" data-state={planningReady ? "ready" : "blocked"}>
        <span className={`od-pill ${planningReady ? "success" : "warn"}`}>
          {planningReady ? t("settings.status.readyToPlan") : t("os.blocked")}
        </span>
        <div>
          <span>{t("settings.nextAction")}</span>
          <strong>{overallNext}</strong>
        </div>
        <p>{t("settings.intakeNote")}</p>
      </div>

      <div className="od-helper-readiness" aria-label={t("settings.readinessLabel")}>
        {helpers.map((helper) => (
          <div className="od-helper-row" key={helper.title}>
            <div className="od-helper-row-main">
              <strong>{helper.title}</strong>
              <span>{helper.body}</span>
            </div>
            <span className={`od-pill ${helper.tone}`}>{helper.status}</span>
            <div className="od-helper-row-next">
              <span>{t("settings.nextAction")}</span>
              <strong>{helper.next}</strong>
            </div>
          </div>
        ))}
      </div>

      <SettingsHelperSection helper={providerHelper}>
        <ProviderForm status={props.provider} onSaved={props.onProvider} onClose={() => {}} />
      </SettingsHelperSection>

      <SettingsHelperSection helper={localAgentHelper}>
        <LocalAgentForm agents={props.localAgents} onRefresh={props.onRefreshAgents} />
      </SettingsHelperSection>

      <SettingsHelperSection helper={webResearchHelper}>
        <WebResearchForm status={props.webResearch} onSaved={props.onWeb} />
      </SettingsHelperSection>

      <SettingsHelperSection helper={contextHelper}>
        <ContextSourcesPanel status={props.contextSources} compact onSaved={props.onContextSources} />
      </SettingsHelperSection>
    </section>
  );
}

function SettingsAimContextPanel(props: {
  title: string;
  profile: AimHelperProfile;
  runtimeReady: boolean;
  onReturnToAim?: () => void;
}) {
  const { t } = useI18n();
  return (
    <section className="od-settings-aim-context" data-state={props.runtimeReady ? "ready" : "blocked"}>
      <div className="od-settings-aim-context-main">
        <div className="od-aim-kicker">{t("firstRun.settingsEyebrow")}</div>
        <h3>{shortText(props.title, 140)}</h3>
        <p>{props.runtimeReady ? t("firstRun.settingsReady") : t("firstRun.settingsBlocked")}</p>
      </div>
      <div className="od-first-run-helper-grid">
        <HelperFact label={t("firstRun.capabilityLabel")} value={helperCapabilityLabel(props.profile, t)} />
        <HelperFact label={t("firstRun.bestHelperLabel")} value={helperPreferenceLabel(props.profile, t)} />
      </div>
      <p className="od-first-run-helper-reason">{helperReason(props.profile, t)}</p>
      {props.onReturnToAim ? (
        <button className="od-aim-secondary" type="button" onClick={props.onReturnToAim}>
          {t("firstRun.returnToAim")}
        </button>
      ) : null}
    </section>
  );
}

type SettingsHelperTone = "success" | "warn" | "blue" | "";

interface SettingsHelper {
  title: string;
  body: string;
  status: string;
  tone: SettingsHelperTone;
  next: string;
}

function SettingsHelperSection(props: { helper: SettingsHelper; children: ReactNode }) {
  return (
    <section className="od-helper-section">
      <div className="od-helper-section-head">
        <div>
          <h3>{props.helper.title}</h3>
          <p>{props.helper.body}</p>
        </div>
        <div className="od-helper-section-status">
          <span className={`od-pill ${props.helper.tone}`}>{props.helper.status}</span>
          <span>{props.helper.next}</span>
        </div>
      </div>
      {props.children}
    </section>
  );
}

function activeContextSourceCount(status: ContextSourceStatus | null): number {
  if (!status) return 0;
  const localActive = status.local.configured;
  const onlineActive = status.online.enabled && status.online.enabledCount > 0;
  const webActive = status.research.webEnabled;
  const deepActive = status.research.deepResearch && webActive && localActive;
  const sessionActive = status.userSession.enabled;
  const questionnaireActive = status.questionnaire.enabled;
  return [localActive, onlineActive, webActive, deepActive, sessionActive, questionnaireActive].filter(Boolean).length;
}

function ProgressDonut({ done, total }: { done: number; total: number }) {
  const value = pct(done, total);
  return (
    <div style={donutWrapStyle()}>
      <div style={donutStyle(value)}>
        <div style={donutInnerStyle()}>
          <strong>{value}%</strong>
          <span>{done}/{total}</span>
        </div>
      </div>
    </div>
  );
}

function panelStyle(): CSSProperties {
  return {
    background: "#fff",
    border: "none",
    borderRadius: 0,
    padding: 0,
  };
}

function sectionHeaderStyle(): CSSProperties {
  return {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 16,
    marginBottom: 14,
  };
}

function sectionTitleStyle(): CSSProperties {
  return { margin: "4px 0 0", fontSize: 18, letterSpacing: 0 };
}

function eyebrowStyle(): CSSProperties {
  return {
    color: C.accent,
    fontSize: 11,
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: 0,
  };
}

function mutedTextStyle(): CSSProperties {
  return { color: C.muted, fontSize: 13, lineHeight: 1.45, margin: "4px 0 0" };
}

function questionStyle(): CSSProperties {
  return {
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    padding: 14,
    background: "#fbfbfb",
  };
}

function choiceStyle(active: boolean): CSSProperties {
  return {
    border: `1px solid ${active ? C.accent : C.border}`,
    background: active ? C.accentBg : "#fff",
    borderRadius: 8,
    padding: 12,
    display: "grid",
    gap: 4,
    textAlign: "left",
    color: C.text,
    cursor: "pointer",
  };
}

function badgeStyle(bg: string, fg: string): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 22,
    borderRadius: 999,
    padding: "2px 8px",
    background: bg,
    color: fg,
    fontSize: 12,
    fontWeight: 750,
  };
}

function donutWrapStyle(): CSSProperties {
  return { display: "grid", placeItems: "center", flex: "0 0 auto" };
}

function donutStyle(value: number): CSSProperties {
  return {
    width: 96,
    height: 96,
    borderRadius: "50%",
    background: `conic-gradient(${C.accent} ${value * 3.6}deg, #e7eaed 0deg)`,
    display: "grid",
    placeItems: "center",
  };
}

function donutInnerStyle(): CSSProperties {
  return {
    width: 70,
    height: 70,
    borderRadius: "50%",
    background: "#fff",
    display: "grid",
    placeItems: "center",
    alignContent: "center",
    fontSize: 12,
    color: C.muted,
  };
}
