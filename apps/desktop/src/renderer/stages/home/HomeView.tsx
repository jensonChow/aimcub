/**
 * Aimcub Glass — the Home surface.
 *
 * Replaces the old quiet-placeholder `InitialWorkspacePanel`. It resolves to one of
 * three states in priority order:
 *   1. Recoverable drafts  → the draft-recovery surface (unchanged invariant behaviour).
 *   2. Saved aims present   → a "Welcome back" glass card list of recent aims.
 *   3. First run (no aims)  → a glass hero + a planning-runtime setup card.
 *
 * The empty/first-run state must never auto-render the aim composer — the primary
 * action is a "Set your first aim" button that opens New Aim explicitly.
 */
import type { AimDraft, AimProgressSummary, AimProgressSummaryStatus, Goal } from "@core/types";

import { useI18n, type StringKey } from "../../i18n";
import { aimNavigationLabels } from "../../workflow/aimNavigationTitle";
import { PROGRESS_STATUS_KEY, progressRatio } from "../../workflow/progressSummary";
import { AimDraftHomeSection } from "../aim/AimDraftRecovery";

/** Card sub-line phrases, in the design's voice ("Run · waiting on you" → status only, honestly derived). */
const HOME_STATE_KEY: Record<AimProgressSummaryStatus, StringKey> = {
  planning: "glass.home.state.planning",
  needs_you: "glass.home.state.needs_you",
  running: "glass.home.state.running",
  blocked: "glass.home.state.blocked",
  complete: "glass.home.state.complete",
};

export interface HomeViewProps {
  goals?: Goal[];
  drafts?: AimDraft[];
  progressSummaries?: Record<string, AimProgressSummary>;
  planningRuntimeReady?: boolean;
  /** Configured planning-model label for the first-run "connected" line, when known. */
  planningModelLabel?: string;
  onOpenGoal?: (goal: Goal) => void;
  onNewAim?: () => void;
  onResumeDraft?: (draft: AimDraft) => void;
  onDiscardDraft?: (draft: AimDraft) => void;
  onOpenSettings?: () => void;
}

export function HomeView(props: HomeViewProps) {
  const { t } = useI18n();
  const drafts = props.drafts ?? [];
  const goals = props.goals ?? [];
  const hasRecoverableDrafts = drafts.length > 0 && Boolean(props.onResumeDraft) && Boolean(props.onDiscardDraft);

  if (hasRecoverableDrafts && props.onResumeDraft && props.onDiscardDraft) {
    return (
      <section className="od-initial-workspace" data-has-drafts="true">
        <AimDraftHomeSection drafts={drafts} onResume={props.onResumeDraft} onDiscard={props.onDiscardDraft} />
      </section>
    );
  }

  if (goals.length > 0 && props.onOpenGoal) {
    const onOpenGoal = props.onOpenGoal;
    const needsCount = goals.filter(
      (goal) => props.progressSummaries?.[goal.id]?.status === "needs_you",
    ).length;
    const countLine = goals.length === 1
      ? t("glass.home.countOne")
      : t("glass.home.countMany", { n: goals.length });
    const needsLine = needsCount === 0
      ? t("glass.home.needsNone")
      : needsCount === 1
        ? t("glass.home.needsOne")
        : t("glass.home.needsMany", { n: needsCount });
    return (
      <section
        className="od-initial-workspace od-home-aims-wrap"
        data-has-drafts="false"
        aria-label={t("glass.home.welcome")}
      >
        <div className="od-home-aims">
          <h1 className="od-home-heading">{t("glass.home.welcome")}</h1>
          <p className="od-home-sub">{countLine} {needsLine}</p>
          <div className="od-home-card-list">
            {goals.map((goal) => {
              const nav = aimNavigationLabels({ title: goal.title, plan: goal.plan_json });
              const summary = props.progressSummaries?.[goal.id];
              const statusLabel = summary ? t(PROGRESS_STATUS_KEY[summary.status]) : "";
              return (
                <button
                  className="od-home-card"
                  key={goal.id}
                  type="button"
                  aria-label={summary ? `${nav.fullLabel} · ${statusLabel}` : nav.fullLabel}
                  title={nav.fullLabel}
                  onClick={() => onOpenGoal(goal)}
                >
                  <span className="od-home-card-main">
                    <strong className="od-home-card-title">{nav.label}</strong>
                    {summary ? (
                      <span className="od-home-card-state">{t(HOME_STATE_KEY[summary.status])}</span>
                    ) : null}
                  </span>
                  {summary?.status === "needs_you" ? (
                    <span className="od-home-card-pill">{t("glass.home.yourMove")}</span>
                  ) : null}
                  {summary ? (
                    <span className="od-home-card-bar" role="img" aria-label={t("shell.progressValue", { done: summary.completed, total: summary.total })}>
                      <span className="od-home-card-bar-fill" style={{ width: `${progressRatio(summary) * 100}%` }} />
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      className="od-initial-workspace od-home-firstrun-wrap"
      data-has-drafts="false"
      aria-label={t("initialWorkspace.label")}
    >
      <div className="od-home-firstrun">
        <span className="od-home-mark" aria-hidden="true">A</span>
        <h1 className="od-home-hero-title">{t("glass.home.firstHeading")}</h1>
        <p className="od-home-hero-body">{t("glass.home.firstBody")}</p>
        {props.onNewAim ? (
          <button className="od-home-hero-cta" type="button" onClick={props.onNewAim}>
            {t("glass.home.firstCta")}
          </button>
        ) : null}
        {props.planningRuntimeReady === false ? (
          <div className="od-home-setup">
            <div className="od-home-setup-main">
              <div className="od-home-setup-title">{t("glass.home.setupTitle")}</div>
              <div className="od-home-setup-body">{t("glass.home.setupBody")}</div>
            </div>
            {props.onOpenSettings ? (
              <button className="od-home-setup-cta" type="button" onClick={props.onOpenSettings}>
                {t("glass.home.setupCta")}
              </button>
            ) : null}
          </div>
        ) : props.planningRuntimeReady === true ? (
          <div className="od-home-setup-done">
            {props.planningModelLabel
              ? t("glass.home.setupDoneModel", { model: props.planningModelLabel })
              : t("glass.home.setupDone")}
          </div>
        ) : null}
      </div>
    </section>
  );
}
