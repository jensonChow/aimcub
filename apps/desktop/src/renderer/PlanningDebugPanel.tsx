import type { CSSProperties, ReactNode } from "react";

import type { DecompositionOutput, Goal } from "@core/types";

import type { GoalDetail, PlanResult, PlanningDebugTrace, PlanningToolIpcTrace, ProviderStatus } from "../shared/ipc";
import { useI18n, type StringKey } from "./i18n";
import {
  aimIntakeOf,
  contextCategoryLabel,
  planOf,
  planQualityOf,
  planQualityRetryOf,
  planningContextOf,
  planningDebugTraceOf,
  planningToolsOf,
  qualityTone,
  reviewOf,
  shortUiText,
} from "./labels";
import { C } from "./styles";

type AppMode = "cockpit" | "drafting" | "answering" | "reviewing" | "settings";
type T = (key: StringKey, vars?: Record<string, string | number>) => string;

export function mergePlanningDebugTraces(
  traces: Array<PlanningDebugTrace | null | undefined>,
): PlanningDebugTrace | null {
  const valid = traces.filter((trace): trace is PlanningDebugTrace => Boolean(trace));
  if (valid.length === 0) return null;
  if (valid.length === 1) return valid[0]!;

  const starts = valid.map((trace) => Date.parse(trace.startedAt)).filter((ms) => Number.isFinite(ms));
  const finishes = valid.map((trace) => Date.parse(trace.finishedAt)).filter((ms) => Number.isFinite(ms));
  const startedAtMs = starts.length > 0 ? Math.min(...starts) : Date.now();
  const finishedAtMs = finishes.length > 0 ? Math.max(...finishes) : startedAtMs;

  return {
    version: 1,
    stage: "planning",
    startedAt: new Date(startedAtMs).toISOString(),
    finishedAt: new Date(finishedAtMs).toISOString(),
    durationMs: Math.max(0, finishedAtMs - startedAtMs),
    modelRuns: valid.flatMap((trace) => trace.modelRuns),
  };
}

export function PlanningDebugPanel(props: {
  mode: AppMode;
  busy: string | null;
  provider: ProviderStatus | null;
  planResult: PlanResult | null;
  debugTraces: PlanningDebugTrace[];
  plan: DecompositionOutput | null;
  detail: GoalDetail | null;
}) {
  const { t } = useI18n();
  const goal = props.detail?.goal ?? null;
  const liveTrace = props.debugTraces.length > 0
    ? mergePlanningDebugTraces(props.debugTraces)
    : props.planResult?.debugTrace ?? null;
  const trace = liveTrace ?? (goal ? planningDebugTraceOf(goal) : null);
  const plan = props.plan ?? (goal ? planOf(goal) : null);
  const intake = props.planResult?.intake ?? (goal ? aimIntakeOf(goal) : null);
  const quality = props.planResult?.quality ?? (goal ? planQualityOf(goal) : null);
  const qualityRetry = props.planResult?.qualityRetry ?? (goal ? planQualityRetryOf(goal) : null);
  const review = props.planResult?.review ?? (goal ? reviewOf(goal) : null);
  const planningContext = props.planResult?.planningContext ?? (goal ? planningContextOf(goal) : null);
  const planningTools = props.planResult?.planningTools ?? (goal ? planningToolsOf(goal) : null);
  const running = Boolean(props.busy) && (props.mode === "drafting" || props.mode === "answering" || props.mode === "reviewing");

  return (
    <section style={panelStyle()}>
      <div style={headerStyle()}>
        <div>
          <div style={eyebrowStyle()}>{t("shell.inspector")}</div>
          <h2 style={titleStyle()}>{t("trace.title")}</h2>
        </div>
        {running ? <span style={pillStyle(C.accent)}>{t("debug.pending")}</span> : null}
      </div>

      {!trace && !planningContext && !planningTools && !plan ? (
        <p style={mutedTextStyle()}>{t("debug.noTrace")}</p>
      ) : null}

      {running ? <PendingSteps mode={props.mode} provider={props.provider} t={t} /> : null}
      <ModelRunsSection trace={trace} t={t} />
      <ContextCollectionSection
        intake={intake}
        planningContext={planningContext}
        planningTools={planningTools}
        t={t}
      />
      <StructuredReasoningSection
        goal={goal}
        plan={plan}
        quality={quality}
        qualityRetry={qualityRetry}
        review={review}
        t={t}
      />
    </section>
  );
}

function PendingSteps(props: { mode: AppMode; provider: ProviderStatus | null; t: T }) {
  const providerName = props.provider?.provider ?? "provider";
  const rows = [
    { title: props.t("trace.intake"), body: props.t("trace.intakePending") },
    { title: props.t("trace.context"), body: props.t("trace.contextPending") },
    { title: props.t("trace.draft"), body: props.t("trace.draftPending", { provider: providerName }) },
    {
      title: props.t("trace.clarify"),
      body: props.mode === "answering" || props.mode === "reviewing"
        ? props.t("trace.clarifyRunning")
        : props.t("trace.clarifyPending"),
    },
  ];
  return (
    <div style={sectionStyle()}>
      {rows.map((row) => (
        <div key={row.title} style={pendingRowStyle()}>
          <span style={dotStyle()} />
          <div style={{ minWidth: 0 }}>
            <div style={rowTitleStyle()}>{row.title}</div>
            <div style={mutedTextStyle()}>{row.body}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ModelRunsSection(props: { trace: PlanningDebugTrace | null; t: T }) {
  const runs = props.trace?.modelRuns ?? [];
  return (
    <Section title={props.t("debug.modelRuns")}>
      {runs.length === 0 ? <div style={mutedTextStyle()}>{props.t("debug.noModelRuns")}</div> : null}
      {runs.map((run) => (
        <div key={run.id} style={debugRowStyle()}>
          <div style={rowHeaderStyle()}>
            <strong style={{ minWidth: 0 }}>{run.stage} / {run.task}</strong>
            <span style={pillStyle(run.status === "ok" ? "#1a7f4b" : C.danger)}>
              {props.t(run.status === "ok" ? "debug.ok" : "debug.error")}
            </span>
          </div>
          <div style={metaLineStyle()}>
            {run.model ?? "model"} · {props.t("debug.duration", { ms: run.durationMs })}
          </div>
          <div style={metaLineStyle()}>
            {props.t("debug.promptSize", { prompt: run.promptChars, system: run.systemChars })}
          </div>
          {run.usage ? (
            <div style={metaLineStyle()}>
              {props.t("debug.tokens", { input: run.usage.inputTokens, output: run.usage.outputTokens })}
            </div>
          ) : null}
          {run.error ? <div style={{ ...mutedTextStyle(), color: C.danger }}>{shortUiText(run.error)}</div> : null}
        </div>
      ))}
    </Section>
  );
}

function ContextCollectionSection(props: {
  intake: PlanResult["intake"] | null;
  planningContext: PlanResult["planningContext"] | null;
  planningTools: PlanningToolIpcTrace | null;
  t: T;
}) {
  const observations = props.planningTools?.observationEvents?.length
    ? props.planningTools.observationEvents
    : (props.planningTools?.observations ?? []).map((observation) => ({ toolName: "tool", observation }));
  const failures = props.planningTools?.failures ?? [];
  const distillation = props.planningTools?.distillation ?? null;

  return (
    <Section title={props.t("debug.contextCollection")}>
      {props.intake ? (
        <div style={debugRowStyle()}>
          <div style={rowHeaderStyle()}>
            <strong>{props.t("trace.intake")}</strong>
            <span style={pillStyle(C.accent)}>{props.intake.score}/100</span>
          </div>
          <div style={metaLineStyle()}>
            {props.intake.readiness} · {props.t("trace.tool.missing", { n: props.intake.questions.length })}
          </div>
          {props.intake.nextActions.slice(0, 2).map((action) => (
            <div key={action} style={mutedTextStyle()}>{shortUiText(action)}</div>
          ))}
        </div>
      ) : null}

      {props.planningContext ? (
        <div style={debugRowStyle()}>
          <div style={rowHeaderStyle()}>
            <strong>{props.t("context.trace")}</strong>
            <span style={pillStyle(C.muted)}>
              {props.t("debug.contextCounts", {
                selected: props.planningContext.selected.length,
                ignored: props.planningContext.ignored.length,
                total: props.planningContext.total,
              })}
            </span>
          </div>
          {props.planningContext.selected.slice(0, 3).map((row) => (
            <div key={`${row.memoryId ?? row.content}-${row.score}`} style={mutedTextStyle()}>
              {contextCategoryLabel(row.category, props.t)} · {Math.round(row.score)} · {shortUiText(row.content)}
            </div>
          ))}
        </div>
      ) : null}

      {props.planningTools ? (
        <div style={debugRowStyle()}>
          <div style={rowHeaderStyle()}>
            <strong>{props.t("debug.toolActivity")}</strong>
            <span style={pillStyle(failures.length ? C.danger : C.muted)}>
              {props.t("debug.toolRuns", { observations: observations.length, failures: failures.length })}
            </span>
          </div>
          {observations.slice(0, 4).map((event, index) => (
            <div key={`${event.toolName}-${index}`} style={mutedTextStyle()}>
              {toolLabel(event.toolName, props.t)} · {shortUiText(event.observation.summary)}
              {event.observation.sources.length ? ` · ${props.t("trace.tool.sources", { n: event.observation.sources.length })}` : ""}
              {event.observation.warnings?.length ? ` · ${props.t("trace.tool.warnings", { n: event.observation.warnings.length })}` : ""}
            </div>
          ))}
          {failures.slice(0, 3).map((failure) => (
            <div key={`${failure.toolName}-${failure.error.message}`} style={{ ...mutedTextStyle(), color: C.danger }}>
              {toolLabel(failure.toolName, props.t)} · {shortUiText(failure.error.message)}
            </div>
          ))}
        </div>
      ) : null}

      {distillation ? (
        <div style={debugRowStyle()}>
          <div style={rowHeaderStyle()}>
            <strong>{props.t("debug.distillation")}</strong>
            <span style={pillStyle(C.muted)}>
              {props.t("trace.tool.candidates", { n: distillation.durableMemoryCandidates.length })}
            </span>
          </div>
          <div style={mutedTextStyle()}>{shortUiText(distillation.summary)}</div>
          {distillation.missingQuestions.slice(0, 3).map((question) => (
            <div key={question.id} style={mutedTextStyle()}>
              {props.t("trace.tool.missing", { n: 1 })} · {shortUiText(question.question)}
            </div>
          ))}
        </div>
      ) : null}
    </Section>
  );
}

function StructuredReasoningSection(props: {
  goal: Goal | null;
  plan: DecompositionOutput | null;
  quality: PlanResult["quality"] | null;
  qualityRetry: PlanResult["qualityRetry"] | null;
  review: PlanResult["review"] | null;
  t: T;
}) {
  const plan = props.plan;
  const contextGaps = plan?.nodes.flatMap((node) =>
    (node.decomposition_contract?.context_gaps ?? []).map((gap) => ({
      nodeTitle: node.title,
      gap,
    })),
  ) ?? [];

  return (
    <Section title={props.t("debug.structuredReasoning")}>
      <div style={mutedTextStyle()}>{props.t("debug.reasoningNote")}</div>
      {plan?.rationale ? (
        <div style={debugRowStyle()}>
          <div style={rowHeaderStyle()}>
            <strong>{props.t("debug.rationale")}</strong>
            {props.quality ? (
              <span style={pillStyle(qualityTone(props.quality.grade))}>
                {props.quality.grade} · {props.quality.score}
              </span>
            ) : null}
          </div>
          <div style={mutedTextStyle()}>{shortUiText(plan.rationale)}</div>
          {props.qualityRetry ? (
            <div style={metaLineStyle()}>
              {props.t(props.qualityRetry.retried ? "trace.retryYes" : "trace.retryNo", { attempts: props.qualityRetry.attempts })}
            </div>
          ) : null}
        </div>
      ) : null}

      {plan?.nodes.length ? (
        <div style={debugRowStyle()}>
          <div style={rowHeaderStyle()}>
            <strong>{props.t("debug.contracts")}</strong>
            <span style={pillStyle(C.muted)}>{plan.nodes.length}</span>
          </div>
          {plan.nodes.slice(0, 4).map((node) => {
            const contract = node.decomposition_contract;
            return (
              <div key={node.key} style={compactBlockStyle()}>
                <div style={rowTitleStyle()}>{node.title}</div>
                {contract?.why ? <div style={mutedTextStyle()}>{shortUiText(contract.why)}</div> : null}
                {contract?.definition_of_done ? <div style={metaLineStyle()}>{shortUiText(contract.definition_of_done)}</div> : null}
                {contract?.eval_signal ? <div style={metaLineStyle()}>{shortUiText(contract.eval_signal)}</div> : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {props.review?.actions.length ? (
        <div style={debugRowStyle()}>
          <div style={rowHeaderStyle()}>
            <strong>{props.t("debug.reviewActions")}</strong>
            <span style={pillStyle(C.muted)}>{props.review.actions.length}</span>
          </div>
          {props.review.actions.slice(0, 4).map((action) => (
            <div key={`${action.code}-${action.reason}`} style={mutedTextStyle()}>
              {action.priority} · {shortUiText(action.reason)}
            </div>
          ))}
        </div>
      ) : null}

      {contextGaps.length ? (
        <div style={debugRowStyle()}>
          <div style={rowHeaderStyle()}>
            <strong>{props.t("debug.contextGaps")}</strong>
            <span style={pillStyle(C.muted)}>{contextGaps.length}</span>
          </div>
          {contextGaps.slice(0, 5).map(({ nodeTitle, gap }) => (
            <div key={`${nodeTitle}-${gap.category}-${gap.question}`} style={mutedTextStyle()}>
              {nodeTitle} · {contextCategoryLabel(gap.category, props.t)} · {shortUiText(gap.question)}
            </div>
          ))}
        </div>
      ) : null}

      {!plan && props.goal ? <div style={mutedTextStyle()}>{props.goal.title}</div> : null}
    </Section>
  );
}

function Section(props: { title: string; children: ReactNode }) {
  return (
    <div style={sectionStyle()}>
      <div style={sectionTitleStyle()}>{props.title}</div>
      <div style={{ display: "grid", gap: 8 }}>{props.children}</div>
    </div>
  );
}

function toolLabel(toolName: string, t: T): string {
  if (toolName.startsWith("memory.")) return t("trace.tool.memory");
  if (toolName.startsWith("local.")) return t("trace.tool.local");
  if (toolName.startsWith("context.")) return t("trace.tool.context");
  if (toolName.startsWith("web.")) return t("trace.tool.web");
  return t("trace.tool.observation");
}

function panelStyle(): CSSProperties {
  return {
    background: "#fff",
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    padding: 16,
    marginBottom: 0,
  };
}

function headerStyle(): CSSProperties {
  return { display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 10 };
}

function eyebrowStyle(): CSSProperties {
  return { color: C.accent, fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0 };
}

function titleStyle(): CSSProperties {
  return { margin: "4px 0 0", fontSize: 18, letterSpacing: 0 };
}

function sectionStyle(): CSSProperties {
  return { borderTop: `1px solid ${C.border}`, paddingTop: 12, marginTop: 12 };
}

function sectionTitleStyle(): CSSProperties {
  return { fontSize: 12, fontWeight: 800, color: C.text, marginBottom: 8 };
}

function debugRowStyle(): CSSProperties {
  return {
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    padding: 10,
    minWidth: 0,
    overflow: "hidden",
  };
}

function pendingRowStyle(): CSSProperties {
  return { display: "grid", gridTemplateColumns: "10px minmax(0, 1fr)", gap: 8, alignItems: "start", marginBottom: 10 };
}

function rowHeaderStyle(): CSSProperties {
  return { display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline", minWidth: 0 };
}

function rowTitleStyle(): CSSProperties {
  return { fontSize: 13, fontWeight: 750, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
}

function mutedTextStyle(): CSSProperties {
  return { color: C.muted, fontSize: 12, lineHeight: 1.45, marginTop: 4, overflowWrap: "anywhere" };
}

function metaLineStyle(): CSSProperties {
  return { ...mutedTextStyle(), fontSize: 11 };
}

function compactBlockStyle(): CSSProperties {
  return { display: "grid", gap: 2, borderTop: `1px solid ${C.border}`, paddingTop: 8, marginTop: 8, minWidth: 0 };
}

function pillStyle(color: string): CSSProperties {
  return {
    color,
    background: "#f6f7f7",
    border: `1px solid ${C.border}`,
    borderRadius: 999,
    padding: "2px 7px",
    fontSize: 11,
    fontWeight: 750,
    whiteSpace: "nowrap",
  };
}

function dotStyle(): CSSProperties {
  return { width: 8, height: 8, borderRadius: 999, background: C.accent, marginTop: 6 };
}
