import type { ClarifyOutput } from "@core/llm";

import { useI18n } from "../../i18n";
import { Button, Panel, Pill, TextArea, TextField } from "../../ui";
import type { ClarifyPhase, ContextAnswerMap } from "./types";

interface ContextClarifyPanelProps {
  clarify: ClarifyOutput;
  phase: ClarifyPhase;
  answers: ContextAnswerMap;
  contextNote: string;
  conversationEnabled: boolean;
  questionnaireEnabled: boolean;
  disabled: boolean;
  onAnswer: (id: string, value: { labels: string[]; other: string }) => void;
  onContextNote: (value: string) => void;
  onRefine: () => void;
  onSkip?: () => void;
}

export function ContextClarifyPanel(props: ContextClarifyPanelProps) {
  const { t } = useI18n();
  const intake = props.phase === "intake";
  const questions = intake && !props.questionnaireEnabled ? [] : props.clarify.questions;
  const answeredQuestionIds = new Set(Object.entries(props.answers)
    .filter(([, answer]) => answer.other.trim() || answer.labels.length > 0)
    .map(([id]) => id));
  const activeQuestionIndex = intake
    ? questions.findIndex((question) => !answeredQuestionIds.has(question.id))
    : -1;
  const visibleQuestions = intake
    ? activeQuestionIndex >= 0 ? [questions[activeQuestionIndex]!] : []
    : questions;
  const hasQuestionAnswer = Object.values(props.answers).some((answer) => answer.other.trim() || answer.labels.length > 0);
  const activeQuestion = activeQuestionIndex >= 0 ? questions[activeQuestionIndex] : null;
  const activeAnswer = activeQuestion ? props.answers[activeQuestion.id] : null;
  const activeQuestionAnswered = Boolean(activeAnswer && (activeAnswer.other.trim() || activeAnswer.labels.length > 0));
  const contextNoteProvided = props.conversationEnabled && props.contextNote.trim().length > 0;
  const hasContextAnswer = (props.conversationEnabled && props.contextNote.trim().length > 0)
    || hasQuestionAnswer;
  const primaryAcceptsDraft = !intake && !hasQuestionAnswer && Boolean(props.onSkip);
  const primaryAction = primaryAcceptsDraft && props.onSkip ? props.onSkip : props.onRefine;
  const primaryLabel = intake ? t("os.generateFromContext") : primaryAcceptsDraft ? t("os.acceptDraft") : t("os.refineDraft");
  const secondaryLabel = hasQuestionAnswer ? t("os.acceptDraft") : t("os.skipRefinement");
  const primaryDisabled = props.disabled || (intake && (
    activeQuestion
      ? !activeQuestionAnswered && !contextNoteProvided
      : !hasContextAnswer
  ));
  const body = intake
    ? t("os.contextIntakeBody")
    : questions.length
      ? t("os.clarifyBody")
      : t("os.noQuestionsBody");
  return (
    <Panel variant="plain" className="od-context-clarify" data-od-id={intake ? "context-blocking-question" : "context-draft-refinement"}>
      <div className="od-stage-panel-head od-context-clarify-head">
        <div>
          <div className="od-stage-kicker">{t(intake ? "os.contextIntakeEyebrow" : "os.draftRefinementEyebrow")}</div>
          <h2>
            {intake ? t("os.contextIntakeHeading") : questions.length ? t("os.clarifyHeading") : t("os.noQuestionsHeading")}
          </h2>
        </div>
        <div className="od-context-clarify-actions">
          {props.onSkip && !primaryAcceptsDraft ? (
            <Button variant="secondary" size="lg" className="od-context-clarify-action" onClick={props.onSkip}>
              {secondaryLabel}
            </Button>
          ) : null}
          <Button variant="primary" size="lg" className="od-context-clarify-action" onClick={primaryAction} disabled={primaryDisabled}>
            {primaryLabel}
          </Button>
        </div>
      </div>
      <p className="od-context-clarify-body">{body}</p>
      {intake && questions.length > 0 ? (
        <div className="od-context-step-progress">
          <span>
            {activeQuestionIndex >= 0
              ? t("os.contextQuestionProgress", { current: activeQuestionIndex + 1, total: questions.length })
              : t("os.contextQuestionsComplete", { total: questions.length })}
          </span>
        </div>
      ) : null}
      <div className="od-context-question-list">
        {visibleQuestions.map((question) => {
          const answer = props.answers[question.id] ?? { labels: [], other: "" };
          const multi = question.selection_mode === "multiple";
          return (
            <Panel key={question.id} variant="warm" className="od-context-question">
              <div className="od-context-question-head">
                <strong>{question.question}</strong>
                <Pill>{t(multi ? "os.multiSelect" : "os.singleSelect")}</Pill>
              </div>
              <p>{question.why_high_impact}</p>
              <div className="od-context-choice-list">
                {question.options.map((option) => (
                  <Button
                    key={option.label}
                    variant="secondary"
                    className="od-ui-button-card od-context-choice"
                    selected={answer.labels.includes(option.label)}
                    aria-pressed={answer.labels.includes(option.label)}
                    onClick={() => {
                      const selected = answer.labels.includes(option.label);
                      const labels = multi
                        ? selected
                          ? answer.labels.filter((label) => label !== option.label)
                          : [...answer.labels, option.label]
                        : [option.label];
                      props.onAnswer(question.id, { ...answer, labels });
                    }}
                  >
                    <strong>{option.label}</strong>
                    <span>{option.tradeoff}</span>
                  </Button>
                ))}
              </div>
              <TextField
                aria-label={t("os.otherAnswer")}
                value={answer.other}
                onChange={(event) => props.onAnswer(question.id, { ...answer, other: event.target.value })}
                placeholder={t("os.otherAnswer")}
                fieldClassName="od-context-other-field"
              />
            </Panel>
          );
        })}
        {intake && props.conversationEnabled ? (
          <Panel variant="warm" className="od-context-question">
            <div className="od-context-question-head">
              <strong>{t("os.contextConversation")}</strong>
            </div>
            <p>{t("os.contextConversationBody")}</p>
            <TextArea
              aria-label={t("os.contextConversation")}
              value={props.contextNote}
              onChange={(event) => props.onContextNote(event.target.value)}
              placeholder={t("os.contextConversationPlaceholder")}
              rows={3}
              fieldClassName="od-context-note-field"
            />
          </Panel>
        ) : null}
      </div>
    </Panel>
  );
}
