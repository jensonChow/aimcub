"use client";

import { colors, radius, space } from "@ui/tokens";
import type { ReactNode } from "react";
import type {
  GoalDebugContextStage,
  GoalDebugTrace,
  GoalDebugUsageEvent,
} from "../lib/debug-trace";

function humanize(value: string): string {
  return value.replace(/_/g, " ");
}

function compact(value: string, max = 220): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function StatusPill({ tone, children }: { tone: "ok" | "warn" | "muted"; children: ReactNode }) {
  const color = tone === "ok" ? colors.success : tone === "warn" ? colors.warning : colors.textMuted;
  return (
    <span
      style={{
        color,
        border: `1px solid ${color}`,
        borderRadius: radius.pill,
        padding: "2px 8px",
        fontSize: 12,
        fontFamily: "ui-monospace, monospace",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function DebugBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section
      style={{
        border: "1px solid #232733",
        borderRadius: radius.sm,
        padding: space.md,
        background: colors.surface,
        minWidth: 0,
      }}
    >
      <h3 style={{ margin: `0 0 ${space.sm}px`, fontSize: 15 }}>{title}</h3>
      {children}
    </section>
  );
}

function KeyValue({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "128px minmax(0, 1fr)", gap: space.sm, fontSize: 13 }}>
      <span style={{ color: colors.textMuted }}>{label}</span>
      <span style={{ minWidth: 0 }}>{value}</span>
    </div>
  );
}

function UsageList({ usage }: { usage: GoalDebugUsageEvent[] }) {
  if (usage.length === 0) {
    return <p style={{ color: colors.textMuted, margin: 0, fontSize: 13 }}>No live model usage was recorded.</p>;
  }
  return (
    <ul style={{ margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: space.xs }}>
      {usage.map((row, index) => (
        <li key={`${row.task}-${index}`} style={{ listStyle: "none", fontSize: 13, fontFamily: "ui-monospace, monospace" }}>
          {row.model} · in {row.inputTokens} · out {row.outputTokens}
          {row.cacheReadTokens ? ` · cache read ${row.cacheReadTokens}` : ""}
          {row.cacheWriteTokens ? ` · cache write ${row.cacheWriteTokens}` : ""}
        </li>
      ))}
    </ul>
  );
}

function TextList({ rows, empty }: { rows: string[]; empty: string }) {
  if (rows.length === 0) return <p style={{ color: colors.textMuted, margin: 0, fontSize: 13 }}>{empty}</p>;
  return (
    <ul style={{ margin: 0, paddingLeft: 18, color: colors.textMuted, fontSize: 13 }}>
      {rows.map((row, index) => (
        <li key={`${row}-${index}`} style={{ marginBottom: 4 }}>{compact(row)}</li>
      ))}
    </ul>
  );
}

function ContextStage({ stage }: { stage: GoalDebugContextStage }) {
  const blockingCount = stage.progress.blockedAcceptanceCount;
  return (
    <DebugBlock title={stage.label}>
      <div style={{ display: "flex", gap: space.sm, flexWrap: "wrap", marginBottom: space.sm }}>
        <StatusPill tone={stage.intake.readiness === "ready" ? "ok" : "warn"}>
          {humanize(stage.intake.readiness)}
        </StatusPill>
        <StatusPill tone={blockingCount > 0 ? "warn" : "muted"}>
          {blockingCount} blocking
        </StatusPill>
        <StatusPill tone={stage.sedimentation.readyForDecomposition ? "ok" : "warn"}>
          score {stage.intake.score}
        </StatusPill>
      </div>

      <KeyValue label="Questions" value={`${stage.intake.questions.length}`} />
      <KeyValue label="Loop" value={stage.intake.loop.shouldContinue ? "continue" : "settled"} />
      <KeyValue label="Aim context" value={`${stage.sedimentation.aimContextCount}`} />
      <KeyValue label="Memory candidates" value={`${stage.sedimentation.durableMemoryCandidateCount}`} />

      <div style={{ marginTop: space.sm }}>
        <div style={{ color: colors.text, fontWeight: 700, fontSize: 13, marginBottom: 4 }}>Next actions</div>
        <TextList rows={stage.sedimentation.nextActions} empty="No context actions." />
      </div>

      <div style={{ marginTop: space.sm }}>
        <div style={{ color: colors.text, fontWeight: 700, fontSize: 13, marginBottom: 4 }}>Intake questions</div>
        <TextList rows={stage.intake.questions.map((question) => `[${question.priority}] ${question.category}: ${question.prompt}`)} empty="No intake questions." />
      </div>

      <div style={{ marginTop: space.sm }}>
        <div style={{ color: colors.text, fontWeight: 700, fontSize: 13, marginBottom: 4 }}>Steps</div>
        {stage.progress.steps.length === 0 ? (
          <p style={{ color: colors.textMuted, margin: 0, fontSize: 13 }}>No intake loop steps.</p>
        ) : (
          <ul style={{ margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: space.xs }}>
            {stage.progress.steps.map((step) => (
              <li key={step.stepId} style={{ listStyle: "none", fontSize: 13, color: colors.textMuted }}>
                <span style={{ color: colors.text, fontFamily: "ui-monospace, monospace" }}>{step.stepId}</span>
                {" · "}
                {step.channel}
                {" · "}
                {humanize(step.status)}
                {step.remainingOutputs.length > 0 ? ` · needs ${step.remainingOutputs.join(", ")}` : ""}
                {step.requiredTools.length > 0 ? ` · tools ${step.requiredTools.map((tool) => tool.name).join(", ")}` : ""}
              </li>
            ))}
          </ul>
        )}
      </div>
    </DebugBlock>
  );
}

export function GoalDebugPanel({ trace }: { trace: GoalDebugTrace | null }) {
  if (!trace) {
    return (
      <section style={{ marginTop: space.xl, borderTop: "1px solid #232733", paddingTop: space.lg }}>
        <h2 style={{ margin: `0 0 ${space.sm}px`, fontSize: 20 }}>Debug trace</h2>
        <p style={{ color: colors.textMuted, margin: 0, fontSize: 13 }}>No debug trace was captured for this goal.</p>
      </section>
    );
  }

  const modelTone = trace.model.status === "model_succeeded" ? "ok" : trace.model.status === "local_fallback" ? "warn" : "muted";
  const qualityTone = trace.plan.quality.grade === "pass" ? "ok" : trace.plan.quality.grade === "warn" ? "warn" : "warn";

  return (
    <section style={{ marginTop: space.xl, borderTop: "1px solid #232733", paddingTop: space.lg }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: space.md, alignItems: "center", marginBottom: space.md, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20 }}>Debug trace</h2>
          <p style={{ margin: "4px 0 0", color: colors.textMuted, fontSize: 12, fontFamily: "ui-monospace, monospace" }}>
            {trace.generatedAt}
          </p>
        </div>
        <div style={{ display: "flex", gap: space.sm, flexWrap: "wrap" }}>
          <StatusPill tone={modelTone}>{humanize(trace.model.status)}</StatusPill>
          <StatusPill tone={qualityTone}>quality {trace.plan.quality.grade} · {trace.plan.quality.score}</StatusPill>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: space.md }}>
        <DebugBlock title="Model run">
          <div style={{ display: "flex", flexDirection: "column", gap: space.xs }}>
            <KeyValue label="Mode" value={trace.mode} />
            <KeyValue label="Primary" value={trace.model.primaryProvider} />
            <KeyValue label="Final" value={trace.model.finalProvider} />
            <KeyValue label="Attempts" value={`${trace.model.attempts}${trace.model.retried ? " with retry" : ""}`} />
            <KeyValue label="Output" value={trace.model.structuredOutput ? "structured JSON" : "text"} />
            {trace.model.fallbackReason ? <KeyValue label="Fallback" value={compact(trace.model.fallbackReason)} /> : null}
          </div>
          <div style={{ marginTop: space.sm }}>
            <div style={{ color: colors.text, fontWeight: 700, fontSize: 13, marginBottom: 4 }}>Usage</div>
            <UsageList usage={trace.model.usage} />
          </div>
          <p style={{ margin: `${space.sm}px 0 0`, color: colors.textMuted, fontSize: 12 }}>
            {trace.model.reasoningVisibility}
          </p>
        </DebugBlock>

        <DebugBlock title="Plan judgment">
          <KeyValue label="Summary" value={compact(trace.plan.summary)} />
          <KeyValue label="Rationale" value={compact(trace.plan.rationale)} />
          <KeyValue label="Graph" value={`${trace.plan.nodeCount} nodes · ${trace.plan.edgeCount} edges`} />
          <div style={{ marginTop: space.sm }}>
            <div style={{ color: colors.text, fontWeight: 700, fontSize: 13, marginBottom: 4 }}>Review actions</div>
            <TextList rows={trace.plan.review.actions.map((action) => `[${action.priority}] ${action.title}: ${action.reason}`)} empty="No review actions." />
          </div>
          <div style={{ marginTop: space.sm }}>
            <div style={{ color: colors.text, fontWeight: 700, fontSize: 13, marginBottom: 4 }}>Quality issues</div>
            <TextList rows={trace.plan.quality.issues.map((issue) => `[${issue.severity}] ${issue.code}: ${issue.message}`)} empty="No quality issues." />
          </div>
        </DebugBlock>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: space.md, marginTop: space.md }}>
        <ContextStage stage={trace.context.preModel} />
        <ContextStage stage={trace.context.postModel} />
      </div>

      <DebugBlock title="Milestone rationale">
        <ul style={{ margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: space.sm }}>
          {trace.plan.nodes.map((node) => (
            <li key={node.key} style={{ listStyle: "none", borderTop: "1px solid #232733", paddingTop: space.sm }}>
              <div style={{ display: "flex", gap: space.sm, alignItems: "center", flexWrap: "wrap" }}>
                <strong>{node.title}</strong>
                <StatusPill tone="muted">{node.likelyOwner}</StatusPill>
                <span style={{ color: colors.textMuted, fontSize: 12, fontFamily: "ui-monospace, monospace" }}>{node.key}</span>
              </div>
              <p style={{ color: colors.textMuted, margin: "4px 0", fontSize: 13 }}>Why: {compact(node.why)}</p>
              {node.definitionOfDone ? <p style={{ color: colors.textMuted, margin: "4px 0", fontSize: 13 }}>Done: {compact(node.definitionOfDone)}</p> : null}
              {node.evalSignal ? <p style={{ color: colors.textMuted, margin: "4px 0", fontSize: 13 }}>Eval: {compact(node.evalSignal)}</p> : null}
              {node.contextGaps.length > 0 ? (
                <div style={{ marginTop: 4 }}>
                  <TextList rows={node.contextGaps} empty="No context gaps." />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </DebugBlock>

      {trace.notices.length > 0 ? (
        <div style={{ marginTop: space.md, color: colors.textMuted, fontSize: 13 }}>
          <TextList rows={trace.notices} empty="No notices." />
        </div>
      ) : null}
    </section>
  );
}
