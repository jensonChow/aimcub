import { useEffect, useMemo, useState, type ReactNode } from "react";

import type { Goal } from "@core/types";

import { useI18n } from "./i18n";
import { LangToggle } from "./LangToggle";

import "./cockpit.css";

export type CockpitStage = "aim" | "context" | "contracts" | "run" | "eval" | "settings";

export interface CockpitCommand {
  id: string;
  label: string;
  detail: string;
  shortcut?: string;
  disabled?: boolean;
  action: () => void;
}

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
  settingsSidebar?: ReactNode;
  commands?: CockpitCommand[];
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
  settingsSidebar,
  commands,
}: CockpitShellProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "paused">("all");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const usingSettingsSidebar = activeStage === "settings" && Boolean(settingsSidebar);
  const hasGoals = goals.length > 0;
  const firstRunAim = activeStage === "aim" && !selected && !hasGoals;

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

  const commandItems = useMemo<CockpitCommand[]>(() => commands ?? [
    { id: "new-aim", label: t("command.newAim"), detail: t("command.newAim.detail"), shortcut: "Cmd N", action: onNewAim },
    { id: "stage-aim", label: t("os.stepAim"), detail: t("command.stageAim.detail"), shortcut: "Cmd 1", action: () => onStage("aim") },
    { id: "stage-context", label: t("os.stepContext"), detail: t("command.stageContext.detail"), shortcut: "Cmd 2", action: () => onStage("context") },
    { id: "stage-contracts", label: t("os.stepPlan"), detail: t("command.stagePlan.detail"), shortcut: "Cmd 3", action: () => onStage("contracts") },
    { id: "stage-run", label: t("os.stepExecute"), detail: t("command.stageRun.detail"), shortcut: "Cmd 4", action: () => onStage("run") },
    { id: "stage-eval", label: t("os.stepEval"), detail: t("command.stageEval.detail"), shortcut: "Cmd 5", action: () => onStage("eval") },
    { id: "settings", label: t("os.settings"), detail: t("command.settings.detail"), shortcut: "Cmd ,", action: () => onStage("settings") },
  ], [commands, onNewAim, onStage, t]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!event.metaKey && !event.ctrlKey) return;
      const key = event.key.toLowerCase();
      if (key === "k") {
        event.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (key === "n") {
        event.preventDefault();
        onNewAim();
        return;
      }
      if (key === ",") {
        event.preventDefault();
        onStage("settings");
        return;
      }
      if (["1", "2", "3", "4", "5"].includes(key)) {
        event.preventDefault();
        const stage = ["aim", "context", "contracts", "run", "eval"][Number(key) - 1] as CockpitStage | undefined;
        if (stage) onStage(stage);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onNewAim, onStage]);

  return (
    <div className="od-window" data-od-id="desktop-window">
      <header className="od-titlebar" data-od-id="mac-titlebar">
        <div className="od-titlebar-status">{busy || error || ""}</div>
        <button className="od-command-trigger" type="button" onClick={() => setPaletteOpen(true)}>
          <span>{t("command.open")}</span>
          <kbd>{t("command.shortcut")}</kbd>
        </button>
      </header>

      <div className={`od-app od-app-stage-${activeStage}`} data-empty-aim={firstRunAim ? "true" : "false"}>
        <aside
          className="od-sidebar"
          data-mode={usingSettingsSidebar ? "settings" : "aims"}
          data-od-id={usingSettingsSidebar ? "left-settings-sidebar" : "left-aim-sidebar"}
        >
          <div className="od-sidebar-head">
            <div>
              <h1>Aimcub</h1>
              <p>{t("os.tagline")}</p>
            </div>
            <div className="od-sidebar-head-actions">
              <LangToggle />
            </div>
          </div>

          {usingSettingsSidebar ? settingsSidebar : (
            <>
              <button className="od-new-aim" type="button" onClick={onNewAim}>
                <span>{t("os.newAim")}</span>
                <kbd>Cmd N</kbd>
              </button>

              <section className="od-aim-browser" aria-label={t("shell.recentAims")}>
                {hasGoals ? (
                  <>
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
                  </>
                ) : null}
                <div className="od-section-label">
                  <span>{t("shell.recentAims")}</span>
                  <span>{visibleGoals.length}</span>
                </div>
                <div className="od-aim-list">
                  {visibleGoals.length === 0 ? (
                    <div className="od-sidebar-empty">
                      <strong>{t(hasGoals ? "shell.noSearchResults" : "shell.noAimsTitle")}</strong>
                      <span>{t(hasGoals ? "shell.noSearchResultsBody" : "shell.noAimsBody")}</span>
                    </div>
                  ) : null}
                  {visibleGoals.map((goal) => (
                    <button
                      key={goal.id}
                      className={`od-aim-card${selected?.id === goal.id ? " selected" : ""}`}
                      type="button"
                      onClick={() => onOpenGoal(goal)}
                    >
                      <span className="od-aim-row-main">
                        <strong>{shortText(goal.title, 58)}</strong>
                        <span>{statusLabel(goal)}</span>
                      </span>
                      <span className="od-aim-row-badge" aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </section>

              <button className="od-settings-button" type="button" onClick={() => onStage("settings")}>
                <span>
                  <strong>{t("os.settings")}</strong>
                  <small>{t("cockpit.settings.meta")}</small>
                </span>
                <kbd>Cmd ,</kbd>
              </button>
            </>
          )}
        </aside>

        <main className={`od-main od-main-${activeStage}`} data-od-id="main-delivery-workbench">
          {activeStage !== "settings" && activeStage !== "aim" ? (
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
          ) : null}

          <section className={`od-workspace od-workspace-${activeStage}`} data-od-id="workflow-panels">
            {main}
          </section>
        </main>
      </div>
      {paletteOpen ? (
        <CommandPalette
          commands={commandItems}
          onClose={() => setPaletteOpen(false)}
        />
      ) : null}
    </div>
  );
}

function CommandPalette(props: { commands: CockpitCommand[]; onClose: () => void }) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const normalized = query.trim().toLowerCase();
  const filtered = props.commands.filter((command) => {
    if (!normalized) return true;
    return `${command.label} ${command.detail} ${command.shortcut ?? ""}`.toLowerCase().includes(normalized);
  });
  const activeCommand = filtered[activeIndex] ?? filtered[0] ?? null;

  useEffect(() => {
    setActiveIndex(0);
  }, [normalized]);

  function run(command: CockpitCommand | null) {
    if (!command || command.disabled) return;
    props.onClose();
    command.action();
  }

  return (
    <div className="od-command-layer" role="presentation" onMouseDown={props.onClose}>
      <div
        className="od-command-palette"
        role="dialog"
        aria-modal="true"
        aria-label={t("command.palette")}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            props.onClose();
            return;
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((current) => Math.min(current + 1, Math.max(filtered.length - 1, 0)));
            return;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((current) => Math.max(current - 1, 0));
            return;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            run(activeCommand);
          }
        }}
      >
        <div className="od-command-search">
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("command.searchPlaceholder")}
          />
          <kbd>{t("command.escape")}</kbd>
        </div>
        <div className="od-command-list" role="listbox" aria-label={t("command.palette")}>
          {filtered.length === 0 ? <div className="od-command-empty">{t("command.empty")}</div> : null}
          {filtered.map((command, index) => (
            <button
              key={command.id}
              type="button"
              className="od-command-row"
              data-active={index === activeIndex ? "true" : "false"}
              disabled={command.disabled}
              role="option"
              aria-selected={index === activeIndex}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => run(command)}
            >
              <span>
                <strong>{command.label}</strong>
                <small>{command.detail}</small>
              </span>
              {command.shortcut ? <kbd>{command.shortcut}</kbd> : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
