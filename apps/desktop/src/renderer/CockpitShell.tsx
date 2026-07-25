import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

import type { AimDraft, AimProgressSummary, Goal } from "@aimcub/types";

import type { WindowChromeState } from "../shared/ipc";
import { useI18n, type Lang } from "./i18n";
import { AimDraftSidebarRows } from "./stages/aim/AimDraftRecovery";
import { setThemePref, useThemePref } from "./theme";
import { aimNavigationLabels } from "./workflow/aimNavigationTitle";
import { PROGRESS_STATUS_KEY } from "./workflow/progressSummary";
import {
  type CockpitStage,
  type WorkbenchStage,
  type WorkspaceTarget,
} from "./workflow/workspaceNavigation";

import "./cockpit.css";

export type { CockpitStage, WorkbenchStage, WorkspaceTarget };
type SidebarState = "pinned" | "collapsed" | "peek";
const USER_MENU_ID = "od-sidebar-user-menu";
const LANGUAGE_MENU_ID = "od-sidebar-language-menu";
/* v2: the Glass island re-sync changed the default width to 224 — retire widths saved
   against the old attached-pane layout so the new geometry actually shows up. */
const SIDEBAR_WIDTH_STORAGE_KEY = "aimcub.sidebarWidth.v2";
const SIDEBAR_REVEAL_DELAY_MS = 180;
const SIDEBAR_CLOSE_DELAY_MS = 180;
const SIDEBAR_AUTO_COLLAPSE_QUERY = "(max-width: 1040px)";
const DEFAULT_SIDEBAR_WIDTH = 224;
const MIN_SIDEBAR_WIDTH = 216;
const MAX_SIDEBAR_WIDTH = 360;
const DEFAULT_WINDOW_CHROME_STATE: WindowChromeState = {
  fullscreen: false,
  colorScheme: "light",
};

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
  drafts?: AimDraft[];
  progressSummaries?: Record<string, AimProgressSummary>;
  activeStage: CockpitStage;
  workspaceTarget: WorkspaceTarget;
  onHome: () => void;
  onNewAim: () => void;
  onOpenGoal: (goal: Goal) => void;
  onOpenDraft?: (draft: AimDraft) => void;
  onDiscardDraft?: (draft: AimDraft) => void;
  onStage: (stage: CockpitStage) => void;
  onMemory?: () => void;
  memoryCount?: number;
  main: ReactNode;
  /** While the Settings stage is open, replaces the aim list (brand row + account menu stay). */
  settingsSidebar?: ReactNode;
  commands?: CockpitCommand[];
}

function prefersCollapsedSidebar() {
  return typeof window !== "undefined" && window.matchMedia(SIDEBAR_AUTO_COLLAPSE_QUERY).matches;
}

function maxSidebarWidthForViewport() {
  if (typeof window === "undefined") return MAX_SIDEBAR_WIDTH;
  return Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, window.innerWidth - 560));
}

function clampSidebarWidth(width: number) {
  return Math.min(Math.max(Math.round(width), MIN_SIDEBAR_WIDTH), maxSidebarWidthForViewport());
}

function readInitialSidebarWidth() {
  if (typeof window === "undefined") return DEFAULT_SIDEBAR_WIDTH;
  const raw = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
  const parsed = raw ? Number.parseInt(raw, 10) : DEFAULT_SIDEBAR_WIDTH;
  return Number.isFinite(parsed) ? clampSidebarWidth(parsed) : DEFAULT_SIDEBAR_WIDTH;
}

function persistSidebarWidth(width: number) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(width));
}

export function CockpitShell({
  goals,
  drafts = [],
  progressSummaries,
  activeStage,
  workspaceTarget,
  onHome,
  onNewAim,
  onOpenGoal,
  onOpenDraft,
  onDiscardDraft,
  onStage,
  onMemory,
  memoryCount,
  main,
  settingsSidebar,
  commands,
}: CockpitShellProps) {
  const { t } = useI18n();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sidebarPinned, setSidebarPinned] = useState(() => !prefersCollapsedSidebar());
  const [sidebarPeeking, setSidebarPeeking] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(readInitialSidebarWidth);
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const [windowChrome, setWindowChrome] = useState<WindowChromeState>(DEFAULT_WINDOW_CHROME_STATE);
  const themePref = useThemePref();
  const effectiveAppearance = themePref === "system" ? windowChrome.colorScheme : themePref;
  const sidebarHoverZoneRef = useRef<HTMLDivElement | null>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const sidebarWidthRef = useRef(sidebarWidth);
  const revealSidebarTimer = useRef<number | null>(null);
  const hideSidebarTimer = useRef<number | null>(null);
  const suppressSidebarPeekUntilExit = useRef(false);
  // Memory and Settings are overlay detours: while one is open no sidebar nav row reads as current.
  const overlayStage = activeStage === "memory" || activeStage === "settings";
  const usingSettingsSidebar = activeStage === "settings" && Boolean(settingsSidebar);
  const hasGoals = goals.length > 0;
  const firstRunAim = activeStage === "aim"
    && workspaceTarget.kind !== "draft"
    && workspaceTarget.kind !== "goal"
    && !hasGoals;
  const sidebarState: SidebarState = sidebarPinned ? "pinned" : sidebarPeeking ? "peek" : "collapsed";
  const sidebarVisible = sidebarState !== "collapsed";
  const sidebarToggleLabel = sidebarPinned ? t("sidebar.collapse") : t("sidebar.expand");
  const sidebarId = "od-left-aim-sidebar";
  const appStyle = { "--sidebar-width": `${sidebarWidth}px` } as CSSProperties;

  const visibleGoals = goals.slice(0, 12);

  const commandItems = useMemo<CockpitCommand[]>(() => {
    return commands ?? [
      { id: "home-panel", label: t("command.homePanel"), detail: t("command.homePanel.detail"), shortcut: "Cmd 0", action: onHome },
      { id: "new-aim", label: t("command.newAim"), detail: t("command.newAim.detail"), shortcut: "Cmd N", action: onNewAim },
      { id: "settings", label: t("os.settings"), detail: t("command.settings.detail"), shortcut: "Cmd ,", action: () => onStage("settings") },
    ];
  }, [commands, onHome, onNewAim, onStage, t]);

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

  function toggleTheme() {
    setThemePref(effectiveAppearance === "dark" ? "light" : "dark");
  }

  function updateSidebarWidth(nextWidth: number) {
    const clamped = clampSidebarWidth(nextWidth);
    sidebarWidthRef.current = clamped;
    setSidebarWidth(clamped);
    return clamped;
  }

  function commitSidebarWidth(nextWidth: number) {
    const clamped = updateSidebarWidth(nextWidth);
    persistSidebarWidth(clamped);
  }

  function beginSidebarResize(event: React.PointerEvent<HTMLDivElement>) {
    if (sidebarState !== "pinned") return;
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    clearSidebarTimers();

    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startWidth = sidebarWidthRef.current;
    setSidebarResizing(true);
    document.body.classList.add("od-resizing");
    handle.setPointerCapture(pointerId);

    function onPointerMove(moveEvent: PointerEvent) {
      updateSidebarWidth(startWidth + moveEvent.clientX - startX);
    }

    function onPointerEnd() {
      persistSidebarWidth(sidebarWidthRef.current);
      setSidebarResizing(false);
      document.body.classList.remove("od-resizing");
      if (handle.hasPointerCapture(pointerId)) {
        handle.releasePointerCapture(pointerId);
      }
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerEnd);
      window.removeEventListener("pointercancel", onPointerEnd);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerEnd);
    window.addEventListener("pointercancel", onPointerEnd);
  }

  function onSidebarResizeKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 32 : 16;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      commitSidebarWidth(sidebarWidthRef.current - step);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      commitSidebarWidth(sidebarWidthRef.current + step);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      commitSidebarWidth(MIN_SIDEBAR_WIDTH);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      commitSidebarWidth(MAX_SIDEBAR_WIDTH);
    }
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
    sidebarWidthRef.current = sidebarWidth;
  }, [sidebarWidth]);

  useEffect(() => {
    function syncSidebarWidthToViewport() {
      setSidebarWidth((current) => {
        const clamped = clampSidebarWidth(current);
        sidebarWidthRef.current = clamped;
        return clamped;
      });
    }

    syncSidebarWidthToViewport();
    window.addEventListener("resize", syncSidebarWidthToViewport);
    return () => window.removeEventListener("resize", syncSidebarWidthToViewport);
  }, []);

  useEffect(() => {
    let active = true;
    window.aimcub?.getWindowChromeState().then((state) => {
      if (active) setWindowChrome(state);
    }).catch(() => {});

    const unsubscribe = window.aimcub?.onWindowChromeState((state) => {
      setWindowChrome(state);
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  // Drive the NATIVE window chrome (titlebar/background/traffic-light context) from the
  // in-app theme toggle so an explicit light/dark override doesn't desync from the visible
  // content. Runs on mount to apply a persisted override and on every toggle. "system"
  // hands appearance back to the OS.
  useEffect(() => {
    void window.aimcub?.setThemeSource(themePref);
  }, [themePref]);

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
    const query = window.matchMedia(SIDEBAR_AUTO_COLLAPSE_QUERY);
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
      if (key === "0") {
        event.preventDefault();
        onHome();
        return;
      }
      if (key === ",") {
        event.preventDefault();
        onStage("settings");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onHome, onNewAim, onStage]);

  return (
    <div className="od-window" data-od-id="desktop-window">
      <div
        className={`od-app od-app-stage-${activeStage}${sidebarResizing ? " od-resizing" : ""}`}
        style={appStyle}
        data-empty-aim={firstRunAim ? "true" : "false"}
        data-sidebar-state={sidebarState}
        data-system-appearance={effectiveAppearance}
        data-window-fullscreen={windowChrome.fullscreen ? "true" : "false"}
      >
        <div className="od-window-drag-strip" aria-hidden="true" data-od-id="window-drag-strip" />
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
        <aside
          id={sidebarId}
          ref={sidebarRef}
          className="od-sidebar"
          data-mode={usingSettingsSidebar ? "settings" : "aims"}
          data-od-id="left-aim-sidebar"
          aria-hidden={sidebarVisible ? undefined : true}
          onPointerEnter={keepSidebarPeekOpen}
          onPointerLeave={scheduleSidebarPeekClose}
          onFocus={keepSidebarPeekOpen}
          onBlur={scheduleSidebarPeekClose}
        >
          <nav className="od-sidebar-brand" aria-label={t("shell.globalActions")} data-od-id="sidebar-global-actions">
                <button
                  className="od-sidebar-brand-home"
                  type="button"
                  aria-current={workspaceTarget.kind === "home" && !overlayStage ? "page" : undefined}
                  aria-label={t("os.homePanel")}
                  title={t("os.homePanel")}
                  data-od-id="sidebar-home-panel-action"
                  onClick={onHome}
                >
                  <span className="od-brand-mark" aria-hidden="true">A</span>
                  <span className="od-brand-name">{t("glass.shell.brand")}</span>
                </button>
                <button
                  className="od-sidebar-plus"
                  type="button"
                  aria-current={workspaceTarget.kind === "newAim" && !overlayStage ? "page" : undefined}
                  aria-label={t("os.newAim")}
                  title={t("os.newAim")}
                  data-od-id="sidebar-new-aim-action"
                  onClick={onNewAim}
                >
                  <PlusIcon />
                </button>
              </nav>

              {usingSettingsSidebar ? settingsSidebar : (
              <section className="od-aim-browser" aria-label={t("shell.recentAims")}>
                {drafts.length > 0 && onOpenDraft && onDiscardDraft ? (
                  <AimDraftSidebarRows
                    drafts={drafts}
                    activeDraftId={workspaceTarget.kind === "draft" ? workspaceTarget.id : null}
                    onResume={onOpenDraft}
                    onDiscard={onDiscardDraft}
                  />
                ) : null}
                <div className="od-aim-list">
                  {visibleGoals.length === 0 ? (
                    <div className="od-sidebar-empty">{t("glass.shell.emptyNav")}</div>
                  ) : null}
                  {visibleGoals.map((goal) => {
                    const selectedGoal = workspaceTarget.kind === "goal" && workspaceTarget.id === goal.id && !overlayStage;
                    const navigationTitle = aimNavigationLabels({ title: goal.title, plan: goal.plan_json });
                    const summary = progressSummaries?.[goal.id];
                    const markedStatus = summary && (summary.status === "needs_you" || summary.status === "blocked")
                      ? summary.status
                      : null;
                    return (
                      <button
                        key={goal.id}
                        className={`od-aim-card${selectedGoal ? " selected" : ""}`}
                        type="button"
                        aria-current={selectedGoal ? "page" : undefined}
                        aria-label={navigationTitle.fullLabel}
                        title={navigationTitle.fullLabel}
                        onClick={() => onOpenGoal(goal)}
                      >
                        <span className="od-aim-row-main">
                          <strong>{navigationTitle.label}</strong>
                        </span>
                        {markedStatus ? (
                          <span
                            className={`od-aim-progress-dot is-${markedStatus}`}
                            role="img"
                            aria-label={t(PROGRESS_STATUS_KEY[markedStatus])}
                            title={t(PROGRESS_STATUS_KEY[markedStatus])}
                          />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </section>
              )}

          <SidebarUserMenu
            appearance={effectiveAppearance}
            themePref={themePref}
            memoryCount={memoryCount}
            memoryCurrent={activeStage === "memory"}
            onMemory={onMemory}
            onSettings={() => onStage("settings")}
            onToggleTheme={toggleTheme}
          />
        </aside>

        {sidebarState === "pinned" ? (
          <div
            className="od-sidebar-resizer"
            role="separator"
            aria-label={t("cockpit.resizeSidebar")}
            aria-controls={sidebarId}
            aria-orientation="vertical"
            aria-valuemin={MIN_SIDEBAR_WIDTH}
            aria-valuemax={MAX_SIDEBAR_WIDTH}
            aria-valuenow={sidebarWidth}
            tabIndex={0}
            title={t("cockpit.resizeSidebar")}
            data-resizing={sidebarResizing ? "true" : "false"}
            data-od-id="sidebar-resizer"
            onPointerDown={beginSidebarResize}
            onKeyDown={onSidebarResizeKeyDown}
          />
        ) : null}

        <main className={`od-main od-main-${activeStage}`} data-od-id="main-delivery-workbench">
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

function PlusIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" focusable="false">
      <path d="M10 4.5v11M4.5 10h11" />
    </svg>
  );
}

function MemoryIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" focusable="false">
      <path d="M10 3.5 3.5 6.5 10 9.5 16.5 6.5 10 3.5Z" />
      <path d="M3.6 10 10 13l6.4-3" />
      <path d="M3.6 13.4 10 16.4l6.4-3" />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" focusable="false">
      <circle cx="10" cy="7" r="3" />
      <path d="M4.5 16c.8-2.6 2.9-4 5.5-4s4.7 1.4 5.5 4" />
    </svg>
  );
}

function UpDownChevronIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" focusable="false">
      <path d="M6.5 8.5 10 5l3.5 3.5" />
      <path d="M6.5 11.5 10 15l3.5-3.5" />
    </svg>
  );
}

function ThemeMoonIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" focusable="false">
      <path d="M15.5 11.5A6.5 6.5 0 0 1 8.5 4.5 6.5 6.5 0 1 0 15.5 11.5Z" />
    </svg>
  );
}

function ThemeSunIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" focusable="false">
      <circle cx="10" cy="10" r="4" />
      <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.4 4.4l1.4 1.4M14.2 14.2l1.4 1.4M15.6 4.4l-1.4 1.4M5.8 14.2l-1.4 1.4" />
    </svg>
  );
}

interface SidebarUserMenuProps {
  appearance: "light" | "dark";
  themePref: "system" | "light" | "dark";
  memoryCount?: number;
  memoryCurrent: boolean;
  onMemory?: () => void;
  onSettings: () => void;
  onToggleTheme: () => void;
}

function SidebarUserMenu(props: SidebarUserMenuProps) {
  const { lang, setLang, t } = useI18n();
  const [open, setOpen] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  // Viewport-anchored geometry captured from the trigger at open time. The popover renders in a
  // body portal: the sidebar's backdrop-filter makes it the containing block for position:fixed,
  // so a popover left inside it gets clipped by the sidebar's overflow (the Language submenu
  // extends past the sidebar edge and was cut to a dead sliver).
  const [menuPos, setMenuPos] = useState<{ left: number; bottom: number; width: number } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const firstItemRef = useRef<HTMLButtonElement | null>(null);
  const languageTriggerRef = useRef<HTMLButtonElement | null>(null);
  const focusFirstItemOnOpen = useRef(false);
  const languageCloseTimerRef = useRef<number | null>(null);
  const languageOptions = [
    { lang: "en", label: t("userMenu.languageEnglish") },
    { lang: "zh", label: t("userMenu.languageChinese") },
  ] satisfies Array<{ lang: Lang; label: string }>;

  function cancelLanguageClose() {
    if (languageCloseTimerRef.current === null) return;
    window.clearTimeout(languageCloseTimerRef.current);
    languageCloseTimerRef.current = null;
  }

  function openLanguageMenu(focusOption = false) {
    cancelLanguageClose();
    setLanguageOpen(true);
    if (!focusOption) return;
    window.requestAnimationFrame(() => {
      const currentOption =
        panelRef.current?.querySelector<HTMLButtonElement>(".od-user-language-option[aria-checked=\"true\"]") ??
        panelRef.current?.querySelector<HTMLButtonElement>(".od-user-language-option");
      currentOption?.focus();
    });
  }

  function scheduleLanguageClose() {
    cancelLanguageClose();
    languageCloseTimerRef.current = window.setTimeout(() => {
      languageCloseTimerRef.current = null;
      setLanguageOpen(false);
    }, 140);
  }

  function closeMenu(focusTrigger = false) {
    focusFirstItemOnOpen.current = false;
    cancelLanguageClose();
    setOpen(false);
    setLanguageOpen(false);
    if (focusTrigger) {
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }

  function openMenu(focusFirstItem = false) {
    focusFirstItemOnOpen.current = focusFirstItem;
    const rect = triggerRef.current?.getBoundingClientRect();
    setMenuPos(rect
      ? { left: Math.round(rect.left), bottom: Math.round(window.innerHeight - rect.top + 8), width: Math.round(rect.width) }
      : null);
    setOpen(true);
  }

  function toggleMenu() {
    if (open) {
      closeMenu();
      return;
    }
    openMenu();
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
      // The popover lives in a body portal, so it is not inside rootRef.
      if (panelRef.current?.contains(target)) return;
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
      {open && typeof document !== "undefined" ? createPortal(
        <div
          className="od-user-menu-popover"
          id={USER_MENU_ID}
          ref={panelRef}
          role="menu"
          aria-label={t("userMenu.menuLabel")}
          style={menuPos ? { left: menuPos.left, bottom: menuPos.bottom, width: menuPos.width } : undefined}
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
              openLanguageMenu(true);
              return;
            }
            if (event.key === "ArrowLeft" && languageOpen) {
              event.preventDefault();
              setLanguageOpen(false);
              languageTriggerRef.current?.focus();
            }
          }}
        >
          {props.onMemory ? (
            <button
              className="od-user-menu-item"
              ref={firstItemRef}
              type="button"
              role="menuitem"
              aria-current={props.memoryCurrent ? "page" : undefined}
              data-od-id="sidebar-memory-action"
              onClick={() => {
                closeMenu();
                props.onMemory?.();
              }}
            >
              <MemoryIcon />
              <span>{t("glass.shell.memory")}</span>
              {typeof props.memoryCount === "number" && props.memoryCount > 0 ? (
                <small className="od-user-menu-value" aria-label={t("glass.shell.memoryCount", { n: props.memoryCount })}>
                  {props.memoryCount}
                </small>
              ) : null}
            </button>
          ) : null}

          <button
            className="od-user-menu-item"
            ref={props.onMemory ? undefined : firstItemRef}
            type="button"
            role="menuitem"
            onClick={() => {
              closeMenu();
              props.onSettings();
            }}
          >
            <SettingsIcon />
            <span>{t("userMenu.settings")}</span>
          </button>

          <div
            className="od-user-menu-submenu-anchor"
            data-open={languageOpen}
            onPointerEnter={() => openLanguageMenu()}
            onPointerLeave={scheduleLanguageClose}
            onFocusCapture={() => openLanguageMenu()}
            onBlurCapture={(event) => {
              const nextTarget = event.relatedTarget;
              if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
              setLanguageOpen(false);
            }}
          >
            <button
              className="od-user-menu-item"
              ref={languageTriggerRef}
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={languageOpen}
              aria-controls={LANGUAGE_MENU_ID}
              data-menu-action="language"
              data-submenu-open={languageOpen}
              onClick={() => openLanguageMenu()}
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

          <div className="od-user-menu-separator" role="separator" />

          <button
            className="od-user-menu-item"
            type="button"
            role="menuitem"
            onClick={props.onToggleTheme}
          >
            {props.appearance === "dark" ? <ThemeMoonIcon /> : <ThemeSunIcon />}
            <span>{t("userMenu.appearance")}</span>
            <small className="od-user-menu-value">
              {t(props.themePref === "system"
                ? "userMenu.appearanceSystem"
                : props.appearance === "dark"
                  ? "userMenu.appearanceDark"
                  : "userMenu.appearanceLight")}
            </small>
          </button>

          <div className="od-user-menu-device" role="presentation">
            <span className="od-user-menu-device-dot" aria-hidden="true" />
            <span>{t("glass.shell.onDevice")}</span>
          </div>
        </div>,
        document.body,
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
        <span className="od-user-avatar" aria-hidden="true">
          <PersonIcon />
        </span>
        <span className="od-user-trigger-copy">
          <strong>{t("userMenu.accountName")}</strong>
          <small>{t("userMenu.accountMeta")}</small>
        </span>
        <UpDownChevronIcon />
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
