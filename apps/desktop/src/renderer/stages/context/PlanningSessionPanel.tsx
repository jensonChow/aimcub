/**
 * The live surface of an embedded planning session: the local agent researches
 * the aim while the user watches, interjects over temporary chat, answers the
 * brain's blocking questions (through the existing one-question clarify
 * surface), or asks it to draft now. Mounted as the Context stage's focused
 * panel, so the focused-question invariants keep holding.
 */
import { useI18n, type StringKey } from "../../i18n";
import { Button, Panel, Pill, TextArea } from "../../ui";
import type { ContextAnswerMap } from "./types";
import type { PlanningSessionStateView } from "../../../shared/ipc";
import { ContextClarifyPanel } from "./ContextClarifyPanel";
import { planningActivityNow, sessionQuestionClarifyOutput } from "../../workflow/planningSession";

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
        // Answering resumes the brain's research — it does not generate the plan, so the
        // funnel's "Generate plan" label would promise the wrong thing here.
        primaryLabelKey="planningSession.sendAnswer"
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

  // One "now" line carries what the brain is doing; counts appear only once they exist.
  // The chat stays a single quiet lane — optional, never the visual center of the card.
  const tk = (key: string, vars?: Record<string, string | number>) => t(key as StringKey, vars);
  const now = planningActivityNow(view.activity, tk) ?? t("planningSession.starting");
  const hasCounts = view.researchFindingCount + view.researchGapCount + view.questionsAsked > 0;
  return (
    <Panel className="od-planning-session" data-od-id="planning-session-live">
      <header className="od-planning-session-head">
        <div className="od-planning-session-title">
          <i className="od-journey-dot od-journey-dot-active" aria-hidden="true" />
          <h2>{t("planningSession.liveTitle")}</h2>
        </div>
        {view.model ? <Pill tone="neutral">{view.model}</Pill> : null}
      </header>
      <p className="od-planning-session-now" role="status" aria-live="polite">{now}</p>
      {hasCounts ? (
        <p className="od-planning-session-counts">
          {t("planningSession.liveStatus", {
            findings: view.researchFindingCount,
            gaps: view.researchGapCount,
            questions: view.questionsAsked,
          })}
        </p>
      ) : null}
      {/* One integrated composer: the field is the container, send lives inside it. */}
      <div className="od-planning-session-chat">
        <TextArea
          value={props.chatDraft}
          rows={1}
          fieldClassName="od-planning-session-chat-field"
          placeholder={t("planningSession.chatPlaceholder")}
          disabled={props.disabled}
          onChange={(event) => props.onChatDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey) return;
            event.preventDefault();
            if (props.chatDraft.trim()) props.onChatSend();
          }}
        />
        <Button
          variant="ghost"
          className="od-planning-session-chat-send"
          disabled={props.disabled || !props.chatDraft.trim()}
          onClick={props.onChatSend}
        >
          {t("planningSession.chatSend")}
        </Button>
      </div>
      <div className="od-planning-session-controls">
        <Button variant="ghost" disabled={props.disabled} onClick={props.onFinishNow}>
          {t("planningSession.finishNow")}
        </Button>
        <Button variant="ghost" disabled={props.disabled} onClick={props.onCancel}>
          {t("planningSession.cancel")}
        </Button>
      </div>
    </Panel>
  );
}
