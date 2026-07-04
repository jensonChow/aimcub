import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

import type { AimIntakeReport, AimProgressReadModel } from "@core/domain";
import type { ClarifyAnswer, ClarifyOutput, ClarifyQuestion, ClarifySelectionMode } from "@core/llm";
import type { ContextCategory, DecompositionOutput, Goal, Milestone } from "@core/types";
import type {
  ClarifyIpcResult,
  ContextSourceStatus,
  GoalDetail,
  LocalAgentDetection,
  PlanningDebugTrace,
  PlanResult,
  ProviderStatus,
  WebResearchStatus,
} from "../shared/ipc";

import { CockpitShell, type CockpitStage } from "./CockpitShell";
import { ContextSourcesPanel } from "./ContextSourcesPanel";
import { I18nProvider, useI18n } from "./i18n";
import { LocalAgentForm } from "./LocalAgentForm";
import { Notice } from "./Notice";
import { mergePlanningDebugTraces } from "./PlanningDebugPanel";
import { ProviderForm } from "./ProviderForm";
import { WebResearchForm } from "./WebResearchForm";
import { C, inputStyle, primaryButton, secondaryButton } from "./styles";

type AppMode = "cockpit" | "contexting" | "drafting" | "answering" | "reviewing" | "settings";
type ClarifyPhase = "intake" | "postDraft" | null;
type AnswerMap = Record<string, { labels: string[]; other: string }>;

function shortText(value: string | undefined | null, max = 120): string {
  const cleaned = (value ?? "").replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1).trim()}…`;
}

function pct(done: number, total: number): number {
  return total <= 0 ? 0 : Math.round((done / total) * 100);
}

function planNodeForMilestone(plan: DecompositionOutput | null | undefined, milestone: Milestone) {
  const key = typeof milestone.metadata?.plan_key === "string" ? milestone.metadata.plan_key : null;
  return plan?.nodes.find((node) => node.key === key) ?? plan?.nodes.find((node) => node.title === milestone.title) ?? null;
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
  const [intakeClarify, setIntakeClarify] = useState<ClarifyOutput | null>(null);
  const [intakeAnswers, setIntakeAnswers] = useState<AnswerMap>({});
  const [clarifyPhase, setClarifyPhase] = useState<ClarifyPhase>(null);
  const [clarify, setClarify] = useState<ClarifyOutput | null>(null);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [contextNote, setContextNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [stageOverride, setStageOverride] = useState<CockpitStage | null>(null);
  const planningRunIdRef = useRef<string | null>(null);

  useEffect(() => {
    void refreshAll();
  }, []);

  function startPlanningRun(): string {
    const runId = createPlanningRunId();
    planningRunIdRef.current = runId;
    return runId;
  }

  function clearPlanningRun() {
    planningRunIdRef.current = null;
  }

  function hasCliPlanningRuntime(): boolean {
    return localAgents.some((agent) => agent.available && agent.authStatus !== "missing");
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
    if (!selected && nextGoals[0]) void openGoal(nextGoals[0]);
    if (!nextProvider?.configured && !nextAgents.some((agent) => agent.available && agent.authStatus !== "missing")) {
      setMode("settings");
      setStageOverride("settings");
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
    clearPlanningRun();
    setIntakeClarify(null);
    setIntakeAnswers({});
    setClarifyPhase(null);
    setClarify(null);
    setAnswers({});
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
    clearPlanningRun();
    setIntakeClarify(null);
    setIntakeAnswers({});
    setClarifyPhase(null);
    setClarify(null);
    setAnswers({});
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
    if (!title) return;
    if (!provider?.configured && !hasCliPlanningRuntime()) {
      setMode("settings");
      setStageOverride("settings");
      return;
    }
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

  async function confirmMilestone(milestone: Milestone) {
    if (!selected) return;
    setBusy(t("os.busy.confirm"));
    setError(null);
    try {
      const nextDetail = await window.aimcub.confirmMilestone({
        goalId: selected.id,
        milestoneId: milestone.id,
        summary: `Confirmed sub-aim: ${milestone.title}`,
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
  const completed = progress?.completed_milestones ?? detail?.milestones.filter((m) => m.status === "completed").length ?? 0;
  const total = progress?.total_milestones ?? detail?.milestones.length ?? 0;
  const hasUnsavedAim = aimTitle.trim().length > 0;
  const activeStage = stageOverride ?? cockpitStageFor(mode, selected, activePlan);

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
      disabled={Boolean(busy)}
      onSave={() => void savePlan()}
    />
  ) : null;

  const executionPanel = selected && detail ? (
    <ExecutionPanel
      detail={detail}
      progress={progress}
      disabled={Boolean(busy)}
      onRunAgent={(milestone) => void runAgent(milestone)}
      onConfirm={(milestone) => void confirmMilestone(milestone)}
      onBreakDown={breakDown}
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
          {clarifyPanel}
        </>
      );
    }
    if (activeStage === "contracts") {
      return planPanel ?? (
        <LockedStagePanel
          eyebrow={t("os.stepPlan")}
          title={t("cockpit.contractsLockedTitle")}
          body={t("cockpit.contractsLockedBody")}
          action={t("cockpit.next.context")}
          onAction={() => openCockpitStage("context")}
        />
      );
    }
    if (activeStage === "run" || activeStage === "eval") {
      return executionPanel ?? planPanel ?? (
        <LockedStagePanel
          eyebrow={activeStage === "eval" ? t("os.stepEval") : t("os.stepExecute")}
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
  onTitle: (value: string) => void;
  onDescription: (value: string) => void;
  onDraft: () => void;
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
    </section>
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
  onSave: () => void;
}) {
  const { t } = useI18n();
  return (
    <section style={panelStyle()}>
      <div style={sectionHeaderStyle()}>
        <div>
          <div style={eyebrowStyle()}>{t("os.stepPlan")}</div>
          <h2 style={sectionTitleStyle()}>{t("os.planHeading")}</h2>
        </div>
        {!props.saved ? (
          <button onClick={props.onSave} disabled={props.disabled} style={{ ...primaryButton(props.disabled), marginTop: 0 }}>
            {t("os.saveAim")}
          </button>
        ) : null}
      </div>
      <div style={scoreRowStyle()}>
        <Metric label={t("os.metricSubAims")} value={String(props.plan.nodes.length)} />
        <Metric label={t("os.metricQuality")} value={props.quality ? `${props.quality.grade} · ${props.quality.score}` : "-"} />
        <Metric label={t("os.metricActions")} value={String(props.review?.actions.length ?? 0)} />
      </div>
      <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
        {props.plan.nodes.map((node, index) => (
          <div key={node.key} style={nodeCardStyle()}>
            <div style={{ ...badgeStyle("#eef6f8", C.accent) }}>{index + 1}</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 800 }}>{node.title}</div>
              <div style={mutedTextStyle()}>{shortText(node.description, 180)}</div>
              <div style={contractLineStyle()}>
                <span>{node.decomposition_contract?.likely_owner ?? "either"}</span>
                <span>{node.acceptance_rule.completion_mode}</span>
                <span>{node.acceptance_rule.clauses.map((clause) => clause.evaluator).join(" + ")}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ExecutionPanel(props: {
  detail: GoalDetail;
  progress: AimProgressReadModel | null;
  disabled: boolean;
  onRunAgent: (milestone: Milestone) => void;
  onConfirm: (milestone: Milestone) => void;
  onBreakDown: (milestone: Milestone) => void;
}) {
  const { t } = useI18n();
  const rows = props.progress?.milestones ?? props.detail.milestones.map((milestone) => ({
    milestone,
    assignment: null,
    latest_run: null,
    child_relations: [],
    evaluator_results: [],
    evidence_count: 0,
    completed: milestone.status === "completed",
    blocked: milestone.status === "blocked",
    next_action: "",
  }));
  return (
    <section style={panelStyle()}>
      <div style={sectionHeaderStyle()}>
        <div>
          <div style={eyebrowStyle()}>{t("os.stepExecute")}</div>
          <h2 style={sectionTitleStyle()}>{t("os.executeHeading")}</h2>
        </div>
        <div style={{ color: C.muted, fontSize: 13 }}>{props.progress?.next_action}</div>
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        {rows.map((row) => (
          <div key={row.milestone.id} style={executionCardStyle(row.completed)}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <strong>{row.milestone.title}</strong>
                  <span style={badgeStyle(row.completed ? "#eef8ef" : "#f2f3f4", row.completed ? "#2f7d45" : C.muted)}>
                    {row.completed ? t("os.done") : row.milestone.status}
                  </span>
                  <span style={badgeStyle("#f4f0e6", "#7b5b12")}>{row.assignment?.actor_kind ?? "unassigned"}</span>
                </div>
                <div style={mutedTextStyle()}>{shortText(row.milestone.description, 180)}</div>
                <div style={contractLineStyle()}>
                  <span>{t("os.evidenceCount", { n: row.evidence_count })}</span>
                  <span>{row.latest_run?.status ?? t("os.noRun")}</span>
                  <span>{row.evaluator_results.map((result) => `${result.evaluator}:${result.status}`).join(" · ") || t("os.noEval")}</span>
                </div>
                {row.child_relations.length ? (
                  <div style={{ color: C.accent, fontSize: 12, marginTop: 6 }}>
                    {t("os.childAims", { n: row.child_relations.length })} · {row.child_relations.map((item) => item.status).join(", ")}
                  </div>
                ) : null}
                <div style={{ color: C.muted, fontSize: 12, marginTop: 6 }}>{row.next_action}</div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap", justifyContent: "flex-end" }}>
                <button
                  disabled={props.disabled || row.completed}
                  onClick={() => props.onRunAgent(row.milestone)}
                  style={{ ...secondaryButton(), marginTop: 0 }}
                >
                  {t("os.runAgent")}
                </button>
                <button
                  disabled={props.disabled || row.completed}
                  onClick={() => props.onConfirm(row.milestone)}
                  style={{ ...secondaryButton(), marginTop: 0 }}
                >
                  {t("os.confirm")}
                </button>
                <button
                  disabled={props.disabled || row.completed}
                  onClick={() => props.onBreakDown(row.milestone)}
                  style={{ ...secondaryButton(), marginTop: 0 }}
                >
                  {t("os.breakDown")}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function SettingsPanel(props: {
  provider: ProviderStatus | null;
  webResearch: WebResearchStatus | null;
  contextSources: ContextSourceStatus | null;
  localAgents: LocalAgentDetection[];
  onProvider: (status: ProviderStatus) => void;
  onWeb: (status: WebResearchStatus) => void;
  onContextSources: (status: ContextSourceStatus) => void;
  onRefreshAgents: () => Promise<void>;
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={metricStyle()}>
      <span>{label}</span>
      <strong>{value}</strong>
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

function scoreRowStyle(): CSSProperties {
  return { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 };
}

function metricStyle(): CSSProperties {
  return {
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    padding: "10px 12px",
    background: "#fff",
    display: "grid",
    gap: 4,
  };
}

function nodeCardStyle(): CSSProperties {
  return {
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    padding: 12,
    display: "grid",
    gridTemplateColumns: "32px minmax(0, 1fr)",
    gap: 12,
    background: "#fff",
  };
}

function executionCardStyle(done: boolean): CSSProperties {
  return {
    border: `1px solid ${done ? "#b7dfc0" : C.border}`,
    borderRadius: 8,
    padding: 14,
    background: done ? "#fbfffb" : "#fff",
  };
}

function contractLineStyle(): CSSProperties {
  return {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    color: C.muted,
    fontSize: 12,
    marginTop: 8,
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
