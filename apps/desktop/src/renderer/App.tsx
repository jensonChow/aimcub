import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import type { AimIntakeReport, AimProgressReadModel } from "@core/domain";
import type { ClarifyAnswer, ClarifyOutput, ClarifyQuestion, ClarifySelectionMode } from "@core/llm";
import type { ContextCategory, DecompositionOutput, Goal, Memory, Milestone } from "@core/types";
import type {
  ClarifyIpcResult,
  GoalDetail,
  LocalAgentDetection,
  PlanningDebugTrace,
  PlanningLiveEvent,
  PlanResult,
  ProviderStatus,
  WebResearchStatus,
} from "../shared/ipc";

import { ContextInbox } from "./ContextInbox";
import { I18nProvider, useI18n } from "./i18n";
import { LangToggle } from "./LangToggle";
import { LocalAgentForm } from "./LocalAgentForm";
import { Notice } from "./Notice";
import { mergePlanningDebugTraces, PlanningDebugPanel } from "./PlanningDebugPanel";
import { ProviderForm } from "./ProviderForm";
import { WebResearchForm } from "./WebResearchForm";
import { C, inputStyle, primaryButton, secondaryButton } from "./styles";

type AppMode = "cockpit" | "contexting" | "drafting" | "answering" | "reviewing" | "settings";
type ClarifyPhase = "intake" | "postDraft" | null;
type AnswerMap = Record<string, { labels: string[]; other: string }>;

const shell: CSSProperties = {
  width: "100%",
  height: "100vh",
  minHeight: "100vh",
  overflow: "hidden",
  background: "#f6f7f7",
  color: C.text,
  fontFamily:
    'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
};

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
          { label: "需要你决策", tradeoff: "关键选择会保留给人。" },
          { label: "需要外部资源", tradeoff: "计划会先处理 access 或素材。" },
        ];
      case "project_fact":
        return [
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
        { label: "You must decide", tradeoff: "Key decisions should stay human-owned." },
        { label: "External resource needed", tradeoff: "Access, assets, or vendors become prerequisites." },
      ];
    case "project_fact":
      return [
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
      why_high_impact: question.reason,
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
      selection_mode: intakeQuestionSelectionMode(question.category),
      options: intakeOptions(question.category, zh),
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
  const [contextCandidates, setContextCandidates] = useState<Memory[]>([]);
  const [provider, setProvider] = useState<ProviderStatus | null>(null);
  const [webResearch, setWebResearch] = useState<WebResearchStatus | null>(null);
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
  const [showSettings, setShowSettings] = useState(false);
  const planningRunIdRef = useRef<string | null>(null);

  useEffect(() => {
    void refreshAll();
  }, []);

  useEffect(() => window.aimcub.onPlanningLiveEvent((event) => {
    const activeRunId = planningRunIdRef.current;
    if (!activeRunId || event.runId !== activeRunId) return;
    setPlanningLiveEvents((current) => [...current, event].slice(-80));
  }), []);

  function startPlanningRun(): string {
    const runId = createPlanningRunId();
    planningRunIdRef.current = runId;
    setPlanningLiveEvents([]);
    return runId;
  }

  function clearPlanningRun() {
    planningRunIdRef.current = null;
    setPlanningLiveEvents([]);
  }

  function hasCliPlanningRuntime(): boolean {
    return localAgents.some((agent) => agent.available && agent.authStatus !== "missing");
  }

  async function refreshAll() {
    const [nextGoals, nextProvider, nextWeb, nextAgents, nextCandidates] = await Promise.all([
      window.aimcub.listGoals().catch(() => []),
      window.aimcub.getProviderConfig().catch(() => null),
      window.aimcub.getWebResearchConfig().catch(() => null),
      window.aimcub.listLocalAgents().catch(() => []),
      window.aimcub.listContextCandidates().catch(() => []),
    ]);
    setGoals(nextGoals);
    setProvider(nextProvider);
    setWebResearch(nextWeb);
    setLocalAgents(nextAgents);
    setContextCandidates(nextCandidates);
    if (!selected && nextGoals[0]) void openGoal(nextGoals[0]);
    if (!nextProvider?.configured && !nextAgents.some((agent) => agent.available && agent.authStatus !== "missing")) setShowSettings(true);
  }

  async function openGoal(goal: Goal) {
    setSelected(goal);
    setMode("cockpit");
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
      setShowSettings(true);
      setMode("settings");
      return;
    }
    setError(null);
    try {
      if (!options.skipIntakeGate) {
        setBusy(t("os.busy.context"));
        setMode("contexting");
        const intake = await window.aimcub.intake({ title, description: aimDescription.trim() || undefined });
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
      setPlanningDebugTraces([]);
      const runId = startPlanningRun();
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
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setMode("cockpit");
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
      setContextCandidates(saved.contextCandidates ?? []);
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
      const [nextDetail, nextProgress, nextCandidates] = await Promise.all([
        window.aimcub.getGoal(selected.id),
        window.aimcub.getAimProgress(selected.id),
        window.aimcub.listContextCandidates(),
      ]);
      setDetail(nextDetail);
      setProgress(nextProgress);
      setContextCandidates(nextCandidates);
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
      const [nextProgress, nextCandidates] = await Promise.all([
        window.aimcub.getAimProgress(selected.id),
        window.aimcub.listContextCandidates(),
      ]);
      setDetail(nextDetail);
      setProgress(nextProgress);
      setContextCandidates(nextCandidates);
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
  }

  async function acceptContext(candidate: Memory, content: string, scope: "aim" | "global") {
    await window.aimcub.acceptContextCandidate({ id: candidate.id, content, scope });
    setContextCandidates(await window.aimcub.listContextCandidates());
  }

  async function rejectContext(candidate: Memory) {
    await window.aimcub.rejectContextCandidate(candidate.id);
    setContextCandidates(await window.aimcub.listContextCandidates());
  }

  const activePlan = (finalPlan ?? draft ?? detail?.goal.plan_json ?? null) as DecompositionOutput | null;
  const completed = progress?.completed_milestones ?? detail?.milestones.filter((m) => m.status === "completed").length ?? 0;
  const total = progress?.total_milestones ?? detail?.milestones.length ?? 0;

  return (
    <div style={shell}>
      <div style={layoutStyle()}>
        <aside style={sidebarStyle()}>
          <div style={brandRowStyle()}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 18 }}>Aimcub</div>
              <div style={{ color: C.muted, fontSize: 12 }}>{t("os.tagline")}</div>
            </div>
            <LangToggle />
          </div>

          <button
            style={{ ...primaryButton(false), width: "100%", marginTop: 8 }}
            onClick={() => {
              resetComposer();
              setMode("cockpit");
            }}
          >
            {t("os.newAim")}
          </button>

          <div style={{ marginTop: 20, color: C.muted, fontSize: 12, fontWeight: 700 }}>{t("os.savedAims")}</div>
          <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
            {goals.length === 0 ? <div style={emptySmallStyle()}>{t("os.noAims")}</div> : null}
            {goals.map((goal) => (
              <button
                key={goal.id}
                onClick={() => void openGoal(goal)}
                style={goalButtonStyle(selected?.id === goal.id)}
              >
                <span style={{ fontWeight: 700 }}>{shortText(goal.title, 42)}</span>
                <span style={{ color: C.muted, fontSize: 12 }}>{goal.status}</span>
              </button>
            ))}
          </div>

          <button
            style={{ ...secondaryButton(), width: "100%", marginTop: 18 }}
            onClick={() => {
              setShowSettings((value) => !value);
              setMode("settings");
            }}
          >
            {provider?.configured ? t("os.settings") : t("os.setupProvider")}
          </button>
        </aside>

        <main style={mainStyle()}>
          {error ? <Notice tone="error">{error}</Notice> : null}
          {busy ? <Notice tone="info">{busy}</Notice> : null}

          <section style={heroPanelStyle()}>
            <div>
              <div style={eyebrowStyle()}>{t("os.flow")}</div>
              <h1 style={{ margin: "6px 0 8px", fontSize: 30, letterSpacing: 0 }}>
                {selected ? selected.title : parent ? t("os.breakdownTitle") : t("os.heroTitle")}
              </h1>
              <p style={{ margin: 0, color: C.muted, maxWidth: 680, lineHeight: 1.55 }}>
                {selected ? shortText(selected.description || progress?.next_action || t("os.heroBody"), 220) : t("os.heroBody")}
              </p>
            </div>
            <ProgressDonut done={completed} total={total} />
          </section>

          <FlowRail mode={mode} hasDraft={Boolean(draft)} hasPlan={Boolean(finalPlan)} saved={Boolean(selected)} />

          {!selected || draft ? (
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
          ) : null}

          {clarify && (mode === "contexting" || mode === "answering" || mode === "reviewing") ? (
            <ClarifyPanel
              clarify={clarify}
              phase={clarifyPhase}
              answers={clarifyPhase === "intake" ? intakeAnswers : answers}
              contextNote={contextNote}
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
          ) : null}

          {activePlan ? (
            <PlanPanel
              plan={activePlan}
              quality={planResult?.quality ?? null}
              review={planResult?.review ?? null}
              saved={Boolean(selected)}
              disabled={Boolean(busy)}
              onSave={() => void savePlan()}
            />
          ) : null}

          {selected && detail ? (
            <ExecutionPanel
              detail={detail}
              progress={progress}
              disabled={Boolean(busy)}
              onRunAgent={(milestone) => void runAgent(milestone)}
              onConfirm={(milestone) => void confirmMilestone(milestone)}
              onBreakDown={breakDown}
            />
          ) : null}

          {showSettings || mode === "settings" ? (
            <SettingsPanel
              provider={provider}
              webResearch={webResearch}
              localAgents={localAgents}
              onProvider={setProvider}
              onWeb={setWebResearch}
              onRefreshAgents={async () => setLocalAgents(await window.aimcub.listLocalAgents())}
            />
          ) : null}
        </main>

        <aside style={rightRailStyle()}>
          <PlanningDebugPanel
            mode={mode}
            busy={busy}
            provider={provider}
            planResult={planResult}
            debugTraces={planningDebugTraces}
            liveEvents={planningLiveEvents}
            intakeClarify={intakeClarify}
            intakeAnswers={builtIntakeAnswers}
            clarify={clarifyPhase === "postDraft" ? clarify : null}
            clarifyAnswers={builtAnswers}
            contextNote={contextNote}
            plan={activePlan}
            detail={detail}
          />
          <ContextInbox candidates={contextCandidates} onAccept={acceptContext} onReject={rejectContext} />
          <RuntimePanel
            provider={provider}
            webResearch={webResearch}
            localAgents={localAgents}
            progress={progress}
            contextCount={contextCandidates.length}
          />
        </aside>
      </div>
    </div>
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
  disabled: boolean;
  onAnswer: (id: string, value: { labels: string[]; other: string }) => void;
  onContextNote: (value: string) => void;
  onRefine: () => void;
  onSkip?: () => void;
}) {
  const { t } = useI18n();
  const questions = props.clarify.questions;
  const intake = props.phase === "intake";
  const hasContextAnswer = !intake
    || props.contextNote.trim().length > 0
    || Object.values(props.answers).some((answer) => answer.other.trim() || answer.labels.length > 0);
  const primaryDisabled = props.disabled || !hasContextAnswer;
  return (
    <section style={panelStyle()}>
      <div style={sectionHeaderStyle()}>
        <div>
          <div style={eyebrowStyle()}>{t("os.stepContext")}</div>
          <h2 style={sectionTitleStyle()}>
            {intake ? t("os.contextIntakeHeading") : questions.length ? t("os.clarifyHeading") : t("os.noQuestionsHeading")}
          </h2>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {props.onSkip ? <button onClick={props.onSkip} style={{ ...secondaryButton(), marginTop: 0 }}>{t("os.useDraft")}</button> : null}
          <button onClick={props.onRefine} disabled={primaryDisabled} style={{ ...primaryButton(primaryDisabled), marginTop: 0 }}>
            {intake ? t("os.generateFromContext") : t("os.refine")}
          </button>
        </div>
      </div>
      {intake ? <p style={mutedTextStyle()}>{t("os.contextIntakeBody")}</p> : null}
      {questions.length === 0 ? <p style={mutedTextStyle()}>{t("os.noQuestionsBody")}</p> : null}
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
        {intake ? (
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
  localAgents: LocalAgentDetection[];
  onProvider: (status: ProviderStatus) => void;
  onWeb: (status: WebResearchStatus) => void;
  onRefreshAgents: () => Promise<void>;
}) {
  const { t } = useI18n();
  return (
    <section style={panelStyle()}>
      <div style={sectionHeaderStyle()}>
        <div>
          <div style={eyebrowStyle()}>{t("os.runtime")}</div>
          <h2 style={sectionTitleStyle()}>{t("os.settingsHeading")}</h2>
        </div>
      </div>
      <ProviderForm status={props.provider} onSaved={props.onProvider} onClose={() => {}} />
      <div style={{ height: 12 }} />
      <WebResearchForm status={props.webResearch} onSaved={props.onWeb} />
      <div style={{ height: 12 }} />
      <LocalAgentForm agents={props.localAgents} onRefresh={props.onRefreshAgents} />
    </section>
  );
}

function RuntimePanel(props: {
  provider: ProviderStatus | null;
  webResearch: WebResearchStatus | null;
  localAgents: LocalAgentDetection[];
  progress: AimProgressReadModel | null;
  contextCount: number;
}) {
  const { t } = useI18n();
  return (
    <section style={rightPanelStyle()}>
      <div style={eyebrowStyle()}>{t("os.runtime")}</div>
      <h2 style={sectionTitleStyle()}>{t("os.runtimeHeading")}</h2>
      <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
        <Metric
          label={t("os.provider")}
          value={props.provider?.configured
            ? props.provider.provider ?? "configured"
            : props.localAgents.some((agent) => agent.available && agent.authStatus !== "missing")
              ? "local CLI"
              : t("os.missing")}
        />
        <Metric label={t("os.webResearch")} value={props.webResearch?.enabled ? "on" : "off"} />
        <Metric label={t("os.localAgents")} value={`${props.localAgents.filter((agent) => agent.available).length}/${props.localAgents.length}`} />
        <Metric label={t("os.pendingContext")} value={String(props.contextCount)} />
        <Metric label={t("os.blocked")} value={String(props.progress?.blocked_count ?? 0)} />
      </div>
    </section>
  );
}

function FlowRail(props: { mode: AppMode; hasDraft: boolean; hasPlan: boolean; saved: boolean }) {
  const { t } = useI18n();
  const steps = [
    { label: t("os.stepAim"), active: !props.hasDraft && !props.saved },
    { label: t("os.stepContext"), active: props.mode === "contexting" || props.mode === "answering" },
    { label: t("os.stepPlan"), active: props.hasPlan && !props.saved },
    { label: t("os.stepExecute"), active: props.saved },
    { label: t("os.stepEval"), active: props.saved },
  ];
  return (
    <section style={flowRailStyle()}>
      {steps.map((step, index) => (
        <div key={step.label} style={flowStepStyle(step.active)}>
          <div style={flowNumberStyle(step.active)}>{index + 1}</div>
          <span>{step.label}</span>
        </div>
      ))}
    </section>
  );
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

function layoutStyle(): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: "280px minmax(0, 1fr) 320px",
    gap: 16,
    width: "100%",
    height: "100%",
    minHeight: 0,
    padding: 16,
    boxSizing: "border-box",
  };
}

function sidebarStyle(): CSSProperties {
  return {
    background: "#fff",
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    padding: 16,
    height: "100%",
    minHeight: 0,
    boxSizing: "border-box",
    overflow: "auto",
  };
}

function mainStyle(): CSSProperties {
  return {
    minWidth: 0,
    minHeight: 0,
    display: "grid",
    alignContent: "start",
    gap: 14,
    overflowY: "auto",
    paddingRight: 2,
  };
}

function rightRailStyle(): CSSProperties {
  return {
    display: "grid",
    alignContent: "start",
    gap: 14,
    height: "100%",
    minHeight: 0,
    overflow: "auto",
  };
}

function brandRowStyle(): CSSProperties {
  return { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12 };
}

function heroPanelStyle(): CSSProperties {
  return {
    background: "#fff",
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    padding: 22,
    display: "flex",
    justifyContent: "space-between",
    gap: 20,
    alignItems: "center",
  };
}

function panelStyle(): CSSProperties {
  return {
    background: "#fff",
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    padding: 18,
  };
}

function rightPanelStyle(): CSSProperties {
  return {
    ...panelStyle(),
    marginBottom: 0,
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

function goalButtonStyle(active: boolean): CSSProperties {
  return {
    display: "grid",
    gap: 4,
    textAlign: "left",
    padding: 12,
    borderRadius: 8,
    border: `1px solid ${active ? C.accent : C.border}`,
    background: active ? C.accentBg : "#fff",
    color: C.text,
    cursor: "pointer",
  };
}

function emptySmallStyle(): CSSProperties {
  return { padding: 12, border: `1px dashed ${C.border}`, borderRadius: 8, color: C.muted, fontSize: 13 };
}

function flowRailStyle(): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
    gap: 8,
  };
}

function flowStepStyle(active: boolean): CSSProperties {
  return {
    background: active ? C.accentBg : "#fff",
    border: `1px solid ${active ? C.accent : C.border}`,
    borderRadius: 8,
    padding: 10,
    display: "flex",
    alignItems: "center",
    gap: 8,
    color: active ? C.accent : C.muted,
    fontSize: 13,
    fontWeight: 700,
    minWidth: 0,
  };
}

function flowNumberStyle(active: boolean): CSSProperties {
  return {
    width: 20,
    height: 20,
    borderRadius: 999,
    display: "grid",
    placeItems: "center",
    background: active ? C.accent : "#eef0f2",
    color: active ? "#fff" : C.muted,
    fontSize: 11,
    flex: "0 0 auto",
  };
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
