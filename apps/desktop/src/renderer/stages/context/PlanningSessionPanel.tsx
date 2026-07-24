/**
 * The live surface of an embedded planning session: the local agent researches
 * the aim while the user watches, interjects over temporary chat, answers the
 * brain's blocking questions (through the existing one-question clarify
 * surface), or asks it to draft now. Mounted as the Context stage's focused
 * panel, so the focused-question invariants keep holding.
 */
import { useI18n } from "../../i18n";
import { Button, Panel, Pill, TextArea } from "../../ui";
import type { ContextAnswerMap } from "./types";
import type { PlanningSessionStateView } from "../../../shared/ipc";
import { ContextClarifyPanel } from "./ContextClarifyPanel";
import { sessionQuestionClarifyOutput } from "../../workflow/planningSession";

export interface PlanningSessionPanelProps {
  view: PlanningSessionStateView;
  answers: ContextAnswerMap;
  chatDraft: string;
  disabled: boolean;
  onAnswer: (id: string, value: { labels: string[]; other: string }) => void;
  onSubmitAnswer: () => void;
  onChatDraft: (text: string) => void;
  onChatSend: () => void;
  onFinishNow: () => void;
  onCancel: () => void;
  onFallback: () => void;
  onReview: () => void;
}

export function PlanningSessionPanel(props: PlanningSessionPanelProps) {
  const { t } = useI18n();
  const view = props.view;

  if (view.pendingQuestion) {
    return (
      <ContextClarifyPanel
        clarify={sessionQuestionClarifyOutput(view.pendingQuestion)}
        phase="intake"
        answers={props.answers}
        contextNote=""
        conversationEnabled={false}
        questionnaireEnabled
        disabled={props.disabled}
        onAnswer={props.onAnswer}
        onContextNote={() => undefined}
        onRefine={props.onSubmitAnswer}
        flowKey={`planning-session-${view.goalId}-${view.pendingQuestion.id}`}
      />
    );
  }

  if (view.failure) {
    return (
      <Panel className="od-planning-session" data-od-id="planning-session-failed">
        <header className="od-planning-session-head">
          <Pill tone="warn">{t("planningSession.failedPill")}</Pill>
          <h2>{t("planningSession.failedTitle")}</h2>
          <p className="od-planning-session-sub">{view.failure.message}</p>
        </header>
        <div className="od-planning-session-actions">
          <Button variant="primary" disabled={props.disabled} onClick={props.onFallback}>
            {t("planningSession.fallback")}
          </Button>
        </div>
      </Panel>
    );
  }

  if (!view.active && view.phase === "draft_ready" && view.landing) {
    return (
      <Panel className="od-planning-session" data-od-id="planning-session-landed">
        <header className="od-planning-session-head">
          <Pill tone="success">{t("planningSession.readyPill")}</Pill>
          <h2>{t("planningSession.readyTitle")}</h2>
          <p className="od-planning-session-sub">
            {t("planningSession.readySummary", {
              findings: view.researchFindingCount,
              questions: view.questionsAsked,
            })}
          </p>
        </header>
        <div className="od-planning-session-actions">
          <Button variant="primary" disabled={props.disabled} onClick={props.onReview}>
            {t("planningSession.review")}
          </Button>
        </div>
      </Panel>
    );
  }

  const recentActivity = view.activity.slice(-8);
  return (
    <Panel className="od-planning-session" data-od-id="planning-session-live">
      <header className="od-planning-session-head">
        <Pill tone="accent">{t("planningSession.livePill")}</Pill>
        <h2>{t("planningSession.liveTitle")}</h2>
        <p className="od-planning-session-sub">
          {t("planningSession.liveStatus", {
            findings: view.researchFindingCount,
            gaps: view.researchGapCount,
            questions: view.questionsAsked,
          })}
        </p>
      </header>
      {recentActivity.length > 0 ? (
        <ul className="od-planning-session-activity" aria-label={t("planningSession.activityLabel")}>
          {recentActivity.map((item, index) => (
            <li key={`${item.at}-${index}`} data-kind={item.kind}>
              <span className="od-planning-session-activity-label">{item.label}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="od-planning-session-sub">{t("planningSession.starting")}</p>
      )}
      <div className="od-planning-session-chat">
        <TextArea
          value={props.chatDraft}
          rows={2}
          placeholder={t("planningSession.chatPlaceholder")}
          disabled={props.disabled}
          onChange={(event) => props.onChatDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              props.onChatSend();
            }
          }}
        />
        <div className="od-planning-session-actions">
          <Button
            variant="primary"
            disabled={props.disabled || !props.chatDraft.trim()}
            onClick={props.onChatSend}
          >
            {t("planningSession.chatSend")}
          </Button>
          <Button variant="ghost" disabled={props.disabled} onClick={props.onFinishNow}>
            {t("planningSession.finishNow")}
          </Button>
          <Button variant="ghost" disabled={props.disabled} onClick={props.onCancel}>
            {t("planningSession.cancel")}
          </Button>
        </div>
      </div>
    </Panel>
  );
}
