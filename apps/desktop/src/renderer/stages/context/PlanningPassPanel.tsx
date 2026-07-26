/**
 * The surface of a STOPPED planning pass — what an aim shows when you come back to it after the
 * app closed mid-planning.
 *
 * Before this existed, such an aim rendered the ordinary "Let Aimcub plan this aim / Start
 * planning" card, which read as amnesia: the app had been planning the aim, said so, and then
 * greeted its owner as if nothing had ever happened (founder, 2026-07-26).
 *
 * It deliberately mirrors the live card's shape (plain panel, thought trace, receipt footer) so
 * returning feels like the same lane at rest — with two honest differences: the dot does not
 * pulse and the last trace line is NOT marked current, because nothing is happening now.
 */
import { useI18n, type StringKey } from "../../i18n";
import { Button, Panel, Pill } from "../../ui";
import type { PlanningPassStateView } from "../../../shared/ipc";
import { planningPassActivity, planningPassAnswered, planningPassOffer } from "../../workflow/planningPass";
import { planningActivityTrace } from "../../workflow/planningSession";

export interface PlanningPassPanelProps {
  pass: PlanningPassStateView;
  disabled: boolean;
  /** Start a brain again on this aim, continuing the pass. */
  onResume: () => void;
  /** Open the drafted plan for review + adoption (only offered when the pass has one). */
  onReview: () => void;
  /** Forget this pass and plan the aim again from nothing. */
  onStartOver: () => void;
}

export function PlanningPassPanel(props: PlanningPassPanelProps) {
  const { t } = useI18n();
  const tk = (key: string, vars?: Record<string, string | number>) => t(key as StringKey, vars);
  const pass = props.pass;
  const offer = planningPassOffer(pass);
  const failed = pass.stoppedReason === "failed";

  const titleKey: StringKey = offer === "review_plan"
    ? "planningPass.readyTitle"
    : failed ? "planningPass.failedTitle" : "planningPass.pausedTitle";
  const subKey: StringKey = offer === "review_plan"
    ? "planningPass.readySub"
    : failed ? "planningPass.failedSub" : "planningPass.pausedSub";

  const trace = planningActivityTrace(planningPassActivity(pass), tk, 8);
  const answered = planningPassAnswered(pass);

  return (
    <Panel variant="plain" className="od-planning-session" data-od-id="planning-pass">
      <header className="od-planning-session-head">
        <div className="od-planning-session-title">
          {/* Static, never pulsing: a paused pass must not imitate work in progress. */}
          <i className="od-journey-dot od-journey-dot-idle" aria-hidden="true" />
          <h2>{t(titleKey)}</h2>
        </div>
        {offer === "review_plan" ? <Pill tone="success">{t("planningPass.readyPill")}</Pill> : null}
        {pass.model ? <Pill tone="neutral">{pass.model}</Pill> : null}
      </header>
      <p className="od-planning-session-sub">{t(subKey)}</p>
      {trace.length > 0 ? (
        <ol className="od-planning-session-trace" data-od-id="planning-pass-trace">
          {trace.map((line, index) => (
            <li key={`${index}-${line}`}>{line}</li>
          ))}
        </ol>
      ) : null}
      {pass.truncated ? <p className="od-planning-session-sub">{t("planningPass.trimmed")}</p> : null}
      <div className="od-planning-session-controls">
        <span className="od-planning-session-counts">
          {t("planningPass.receipt", {
            findings: pass.researchFindingCount,
            gaps: pass.researchGapCount,
            answered,
          })}
        </span>
        {offer === "review_plan" ? (
          <Button variant="primary" disabled={props.disabled} onClick={props.onReview}>
            {t("planningPass.review")}
          </Button>
        ) : (
          <Button variant="primary" disabled={props.disabled} onClick={props.onResume}>
            {failed ? t("planningPass.retry") : t("planningPass.resume")}
          </Button>
        )}
        <Button variant="ghost" disabled={props.disabled} onClick={props.onStartOver}>
          {t("planningPass.startOver")}
        </Button>
      </div>
    </Panel>
  );
}
