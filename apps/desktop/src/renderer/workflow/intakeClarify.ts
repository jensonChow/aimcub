import type { AimIntakeReport } from "@core/domain";
import type { ClarifyAnswer, ClarifyOutput, ClarifyQuestion, ClarifySelectionMode } from "@core/llm";
import type { ContextCategory } from "@core/types";

import type { ContextAnswerMap } from "../stages/context/types";

export function hasCjkText(value: string): boolean {
  return /[\u3400-\u9fff]/.test(value);
}

function intakeQuestionKind(category: ContextCategory): ClarifyQuestion["kind"] {
  if (category === "capability") return "capability";
  if (category === "constraint") return "constraint";
  if (category === "preference") return "scope";
  return "assumption";
}

function intakeQuestionDimension(category: ContextCategory): ClarifyQuestion["source_dimension"] {
  if (category === "eval_signal" || category === "procedure") return "verifiability";
  if (category === "constraint") return "granularity";
  return "context_fit";
}

function intakeQuestionSelectionMode(category: ContextCategory): ClarifySelectionMode {
  return category === "preference" ? "single" : "multiple";
}

function intakeOptions(category: ContextCategory, zh: boolean): ClarifyQuestion["options"] {
  if (zh) {
    switch (category) {
      case "eval_signal":
        return [
          { label: "\u81ea\u52a8\u8bc1\u636e", tradeoff: "\u540e\u7eed\u8fdb\u5ea6\u53ef\u4ee5\u5c3d\u91cf\u7531 CI\u3001\u6587\u4ef6\u6216\u8fd0\u884c\u7ed3\u679c\u8bc1\u660e\u3002" },
          { label: "\u4eba\u5de5\u786e\u8ba4", tradeoff: "\u4fdd\u7559\u4e3b\u89c2\u9a8c\u6536\uff0c\u4f46\u9700\u8981\u4f60\u6700\u7ec8\u786e\u8ba4\u3002" },
          { label: "\u53ef\u4ea4\u4ed8\u7269", tradeoff: "\u7528\u660e\u786e\u4ea7\u7269\u4f5c\u4e3a\u5b8c\u6210\u6807\u51c6\u3002" },
        ];
      case "constraint":
        return [
          { label: "\u8d26\u53f7/\u6743\u9650\u524d\u7f6e", tradeoff: "\u4f1a\u5148\u5904\u7406\u5f00\u53d1\u8005\u8d26\u53f7\u3001\u6388\u6743\u3001\u51ed\u8bc1\u6216\u5ba1\u6279\u3002" },
          { label: "\u5e73\u53f0/\u5de5\u5177\u9650\u5236", tradeoff: "\u4f1a\u5f71\u54cd\u6280\u672f\u8def\u7ebf\u548c\u6267\u884c\u65b9\u5f0f\u3002" },
          { label: "\u65f6\u95f4/\u9884\u7b97\u9650\u5236", tradeoff: "\u4f1a\u5f71\u54cd\u91cc\u7a0b\u7891\u7c92\u5ea6\u548c\u53d6\u820d\u3002" },
          { label: "\u9690\u79c1/\u8d28\u91cf\u9650\u5236", tradeoff: "\u4f1a\u5f71\u54cd\u9a8c\u6536\u6807\u51c6\u548c\u53ef\u59d4\u6d3e\u8303\u56f4\u3002" },
        ];
      case "procedure":
        return [
          { label: "\u5df2\u6709\u5de5\u4f5c\u6d41", tradeoff: "\u8ba1\u5212\u4f1a\u590d\u7528\u73b0\u6709\u6b65\u9aa4\u548c\u547d\u4ee4\u3002" },
          { label: "\u5df2\u6709\u6750\u6599", tradeoff: "\u9700\u8981\u5148\u8bfb\u6750\u6599\u518d\u62c6\u76ee\u6807\u3002" },
          { label: "\u9700\u8981\u65b0\u6d41\u7a0b", tradeoff: "\u8ba1\u5212\u4f1a\u5305\u542b\u6d41\u7a0b\u5b9a\u4e49\u3002" },
        ];
      case "capability":
        return [
          { label: "agent \u53ef\u6267\u884c", tradeoff: "\u6570\u5b57\u5316\u5de5\u4f5c\u4f18\u5148\u4ea4\u7ed9 agent\u3002" },
          { label: "\u6211\u6709\u9886\u57df\u7ecf\u9a8c", tradeoff: "\u8ba1\u5212\u4f1a\u590d\u7528\u4f60\u7684\u7ecf\u9a8c\u3001\u54c1\u5473\u548c\u5224\u65ad\u3002" },
          { label: "\u9700\u8981\u4f60\u51b3\u7b56", tradeoff: "\u5173\u952e\u9009\u62e9\u4f1a\u4fdd\u7559\u7ed9\u4eba\u3002" },
          { label: "\u9700\u8981\u5916\u90e8\u4e13\u5bb6/\u7d20\u6750", tradeoff: "\u8ba1\u5212\u4f1a\u5148\u5904\u7406\u4e13\u4e1a\u8f93\u5165\u3001access \u6216\u7d20\u6750\u3002" },
        ];
      case "project_fact":
        return [
          { label: "\u7528\u6237/\u573a\u666f\u660e\u786e", tradeoff: "\u53ef\u4ee5\u56f4\u7ed5\u771f\u5b9e\u4f7f\u7528\u573a\u666f\u62c6\u5206\u3002" },
          { label: "\u76ee\u6807\u8303\u56f4\u5df2\u660e\u786e", tradeoff: "\u53ef\u4ee5\u66f4\u5feb\u62c6\u5206\u3002" },
          { label: "\u5f53\u524d\u72b6\u6001\u9700\u8981\u68c0\u67e5", tradeoff: "\u5148\u6536\u96c6\u73b0\u72b6\u518d\u62c6\u5206\u3002" },
          { label: "\u4ea4\u4ed8\u5f62\u5f0f\u5f85\u5b9a", tradeoff: "\u9700\u8981\u5148\u786e\u5b9a\u4ea7\u7269\u3002" },
        ];
      case "preference":
        return [
          { label: "\u901f\u5ea6\u4f18\u5148", tradeoff: "\u8ba1\u5212\u4f1a\u504f\u5411\u8f83\u5c0f\u53ef\u4ea4\u4ed8\u7248\u672c\u3002" },
          { label: "\u8d28\u91cf\u4f18\u5148", tradeoff: "\u8ba1\u5212\u4f1a\u52a0\u5165\u66f4\u591a\u9a8c\u8bc1\u6b65\u9aa4\u3002" },
        ];
    }
  }

  switch (category) {
    case "eval_signal":
      return [
        { label: "Automated evidence", tradeoff: "Progress can be proven by CI, files, or run results." },
        { label: "Manual approval", tradeoff: "Subjective acceptance stays with you." },
        { label: "Deliverable artifact", tradeoff: "Completion is tied to a concrete artifact." },
      ];
    case "constraint":
      return [
        { label: "Account/access prerequisites", tradeoff: "Developer accounts, credentials, approvals, or permissions become prerequisites." },
        { label: "Platform/tool limits", tradeoff: "Changes the technical route and execution surface." },
        { label: "Time/budget limits", tradeoff: "Changes milestone size and tradeoffs." },
        { label: "Privacy/quality limits", tradeoff: "Changes acceptance rules and delegation." },
      ];
    case "procedure":
      return [
        { label: "Existing workflow", tradeoff: "The plan should reuse known steps and commands." },
        { label: "Existing materials", tradeoff: "Aimcub should inspect source material before planning." },
        { label: "New procedure needed", tradeoff: "The plan should include defining the workflow." },
      ];
    case "capability":
      return [
        { label: "Agent can execute", tradeoff: "Digital work should route to an agent first." },
        { label: "I have domain expertise", tradeoff: "The plan should reuse your experience, taste, and judgment." },
        { label: "You must decide", tradeoff: "Key decisions should stay human-owned." },
        { label: "External expert/material needed", tradeoff: "Expert input, access, assets, or vendors become prerequisites." },
      ];
    case "project_fact":
      return [
        { label: "User/scenario is clear", tradeoff: "The plan can decompose around the real usage situation." },
        { label: "Scope is clear", tradeoff: "Aimcub can decompose faster." },
        { label: "Current state needs inspection", tradeoff: "Context should be gathered before decomposition." },
        { label: "Deliverable is undecided", tradeoff: "The plan should first pin down the artifact." },
      ];
    case "preference":
      return [
        { label: "Move fast", tradeoff: "The plan favors a smaller deliverable." },
        { label: "Optimize quality", tradeoff: "The plan adds more verification." },
      ];
  }
}

export function intakeToClarifyOutput(intake: AimIntakeReport, zh: boolean): ClarifyOutput {
  return {
    questions: intake.questions.map((question): ClarifyQuestion => ({
      id: `intake_${question.id}`,
      question: question.prompt,
      why_high_impact: question.whyHighImpact ?? question.reason,
      kind: intakeQuestionKind(question.category),
      source_dimension: intakeQuestionDimension(question.category),
      why_asked: [{
        code: "aim_intake",
        detail: question.reason,
        category: question.category,
        priority: question.priority,
        ...(question.gapSource ? { gapSource: question.gapSource } : {}),
        ...(question.nodeKey ? { nodeKey: question.nodeKey } : {}),
        ...(question.nodeTitle ? { nodeTitle: question.nodeTitle } : {}),
      }],
      capture: question.capture,
      allow_other: true,
      selection_mode: question.selectionMode ?? intakeQuestionSelectionMode(question.category),
      options: question.options?.length ? question.options : intakeOptions(question.category, zh),
    })),
    assumptions: [],
  };
}

export function shouldBlockForIntake(intake: AimIntakeReport): boolean {
  return intake.loop.shouldContinue
    || intake.questions.some((question) => question.priority === "high" || question.priority === "medium");
}

export function answerText(answer: ClarifyAnswer): string {
  const selected = Array.isArray(answer.selected_labels) && answer.selected_labels.length > 0
    ? answer.selected_labels.join("; ")
    : answer.selected_label ?? "";
  return [selected, answer.other_text ?? ""].filter((part) => part.trim().length > 0).join(selected ? "; " : "");
}

export function answersFor(output: ClarifyOutput | null, answerMap: ContextAnswerMap): ClarifyAnswer[] {
  const questions = output?.questions ?? [];
  return questions.flatMap((question) => {
    const answer = answerMap[question.id];
    const labels = answer?.labels.map((label) => label.trim()).filter(Boolean) ?? [];
    const selectedLabel = labels[0] ?? null;
    const other = answer?.other.trim() || null;
    if (labels.length === 0 && !other) return [];
    return [{
      question_id: question.id,
      selected_label: selectedLabel,
      selected_labels: labels,
      other_text: other,
    }];
  });
}

export function buildDescriptionWithContext(input: {
  baseDescription: string;
  intakeClarify: ClarifyOutput | null;
  intakeAnswers: ContextAnswerMap;
  contextNote: string;
}): string | undefined {
  const base = input.baseDescription.trim();
  const contextLines: string[] = [];
  const intakeQuestions = new Map((input.intakeClarify?.questions ?? []).map((question) => [question.id, question.question]));
  for (const answer of answersFor(input.intakeClarify, input.intakeAnswers)) {
    const text = answerText(answer);
    if (!text) continue;
    contextLines.push(`- ${intakeQuestions.get(answer.question_id) ?? answer.question_id}: ${text}`);
  }
  if (input.contextNote.trim()) contextLines.push(`- Additional context: ${input.contextNote.trim()}`);
  const contextBlock = contextLines.length > 0
    ? ["Context collected before decomposition:", ...contextLines].join("\n")
    : "";
  return [base, contextBlock].filter((part) => part.trim().length > 0).join("\n\n") || undefined;
}
