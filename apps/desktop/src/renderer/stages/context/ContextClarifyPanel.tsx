import type { CSSProperties } from "react";

import type { ClarifyOutput } from "@core/llm";

import { useI18n } from "../../i18n";
import { C, TYPE, WEIGHT, inputStyle, primaryButton, secondaryButton } from "../../styles";
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
    <section className="od-context-clarify" data-od-id={intake ? "context-blocking-question" : "context-draft-refinement"} style={panelStyle()}>
      <div style={sectionHeaderStyle()}>
        <div>
          <div style={eyebrowStyle()}>{t(intake ? "os.contextIntakeEyebrow" : "os.draftRefinementEyebrow")}</div>
          <h2 style={sectionTitleStyle()}>
            {intake ? t("os.contextIntakeHeading") : questions.length ? t("os.clarifyHeading") : t("os.noQuestionsHeading")}
          </h2>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {props.onSkip && !primaryAcceptsDraft ? <button type="button" onClick={props.onSkip} style={{ ...secondaryButton(), marginTop: 0 }}>{secondaryLabel}</button> : null}
          <button type="button" onClick={primaryAction} disabled={primaryDisabled} style={{ ...primaryButton(primaryDisabled), marginTop: 0 }}>
            {primaryLabel}
          </button>
        </div>
      </div>
      <p style={mutedTextStyle()}>{body}</p>
      {intake && questions.length > 0 ? (
        <div className="od-context-step-progress">
          <span>
            {activeQuestionIndex >= 0
              ? t("os.contextQuestionProgress", { current: activeQuestionIndex + 1, total: questions.length })
              : t("os.contextQuestionsComplete", { total: questions.length })}
          </span>
        </div>
      ) : null}
      <div style={{ display: "grid", gap: 12 }}>
        {visibleQuestions.map((question) => {
          const answer = props.answers[question.id] ?? { labels: [], other: "" };
          const multi = question.selection_mode === "multiple";
          return (
            <div key={question.id} style={questionStyle()}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                <div style={{ fontWeight: WEIGHT.strong }}>{question.question}</div>
                <span style={badgeStyle(C.page, C.muted)}>{t(multi ? "os.multiSelect" : "os.singleSelect")}</span>
              </div>
              <div style={{ color: C.muted, fontSize: TYPE.body, marginTop: 4 }}>{question.why_high_impact}</div>
              <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                {question.options.map((option) => (
                  <button
                    type="button"
                    key={option.label}
                    onClick={() => {
                      const selected = answer.labels.includes(option.label);
                      const labels = multi
                        ? selected
                          ? answer.labels.filter((label) => label !== option.label)
                          : [...answer.labels, option.label]
                        : [option.label];
                      props.onAnswer(question.id, { ...answer, labels });
                    }}
                    style={choiceStyle(answer.labels.includes(option.label))}
                  >
                    <strong>{option.label}</strong>
                    <span>{option.tradeoff}</span>
                  </button>
                ))}
              </div>
              <input
                value={answer.other}
                onChange={(event) => props.onAnswer(question.id, { ...answer, other: event.target.value })}
                placeholder={t("os.otherAnswer")}
                style={{ ...inputStyle(), marginTop: 10 }}
              />
            </div>
          );
        })}
        {intake && props.conversationEnabled ? (
          <div style={questionStyle()}>
            <div style={{ fontWeight: WEIGHT.strong }}>{t("os.contextConversation")}</div>
            <div style={{ color: C.muted, fontSize: TYPE.body, marginTop: 4 }}>{t("os.contextConversationBody")}</div>
            <textarea
              value={props.contextNote}
              onChange={(event) => props.onContextNote(event.target.value)}
              placeholder={t("os.contextConversationPlaceholder")}
              rows={3}
              style={{ ...inputStyle(), marginTop: 10, resize: "vertical" }}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}

function panelStyle(): CSSProperties {
  return {
    background: C.surface,
    border: "none",
    borderRadius: 0,
    padding: 0,
  };
}

function sectionHeaderStyle(): CSSProperties {
  return {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 16,
    marginBottom: 14,
  };
}

function sectionTitleStyle(): CSSProperties {
  return { margin: "4px 0 0", fontSize: TYPE.title, letterSpacing: 0 };
}

function eyebrowStyle(): CSSProperties {
  return {
    color: C.accent,
    fontSize: TYPE.meta,
    fontWeight: WEIGHT.strong,
    textTransform: "uppercase",
    letterSpacing: 0,
  };
}

function mutedTextStyle(): CSSProperties {
  return { color: C.muted, fontSize: TYPE.body, lineHeight: 1.45, margin: "4px 0 0" };
}

function questionStyle(): CSSProperties {
  return {
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    padding: 14,
    background: C.surfaceWarm,
  };
}

function choiceStyle(active: boolean): CSSProperties {
  return {
    border: `1px solid ${active ? C.accent : C.border}`,
    background: active ? C.accentBg : C.surface,
    borderRadius: 8,
    padding: 12,
    display: "grid",
    gap: 4,
    textAlign: "left",
    color: C.text,
    cursor: "pointer",
  };
}

function badgeStyle(bg: string, fg: string): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 22,
    borderRadius: 999,
    padding: "2px 8px",
    background: bg,
    color: fg,
    fontSize: TYPE.meta,
    fontWeight: WEIGHT.strong,
  };
}
