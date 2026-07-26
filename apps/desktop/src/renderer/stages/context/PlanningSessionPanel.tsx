/**
 * The live surface of an embedded planning session: the local agent researches
 * the aim while the user watches, interjects over temporary chat, answers the
 * brain's blocking questions (through the existing one-question clarify
 * surface), or asks it to draft now. Mounted as the Context stage's focused
 * panel, so the focused-question invariants keep holding.
 */
import { useState } from "react";

import { useI18n, type StringKey } from "../../i18n";
import { Button, Panel, Pill, TextArea } from "../../ui";
import type { ContextAnswerMap } from "./types";
import type { PlanningSessionStateView } from "../../../shared/ipc";
import { ContextClarifyPanel } from "./ContextClarifyPanel";
import { planningActivityTrace, sessionQuestionClarifyOutput } from "../../workflow/planningSession";

export interface PlanningSessionPanelProps {
  view: PlanningSessionStateView;
  answers: ContextAnswerMap;
  chatDraft: string;
  disabled: boolean;
  onAnswer: (id: string, value: { labels: string[]; other: string }) => void;
  onSubmitAnswer: () => void;
  onChatDraft: (text: string) => void;
  onChatSend: () => void;
  /** Hand local files to the running brain. Absent when the platform offers no file picker. */
  onAttachFiles?: () => Promise<void>;
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
      <Panel variant="plain" className="od-planning-session" data-od-id="planning-session-failed">
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
      <Panel variant="plain" className="od-planning-session" data-od-id="planning-session-landed">
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

  return <PlanningSessionLiveCard {...props} />;
}

function PlanningSessionLiveCard(props: PlanningSessionPanelProps) {
  const { t } = useI18n();
  const view = props.view;
  // The note lane is on-demand (founder: the researching screen needs no standing input
  // box). A non-empty draft keeps it open across re-renders and re-mounts.
  const [noteOpen, setNoteOpen] = useState(() => Boolean(props.chatDraft.trim()));
  // The native picker is modal and slow enough to double-click through; the button owns that wait.
  const [attaching, setAttaching] = useState(false);

  // The thought trace carries what the brain has been doing, ending on the current step;
  // counts appear only once they exist.
  const tk = (key: string, vars?: Record<string, string | number>) => t(key as StringKey, vars);
  const trace = planningActivityTrace(view.activity, tk);
  const lines = trace.length > 0 ? trace : [t("planningSession.starting")];
  const hasCounts = view.researchFindingCount + view.researchGapCount + view.questionsAsked > 0;

  function sendNote() {
    if (!props.chatDraft.trim()) return;
    props.onChatSend();
    setNoteOpen(false);
  }

  async function attachFiles() {
    if (!props.onAttachFiles || attaching) return;
    setAttaching(true);
    try {
      await props.onAttachFiles();
    } finally {
      setAttaching(false);
    }
  }

  // Plain like the question state: the Journey's planning island is the ONE card — a
  // chromed panel inside it reads as a card-in-card (founder: "too many layers").
  return (
    <Panel variant="plain" className="od-planning-session" data-od-id="planning-session-live">
      <header className="od-planning-session-head">
        <div className="od-planning-session-title">
          <i className="od-journey-dot od-journey-dot-active" aria-hidden="true" />
          <h2>{t("planningSession.liveTitle")}</h2>
        </div>
        {view.model ? <Pill tone="neutral">{view.model}</Pill> : null}
      </header>
      <ol className="od-planning-session-trace">
        {lines.map((line, index) => {
          const current = index === lines.length - 1;
          return (
            <li
              key={`${index}-${line}`}
              data-current={current ? "true" : undefined}
              role={current ? "status" : undefined}
              aria-live={current ? "polite" : undefined}
            >
              {line}
            </li>
          );
        })}
      </ol>
      {noteOpen ? (
        /* One integrated composer: the field is the container, send lives inside it. */
        <div className="od-planning-session-chat">
          <TextArea
            value={props.chatDraft}
            rows={1}
            autoFocus
            fieldClassName="od-planning-session-chat-field"
            placeholder={t("planningSession.chatPlaceholder")}
            disabled={props.disabled}
            onChange={(event) => props.onChatDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setNoteOpen(false);
                return;
              }
              if (event.key !== "Enter" || event.shiftKey) return;
              event.preventDefault();
              sendNote();
            }}
          />
          <Button
            variant="ghost"
            className="od-planning-session-chat-send"
            disabled={props.disabled || !props.chatDraft.trim()}
            onClick={sendNote}
          >
            {t("planningSession.chatSend")}
          </Button>
        </div>
      ) : null}
      <div className="od-planning-session-controls">
        {/* The session receipt balances the footer's left side; actions stay right. */}
        <span className="od-planning-session-counts">
          {hasCounts
            ? t("planningSession.liveStatus", {
              findings: view.researchFindingCount,
              gaps: view.researchGapCount,
              questions: view.questionsAsked,
            })
            : null}
        </span>
        {noteOpen ? null : (
          <Button variant="ghost" disabled={props.disabled} onClick={() => setNoteOpen(true)}>
            {t("planningSession.addNote")}
          </Button>
        )}
        {/* Beside the note, because handing over a file is the same act as telling it something:
            this is the moment you are watching it research and think "it should read this". */}
        {props.onAttachFiles ? (
          <Button
            variant="ghost"
            data-od-id="planning-session-attach"
            disabled={props.disabled || attaching}
            onClick={() => void attachFiles()}
          >
            {t("planningSession.attach")}
          </Button>
        ) : null}
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
