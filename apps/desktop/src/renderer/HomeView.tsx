import type { Goal } from "@core/types";
import type { ContextHealthRow, ContextLineageLearningReport, ContextProfileReport, DecompositionLearningReport } from "@core/domain";
import type { ClarifyLearningReport } from "@core/llm";
import { useState } from "react";

import { useI18n } from "./i18n";
import {
  capturePurposeLabel,
  contextCategoryLabel,
  contextHealthActionLabel,
  contextHealthReasonLabel,
  contextLearningRecommendationLabel,
  contextProfileStrengthLabel,
  decompositionLearningRecommendationLabel,
  dimensionLabel,
  formatDate,
  lineageLearningRecommendationLabel,
  planOf,
  shortUiText,
} from "./labels";
import { C, card, inputStyle, linkButton, primaryButton, secondaryButton } from "./styles";

interface HomeViewProps {
  goals: Goal[];
  onNew: () => void;
  onOpen: (g: Goal) => void;
  onDelete: (g: Goal) => void;
}

export function HomeView({
  goals,
  onNew,
  onOpen,
  onDelete,
}: HomeViewProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const filteredGoals = goals.filter((goal) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return `${goal.title} ${goal.description ?? ""}`.toLowerCase().includes(q);
  });
  return (
    <section>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: 22, letterSpacing: 0 }}>{t("home.recent")}</h2>
          <div style={{ color: C.muted, fontSize: 13, marginTop: 4 }}>
            {goals.length === 0 ? t("home.none") : t(goals.length === 1 ? "home.aim_one" : "home.aim_other", { n: goals.length })}
          </div>
        </div>
        <button onClick={onNew} style={{ ...primaryButton(false), marginTop: 0, whiteSpace: "nowrap" }}>{t("home.new")}</button>
      </div>

      {goals.length > 0 && (
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("shell.searchAims")}
          style={{ ...inputStyle(), marginBottom: 14 }}
        />
      )}

      {goals.length === 0 && (
        <div style={{ ...card(), minHeight: 220, display: "grid", placeItems: "center", textAlign: "center", borderStyle: "dashed" }}>
          <div style={{ maxWidth: 380 }}>
            <h3 style={{ margin: 0, fontSize: 24, letterSpacing: 0 }}>{t("home.emptyTitle")}</h3>
            <p style={{ color: C.muted, fontSize: 14, lineHeight: 1.6, margin: "10px 0 18px" }}>{t("home.emptyHelp")}</p>
            <button onClick={onNew} style={{ ...primaryButton(false), marginTop: 0, whiteSpace: "nowrap" }}>{t("home.new")}</button>
          </div>
        </div>
      )}

      {filteredGoals.length === 0 && goals.length > 0 && (
        <div style={{ ...card(), color: C.muted, fontSize: 13 }}>{t("shell.noSearchResults")}</div>
      )}

      {filteredGoals.map((goal) => {
        const n = planOf(goal)?.nodes.length ?? 0;
        const description = goal.description?.trim();
        return (
          <div key={goal.id} style={{ ...card(), display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, cursor: "pointer" }} onClick={() => onOpen(goal)}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{goal.title}</div>
              {description ? (
                <div style={{ color: C.muted, fontSize: 13, marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {description}
                </div>
              ) : null}
              <div style={{ color: C.muted, fontSize: 12, marginTop: 3 }}>
                {t(n === 1 ? "common.milestone_one" : "common.milestone_other", { n })}
                {goal.created_at ? ` · ${formatDate(goal.created_at)}` : ""}
              </div>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(goal); }}
              style={{ ...linkButton(), color: C.muted }}
              title={t("common.delete")}
            >
              {t("common.delete")}
            </button>
          </div>
        );
      })}
    </section>
  );
}

export function ContextProfilePanel({ report }: { report: ContextProfileReport | null }) {
  const { t } = useI18n();
  if (!report || report.totalActive + report.totalPending === 0) return null;
  const gaps = report.gaps.slice(0, 3);
  return (
    <section style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>{t("context.profile")}</h2>
        <span style={{ color: C.muted, fontSize: 12 }}>
          {t("context.profileScore", { score: report.coverageScore })}
        </span>
      </div>
      <div style={{ ...card(), background: "#fbfaf7" }}>
        <div style={{ display: "grid", gap: 8 }}>
          {report.rows.slice(0, 6).map((row) => (
            <div
              key={row.category}
              style={{ display: "grid", gridTemplateColumns: "112px minmax(80px, 1fr) 72px", gap: 8, alignItems: "center" }}
            >
              <div style={{ color: C.text, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {contextCategoryLabel(row.category, t)}
              </div>
              <div style={{ color: C.muted, fontSize: 12 }}>
                {contextProfileStrengthLabel(row.strength, t)}
              </div>
              <div style={{ color: C.muted, fontSize: 12, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {row.highConfidenceCount}/{row.activeCount}
              </div>
            </div>
          ))}
        </div>
        {gaps.length > 0 && (
          <div style={{ color: C.muted, fontSize: 12, marginTop: 10 }}>
            {t("context.profileNext")} {gaps.map((row) => contextCategoryLabel(row.category, t)).join(", ")}
          </div>
        )}
      </div>
    </section>
  );
}

export function ContextLearningPanel({ report }: { report: ClarifyLearningReport | null }) {
  const { t } = useI18n();
  if (!report || report.total_answered === 0) return null;
  const rows = report.rows.filter((row) => row.answered_count > 0);
  if (rows.length === 0) return null;
  return (
    <section style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>{t("context.learning")}</h2>
        <span style={{ color: C.muted, fontSize: 12 }}>
          {t("context.learningCounts", { answered: report.total_answered, impacted: report.total_impacted })}
        </span>
      </div>
      <div style={{ ...card(), background: "#f7fbf8" }}>
        <div style={{ display: "grid", gap: 8 }}>
          {rows.map((row) => (
            <div
              key={row.source_dimension}
              style={{ display: "grid", gridTemplateColumns: "112px minmax(90px, 1fr) 72px", gap: 8, alignItems: "center" }}
            >
              <div style={{ fontSize: 12, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {dimensionLabel(row.source_dimension, t)}
              </div>
              <div style={{ color: C.muted, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {contextLearningRecommendationLabel(row.recommendation, t)}
              </div>
              <div style={{ color: C.muted, fontSize: 12, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {row.impacted_count}/{row.answered_count}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function ContextLineageLearningPanel({ report }: { report: ContextLineageLearningReport | null }) {
  const { t } = useI18n();
  if (!report || report.totalQuestions === 0) return null;
  const rows = report.rows.filter((row) => row.askedCount > 0).slice(0, 5);
  if (rows.length === 0) return null;
  return (
    <section style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>{t("context.lineageLearning")}</h2>
        <span style={{ color: C.muted, fontSize: 12 }}>
          {t("context.lineageLearningCounts", {
            questions: report.totalQuestions,
            captured: report.totalCaptured,
            impacted: report.totalImpacted,
            pending: report.totalPending,
          })}
        </span>
      </div>
      <div style={{ ...card(), background: "#f7fbfb" }}>
        <div style={{ display: "grid", gap: 10 }}>
          {rows.map((row, index) => {
            const source = row.gapSource?.replace("_", "-") ?? row.source.replace("_", "-");
            return (
              <div key={`${row.source}-${row.category}-${row.capturePurpose}-${index}`} style={{ display: "grid", gap: 3 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
                  <div style={{ color: C.text, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {source} · {contextCategoryLabel(row.category, t)} · {dimensionLabel(row.improvesDimension, t)}
                  </div>
                  <div style={{ color: C.muted, fontSize: 12, whiteSpace: "nowrap" }}>
                    {row.impactedCount}/{row.memoryCapturedCount}
                  </div>
                </div>
                <div style={{ color: C.muted, fontSize: 12 }}>
                  {lineageLearningRecommendationLabel(row.recommendation, t)} · {capturePurposeLabel(row.capturePurpose, t)}
                  {row.pendingContextCount > 0 ? ` · ${t("context.lineageLearningPending", { n: row.pendingContextCount })}` : ""}
                  {row.acceptedContextCount ? ` · ${t("context.lineageLearningAccepted", { n: row.acceptedContextCount })}` : ""}
                  {(row.rejectedContextCount ?? 0) + (row.deprioritizedContextCount ?? 0) > 0
                    ? ` · ${t("context.lineageLearningRejected", { n: (row.rejectedContextCount ?? 0) + (row.deprioritizedContextCount ?? 0) })}`
                    : ""}
                </div>
                <div style={{ color: C.muted, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {shortUiText(row.exampleQuestion)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function DecompositionLearningPanel({ report }: { report: DecompositionLearningReport | null }) {
  const { t } = useI18n();
  if (!report || report.rows.length === 0) return null;
  const rows = report.rows.slice(0, 5);
  return (
    <section style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>{t("context.decompositionLearning")}</h2>
        <span style={{ color: C.muted, fontSize: 12 }}>
          {t("context.decompositionLearningCounts", {
            aims: report.totalAims,
            completed: report.completedMilestones,
            total: report.totalMilestones,
            issues: report.qualityIssueCount,
            evidence: report.evidenceAttributionCount,
          })}
        </span>
      </div>
      <div style={{ ...card(), background: "#f8faf6" }}>
        <div style={{ display: "grid", gap: 10 }}>
          {rows.map((row, index) => {
            const context = row.acceptedContextCount || row.rejectedContextCount || row.deprioritizedContextCount
              ? ` · ${t("context.decompositionLearningContext", {
                  accepted: row.acceptedContextCount ?? 0,
                  rejected: (row.rejectedContextCount ?? 0) + (row.deprioritizedContextCount ?? 0),
                })}`
              : "";
            const evidence = row.evidenceKinds?.length
              ? ` · ${t("context.decompositionLearningEvidence", {
                  evidence: row.evidenceKinds.join(", "),
                  evaluator: row.evaluatorKinds?.join(", ") || "unknown",
                })}`
              : "";
            return (
              <div key={`${row.source}-${row.recommendation}-${row.aimId}-${index}`} style={{ display: "grid", gap: 3 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
                  <div style={{ color: C.text, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {decompositionLearningRecommendationLabel(row.recommendation, t)} · {row.source.replace("_", "-")}
                  </div>
                  <div style={{ color: C.muted, fontSize: 12, whiteSpace: "nowrap" }}>
                    {row.dimension ? dimensionLabel(row.dimension, t) : row.category ? contextCategoryLabel(row.category, t) : t("context.decompositionLearningContract")}
                  </div>
                </div>
                <div style={{ color: C.muted, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {row.nodeTitle ?? row.aimTitle}{context}{evidence}
                </div>
                <div style={{ color: C.muted, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {shortUiText(row.example)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function ContextHealthPanel({
  rows,
  onArchive,
  onDeprioritize,
}: {
  rows: ContextHealthRow[];
  onArchive: (id: string) => void;
  onDeprioritize: (id: string) => void;
}) {
  const { t } = useI18n();
  const actionable = rows.filter((row) => row.action !== "keep");
  if (rows.length === 0) return null;
  if (actionable.length === 0) {
    const traced = rows.filter((row) => row.selectedCount + row.ignoredCount > 0).length;
    return (
      <section style={{ marginBottom: 18 }}>
        <div style={{ ...card(), background: "#f7fbf8", color: "#1a7f4b", fontSize: 13 }}>
          {t("context.healthClean", { traced, total: rows.length })}
        </div>
      </section>
    );
  }

  return (
    <section style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>{t("context.health")}</h2>
        <span style={{ color: C.muted, fontSize: 12 }}>
          {t(actionable.length === 1 ? "context.healthAttention_one" : "context.healthAttention_other", { n: actionable.length })}
        </span>
      </div>
      {actionable.slice(0, 5).map((row) => (
        <div key={row.memoryId} style={{ ...card(), background: "#fffaf1" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
            <div style={{ color: C.muted, fontSize: 12 }}>
              {row.category} · {contextHealthActionLabel(row.action, t)}
            </div>
            <div style={{ color: C.muted, fontSize: 12, whiteSpace: "nowrap" }}>
              {t("context.healthCounts", { selected: row.selectedCount, ignored: row.ignoredCount })}
            </div>
          </div>
          <div style={{ fontSize: 13, marginTop: 6 }}>{row.content}</div>
          <div style={{ color: C.muted, fontSize: 12, marginTop: 6 }}>
            {contextHealthReasonLabel(row.reason, t)}
            {row.lastReasons.length > 0 ? ` · ${row.lastReasons.slice(-2).join(", ")}` : ""}
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
            <button onClick={() => onDeprioritize(row.memoryId)} style={{ ...secondaryButton(), marginTop: 0 }}>
              {t("context.health.deprioritize")}
            </button>
            <button
              onClick={() => onArchive(row.memoryId)}
              style={{ ...secondaryButton(), marginTop: 0, color: C.danger, borderColor: "#e7c9c9" }}
            >
              {t("context.health.archive")}
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}
