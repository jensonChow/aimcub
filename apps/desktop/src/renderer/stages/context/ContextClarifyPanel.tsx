import { useEffect, useRef, useState } from "react";

import { decideChoiceSelection } from "@aimcub/core";
import type { ClarifyOutput } from "@aimcub/llm";

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
  onOpenSettings?: () => void;
  flowKey?: string;
}

interface ContextClarifyFlowProps extends ContextClarifyPanelProps {
  questions: ClarifyOutput["questions"];
}

type ContextChoiceAnswer = { labels: string[]; other: string };

export function selectContextChoice(
  answer: ContextChoiceAnswer,
  label: string,
  mode: "single" | "multiple",
): ContextChoiceAnswer {
  if (mode === "single") return { labels: [label], other: "" };
  const selected = answer.labels.includes(label);
  return {
    ...answer,
    labels: selected
      ? answer.labels.filter((candidate) => candidate !== label)
      : [...answer.labels, label],
  };
}

export function setContextOtherAnswer(
  answer: ContextChoiceAnswer,
  other: string,
  mode: "single" | "multiple",
): ContextChoiceAnswer {
  return {
    labels: mode === "single" ? [] : answer.labels,
    other,
  };
}

export function nextRadioIndex(current: number, key: string, count: number): number | null {
  if (count <= 0) return null;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowRight" || key === "ArrowDown") return (current + 1) % count;
  if (key === "ArrowLeft" || key === "ArrowUp") return (current - 1 + count) % count;
  return null;
}

function answerProvided(answer: { labels: string[]; other: string } | undefined): boolean {
  return Boolean(answer && (answer.labels.length > 0 || answer.other.trim()));
}

function firstUnansweredQuestionIndex(
  questions: ClarifyOutput["questions"],
  answers: ContextAnswerMap,
): number {
  const index = questions.findIndex((question) => !answerProvided(answers[question.id]));
  return index >= 0 ? index : Math.max(questions.length - 1, 0);
}

function ContextClarifyFlow(props: ContextClarifyFlowProps) {
  const { t } = useI18n();
  const intake = props.phase === "intake";
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(() =>
    firstUnansweredQuestionIndex(props.questions, props.answers));
  const questionHeadingRef = useRef<HTMLHeadingElement>(null);
  const questionIndex = Math.min(activeQuestionIndex, Math.max(props.questions.length - 1, 0));
  const activeQuestion = props.questions[questionIndex] ?? null;
  const activeAnswer = activeQuestion
    ? props.answers[activeQuestion.id] ?? { labels: [], other: "" }
    : null;
  const activeSelectionMode = activeQuestion
    ? decideChoiceSelection({
      question: activeQuestion.question,
      options: activeQuestion.options.map((option) => ({ label: option.label, detail: option.tradeoff })),
      requestedMode: activeQuestion.selection_mode,
      requestedReason: activeQuestion.selection_mode_reason,
    }).mode
    : "multiple";
  const activeQuestionAnswered = answerProvided(activeAnswer ?? undefined);
  const hasQuestionAnswer = Object.values(props.answers).some(answerProvided);
  const contextNoteProvided = props.conversationEnabled && props.contextNote.trim().length > 0;
  const hasNextQuestion = Boolean(activeQuestion && questionIndex < props.questions.length - 1);
  const intakePaused = intake && !activeQuestion && !props.conversationEnabled;
  const primaryAcceptsDraft = !intake && !hasQuestionAnswer && !hasNextQuestion && Boolean(props.onSkip);
  const primaryLabel = intakePaused
    ? t("context.workbench.manage")
    : hasNextQuestion
      ? t("os.nextQuestion")
      : intake
        ? t("os.generateFromContext")
        : primaryAcceptsDraft
          ? t("os.acceptDraft")
          : t("os.refineDraft");
  const primaryDisabled = props.disabled || (intake && !intakePaused && (
    activeQuestion ? !activeQuestionAnswered : !contextNoteProvided
  ));

  useEffect(() => {
    if (!activeQuestion) return;
    questionHeadingRef.current?.focus();
  }, [activeQuestion?.id]);

  function showQuestion(index: number) {
    setActiveQuestionIndex(index);
  }

  function runPrimaryAction() {
    if (intakePaused) {
      props.onOpenSettings?.();
      return;
    }
    if (hasNextQuestion) {
      showQuestion(questionIndex + 1);
      return;
    }
    if (primaryAcceptsDraft && props.onSkip) {
      props.onSkip();
      return;
    }
    props.onRefine();
  }

  return (
    <Panel
      variant="plain"
      className="od-context-clarify"
      data-od-id={intake ? "context-blocking-question" : "context-draft-refinement"}
      data-phase={intake ? "intake" : "refinement"}
    >
      {activeQuestion && activeAnswer ? (
        <>
          <header className="od-context-question-focus">
            <div className="od-context-question-meta">
              <span>{t("os.contextQuestionProgress", { current: questionIndex + 1, total: props.questions.length })}</span>
              <Pill>{t(activeSelectionMode === "multiple" ? "os.multiSelect" : "os.singleSelect")}</Pill>
            </div>
            <h2 ref={questionHeadingRef} tabIndex={-1}>{activeQuestion.question}</h2>
            <p>{activeQuestion.why_high_impact}</p>
          </header>

          <div
            className="od-context-answer-focus"
            data-od-id={intake ? "context-user-reply" : undefined}
          >
            <div
              className="od-context-choice-list"
              role={activeSelectionMode === "single" ? "radiogroup" : "group"}
              aria-label={activeQuestion.question}
            >
              {activeQuestion.options.map((option, optionIndex) => (
                <Button
                  key={option.label}
                  variant="secondary"
                  className="od-ui-button-card od-context-choice"
                  selected={activeAnswer.labels.includes(option.label)}
                  role={activeSelectionMode === "single" ? "radio" : undefined}
                  aria-checked={activeSelectionMode === "single"
                    ? activeAnswer.labels.includes(option.label)
                    : undefined}
                  aria-pressed={activeSelectionMode === "multiple"
                    ? activeAnswer.labels.includes(option.label)
                    : undefined}
                  tabIndex={activeSelectionMode === "single"
                    ? activeAnswer.labels.includes(option.label) || (activeAnswer.labels.length === 0 && optionIndex === 0)
                      ? 0
                      : -1
                    : undefined}
                  disabled={props.disabled}
                  onClick={() => {
                    props.onAnswer(
                      activeQuestion.id,
                      selectContextChoice(activeAnswer, option.label, activeSelectionMode),
                    );
                  }}
                  onKeyDown={(event) => {
                    if (activeSelectionMode !== "single") return;
                    const nextIndex = nextRadioIndex(optionIndex, event.key, activeQuestion.options.length);
                    if (nextIndex === null) return;
                    event.preventDefault();
                    const nextOption = activeQuestion.options[nextIndex];
                    if (!nextOption) return;
                    props.onAnswer(
                      activeQuestion.id,
                      selectContextChoice(activeAnswer, nextOption.label, "single"),
                    );
                    const radios = event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="radio"]');
                    radios?.[nextIndex]?.focus();
                  }}
                >
                  <strong>{option.label}</strong>
                  <span>{option.tradeoff}</span>
                </Button>
              ))}
            </div>
            {activeQuestion.allow_other ? (
              <TextField
                label={t("os.otherAnswer")}
                value={activeAnswer.other}
                disabled={props.disabled}
                onChange={(event) => props.onAnswer(
                  activeQuestion.id,
                  setContextOtherAnswer(activeAnswer, event.target.value, activeSelectionMode),
                )}
                placeholder={t("os.otherAnswerPlaceholder")}
                fieldClassName="od-context-other-field"
              />
            ) : null}
          </div>
        </>
      ) : (
        <>
          <div className="od-stage-panel-head od-context-clarify-head">
            <div>
              <div className="od-stage-kicker">
                {t(intake ? "os.contextIntakeEyebrow" : "os.draftRefinementEyebrow")}
              </div>
              <h2>
                {intakePaused
                  ? t("os.contextIntakePausedHeading")
                  : intake
                    ? t("os.contextConversation")
                    : t("os.noQuestionsHeading")}
              </h2>
            </div>
          </div>
          <p className="od-context-clarify-body">
            {intakePaused
              ? t("os.contextIntakePausedBody")
              : intake
                ? t("os.contextConversationBody")
                : t("os.noQuestionsBody")}
          </p>
          {intake && props.conversationEnabled ? (
            <TextArea
              label={t("os.contextConversation")}
              value={props.contextNote}
              disabled={props.disabled}
              onChange={(event) => props.onContextNote(event.target.value)}
              placeholder={t("os.contextConversationPlaceholder")}
              rows={4}
              fieldClassName="od-context-note-field"
            />
          ) : null}
        </>
      )}

      <footer className="od-context-clarify-footer">
        <div>
          {activeQuestion && questionIndex > 0 ? (
            <Button
              variant="ghost"
              size="lg"
              disabled={props.disabled}
              onClick={() => showQuestion(Math.max(0, questionIndex - 1))}
            >
              {t("common.back")}
            </Button>
          ) : null}
        </div>
        <div className="od-context-clarify-actions">
          {props.onSkip && !primaryAcceptsDraft ? (
            <Button
              variant="secondary"
              size="lg"
              className="od-context-clarify-action"
              disabled={props.disabled}
              onClick={props.onSkip}
            >
              {t(hasQuestionAnswer ? "os.acceptDraft" : "os.skipRefinement")}
            </Button>
          ) : null}
          <Button
            variant="primary"
            size="lg"
            className="od-context-clarify-action"
            onClick={runPrimaryAction}
            disabled={primaryDisabled}
          >
            {primaryLabel}
          </Button>
        </div>
      </footer>
    </Panel>
  );
}

export function ContextClarifyPanel(props: ContextClarifyPanelProps) {
  const questions = props.phase === "intake" && !props.questionnaireEnabled
    ? []
    : props.clarify.questions;
  const flowKey = `${props.flowKey ?? "default"}:${props.phase ?? "none"}:${questions
    .map((question) => `${question.id}:${question.question}`)
    .join("|")}`;

  return <ContextClarifyFlow key={flowKey} {...props} questions={questions} />;
}
