import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { Goal } from "@core/types";

import { useI18n, type Lang } from "./i18n";

import "./cockpit.css";

export type CockpitStage = "aim" | "context" | "contracts" | "run" | "eval" | "settings";
type SidebarState = "pinned" | "collapsed" | "peek";
const USER_MENU_ID = "od-sidebar-user-menu";
const LANGUAGE_MENU_ID = "od-sidebar-language-menu";
const SIDEBAR_REVEAL_DELAY_MS = 180;
const SIDEBAR_CLOSE_DELAY_MS = 180;

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

function prefersCollapsedSidebar() {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 760px)").matches;
}

export function CockpitShell({
  goals,
  selected,
  activeStage,
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
  const [sidebarPinned, setSidebarPinned] = useState(() => !prefersCollapsedSidebar());
  const [sidebarPeeking, setSidebarPeeking] = useState(false);
  const [windowFullscreen, setWindowFullscreen] = useState(false);
  const sidebarHoverZoneRef = useRef<HTMLDivElement | null>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const revealSidebarTimer = useRef<number | null>(null);
  const hideSidebarTimer = useRef<number | null>(null);
  const suppressSidebarPeekUntilExit = useRef(false);
  const usingSettingsSidebar = activeStage === "settings" && Boolean(settingsSidebar);
  const hasGoals = goals.length > 0;
  const firstRunAim = activeStage === "aim" && !selected && !hasGoals;
  const sidebarState: SidebarState = usingSettingsSidebar ? "pinned" : sidebarPinned ? "pinned" : sidebarPeeking ? "peek" : "collapsed";
  const sidebarVisible = sidebarState !== "collapsed";
  const sidebarToggleLabel = sidebarPinned ? t("sidebar.collapse") : t("sidebar.expand");

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

  function clearSidebarRevealTimer() {
    if (revealSidebarTimer.current === null) return;
    window.clearTimeout(revealSidebarTimer.current);
    revealSidebarTimer.current = null;
  }

  function clearSidebarHideTimer() {
    if (hideSidebarTimer.current === null) return;
    window.clearTimeout(hideSidebarTimer.current);
    hideSidebarTimer.current = null;
  }

  function clearSidebarTimers() {
    clearSidebarRevealTimer();
    clearSidebarHideTimer();
  }

  function isInsideSidebarHoverZone(target: EventTarget | null) {
    return (
      typeof Node !== "undefined" &&
      target instanceof Node &&
      (Boolean(sidebarHoverZoneRef.current?.contains(target)) || Boolean(sidebarRef.current?.contains(target)))
    );
  }

  function revealSidebar(ignoreManualCollapseGuard = false) {
    if (sidebarPinned) return;
    if (suppressSidebarPeekUntilExit.current && !ignoreManualCollapseGuard) return;
    if (ignoreManualCollapseGuard) suppressSidebarPeekUntilExit.current = false;
    clearSidebarHideTimer();
    if (sidebarPeeking) return;
    clearSidebarRevealTimer();
    revealSidebarTimer.current = window.setTimeout(() => {
      setSidebarPeeking(true);
      revealSidebarTimer.current = null;
    }, SIDEBAR_REVEAL_DELAY_MS);
  }

  function revealSidebarAfterHover() {
    revealSidebar(false);
  }

  function revealSidebarFromRailHover() {
    revealSidebar(true);
  }

  function keepSidebarPeekOpen() {
    if (sidebarPinned) return;
    if (suppressSidebarPeekUntilExit.current) return;
    clearSidebarTimers();
    setSidebarPeeking(true);
  }

  function scheduleSidebarPeekClose(event?: { relatedTarget: EventTarget | null }) {
    if (event && isInsideSidebarHoverZone(event.relatedTarget)) return;
    suppressSidebarPeekUntilExit.current = false;
    if (sidebarPinned) return;
    clearSidebarRevealTimer();
    clearSidebarHideTimer();
    hideSidebarTimer.current = window.setTimeout(() => {
      setSidebarPeeking(false);
      hideSidebarTimer.current = null;
    }, SIDEBAR_CLOSE_DELAY_MS);
  }

  function toggleSidebarPin() {
    clearSidebarTimers();
    setSidebarPeeking(false);
    suppressSidebarPeekUntilExit.current = sidebarPinned;
    setSidebarPinned((current) => !current);
  }

  function onSidebarTogglePointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    event.stopPropagation();
  }

  function onSidebarToggleClick(event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    toggleSidebarPin();
  }

  function onSidebarToggleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    toggleSidebarPin();
  }

  function onSidebarTogglePointerLeave(event: React.PointerEvent<HTMLButtonElement>) {
    suppressSidebarPeekUntilExit.current = false;
    scheduleSidebarPeekClose(event);
  }

  function onSidebarToggleBlur(event: React.FocusEvent<HTMLButtonElement>) {
    suppressSidebarPeekUntilExit.current = false;
    scheduleSidebarPeekClose(event);
  }

  useEffect(() => {
    return () => {
      if (revealSidebarTimer.current !== null) window.clearTimeout(revealSidebarTimer.current);
      if (hideSidebarTimer.current !== null) window.clearTimeout(hideSidebarTimer.current);
    };
  }, []);

  useEffect(() => {
    let active = true;
    window.aimcub?.getWindowChromeState().then((state) => {
      if (active) setWindowFullscreen(state.fullscreen);
    }).catch(() => {});

    const unsubscribe = window.aimcub?.onWindowChromeState((state) => {
      setWindowFullscreen(state.fullscreen);
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    function resetTransientSidebarState() {
      clearSidebarTimers();
      suppressSidebarPeekUntilExit.current = false;
      setSidebarPeeking(false);
    }

    function resetWhenHidden() {
      if (document.visibilityState !== "visible") resetTransientSidebarState();
    }

    window.addEventListener("blur", resetTransientSidebarState);
    document.addEventListener("visibilitychange", resetWhenHidden);
    return () => {
      window.removeEventListener("blur", resetTransientSidebarState);
      document.removeEventListener("visibilitychange", resetWhenHidden);
    };
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 760px)");
    function syncSidebarForViewport(event: MediaQueryList | MediaQueryListEvent) {
      clearSidebarTimers();
      setSidebarPeeking(false);
      setSidebarPinned(!event.matches);
    }

    syncSidebarForViewport(query);
    query.addEventListener("change", syncSidebarForViewport);
    return () => query.removeEventListener("change", syncSidebarForViewport);
  }, []);

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
      <div
        className={`od-app od-app-stage-${activeStage}`}
        data-empty-aim={firstRunAim ? "true" : "false"}
        data-sidebar-state={sidebarState}
        data-window-fullscreen={windowFullscreen ? "true" : "false"}
      >
        <div className="od-window-drag-strip" aria-hidden="true" data-od-id="window-drag-strip" />
        {usingSettingsSidebar ? null : (
          <div className="od-sidebar-hover-zone" data-od-id="sidebar-hover-zone" ref={sidebarHoverZoneRef}>
            <div
              className="od-sidebar-peek-trigger"
              aria-hidden="true"
              data-od-id="sidebar-peek-trigger"
              onMouseDown={(event) => {
                event.stopPropagation();
                revealSidebarFromRailHover();
              }}
              onPointerDown={(event) => {
                event.stopPropagation();
                revealSidebarFromRailHover();
              }}
              onPointerEnter={revealSidebarFromRailHover}
              onPointerMove={revealSidebarFromRailHover}
              onPointerLeave={scheduleSidebarPeekClose}
            />
            <button
              className="od-sidebar-toggle"
              type="button"
              aria-label={sidebarToggleLabel}
              aria-expanded={sidebarVisible}
              aria-pressed={sidebarPinned}
              title={sidebarToggleLabel}
              data-state={sidebarState}
              data-od-id="sidebar-toggle"
              onClick={onSidebarToggleClick}
              onPointerDown={onSidebarTogglePointerDown}
              onKeyDown={onSidebarToggleKeyDown}
              onPointerEnter={revealSidebarAfterHover}
              onPointerLeave={onSidebarTogglePointerLeave}
              onFocus={keepSidebarPeekOpen}
              onBlur={onSidebarToggleBlur}
            >
              <SidebarToggleIcon />
            </button>
          </div>
        )}
        <aside
          ref={sidebarRef}
          className="od-sidebar"
          data-mode={usingSettingsSidebar ? "settings" : "aims"}
          data-od-id={usingSettingsSidebar ? "left-settings-sidebar" : "left-aim-sidebar"}
          aria-hidden={sidebarVisible ? undefined : true}
          onPointerEnter={usingSettingsSidebar ? undefined : keepSidebarPeekOpen}
          onPointerLeave={usingSettingsSidebar ? undefined : scheduleSidebarPeekClose}
          onFocus={usingSettingsSidebar ? undefined : keepSidebarPeekOpen}
          onBlur={usingSettingsSidebar ? undefined : scheduleSidebarPeekClose}
        >
          {usingSettingsSidebar ? null : (
            <div className="od-sidebar-head">
              <div>
                <h1>Aimcub</h1>
                <p>{t("os.tagline")}</p>
              </div>
            </div>
          )}

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

            </>
          )}

          <SidebarUserMenu onSettings={() => onStage("settings")} />
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

function SidebarToggleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" focusable="false">
      <rect x="3.5" y="3.5" width="13" height="13" rx="2" />
      <path d="M8 4v12" />
    </svg>
  );
}

function SidebarUserMenu(props: { onSettings: () => void }) {
  const { lang, setLang, t } = useI18n();
  const [open, setOpen] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const firstItemRef = useRef<HTMLButtonElement | null>(null);
  const focusFirstItemOnOpen = useRef(false);
  const languageOptions = [
    { lang: "en", label: t("userMenu.languageEnglish") },
    { lang: "zh", label: t("userMenu.languageChinese") },
  ] satisfies Array<{ lang: Lang; label: string }>;

  function closeMenu(focusTrigger = false) {
    focusFirstItemOnOpen.current = false;
    setOpen(false);
    setLanguageOpen(false);
    if (focusTrigger) {
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }

  function openMenu(focusFirstItem = false) {
    focusFirstItemOnOpen.current = focusFirstItem;
    setOpen(true);
  }

  function toggleMenu() {
    if (open) {
      closeMenu();
      return;
    }
    openMenu(true);
  }

  function focusMenuItem(offset: number) {
    const panel = panelRef.current;
    if (!panel) return;
    const items = Array.from(panel.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
    if (items.length === 0) return;
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    const baseIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = (baseIndex + offset + items.length) % items.length;
    items[nextIndex]?.focus();
  }

  function focusMenuEdge(edge: "first" | "last") {
    const panel = panelRef.current;
    if (!panel) return;
    const items = Array.from(panel.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
    const item = edge === "first" ? items[0] : items[items.length - 1];
    item?.focus();
  }

  function chooseLanguage(nextLang: Lang) {
    setLang(nextLang);
    closeMenu(true);
  }

  useEffect(() => {
    if (!open) return;
    if (!focusFirstItemOnOpen.current) return;
    const frame = window.requestAnimationFrame(() => {
      firstItemRef.current?.focus();
      focusFirstItemOnOpen.current = false;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target)) return;
      closeMenu();
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeMenu(true);
    }

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  return (
    <div className="od-user-menu-anchor" ref={rootRef} data-od-id="sidebar-user-menu">
      {open ? (
        <div
          className="od-user-menu-popover"
          id={USER_MENU_ID}
          ref={panelRef}
          role="menu"
          aria-label={t("userMenu.menuLabel")}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              focusMenuItem(1);
              return;
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              focusMenuItem(-1);
              return;
            }
            if (event.key === "Home") {
              event.preventDefault();
              focusMenuEdge("first");
              return;
            }
            if (event.key === "End") {
              event.preventDefault();
              focusMenuEdge("last");
              return;
            }
            if (event.key === "ArrowRight" && document.activeElement instanceof HTMLElement && document.activeElement.dataset.menuAction === "language") {
              event.preventDefault();
              setLanguageOpen(true);
              return;
            }
            if (event.key === "ArrowLeft" && languageOpen) {
              event.preventDefault();
              setLanguageOpen(false);
            }
          }}
        >
          <div className="od-user-menu-header" role="presentation">
            <span className="od-user-avatar" aria-hidden="true">A</span>
            <span>
              <strong>{t("userMenu.accountName")}</strong>
              <small>{t("userMenu.accountMeta")}</small>
            </span>
          </div>

          <button
            className="od-user-menu-item"
            ref={firstItemRef}
            type="button"
            role="menuitem"
            onClick={() => {
              closeMenu();
              props.onSettings();
            }}
          >
            <SettingsIcon />
            <span>{t("userMenu.settings")}</span>
            <kbd>Cmd ,</kbd>
          </button>

          <div className="od-user-menu-separator" role="separator" />

          <button
            className="od-user-menu-item"
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={languageOpen}
            aria-controls={LANGUAGE_MENU_ID}
            data-menu-action="language"
            onClick={() => setLanguageOpen((current) => !current)}
          >
            <GlobeIcon />
            <span>{t("userMenu.language")}</span>
            <ChevronRightIcon />
          </button>

          {languageOpen ? (
            <div className="od-user-language-menu" id={LANGUAGE_MENU_ID} role="menu" aria-label={t("userMenu.languageMenu")}>
              {languageOptions.map((option) => (
                <button
                  key={option.lang}
                  className="od-user-menu-item od-user-language-option"
                  type="button"
                  role="menuitemradio"
                  aria-checked={lang === option.lang}
                  onClick={() => chooseLanguage(option.lang)}
                >
                  <CheckIcon visible={lang === option.lang} />
                  <span>{option.label}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <button
        className="od-user-menu-trigger"
        ref={triggerRef}
        type="button"
        aria-label={t("userMenu.triggerLabel")}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={USER_MENU_ID}
        data-od-id="sidebar-user-menu-trigger"
        onClick={toggleMenu}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " " && event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          openMenu(true);
        }}
      >
        <span className="od-user-avatar" aria-hidden="true">A</span>
        <span className="od-user-trigger-copy">
          <strong>{t("userMenu.accountName")}</strong>
          <small>{t("userMenu.accountMeta")}</small>
        </span>
        <ChevronDownIcon />
      </button>
    </div>
  );
}

function SettingsIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" focusable="false">
      <path d="M8.9 3.2h2.2l.4 1.8c.4.1.8.3 1.2.5l1.6-1 1.5 1.5-1 1.6c.2.4.4.8.5 1.2l1.8.4v2.2l-1.8.4c-.1.4-.3.8-.5 1.2l1 1.6-1.5 1.5-1.6-1c-.4.2-.8.4-1.2.5l-.4 1.8H8.9l-.4-1.8c-.4-.1-.8-.3-1.2-.5l-1.6 1-1.5-1.5 1-1.6c-.2-.4-.4-.8-.5-1.2l-1.8-.4V9.1l1.8-.4c.1-.4.3-.8.5-1.2l-1-1.6 1.5-1.5 1.6 1c.4-.2.8-.4 1.2-.5l.4-1.8Z" />
      <circle cx="10" cy="10" r="2.3" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" focusable="false">
      <circle cx="10" cy="10" r="7" />
      <path d="M3.5 10h13M10 3c1.8 2 2.7 4.3 2.7 7s-.9 5-2.7 7M10 3C8.2 5 7.3 7.3 7.3 10s.9 5 2.7 7" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" focusable="false">
      <path d="m8 5 5 5-5 5" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" focusable="false">
      <path d="m5 8 5 5 5-5" />
    </svg>
  );
}

function CheckIcon(props: { visible: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" focusable="false" data-visible={props.visible ? "true" : "false"}>
      <path d="m4.5 10.5 3.2 3.2 7.8-8" />
    </svg>
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
