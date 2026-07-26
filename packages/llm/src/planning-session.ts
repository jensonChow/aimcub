/**
 * Planning-session protocol — the aim-breakdown loop driven by an embedded brain.
 *
 * The old shape was a fixed funnel: the runtime executed research tools in a
 * hardcoded order, compressed the results, and asked a model for one structured
 * decomposition. This module inverts that: a planning BRAIN (an embedded local
 * agent, or any future tool-driving loop) researches with its own tools, asks the
 * user blocking questions, receives temporary-chat interjections, and finally
 * submits a plan that Aimcub validates with the same zod + `validatePlan` +
 * `critiquePlan` gates the funnel used.
 *
 * This layer is PURE protocol: no processes, no transports, no timers. A host
 * (the local MCP bridge in `@aimcub/local-agent`, a TTY shell, a test script)
 * adapts its transport to three calls:
 *
 *   - `handleToolCall(name, input)` → an immediate reply, or a parked question
 *     (`pending_user`) the host resolves later with `provideAnswer`.
 *   - `postUserMessage(text)` / `requestFinishNow()` for the temporary chat.
 *   - `finalize()` when the brain's process ends, so a valid-but-unaccepted
 *     submission is still honored and anything less fails honestly.
 *
 * Total like the funnel: bad brain output becomes a repair reply or an honest
 * failure, never a throw.
 */
import { DecompositionOutput, type AimDraftPlanningSession } from "@aimcub/types";
import {
  CHOICE_SELECTION_REASONS,
  critiquePlan,
  decideChoiceSelection,
  validatePlan,
  type ChoiceSelectionReason,
  type PlanQualityReport,
} from "@aimcub/core";

import { normalizeRawPlan } from "./decompose";
import type { ClarifyQuestionKind } from "./clarify";
import type { PlanningMemory } from "./planning-context";
import type { AimOutputLanguage } from "./language";
import { isPlanningSessionToolName, type PlanningSessionToolName } from "./planning-session-tools";
import type { GoalDomain } from "@aimcub/types";

// ── Session shapes ──────────────────────────────────────────────────────────

export type PlanningSessionPhase = "researching" | "waiting_user" | "draft_ready" | "failed" | "canceled";

export interface PlanningSessionAim {
  title: string;
  description?: string;
  /** Honest classification only: null/absent means "not known yet — the brain infers it". */
  domain?: GoalDomain | null;
  outputLanguage?: AimOutputLanguage;
}

export interface PlanningSessionBudgets {
  /** Maximum blocking user questions in one session. */
  maxQuestions: number;
  /** Maximum `submit_plan` attempts (including the one quality bounce). */
  maxSubmitAttempts: number;
  /** Maximum `report_research` calls kept in the session log. */
  maxResearchReports: number;
}

export const DEFAULT_PLANNING_SESSION_BUDGETS: PlanningSessionBudgets = {
  maxQuestions: 6,
  maxSubmitAttempts: 4,
  maxResearchReports: 20,
};

/**
 * Size bounds for a CHECKPOINTED pass (`planningSessionDraftState`). A pass is now
 * written to the store while it runs, and the store is one JSON file behind an
 * advisory lock — an unbounded transcript would grow every checkpoint. Oldest
 * entries are dropped first (the newest turns are what a resume needs), and the
 * drop is always declared through `truncated` rather than hidden.
 */
export interface PlanningPassBounds {
  /** Transcript entries kept, newest-first priority. */
  maxTranscriptEntries: number;
  /** Research findings kept — the primary fuel for a resumed pass. */
  maxResearchFindings: number;
  /** Total serialized budget; oldest transcript entries then findings give way to it. */
  maxSerializedBytes: number;
}

export const DEFAULT_PLANNING_PASS_BOUNDS: PlanningPassBounds = {
  maxTranscriptEntries: 200,
  maxResearchFindings: 120,
  maxSerializedBytes: 256 * 1024,
};

export interface PlanningSessionQuestionOption {
  label: string;
  tradeoff: string;
}

/** ClarifyQuestion-compatible payload so existing question surfaces render it as-is. */
export interface PlanningSessionQuestion {
  id: string;
  question: string;
  kind: ClarifyQuestionKind;
  why_high_impact: string;
  allow_other: true;
  selection_mode: "single" | "multiple";
  selection_mode_reason: ChoiceSelectionReason;
  capture_scope: "global" | "current_aim" | "none";
  options: PlanningSessionQuestionOption[];
}

export interface PlanningSessionAnswer {
  selected_labels: string[];
  other_text: string | null;
  skipped?: boolean;
}

export interface PlanningSessionResearchFinding {
  summary: string;
  source_urls: string[];
  lane?: string;
}

export interface PlanningSessionResearchLog {
  findings: PlanningSessionResearchFinding[];
  gaps: string[];
  summary?: string;
}

export interface PlanningSessionMemoryCandidate {
  content: string;
  category: string;
  scope: "global" | "current_aim";
}

export interface PlanningSessionAssumption {
  statement: string;
  default_value: string;
}

export interface PlanningSessionQnA {
  question: PlanningSessionQuestion;
  answer: PlanningSessionAnswer;
}

export type PlanningSessionTranscriptEntry =
  | { at: string; kind: "user_message"; text: string; delivered: boolean }
  | { at: string; kind: "question"; question: PlanningSessionQuestion }
  | { at: string; kind: "answer"; request_id: string; answer: PlanningSessionAnswer }
  | { at: string; kind: "research"; findings: PlanningSessionResearchFinding[]; gaps: string[] }
  | { at: string; kind: "memory_candidate"; candidate: PlanningSessionMemoryCandidate }
  | { at: string; kind: "plan_attempt"; attempt: number; accepted: boolean; errors: string[]; quality_grade: string | null }
  | { at: string; kind: "note"; text: string };

export interface PlanningSessionFailure {
  code: "no_plan_submitted" | "no_valid_plan" | "canceled";
  message: string;
  /** Validation errors from the last rejected submission, when any. */
  lastErrors: string[];
}

export interface PlanningSessionOutcome {
  plan: DecompositionOutput;
  quality: PlanQualityReport;
  attempts: number;
  acceptedAttempt: number;
  /** True when the plan was accepted by `finalize()` rather than an in-session submit. */
  acceptedAtSessionEnd: boolean;
  assumptions: PlanningSessionAssumption[];
  openQuestions: string[];
  research: PlanningSessionResearchLog;
  memoryCandidates: PlanningSessionMemoryCandidate[];
  answers: PlanningSessionQnA[];
}

export type PlanningSessionEvent =
  | { type: "phase_changed"; phase: PlanningSessionPhase }
  | { type: "question_asked"; question: PlanningSessionQuestion }
  | { type: "question_answered"; requestId: string; answer: PlanningSessionAnswer }
  | { type: "user_message_queued"; text: string }
  | { type: "research_reported"; findingCount: number; gapCount: number }
  | { type: "memory_proposed"; candidate: PlanningSessionMemoryCandidate }
  | { type: "plan_rejected"; attempt: number; reason: "validation" | "quality"; errors: string[] }
  | { type: "plan_accepted"; attempt: number; qualityGrade: PlanQualityReport["grade"]; atSessionEnd: boolean }
  | { type: "session_failed"; failure: PlanningSessionFailure }
  | { type: "session_canceled" };

export interface PlanningSessionMemorySearchInput {
  query: string;
  scope: "global" | "current_aim" | "both";
  limit: number;
}

export interface PlanningSessionMemorySearchRow {
  content: string;
  category: string;
  kind: string;
  scope: string;
}

export interface PlanningSessionConfig {
  aim: PlanningSessionAim;
  /** Durable memories preselected for this aim; also the default `search_memory` corpus. */
  memories?: readonly PlanningMemory[];
  budgets?: Partial<PlanningSessionBudgets>;
  /** Optional live memory search bound to the real store; defaults to a keyword scan of `memories`. */
  searchMemory?: (input: PlanningSessionMemorySearchInput) => Promise<PlanningSessionMemorySearchRow[]>;
  onEvent?: (event: PlanningSessionEvent) => void;
  now?: () => Date;
  /** Deterministic id source for tests; defaults to `ask_1`, `ask_2`, … */
  idFactory?: () => string;
  /**
   * History from a pass this session RESUMES: the transcript is carried forward so the pass
   * accumulates instead of restarting, and `questionsAsked` continues counting — a resumed pass
   * does not get a fresh question budget to spend on the user.
   */
  resume?: {
    transcript: readonly PlanningSessionTranscriptEntry[];
    questionsAsked: number;
  };
}

/** What the host must do with one tool call. */
export type PlanningSessionToolDisposition =
  | { kind: "reply"; body: Record<string, unknown> }
  | { kind: "pending_user"; requestId: string; question: PlanningSessionQuestion };

export interface PlanningSessionSnapshot {
  phase: PlanningSessionPhase;
  questionsAsked: number;
  submitAttempts: number;
  pendingQuestion: PlanningSessionQuestion | null;
  transcript: PlanningSessionTranscriptEntry[];
  outcome: PlanningSessionOutcome | null;
  failure: PlanningSessionFailure | null;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/**
 * Question text folded to its comparable core: lowercase, no whitespace, no punctuation. Latin and
 * CJK both survive (CJK carries no spaces of its own, so whitespace removal is safe).
 */
function foldQuestion(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function cleanMultiline(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function formatZodIssue(issue: { path: PropertyKey[]; message: string }): string {
  const path = issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)";
  return `${path}: ${issue.message}`;
}

function questionKind(value: unknown): ClarifyQuestionKind {
  return value === "scope" || value === "involvement" || value === "constraint" || value === "capability"
    ? value
    : "assumption";
}

function captureScope(value: unknown): "global" | "current_aim" | "none" {
  return value === "global" || value === "none" ? value : "current_aim";
}

function uniqueOptions(value: unknown): PlanningSessionQuestionOption[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const options: PlanningSessionQuestionOption[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const label = cleanText(row.label);
    if (!label || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    options.push({ label, tradeoff: cleanText(row.tradeoff) });
  }
  return options;
}

function stringArray(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(cleanMultiline).filter(Boolean).slice(0, max);
}

function shouldBounceForQuality(report: PlanQualityReport): boolean {
  return report.issues.some((issue) => issue.severity === "error" || issue.severity === "warning");
}

function qualityRank(grade: PlanQualityReport["grade"]): number {
  switch (grade) {
    case "pass":
      return 3;
    case "warn":
      return 2;
    case "fail":
      return 1;
  }
}

function betterOrEqualQuality(next: PlanQualityReport, prev: PlanQualityReport): boolean {
  const gradeDelta = qualityRank(next.grade) - qualityRank(prev.grade);
  if (gradeDelta !== 0) return gradeDelta > 0;
  return next.score >= prev.score;
}

function qualityReply(report: PlanQualityReport): Record<string, unknown> {
  return {
    grade: report.grade,
    score: report.score,
    issues: report.issues
      .filter((issue) => issue.severity !== "info")
      .slice(0, 6)
      .map((issue) => `[${issue.severity}]${issue.nodeKey ? ` node ${issue.nodeKey}:` : ""} ${issue.message}`),
  };
}

function defaultMemorySearch(memories: readonly PlanningMemory[]): (
  input: PlanningSessionMemorySearchInput,
) => Promise<PlanningSessionMemorySearchRow[]> {
  return async (input) => {
    const tokens = input.query
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length > 1);
    const scored = memories.map((memory) => {
      const content = memory.content.toLowerCase();
      const score = tokens.reduce((sum, token) => sum + (content.includes(token) ? 1 : 0), 0);
      return { memory, score };
    });
    return scored
      .filter((row) => row.score > 0 || tokens.length === 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, input.limit)
      .map((row) => ({
        content: row.memory.content,
        category: String(row.memory.category ?? "unknown"),
        kind: String(row.memory.kind ?? "user_stated"),
        scope: row.memory.goalId || row.memory.goal_id ? "current_aim" : "global",
      }));
  };
}

interface PlanCandidate {
  plan: DecompositionOutput;
  quality: PlanQualityReport;
  attempt: number;
  assumptions: PlanningSessionAssumption[];
  openQuestions: string[];
  researchSummary: string;
}

// ── The session ─────────────────────────────────────────────────────────────

export class PlanningSession {
  private phase: PlanningSessionPhase = "researching";
  private readonly budgets: PlanningSessionBudgets;
  private readonly transcript: PlanningSessionTranscriptEntry[] = [];
  private readonly research: PlanningSessionResearchLog = { findings: [], gaps: [] };
  private readonly memoryCandidates: PlanningSessionMemoryCandidate[] = [];
  private readonly answers: PlanningSessionQnA[] = [];
  private readonly queuedMessages: { text: string; entry: { delivered: boolean } }[] = [];
  private pendingQuestion: PlanningSessionQuestion | null = null;
  private questionsAsked = 0;
  private submitAttempts = 0;
  private researchReports = 0;
  private qualityBounceUsed = false;
  private finishRequested = false;
  private finishDelivered = false;
  private best: PlanCandidate | null = null;
  private lastErrors: string[] = [];
  private outcome: PlanningSessionOutcome | null = null;
  private failure: PlanningSessionFailure | null = null;
  private askSequence = 0;
  private readonly searchMemoryHandler: (
    input: PlanningSessionMemorySearchInput,
  ) => Promise<PlanningSessionMemorySearchRow[]>;

  constructor(private readonly config: PlanningSessionConfig) {
    this.budgets = { ...DEFAULT_PLANNING_SESSION_BUDGETS, ...config.budgets };
    this.searchMemoryHandler = config.searchMemory ?? defaultMemorySearch(config.memories ?? []);
    if (config.resume) this.adoptResumedHistory(config.resume);
  }

  /**
   * Carry a stopped pass's history into this session, so a resume continues one pass rather than
   * starting a second. The transcript, the research log and the answered questions are all
   * restored — the answers matter most: `ask_user` dedupes against them, which is the mechanism
   * that stops a resumed brain from asking the user something they already answered.
   */
  private adoptResumedHistory(resume: NonNullable<PlanningSessionConfig["resume"]>): void {
    for (const entry of resume.transcript) {
      this.transcript.push(entry);
      if (entry.kind === "research") {
        this.research.findings.push(...entry.findings);
        this.research.gaps.push(...entry.gaps);
        this.researchReports += 1;
      }
      if (entry.kind === "memory_candidate") this.memoryCandidates.push(entry.candidate);
    }
    // Pair restored questions with their answers, same rule as `restorePlanningPass`: an
    // unanswered question is not an answer.
    const questions = new Map<string, PlanningSessionQuestion>();
    for (const entry of resume.transcript) {
      if (entry.kind === "question") questions.set(entry.question.id, entry.question);
      if (entry.kind !== "answer") continue;
      const question = questions.get(entry.request_id);
      if (question) this.answers.push({ question, answer: entry.answer });
    }
    // A resumed pass does not get a fresh budget to spend on the user.
    this.questionsAsked = Math.max(0, Math.trunc(resume.questionsAsked));
  }

  // ── Host surface ──────────────────────────────────────────────────────────

  state(): { phase: PlanningSessionPhase; pendingQuestion: PlanningSessionQuestion | null } {
    return { phase: this.phase, pendingQuestion: this.pendingQuestion };
  }

  snapshot(): PlanningSessionSnapshot {
    return {
      phase: this.phase,
      questionsAsked: this.questionsAsked,
      submitAttempts: this.submitAttempts,
      pendingQuestion: this.pendingQuestion,
      transcript: [...this.transcript],
      outcome: this.outcome,
      failure: this.failure,
    };
  }

  /** Queue one temporary-chat message from the user. Delivery is host-dependent. */
  postUserMessage(text: string): void {
    const cleaned = cleanMultiline(text);
    if (!cleaned || !this.isActive()) return;
    const entry = { at: this.timestamp(), kind: "user_message" as const, text: cleaned, delivered: false };
    this.transcript.push(entry);
    this.queuedMessages.push({ text: cleaned, entry });
    this.emit({ type: "user_message_queued", text: cleaned });
  }

  /** The user asked the brain to stop researching and draft now. */
  requestFinishNow(): void {
    if (!this.isActive()) return;
    this.finishRequested = true;
    this.finishDelivered = false;
  }

  /**
   * Drain queued chat for hosts that can inject real user turns mid-session.
   * Undrained messages ride along on the next tool reply instead.
   */
  takeQueuedUserMessages(): string[] {
    return this.drainQueuedMessages();
  }

  /** Take the finish-now directive for delivery as an injected user turn. */
  takeFinishDirective(): boolean {
    if (!this.finishRequested || this.finishDelivered) return false;
    this.finishDelivered = true;
    return true;
  }

  async handleToolCall(name: string, input: unknown): Promise<PlanningSessionToolDisposition> {
    if (!isPlanningSessionToolName(name)) {
      return this.reply({ error: `unknown planning tool: ${name}` });
    }
    if (!this.isActive()) {
      return this.reply({ error: "session_over", phase: this.phase });
    }
    const row = (input && typeof input === "object" && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
    switch (name satisfies PlanningSessionToolName) {
      case "ask_user":
        return this.handleAskUser(row);
      case "search_memory":
        return this.handleSearchMemory(row);
      case "report_research":
        return this.handleReportResearch(row);
      case "propose_memory":
        return this.handleProposeMemory(row);
      case "submit_plan":
        return this.handleSubmitPlan(row);
    }
  }

  /** Resolve the parked `ask_user` call. Returns the reply body for the parked transport response. */
  provideAnswer(requestId: string, rawAnswer: Partial<PlanningSessionAnswer>): Record<string, unknown> {
    const question = this.pendingQuestion;
    if (!question || question.id !== requestId) {
      return { error: "no_pending_question", request_id: requestId };
    }
    const answer: PlanningSessionAnswer = {
      selected_labels: stringArray(rawAnswer.selected_labels, 12),
      other_text: cleanMultiline(rawAnswer.other_text) || null,
      ...(rawAnswer.skipped ? { skipped: true } : {}),
    };
    this.pendingQuestion = null;
    this.setPhase("researching");
    this.transcript.push({ at: this.timestamp(), kind: "answer", request_id: requestId, answer });
    this.answers.push({ question, answer });
    this.emit({ type: "question_answered", requestId, answer });
    return this.decorate({
      request_id: requestId,
      answer: {
        selected_labels: answer.selected_labels,
        other_text: answer.other_text,
        skipped: answer.skipped ?? false,
      },
      questions_remaining: Math.max(0, this.budgets.maxQuestions - this.questionsAsked),
    });
  }

  /**
   * The brain's process ended (or the host is closing the session). A valid
   * submission is honored even if the brain never saw it accepted; anything
   * less becomes an explicit failure.
   */
  finalize(): PlanningSessionSnapshot {
    if (!this.isActive()) return this.snapshot();
    if (this.pendingQuestion) {
      // An unanswered question cannot block finalization; record it as skipped.
      this.provideAnswer(this.pendingQuestion.id, { skipped: true });
    }
    if (this.best) {
      this.acceptCandidate(this.best, true);
      this.transcript.push({
        at: this.timestamp(),
        kind: "note",
        text: "Session ended before an in-session accept; the best valid submission was kept.",
      });
    } else {
      this.fail(
        this.submitAttempts > 0
          ? { code: "no_valid_plan", message: "The planning session ended without a valid plan submission.", lastErrors: this.lastErrors }
          : { code: "no_plan_submitted", message: "The planning session ended before any plan was submitted.", lastErrors: [] },
      );
    }
    return this.snapshot();
  }

  cancel(): void {
    if (!this.isActive()) return;
    this.pendingQuestion = null;
    this.failure = { code: "canceled", message: "The planning session was canceled.", lastErrors: [] };
    this.setPhase("canceled");
    this.emit({ type: "session_canceled" });
  }

  // ── Tool handlers ─────────────────────────────────────────────────────────

  /**
   * An answered question that means the same thing as `questionText`, or null. The comparison is
   * deliberately shallow — case, spacing and punctuation folded away — because it must never
   * REJECT a genuinely new question: a false match would silence a question the plan needs, which
   * is worse than letting one near-duplicate through.
   */
  private findAnswered(questionText: string): PlanningSessionQnA | null {
    const needle = foldQuestion(questionText);
    if (!needle) return null;
    return this.answers.find((row) => foldQuestion(row.question.question) === needle) ?? null;
  }

  private handleAskUser(row: Record<string, unknown>): PlanningSessionToolDisposition {
    if (this.pendingQuestion) {
      return this.reply({ asked: false, reason: "another_question_pending" });
    }
    if (this.questionsAsked >= this.budgets.maxQuestions) {
      return this.reply({
        asked: false,
        reason: "question_budget_exhausted",
        guidance:
          "Proceed with your best assumptions. Record remaining unknowns as assumptions or open_questions on submit_plan.",
      });
    }
    if (this.finishRequested) {
      return this.reply({
        asked: false,
        reason: "user_requested_finish",
        guidance: "The user asked you to finish now. Submit the plan with your current understanding.",
      });
    }
    const questionText = cleanText(row.question);
    if (!questionText) {
      return this.reply({ asked: false, reason: "invalid_question", guidance: "Provide one non-empty question." });
    }
    // Already answered ⇒ refuse and hand the answer straight back. The mission prompt also tells a
    // resumed brain not to re-ask, but an instruction is a request; this is the guarantee. Asking
    // twice is the one failure that tells a user their earlier answers were thrown away.
    const answered = this.findAnswered(questionText);
    if (answered) {
      const picked = answered.answer.selected_labels.filter((label) => label.trim());
      const other = answered.answer.other_text?.trim();
      return this.reply({
        asked: false,
        reason: "already_answered",
        question: answered.question.question,
        answer: { selected_labels: picked, other_text: other || null },
        guidance: "The user already answered this. Use the answer above and move on to something it does not settle.",
      });
    }
    const options = uniqueOptions(row.options);
    const selection = decideChoiceSelection({
      question: questionText,
      options: options.map((option) => ({ label: option.label, detail: option.tradeoff })),
      requestedMode: row.selection_mode,
      requestedReason: row.selection_mode_reason,
    });
    this.askSequence += 1;
    const question: PlanningSessionQuestion = {
      id: this.config.idFactory?.() ?? `ask_${this.askSequence}`,
      question: questionText,
      kind: questionKind(row.kind),
      why_high_impact: cleanText(row.why_high_impact),
      allow_other: true,
      selection_mode: selection.mode,
      selection_mode_reason: selection.reason,
      capture_scope: captureScope(row.capture_scope),
      options,
    };
    this.questionsAsked += 1;
    this.pendingQuestion = question;
    this.transcript.push({ at: this.timestamp(), kind: "question", question });
    this.setPhase("waiting_user");
    this.emit({ type: "question_asked", question });
    return { kind: "pending_user", requestId: question.id, question };
  }

  private async handleSearchMemory(row: Record<string, unknown>): Promise<PlanningSessionToolDisposition> {
    const query = cleanText(row.query);
    if (!query) return this.reply({ memories: [], note: "empty query" });
    const scope = row.scope === "global" || row.scope === "current_aim" ? row.scope : "both";
    const limitRaw = typeof row.limit === "number" && Number.isFinite(row.limit) ? Math.floor(row.limit) : 8;
    const limit = Math.min(50, Math.max(1, limitRaw));
    const memories = await this.searchMemoryHandler({ query, scope, limit });
    return this.reply({ memories });
  }

  private handleReportResearch(row: Record<string, unknown>): PlanningSessionToolDisposition {
    if (this.researchReports >= this.budgets.maxResearchReports) {
      return this.reply({ recorded: false, reason: "research_log_full", guidance: "Move on to submitting the plan." });
    }
    const findings: PlanningSessionResearchFinding[] = [];
    if (Array.isArray(row.findings)) {
      for (const item of row.findings.slice(0, 12)) {
        if (!item || typeof item !== "object" || Array.isArray(item)) continue;
        const finding = item as Record<string, unknown>;
        const summary = cleanText(finding.summary);
        if (!summary) continue;
        const lane = cleanText(finding.lane);
        findings.push({
          summary,
          source_urls: stringArray(finding.source_urls, 8),
          ...(lane ? { lane } : {}),
        });
      }
    }
    const gaps = stringArray(row.gaps, 8);
    if (findings.length === 0 && gaps.length === 0) {
      return this.reply({ recorded: false, reason: "empty_report" });
    }
    this.researchReports += 1;
    this.research.findings.push(...findings);
    this.research.gaps.push(...gaps);
    this.transcript.push({ at: this.timestamp(), kind: "research", findings, gaps });
    this.emit({ type: "research_reported", findingCount: findings.length, gapCount: gaps.length });
    return this.reply({ recorded: true, total_findings: this.research.findings.length });
  }

  private handleProposeMemory(row: Record<string, unknown>): PlanningSessionToolDisposition {
    const content = cleanMultiline(row.content);
    const category = cleanText(row.category);
    const scope = row.scope === "global" ? "global" : "current_aim";
    if (!content || !category) {
      return this.reply({ proposed: false, reason: "invalid_candidate" });
    }
    const candidate: PlanningSessionMemoryCandidate = { content, category, scope };
    this.memoryCandidates.push(candidate);
    this.transcript.push({ at: this.timestamp(), kind: "memory_candidate", candidate });
    this.emit({ type: "memory_proposed", candidate });
    return this.reply({ proposed: true, status: "pending_user_review" });
  }

  private handleSubmitPlan(row: Record<string, unknown>): PlanningSessionToolDisposition {
    this.submitAttempts += 1;
    const attempt = this.submitAttempts;
    const attemptsRemaining = Math.max(0, this.budgets.maxSubmitAttempts - attempt);

    const parsed = DecompositionOutput.safeParse(normalizeRawPlan(row.plan));
    const validationErrors = parsed.success
      ? validatePlan(parsed.data).errors
      : parsed.error.issues.map(formatZodIssue);

    if (validationErrors.length > 0) {
      this.lastErrors = validationErrors;
      this.transcript.push({
        at: this.timestamp(),
        kind: "plan_attempt",
        attempt,
        accepted: false,
        errors: validationErrors.slice(0, 8),
        quality_grade: null,
      });
      this.emit({ type: "plan_rejected", attempt, reason: "validation", errors: validationErrors.slice(0, 8) });
      if (attemptsRemaining === 0) {
        if (this.best) {
          this.acceptCandidate(this.best, false);
          return this.reply({
            accepted: true,
            note: "This submission was invalid, but an earlier valid submission was kept as the plan.",
            quality: qualityReply(this.best.quality),
          });
        }
        this.fail({
          code: "no_valid_plan",
          message: "All plan submissions failed validation.",
          lastErrors: validationErrors,
        });
        return this.reply({ accepted: false, validation_errors: validationErrors, attempts_remaining: 0, session: "failed" });
      }
      return this.reply({
        accepted: false,
        validation_errors: validationErrors,
        attempts_remaining: attemptsRemaining,
        guidance: "Fix every listed error and call submit_plan again with the corrected plan.",
      });
    }

    const plan = parsed.success ? parsed.data : null;
    if (!plan) {
      // Unreachable: no validation errors implies a successful parse. Kept for type narrowing.
      return this.reply({ accepted: false, validation_errors: ["plan failed to parse"], attempts_remaining: attemptsRemaining });
    }

    const quality = critiquePlan({ plan, context: this.config.memories });
    const candidate: PlanCandidate = {
      plan,
      quality,
      attempt,
      assumptions: this.parseAssumptions(row.assumptions),
      openQuestions: stringArray(row.open_questions, 10),
      researchSummary: cleanMultiline(row.research_summary),
    };
    if (!this.best || betterOrEqualQuality(quality, this.best.quality)) {
      this.best = candidate;
    }

    const mustBounce = shouldBounceForQuality(quality) && !this.qualityBounceUsed && attemptsRemaining > 0;
    if (mustBounce) {
      this.qualityBounceUsed = true;
      this.transcript.push({
        at: this.timestamp(),
        kind: "plan_attempt",
        attempt,
        accepted: false,
        errors: [],
        quality_grade: quality.grade,
      });
      this.emit({
        type: "plan_rejected",
        attempt,
        reason: "quality",
        errors: (qualityReply(quality).issues as string[]) ?? [],
      });
      return this.reply({
        accepted: false,
        quality: qualityReply(quality),
        attempts_remaining: attemptsRemaining,
        guidance:
          "The plan is valid but has quality issues. Submit an improved plan; the better of your submissions will be kept.",
      });
    }

    this.acceptCandidate(this.best ?? candidate, false);
    const accepted = this.best ?? candidate;
    return this.reply({
      accepted: true,
      ...(accepted.attempt !== attempt
        ? { note: "An earlier submission had better quality and was kept as the plan." }
        : {}),
      quality: qualityReply(accepted.quality),
    });
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private parseAssumptions(value: unknown): PlanningSessionAssumption[] {
    if (!Array.isArray(value)) return [];
    const assumptions: PlanningSessionAssumption[] = [];
    for (const item of value.slice(0, 12)) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const row = item as Record<string, unknown>;
      const statement = cleanText(row.statement);
      if (!statement) continue;
      assumptions.push({ statement, default_value: cleanText(row.default_value) });
    }
    return assumptions;
  }

  private acceptCandidate(candidate: PlanCandidate, atSessionEnd: boolean): void {
    if (candidate.researchSummary) this.research.summary = candidate.researchSummary;
    this.outcome = {
      plan: candidate.plan,
      quality: candidate.quality,
      attempts: this.submitAttempts,
      acceptedAttempt: candidate.attempt,
      acceptedAtSessionEnd: atSessionEnd,
      assumptions: candidate.assumptions,
      openQuestions: candidate.openQuestions,
      research: { findings: [...this.research.findings], gaps: [...this.research.gaps], ...(this.research.summary ? { summary: this.research.summary } : {}) },
      memoryCandidates: [...this.memoryCandidates],
      answers: [...this.answers],
    };
    this.transcript.push({
      at: this.timestamp(),
      kind: "plan_attempt",
      attempt: candidate.attempt,
      accepted: true,
      errors: [],
      quality_grade: candidate.quality.grade,
    });
    this.setPhase("draft_ready");
    this.emit({
      type: "plan_accepted",
      attempt: candidate.attempt,
      qualityGrade: candidate.quality.grade,
      atSessionEnd,
    });
  }

  private fail(failure: PlanningSessionFailure): void {
    this.failure = failure;
    this.setPhase("failed");
    this.emit({ type: "session_failed", failure });
  }

  private isActive(): boolean {
    return this.phase === "researching" || this.phase === "waiting_user";
  }

  private setPhase(phase: PlanningSessionPhase): void {
    if (this.phase === phase) return;
    this.phase = phase;
    this.emit({ type: "phase_changed", phase });
  }

  private emit(event: PlanningSessionEvent): void {
    this.config.onEvent?.(event);
  }

  private timestamp(): string {
    return (this.config.now?.() ?? new Date()).toISOString();
  }

  private drainQueuedMessages(): string[] {
    if (this.queuedMessages.length === 0) return [];
    const drained = this.queuedMessages.splice(0, this.queuedMessages.length);
    for (const message of drained) message.entry.delivered = true;
    return drained.map((message) => message.text);
  }

  /** Attach queued chat + directives to a reply so no host loses them. */
  private decorate(body: Record<string, unknown>): Record<string, unknown> {
    const notes = this.drainQueuedMessages();
    const directives: string[] = [];
    if (this.takeFinishDirective()) directives.push("finish_now");
    return {
      ...body,
      ...(notes.length > 0 ? { user_notes: notes } : {}),
      ...(directives.length > 0 ? { directives } : {}),
    };
  }

  private reply(body: Record<string, unknown>): { kind: "reply"; body: Record<string, unknown> } {
    return { kind: "reply", body: this.decorate(body) };
  }
}

export function createPlanningSession(config: PlanningSessionConfig): PlanningSession {
  return new PlanningSession(config);
}

/**
 * Provenance a checkpoint carries that the session protocol itself does not know:
 * which model drove the pass, when the pass first started (preserved across
 * resumes), why it stopped, and how many times it was resumed.
 */
export interface PlanningPassProvenance {
  model?: string | null;
  /** ISO start of the pass; defaults to `now` for a first checkpoint. */
  startedAt?: string;
  /** "" (still live) | `app_quit` | `failed` | `canceled` | `landed`. */
  stoppedReason?: string;
  resumedCount?: number;
  /** The runtime's own session/thread id, so a later resume can reopen that conversation. */
  runtimeSessionId?: string;
  /**
   * Files the user attached, by their original location. The session machine never sees these —
   * staging them is platform I/O — but the pass has to carry them or a resume loses them.
   */
  attachments?: readonly { path: string; name?: string; at?: string }[];
  bounds?: Partial<PlanningPassBounds>;
}

/**
 * Serialize a session for persistence (`AimDraftPlanningSession` in
 * `@aimcub/types`). Pure projection: the plan itself lands in `draft_plan` /
 * `plan_json`, this carries the pass — transcript, research, assumptions,
 * open questions, and pending memory candidates.
 *
 * Callable at ANY phase, which is what makes a mid-flight checkpoint possible:
 * `outcome` only exists at `draft_ready`, so research and memory candidates fall
 * back to the transcript. Oversized passes are bounded per
 * {@link DEFAULT_PLANNING_PASS_BOUNDS} and declare it through `truncated`.
 */
export function planningSessionDraftState(
  snapshot: PlanningSessionSnapshot,
  agentId: string,
  now: Date,
  provenance: PlanningPassProvenance = {},
): AimDraftPlanningSession {
  const outcome = snapshot.outcome;
  const transcriptResearch = snapshot.transcript.filter(
    (entry): entry is Extract<PlanningSessionTranscriptEntry, { kind: "research" }> => entry.kind === "research",
  );
  const research = outcome?.research ?? {
    findings: transcriptResearch.flatMap((entry) => entry.findings),
    gaps: transcriptResearch.flatMap((entry) => entry.gaps),
  };
  const memoryCandidates = outcome?.memoryCandidates
    ?? snapshot.transcript
      .filter(
        (entry): entry is Extract<PlanningSessionTranscriptEntry, { kind: "memory_candidate" }> =>
          entry.kind === "memory_candidate",
      )
      .map((entry) => entry.candidate);
  const bounds = { ...DEFAULT_PLANNING_PASS_BOUNDS, ...provenance.bounds };
  const iso = now.toISOString();
  const pass: AimDraftPlanningSession = {
    agent_id: agentId,
    phase: snapshot.phase,
    updated_at: iso,
    model: provenance.model ?? "",
    started_at: provenance.startedAt || iso,
    stopped_reason: provenance.stoppedReason ?? "",
    resumed_count: provenance.resumedCount ?? 0,
    runtime_session_id: provenance.runtimeSessionId ?? "",
    truncated: false,
    // Never bounded away either: these are few, tiny, and the user's own contribution.
    attachments: (provenance.attachments ?? []).map((file) => ({
      path: file.path,
      name: file.name ?? "",
      at: file.at ?? "",
    })),
    // Never bounded away: a finished plan is what the user is one click from adopting.
    draft_plan: outcome?.plan ?? null,
    transcript: snapshot.transcript.map((entry) => ({ ...entry })),
    research_findings: research.findings.map((finding) => ({ ...finding })),
    research_gaps: [...research.gaps],
    research_summary: outcome?.research.summary ?? "",
    assumptions: (outcome?.assumptions ?? []).map((assumption) => ({ ...assumption })),
    open_questions: [...(outcome?.openQuestions ?? [])],
    memory_candidates: memoryCandidates.map((candidate) => ({ ...candidate })),
  };
  return boundPlanningPass(pass, bounds);
}

/** What a checkpointed pass can be restored INTO without re-running a brain. */
export interface PlanningPassRestoration {
  plan: DecompositionOutput;
  quality: PlanQualityReport;
  assumptions: PlanningSessionAssumption[];
  openQuestions: string[];
  /** The Q&A the pass already collected, paired back up from the transcript. */
  answers: PlanningSessionQnA[];
  research: PlanningSessionResearchLog;
  memoryCandidates: PlanningSessionMemoryCandidate[];
}

/**
 * The reverse of {@link planningSessionDraftState}: rebuild an adoptable outcome from a
 * pass that reached `draft_ready` before the app went away. Returns `null` when the pass
 * carries no plan — there is nothing to adopt and the aim must resume planning instead.
 *
 * Quality is recomputed rather than stored (`critiquePlan` is pure over plan + context), so
 * the persisted pass stays small and a plan is never judged by a stale report.
 *
 * The transcript is deliberately permissive on disk, so every entry read here is guarded:
 * anything unrecognized is dropped rather than trusted, exactly as the live surface drops
 * activity it cannot say.
 */
export function restorePlanningPass(
  pass: AimDraftPlanningSession,
  memories: PlanningMemory[] = [],
): PlanningPassRestoration | null {
  const parsed = DecompositionOutput.safeParse(pass.draft_plan);
  if (!parsed.success) return null;
  const plan = parsed.data;
  const research = planningPassResearch(pass);
  return {
    plan,
    // Judged exactly as the live session judged it (`submitPlan` passes plan + memories and no
    // research evidence), so a plan's quality cannot change just because the app restarted.
    quality: critiquePlan({ plan, context: memories }),
    assumptions: pass.assumptions.map((assumption) => ({
      statement: assumption.statement,
      default_value: assumption.default_value,
    })),
    openQuestions: [...pass.open_questions],
    answers: planningPassAnswers(pass),
    research,
    memoryCandidates: pass.memory_candidates.flatMap((candidate) => {
      const content = cleanText(candidate.content);
      if (!content) return [];
      return [{
        content,
        category: cleanText(candidate.category),
        scope: candidate.scope === "global" ? "global" : "current_aim",
      }];
    }),
  };
}

/**
 * The pass's research log, rebuilt from disk. Independent of whether a plan was ever drafted — a
 * pass that stopped mid-research still has findings worth not repeating.
 */
export function planningPassResearch(pass: AimDraftPlanningSession): PlanningSessionResearchLog {
  return {
    findings: pass.research_findings.flatMap((row) => {
      const summary = cleanText(row.summary);
      if (!summary) return [];
      const urls = Array.isArray(row.source_urls)
        ? row.source_urls.filter((url): url is string => typeof url === "string")
        : [];
      const lane = cleanText(row.lane);
      return [{ summary, source_urls: urls, ...(lane ? { lane } : {}) }];
    }),
    gaps: pass.research_gaps.filter((gap) => Boolean(cleanText(gap))),
    summary: pass.research_summary,
  };
}

/**
 * The questions this pass actually got answered, paired back up from the transcript.
 *
 * Deliberately NOT gated on the pass having drafted a plan: the most common stopped pass is one
 * interrupted mid-interview, and its answers are exactly what a resumed brain must be handed so it
 * does not ask again. (`restorePlanningPass` is about adopting a finished PLAN, which is a
 * different question and correctly returns nothing when there is no plan.)
 */
export function planningPassAnswers(pass: AimDraftPlanningSession): PlanningSessionQnA[] {
  return restoreTranscriptAnswers(pass.transcript);
}

/**
 * Pair persisted `question` entries back to their `answer` entries. A question the user never
 * answered is left out: the restored Q&A must describe what was actually settled, not imply
 * an answer that was never given.
 */
function restoreTranscriptAnswers(transcript: Record<string, unknown>[]): PlanningSessionQnA[] {
  const questions = new Map<string, PlanningSessionQuestion>();
  const answers: PlanningSessionQnA[] = [];
  for (const entry of transcript) {
    if (entry.kind === "question") {
      const question = restoreQuestion(entry.question);
      if (question) questions.set(question.id, question);
      continue;
    }
    if (entry.kind !== "answer") continue;
    const requestId = cleanText(entry.request_id);
    const question = questions.get(requestId);
    const raw = entry.answer;
    if (!question || !raw || typeof raw !== "object") continue;
    const record = raw as Record<string, unknown>;
    const labels = Array.isArray(record.selected_labels)
      ? record.selected_labels.filter((label): label is string => typeof label === "string")
      : [];
    const otherText = cleanText(record.other_text);
    if (labels.length === 0 && !otherText) continue;
    answers.push({
      question,
      answer: { selected_labels: labels, other_text: otherText || null },
    });
  }
  return answers;
}

function restoreQuestion(raw: unknown): PlanningSessionQuestion | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = cleanText(record.id);
  const question = cleanText(record.question);
  if (!id || !question) return null;
  const options = Array.isArray(record.options)
    ? record.options.flatMap((option) => {
      if (!option || typeof option !== "object") return [];
      const label = cleanText((option as Record<string, unknown>).label);
      if (!label) return [];
      return [{ label, tradeoff: cleanText((option as Record<string, unknown>).tradeoff) }];
    })
    : [];
  const kind = cleanText(record.kind);
  const mode = record.selection_mode === "multiple" ? "multiple" : "single";
  const reason = cleanText(record.selection_mode_reason);
  return {
    id,
    question,
    kind: PLANNING_QUESTION_KINDS.has(kind) ? (kind as ClarifyQuestionKind) : "constraint",
    why_high_impact: cleanText(record.why_high_impact),
    allow_other: true,
    selection_mode: mode,
    // An unrecognized reason degrades to the honest default for its mode rather than being
    // cast through: the reason drives what the question surface claims about the choice.
    selection_mode_reason: (CHOICE_SELECTION_REASONS as readonly string[]).includes(reason)
      ? (reason as ChoiceSelectionReason)
      : mode === "multiple" ? "compatible_options" : "mutually_exclusive",
    capture_scope: record.capture_scope === "global" || record.capture_scope === "none"
      ? record.capture_scope
      : "current_aim",
    options,
  };
}

const PLANNING_QUESTION_KINDS = new Set<string>(["scope", "involvement", "assumption", "constraint", "capability"]);

/**
 * Trim a pass to its size budget, oldest-first, and declare the trim. Count caps
 * apply before the byte budget so a pass with few but enormous entries still
 * converges. One entry of each kind always survives: an over-budget pass reports
 * less history, never an empty one.
 */
function boundPlanningPass(
  pass: AimDraftPlanningSession,
  bounds: PlanningPassBounds,
): AimDraftPlanningSession {
  let truncated = false;
  if (pass.transcript.length > bounds.maxTranscriptEntries) {
    pass.transcript = pass.transcript.slice(-bounds.maxTranscriptEntries);
    truncated = true;
  }
  if (pass.research_findings.length > bounds.maxResearchFindings) {
    pass.research_findings = pass.research_findings.slice(-bounds.maxResearchFindings);
    truncated = true;
  }
  const overBudget = () => Buffer.byteLength(JSON.stringify(pass), "utf8") > bounds.maxSerializedBytes;
  while (overBudget() && pass.transcript.length > 1) {
    pass.transcript.shift();
    truncated = true;
  }
  while (overBudget() && pass.research_findings.length > 1) {
    pass.research_findings.shift();
    truncated = true;
  }
  pass.truncated = truncated;
  return pass;
}
