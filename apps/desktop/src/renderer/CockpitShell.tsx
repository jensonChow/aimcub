import { useMemo, useState, type ReactNode } from "react";

import type { Goal } from "@core/types";

import { useI18n } from "./i18n";
import { LangToggle } from "./LangToggle";

import "./cockpit.css";

export type CockpitStage = "aim" | "context" | "contracts" | "run" | "eval" | "settings";

interface CockpitShellProps {
  goals: Goal[];
  selected: Goal | null;
  activeStage: CockpitStage;
  busy: string | null;
  error: string | null;
  onNewAim: () => void;
  onOpenGoal: (goal: Goal) => void;
  onStage: (stage: CockpitStage) => void;
  main: ReactNode;
}

interface StageItem {
  stage: CockpitStage;
  index: string;
  title: string;
}

function shortText(value: string | undefined | null, max = 96): string {
  const cleaned = (value ?? "").replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1).trim()}...`;
}

function statusLabel(goal: Goal): string {
  return goal.status.replace("_", " ");
}

export function CockpitShell({
  goals,
  selected,
  activeStage,
  busy,
  error,
  onNewAim,
  onOpenGoal,
  onStage,
  main,
}: CockpitShellProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "paused">("all");

  const stages = useMemo<StageItem[]>(() => [
    { stage: "aim", index: "1", title: t("os.stepAim") },
    { stage: "context", index: "2", title: t("os.stepContext") },
    { stage: "contracts", index: "3", title: t("os.stepPlan") },
    { stage: "run", index: "4", title: t("os.stepExecute") },
    { stage: "eval", index: "5", title: t("os.stepEval") },
  ], [t]);

  const normalizedQuery = query.trim().toLowerCase();
  const visibleGoals = goals
    .filter((goal) => {
      if (filter === "paused" && goal.status !== "paused") return false;
      if (filter === "active" && (goal.status === "achieved" || goal.status === "abandoned")) return false;
      if (!normalizedQuery) return true;
      return `${goal.title} ${goal.description ?? ""} ${goal.status}`.toLowerCase().includes(normalizedQuery);
    })
    .slice(0, 12);

  return (
    <div className="od-window" data-od-id="desktop-window">
      <header className="od-titlebar" data-od-id="mac-titlebar">
        <div className="od-titlebar-brand">Aimcub</div>
        <div className="od-titlebar-status">{busy || error || t("cockpit.titlebar.ready")}</div>
      </header>

      <div className={`od-app od-app-stage-${activeStage}`}>
        <aside className="od-sidebar" data-od-id="left-aim-sidebar">
          <div className="od-sidebar-head">
            <div>
              <h1>Aimcub</h1>
              <p>{t("os.tagline")}</p>
            </div>
            <div className="od-sidebar-head-actions">
              <LangToggle />
            </div>
          </div>

          <button className="od-new-aim" type="button" onClick={onNewAim}>
            {t("os.newAim")}
          </button>

          <section className="od-aim-browser" aria-label={t("shell.recentAims")}>
            <div className="od-sidebar-search">
              <label htmlFor="aim-search">{t("shell.searchAims")}</label>
              <input
                id="aim-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("shell.searchAims")}
              />
            </div>
            <div className="od-filter-row" aria-label={t("shell.recentAims")}>
              <button className={filter === "all" ? "active" : ""} type="button" onClick={() => setFilter("all")}>
                {t("cockpit.filter.all")}
              </button>
              <button className={filter === "active" ? "active" : ""} type="button" onClick={() => setFilter("active")}>
                {t("cockpit.filter.active")}
              </button>
              <button className={filter === "paused" ? "active" : ""} type="button" onClick={() => setFilter("paused")}>
                {t("cockpit.filter.paused")}
              </button>
            </div>
            <div className="od-section-label">
              <span>{t("shell.recentAims")}</span>
              <span>{visibleGoals.length}</span>
            </div>
            <div className="od-aim-list">
              {visibleGoals.length === 0 ? <div className="od-empty">{t("shell.noSearchResults")}</div> : null}
              {visibleGoals.map((goal) => (
                <button
                  key={goal.id}
                  className={`od-aim-card${selected?.id === goal.id ? " selected" : ""}`}
                  type="button"
                  onClick={() => onOpenGoal(goal)}
                >
                  <strong>{shortText(goal.title, 58)}</strong>
                  <span>{statusLabel(goal)}</span>
                </button>
              ))}
            </div>
          </section>

          <button className="od-settings-button" type="button" onClick={() => onStage("settings")}>
            <span>{t("os.settings")}</span>
            <span>{t("cockpit.settings.meta")}</span>
          </button>
        </aside>

        <main className={`od-main od-main-${activeStage}`} data-od-id="main-delivery-workbench">
          <nav className="od-stage-nav" aria-label={t("cockpit.workflow")}>
            {stages.map((item) => (
              <button
                key={item.stage}
                className={activeStage === item.stage ? "active" : ""}
                type="button"
                aria-current={activeStage === item.stage ? "step" : undefined}
                onClick={() => onStage(item.stage)}
              >
                <span className="od-stage-index">{item.index}</span>
                <span className="od-stage-title">{item.title}</span>
              </button>
            ))}
          </nav>

          <section className={`od-workspace od-workspace-${activeStage}`} data-od-id="workflow-panels">
            {main}
          </section>
        </main>
      </div>
    </div>
  );
}
