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
import type { AimDraft, AimProgressSummary, Goal } from "@core/types";

import { useI18n } from "../../i18n";
import { aimNavigationLabels } from "../../workflow/aimNavigationTitle";
import { PROGRESS_STATUS_KEY, progressRatio } from "../../workflow/progressSummary";
import { AimDraftHomeSection } from "../aim/AimDraftRecovery";

export interface HomeViewProps {
  goals?: Goal[];
  drafts?: AimDraft[];
  progressSummaries?: Record<string, AimProgressSummary>;
  planningRuntimeReady?: boolean;
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
    return (
      <section
        className="od-initial-workspace od-home-aims-wrap"
        data-has-drafts="false"
        aria-label={t("glass.home.welcome")}
      >
        <div className="od-home-aims">
          <h1 className="od-home-heading">{t("glass.home.welcome")}</h1>
          <p className="od-home-sub">{t("glass.home.sub")}</p>
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
                  aria-label={nav.fullLabel}
                  title={nav.fullLabel}
                  onClick={() => onOpenGoal(goal)}
                >
                  <span className="od-home-card-main">
                    <strong className="od-home-card-title">{nav.label}</strong>
                    {summary && summary.total > 0 ? (
                      <span className="od-home-card-progress">
                        <span className="od-home-card-bar">
                          <span className="od-home-card-bar-fill" style={{ width: `${progressRatio(summary) * 100}%` }} />
                        </span>
                        <span className="od-home-card-progress-text">{summary.completed}/{summary.total}</span>
                      </span>
                    ) : summary ? (
                      <span className="od-home-card-progress-text">{statusLabel}</span>
                    ) : null}
                  </span>
                  {summary ? (
                    <span
                      className={`od-home-card-dot is-${summary.status}`}
                      role="img"
                      aria-label={statusLabel}
                      title={statusLabel}
                    />
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
          <div className="od-home-setup-done">{t("glass.home.setupDone")}</div>
        ) : null}
      </div>
    </section>
  );
}
