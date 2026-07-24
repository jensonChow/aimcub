/**
 * `aimcub plan` as a real planning-agent session: the embedded brain researches
 * the aim in this terminal, streams its activity, asks blocking questions
 * inline, and accepts temporary-chat interjections — the deep agent-CLI shape
 * of the same session Desktop runs.
 *
 * Interaction contract (interactive TTY):
 *   - a pending question takes over the prompt: answer with option numbers
 *     ("1" or "1,3"), free text, or "-" to skip;
 *   - any other typed line is temporary chat to the brain;
 *   - "/finish" asks the brain to draft now; "/cancel" (or Ctrl+C) stops.
 * Non-interactive runs (piped stdin/stdout) get a question budget of zero:
 * the brain researches and submits without blocking on a user who is not there.
 */
import { createInterface, type Interface } from "node:readline";

import type { PlanningMemory, PlanningSessionOutcome, PlanningSessionQuestion } from "@aimcub/llm";
import { startEmbeddedPlanningSession, type LocalAgentId } from "@aimcub/local-agent";

export interface EmbeddedPlanCliOptions {
  agentId: LocalAgentId;
  title: string;
  description?: string;
  memories: readonly PlanningMemory[];
  /** Grants the brain its own live web tools (`--network`, mirroring `aimcub run`). */
  network: boolean;
  interactive: boolean;
  /** Status lines go here (stderr), keeping stdout clean for the result. */
  log: (line: string) => void;
}

export interface EmbeddedPlanCliFailure {
  code: string;
  message: string;
}

/**
 * Parse one typed answer line for a question. Number lists select options
 * (1-based); "-" skips; anything else is a free-text answer.
 */
export function parseSessionAnswerLine(
  question: PlanningSessionQuestion,
  line: string,
): { labels: string[]; other: string | null; skipped?: boolean } {
  const trimmed = line.trim();
  if (trimmed === "-") return { labels: [], other: null, skipped: true };
  const numberList = /^\d+(?:\s*[,，\s]\s*\d+)*$/u;
  if (question.options.length > 0 && numberList.test(trimmed)) {
    const indexes = [...new Set(trimmed.split(/[,，\s]+/u).map((token) => Number(token)))];
    const labels = indexes
      .filter((index) => index >= 1 && index <= question.options.length)
      .map((index) => question.options[index - 1]!.label);
    if (labels.length > 0) {
      const bounded = question.selection_mode === "single" ? labels.slice(0, 1) : labels;
      return { labels: bounded, other: null };
    }
  }
  return { labels: [], other: trimmed || null };
}

export function renderSessionQuestion(question: PlanningSessionQuestion, log: (line: string) => void): void {
  log("");
  log(`? ${question.question}`);
  if (question.why_high_impact) log(`  (${question.why_high_impact})`);
  question.options.forEach((option, index) => {
    log(`  ${index + 1}. ${option.label}${option.tradeoff ? ` — ${option.tradeoff}` : ""}`);
  });
  log(
    question.options.length > 0
      ? question.selection_mode === "single"
        ? "  Answer with ONE option number, your own text, or - to skip."
        : "  Answer with option numbers (e.g. 1,3), your own text, or - to skip."
      : "  Type your answer, or - to skip.",
  );
}

/** Pretty session provenance printed after the plan: what the brain did and disclosed. */
export function formatSessionSummary(outcome: PlanningSessionOutcome): string {
  const lines = ["", "Session:", `  questions answered: ${outcome.answers.length} · submit attempts: ${outcome.attempts}`];
  if (outcome.research.findings.length > 0) {
    lines.push(`  research findings (${outcome.research.findings.length}):`);
    for (const finding of outcome.research.findings.slice(0, 6)) {
      lines.push(`    - ${finding.summary}${finding.source_urls[0] ? ` [${finding.source_urls[0]}]` : ""}`);
    }
  }
  if (outcome.research.gaps.length > 0) lines.push(`  research gaps: ${outcome.research.gaps.join(" · ")}`);
  if (outcome.assumptions.length > 0) {
    lines.push("  assumptions (defaulted, not asked):");
    for (const assumption of outcome.assumptions) {
      lines.push(`    - ${assumption.statement}${assumption.default_value ? ` (default: ${assumption.default_value})` : ""}`);
    }
  }
  if (outcome.openQuestions.length > 0) lines.push(`  open questions: ${outcome.openQuestions.join(" · ")}`);
  if (outcome.memoryCandidates.length > 0) {
    lines.push(`  proposed durable context: ${outcome.memoryCandidates.length} candidate${outcome.memoryCandidates.length === 1 ? "" : "s"} (not stored by \`plan\`)`);
  }
  return lines.join("\n");
}

/** Run the embedded planning session in this terminal and return its outcome. */
export async function runEmbeddedPlanCli(
  options: EmbeddedPlanCliOptions,
): Promise<{ outcome: PlanningSessionOutcome } | { outcome: null; failure: EmbeddedPlanCliFailure }> {
  const log = options.log;
  let pendingQuestion: PlanningSessionQuestion | null = null;
  let rl: Interface | null = null;

  const handle = await startEmbeddedPlanningSession({
    agentId: options.agentId,
    aim: { title: options.title, description: options.description },
    memories: options.memories,
    webResearch: { enabled: options.network, required: false },
    cwd: process.cwd(),
    ...(options.interactive ? {} : { budgets: { maxQuestions: 0 } }),
  }, {
    onSessionEvent: (event) => {
      if (event.type === "question_asked") {
        pendingQuestion = event.question;
        renderSessionQuestion(event.question, log);
        rl?.prompt();
      }
      if (event.type === "question_answered") pendingQuestion = null;
      if (event.type === "research_reported") log(`  · research: +${event.findingCount} findings, +${event.gapCount} gaps`);
      if (event.type === "plan_rejected") log(`  · plan attempt ${event.attempt} bounced (${event.reason}); the brain is repairing it`);
      if (event.type === "plan_accepted") log("  · plan accepted");
    },
    onActivity: (event) => {
      if (event.type === "agent.tool.started" && event.toolName) log(`  · ${event.toolName}`);
      if (event.type === "agent.run.started") log("  · brain started");
    },
  });

  if (options.interactive) {
    rl = createInterface({ input: process.stdin, output: process.stderr, prompt: "> " });
    log("Chat anytime; /finish drafts now; /cancel stops. Questions take over the prompt.");
    rl.on("line", (line) => {
      const text = line.trim();
      if (pendingQuestion) {
        const parsed = parseSessionAnswerLine(pendingQuestion, line);
        if (parsed.labels.length === 0 && parsed.other === null && !parsed.skipped) {
          renderSessionQuestion(pendingQuestion, log);
          rl?.prompt();
          return;
        }
        handle.provideAnswer(pendingQuestion.id, {
          selected_labels: parsed.labels,
          other_text: parsed.other,
          ...(parsed.skipped ? { skipped: true } : {}),
        });
        pendingQuestion = null;
        rl?.prompt();
        return;
      }
      if (text === "/cancel") {
        handle.cancel();
        return;
      }
      if (text === "/finish") {
        handle.requestFinishNow();
        log("  · asked the brain to draft now");
        rl?.prompt();
        return;
      }
      if (text) handle.postUserMessage(text);
      rl?.prompt();
    });
    rl.on("SIGINT", () => handle.cancel());
    rl.prompt();
  }

  const result = await handle.done;
  rl?.close();
  if (result.outcome) return { outcome: result.outcome };
  const failure = result.failure ?? result.processFailure ?? {
    code: "unknown",
    message: "The planning session ended without a result.",
  };
  return { outcome: null, failure: { code: failure.code, message: failure.message } };
}
