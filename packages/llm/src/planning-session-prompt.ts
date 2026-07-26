/**
 * Mission prompt for an embedded planning brain.
 *
 * The embedded agent (Claude Code, Codex, or any adapter runtime) receives this as
 * its initial prompt for a planning session. It carries the aim, the durable context
 * Aimcub already holds, the research doctrine (use YOUR tools; report gaps, never
 * fabricate), the interaction doctrine (one blocking question at a time through
 * `ask_user`; the user can interject over temporary chat), and the submit contract
 * whose plan rules are shared verbatim with the structured-output funnel.
 */
import { DECOMPOSITION_PLAN_RULES, renderOutputLanguageInstruction } from "./decompose";
import { renderPlanningContext, type PlanningMemory } from "./planning-context";
import type { ContextLinkedSource } from "./tool-contract";
import {
  DEFAULT_PLANNING_SESSION_BUDGETS,
  type PlanningSessionAim,
  type PlanningSessionAssumption,
  type PlanningSessionBudgets,
  type PlanningSessionQnA,
  type PlanningSessionResearchFinding,
} from "./planning-session";

export interface PlanningSessionPromptInput {
  aim: PlanningSessionAim;
  memories?: readonly PlanningMemory[];
  linkedSources?: readonly ContextLinkedSource[];
  /** Absolute directories the brain has been granted read access to. */
  workspaceRoots?: readonly string[];
  webResearch: { enabled: boolean; required: boolean };
  budgets?: Partial<PlanningSessionBudgets>;
  /**
   * A pass on this aim that stopped before finishing (almost always because the app was closed).
   * Present ⇒ this session RESUMES that pass, and the prompt hands back what it already
   * established so the user is never asked the same thing twice.
   */
  priorPass?: PlanningPassBriefing;
}

/** What a resumed brain is told about the pass it is continuing. */
export interface PlanningPassBriefing {
  /** Questions already answered, with the user's own words. */
  answers: readonly PlanningSessionQnA[];
  research: { findings: readonly PlanningSessionResearchFinding[]; gaps: readonly string[]; summary?: string };
  assumptions: readonly PlanningSessionAssumption[];
  openQuestions: readonly string[];
  /** Free-text the user sent mid-pass (temporary chat), which shaped the work. */
  notes: readonly string[];
  /** True when a plan was already drafted and is being refined rather than started. */
  planDrafted: boolean;
  /** Size bounding dropped some history; say so instead of implying completeness. */
  truncated: boolean;
}

/** Bounds so a long pass cannot crowd the aim, the context, or the rules out of the prompt. */
const BRIEFING_LIMITS = {
  findings: 40,
  gaps: 15,
  notes: 10,
  openQuestions: 10,
} as const;

function renderAnsweredQuestions(answers: readonly PlanningSessionQnA[]): string {
  if (answers.length === 0) return "- (no questions were answered before the pass stopped)";
  return answers
    .map((row) => {
      const picked = row.answer.selected_labels.filter((label) => label.trim());
      const other = row.answer.other_text?.trim();
      const reply = [picked.join(" + "), other].filter(Boolean).join(" — ") || "(skipped)";
      return `- Q: ${row.question.question}\n  A: ${reply}`;
    })
    .join("\n");
}

function renderPriorPass(pass: PlanningPassBriefing): string {
  const lines: string[] = [];
  lines.push(
    pass.planDrafted
      ? "You already drafted a plan for this aim in an earlier pass; this session continues that work — refine and resubmit, do not start over."
      : "An earlier pass on this aim stopped before it finished. This session CONTINUES it — you are not starting from nothing.",
  );
  if (pass.truncated) {
    lines.push("Only the most recent part of that pass survived size limits, so this record is partial.");
  }
  lines.push("");
  lines.push("### Already answered by the user — NEVER ask these again");
  lines.push(renderAnsweredQuestions(pass.answers));
  const findings = pass.research.findings.slice(0, BRIEFING_LIMITS.findings);
  if (findings.length > 0) {
    lines.push("");
    lines.push("### Research already recorded — do not redo it");
    lines.push(...findings.map((finding) => {
      const urls = finding.source_urls.filter((url) => url.trim()).join(" ");
      return `- ${finding.summary}${urls ? ` [${urls}]` : ""}`;
    }));
  }
  const summary = (pass.research.summary ?? "").trim();
  if (summary) {
    lines.push("");
    lines.push(`### Research summary so far\n${summary}`);
  }
  const gaps = pass.research.gaps.slice(0, BRIEFING_LIMITS.gaps);
  if (gaps.length > 0) {
    lines.push("");
    lines.push("### Known gaps — where this pass was heading next");
    lines.push(...gaps.map((gap) => `- ${gap}`));
  }
  const notes = pass.notes.slice(-BRIEFING_LIMITS.notes);
  if (notes.length > 0) {
    lines.push("");
    lines.push("### What the user said mid-pass (still binding)");
    lines.push(...notes.map((note) => `- ${note}`));
  }
  if (pass.assumptions.length > 0) {
    lines.push("");
    lines.push("### Assumptions already disclosed");
    lines.push(...pass.assumptions.map((row) => `- ${row.statement} (default: ${row.default_value || "unstated"})`));
  }
  const open = pass.openQuestions.slice(0, BRIEFING_LIMITS.openQuestions);
  if (open.length > 0) {
    lines.push("");
    lines.push("### Still open");
    lines.push(...open.map((question) => `- ${question}`));
  }
  lines.push("");
  lines.push("Continue from here: pick up at the gaps and open questions above. Re-asking something the");
  lines.push("user already answered is the worst thing you can do in this session — it tells them their");
  lines.push("earlier answers were thrown away. The question budget below counts what was already asked.");
  return lines.join("\n");
}

function renderLinkedSources(sources: readonly ContextLinkedSource[] | undefined): string {
  const enabled = (sources ?? []).filter((source) => source.enabled);
  if (enabled.length === 0) return "(none linked)";
  return enabled
    .map((source) => {
      const location = source.path ?? source.uri ?? "";
      const status = source.status === "available" ? "" : ` [${source.status}]`;
      return `- ${source.kind}: ${source.label}${location ? ` (${location})` : ""}${status}`;
    })
    .join("\n");
}

function renderWorkspaceRoots(roots: readonly string[] | undefined): string {
  const cleaned = (roots ?? []).map((root) => root.trim()).filter(Boolean);
  if (cleaned.length === 0) return "(none — do not read local files beyond what the user attaches)";
  return cleaned.map((root) => `- ${root}`).join("\n");
}

function renderResearchDoctrine(webResearch: { enabled: boolean; required: boolean }): string {
  const lines = [
    "Research with YOUR OWN tools (file reading, code search, web search/fetch) within the permissions this session grants.",
    "Cover, when relevant: current aim facts, authoritative requirements, realistic alternatives or market evidence, risks and trade-offs, and user/audience evidence.",
    "Record findings through report_research AS YOU GO, each with full source URLs, so the user can audit the research live.",
    "Never fabricate facts, sources, or availability. Anything you could not verify goes into report_research gaps or submit_plan open_questions.",
  ];
  if (!webResearch.enabled) {
    lines.push(
      "Web research is DISABLED for this session. Do not attempt network access; record the missing web coverage as an explicit gap instead.",
    );
  } else if (webResearch.required) {
    lines.push("This aim depends on current external facts: treat web research as required, not optional.");
  }
  return lines.map((line) => `- ${line}`).join("\n");
}

export function buildPlanningSessionPrompt(input: PlanningSessionPromptInput): string {
  const budgets = { ...DEFAULT_PLANNING_SESSION_BUDGETS, ...input.budgets };
  const description = input.aim.description?.trim() ? input.aim.description.trim() : "(no description provided)";
  return [
    "You are the planning brain of Aimcub, an aim-management system that routes work across humans and agents.",
    "Your job in this session: deeply understand the user's aim through research and dialogue, then break it into a verifiable milestone plan.",
    "You are not executing the aim. You are researching, clarifying, and planning it.",
    "",
    "## The aim",
    `Title: ${input.aim.title}`,
    // A stated-but-wrong domain misleads research, so absence is stated honestly and the
    // brain classifies the aim itself (submit_plan's `domain` lands back on the goal).
    input.aim.domain
      ? `Domain: ${input.aim.domain}`
      : "Domain: not set — infer it from the aim itself and record your classification in submit_plan's `domain` field.",
    `Description: ${description}`,
    "",
    renderOutputLanguageInstruction(input.aim.outputLanguage),
    "",
    "## What Aimcub already knows (durable context from prior aims)",
    renderPlanningContext(input.memories),
    "",
    // Placed BEFORE the research and question doctrine: a resumed brain must know what is already
    // settled before it reads instructions about what to research and ask.
    ...(input.priorPass ? ["## You are resuming an unfinished pass", renderPriorPass(input.priorPass), ""] : []),
    "## Linked context sources",
    renderLinkedSources(input.linkedSources),
    "",
    "## Local directories you may read",
    renderWorkspaceRoots(input.workspaceRoots),
    "",
    "## How to research",
    renderResearchDoctrine(input.webResearch),
    "",
    "## How to work with the user",
    "- Call search_memory before asking anything the user may already have told Aimcub.",
    `- ask_user asks ONE blocking question at a time, budget ${budgets.maxQuestions} per session. Spend it on questions whose answer changes decomposition, routing, research direction, risk controls, evidence, or the definition of done.`,
    "- Sort every unknown by where its answer lives. World facts (options, requirements, prices, comparisons) live in research: never ask the user what your tools can find. Personal facts (dates, budget, who is involved, taste, obligations, experience) live only in the user: research can NEVER answer them — ask, do not guess.",
    "- When the aim is about the user's own life (a trip, a career move, health, learning, finances), open with the 2-4 personal-fact questions that most shape the plan, then research with the answers in hand. When research can cover most of the aim, research first and ask only what it could not answer.",
    "- Prefer options-with-tradeoffs (hypotheses) over open questions; a free-text escape hatch is always added for you.",
    "- Choice cardinality: single ONLY when answers are mutually exclusive in the same scope or one primary choice is explicitly required; if any pair of options can be true together, use multiple; uncertainty defaults to multiple.",
    "- Interleave throughout: let each answer redirect the next research step and each research result sharpen the next question. Do not front-load the full budget as a questionnaire.",
    "- Tool replies may carry user_notes (the user's temporary-chat interjections) and directives. Treat user_notes as fresh user input; a finish_now directive means stop researching and submit the plan with your current understanding.",
    "- Low-impact unknowns are NOT questions: default them and disclose the default in submit_plan assumptions. A personal fact that shapes the plan's structure is never low-impact.",
    "- Durable, reusable facts you discover (stable preferences, constraints, capabilities) go through propose_memory as pending candidates.",
    "",
    "## What to deliver",
    `- Call submit_plan with the milestone plan. If the reply lists validation errors or quality critique, fix them and submit again (budget ${budgets.maxSubmitAttempts} attempts).`,
    "- The session ends when a submission is accepted. Do not print the plan as prose; the tool call is the deliverable.",
    "",
    "Plan rules:",
    DECOMPOSITION_PLAN_RULES,
  ].join("\n");
}
