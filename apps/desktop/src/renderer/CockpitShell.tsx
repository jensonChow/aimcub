import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

import type { AimProgressReadModel } from "@core/domain";
import type { Goal } from "@core/types";
import type {
  ContextSourceStatus,
  LocalAgentDetection,
  ProviderStatus,
  WebResearchStatus,
} from "../shared/ipc";

import { useI18n } from "./i18n";
import { LangToggle } from "./LangToggle";

import "./cockpit.css";

export type CockpitStage = "aim" | "context" | "contracts" | "run" | "eval" | "settings";

interface CockpitShellProps {
  goals: Goal[];
  selected: Goal | null;
  activeStage: CockpitStage;
  completed: number;
  total: number;
  progress: AimProgressReadModel | null;
  provider: ProviderStatus | null;
  webResearch: WebResearchStatus | null;
  contextSources: ContextSourceStatus | null;
  localAgents: LocalAgentDetection[];
  pendingContextCount: number;
  busy: string | null;
  error: string | null;
  onNewAim: () => void;
  onOpenGoal: (goal: Goal) => void;
  onStage: (stage: CockpitStage) => void;
  main: ReactNode;
  inspector: ReactNode;
}

interface StageItem {
  stage: CockpitStage;
  index: string;
  title: string;
  meta: string;
}

function pct(done: number, total: number): number {
  return total <= 0 ? 0 : Math.round((done / total) * 100);
}

function shortText(value: string | undefined | null, max = 96): string {
  const cleaned = (value ?? "").replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1).trim()}...`;
}

function statusLabel(goal: Goal): string {
  return goal.status.replace("_", " ");
}

function providerLabel(provider: ProviderStatus | null, localAgents: LocalAgentDetection[]): string {
  if (provider?.configured) return provider.provider ?? "configured";
  if (localAgents.some((agent) => agent.available && agent.authStatus !== "missing")) return "local CLI";
  return "missing";
}

function localSourceCount(status: ContextSourceStatus | null): number {
  return (status?.local.resolvedWorkspaceRoot ? 1 : 0) + (status?.local.resolvedFilePaths.length ?? 0);
}

export function CockpitShell({
  goals,
  selected,
  activeStage,
  completed,
  total,
  progress,
  provider,
  webResearch,
  contextSources,
  localAgents,
  pendingContextCount,
  busy,
  error,
  onNewAim,
  onOpenGoal,
  onStage,
  main,
  inspector,
}: CockpitShellProps) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "paused">("all");
  const [sidebarWidth, setSidebarWidth] = useState(264);
  const dragState = useRef<{ pointerId: number } | null>(null);

  const stages = useMemo<StageItem[]>(() => [
    { stage: "aim", index: "1", title: t("os.stepAim"), meta: t("cockpit.stage.aim") },
    { stage: "context", index: "2", title: t("os.stepContext"), meta: t("cockpit.stage.context") },
    { stage: "contracts", index: "3", title: t("os.stepPlan"), meta: t("cockpit.stage.contracts") },
    { stage: "run", index: "4a", title: t("os.stepExecute"), meta: t("cockpit.stage.run") },
    { stage: "eval", index: "4b", title: t("os.stepEval"), meta: t("cockpit.stage.eval") },
  ], [t]);

  const normalizedQuery = query.trim().toLowerCase();
  const visibleGoals = goals
    .filter((goal) => {
      if (filter === "paused" && goal.status !== "paused") return false;
      if (filter === "active" && (goal.status === "achieved" || goal.status === "abandoned")) return false;
      if (!normalizedQuery) return true;
      return `${goal.title} ${goal.description ?? ""} ${goal.status}`.toLowerCase().includes(normalizedQuery);
    })
    .slice(0, 5);

  const completion = pct(completed, total);
  const nextAction = selected ? progress?.next_action || t("shell.noNextAction") : t("aimIntake.unsaved");
  const currentAimTitle = selected?.title || t("os.newAim");
  const sidebarStyle = { "--sidebar-width": `${sidebarWidth}px` } as CSSProperties;

  function startResize(event: React.PointerEvent<HTMLDivElement>) {
    dragState.current = { pointerId: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.classList.add("od-resizing");
  }

  function moveResize(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragState.current) return;
    const next = Math.max(232, Math.min(320, event.clientX));
    setSidebarWidth(next);
  }

  function endResize(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragState.current) return;
    dragState.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    document.body.classList.remove("od-resizing");
  }

  function resizeWithKeyboard(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    setSidebarWidth((current) => {
      const delta = event.key === "ArrowRight" ? 16 : -16;
      return Math.max(232, Math.min(320, current + delta));
    });
  }

  return (
    <div className="od-window" data-od-id="desktop-window">
      <header className="od-titlebar" data-od-id="mac-titlebar">
        <div className="od-titlebar-brand">Aimcub</div>
        <div className="od-titlebar-status">{busy || error || t("cockpit.titlebar.ready")}</div>
      </header>

      <div className={`od-app od-app-stage-${activeStage}${collapsed ? " sidebar-collapsed" : ""}`} style={sidebarStyle}>
        <aside className="od-sidebar" aria-hidden={collapsed} data-od-id="left-aim-sidebar">
          <div className="od-sidebar-head">
            <div>
              <h1>Aimcub</h1>
              <p>{t("os.tagline")}</p>
            </div>
            <div className="od-sidebar-head-actions">
              <LangToggle />
              <button
                className="od-subtle-button"
                type="button"
                aria-controls="left-aim-sidebar"
                aria-expanded={!collapsed}
                onClick={() => setCollapsed(true)}
              >
                {t("chat.hideSidebar")}
              </button>
            </div>
          </div>

          <button className="od-new-aim" type="button" onClick={onNewAim}>
            {t("os.newAim")}
          </button>

          <section className="od-current-aim" aria-label={t("shell.currentAim")}>
            <div className="od-section-label">
              <span>{t("shell.currentAim")}</span>
              <span>{completion}%</span>
            </div>
            <button className="od-aim-card current" type="button" onClick={() => onStage("aim")}>
              <strong>{shortText(currentAimTitle, 64)}</strong>
              <span>{shortText(nextAction, 92)}</span>
              <div className="od-progress">
                <i style={{ width: `${completion}%` }} />
              </div>
            </button>
          </section>

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

          <section className="od-next-action">
            <div className="od-section-label">
              <span>{t("shell.nextAction")}</span>
              <span>getAimProgress</span>
            </div>
            <strong>{shortText(nextAction, 88)}</strong>
            <button className="od-chip primary" type="button" onClick={() => onStage("context")}>
              {t("cockpit.next.context")}
            </button>
          </section>

          <button className="od-settings-button" type="button" onClick={() => onStage("settings")}>
            <span>{t("os.settings")}</span>
            <span>{t("cockpit.settings.meta")}</span>
          </button>

          <section className="od-runtime-strip">
            <div><span>{t("os.provider")}</span><strong>{providerLabel(provider, localAgents)}</strong></div>
            <div><span>{t("os.webResearch")}</span><strong>{webResearch?.enabled ? "on" : "off"}</strong></div>
            <div><span>{t("context.sources.local")}</span><strong>{localSourceCount(contextSources)}</strong></div>
            <div><span>{t("os.pendingContext")}</span><strong>{pendingContextCount}</strong></div>
          </section>
        </aside>

        <button className="od-restore-sidebar" type="button" onClick={() => setCollapsed(false)}>
          {t("chat.showSidebar")}
        </button>

        <div
          className="od-sidebar-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label={t("cockpit.resizeSidebar")}
          aria-valuemin={232}
          aria-valuemax={320}
          aria-valuenow={sidebarWidth}
          tabIndex={0}
          onPointerDown={startResize}
          onPointerMove={moveResize}
          onPointerUp={endResize}
          onPointerCancel={endResize}
          onKeyDown={resizeWithKeyboard}
        />

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
                <span>
                  <span className="od-stage-title">{item.title}</span>
                  <span className="od-stage-meta">{item.meta}</span>
                </span>
              </button>
            ))}
          </nav>

          <section className={`od-workspace od-workspace-${activeStage}`} data-od-id="workflow-panels">
            {main}
          </section>
        </main>

        <aside className="od-inspector" data-od-id="right-inspector">
          <div className="od-inspector-head">
            <h2>{t("shell.inspector")}</h2>
            <span>{activeStage}</span>
          </div>
          <div className="od-inspector-body">
            {inspector}
          </div>
        </aside>
      </div>
    </div>
  );
}
