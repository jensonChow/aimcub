/**
 * Pure output formatters for the CLI — kept separate from I/O so they are unit-testable.
 * The CLI shell (index.ts) does argv/env/network; these functions only render strings.
 */
import type { AcceptanceRule, DecompositionOutput, Goal, Milestone } from "@core/types";
import type { MergeAction, MergedItem } from "@core/domain";
import type { ClarifyOutput } from "@core/llm";

/** A terse one-line summary of an acceptance rule (which evaluators must fire). */
export function ruleSummary(rule: AcceptanceRule): string {
  const clauses = Array.isArray(rule?.clauses) ? rule.clauses : [];
  if (clauses.length === 0) return "manual";
  const join = rule.logic === "any" ? " OR " : " AND ";
  return clauses.map((c) => c.evaluator).join(join);
}

/** Render a decomposition plan as readable, terminal-friendly text. */
export function formatPlanPretty(plan: DecompositionOutput): string {
  const lines: string[] = [];
  lines.push(plan.goal_summary || "(plan)");
  lines.push(`${plan.nodes.length} milestone${plan.nodes.length === 1 ? "" : "s"}`);
  lines.push("");
  plan.nodes.forEach((n, i) => {
    lines.push(`${i + 1}. ${n.title}  (+${n.xp_reward} xp · ${n.est_effort})`);
    if (n.description) lines.push(`   ${n.description}`);
    lines.push(`   ✓ ${ruleSummary(n.acceptance_rule)}`);
  });
  return lines.join("\n");
}

/** Render the clarifying-questions step as readable text. */
export function formatClarifyPretty(title: string, out: ClarifyOutput): string {
  const lines: string[] = [];
  lines.push(`Clarifying questions for: ${title}`);
  lines.push("");
  if (out.questions.length === 0) {
    lines.push("(no high-impact questions — the plan is ready)");
  }
  out.questions.forEach((q) => {
    lines.push(`[${q.kind}] ${q.question}`);
    if (q.why_high_impact) lines.push(`   why: ${q.why_high_impact}`);
    q.options.forEach((o) => lines.push(`   - ${o.label}${o.tradeoff ? ` — ${o.tradeoff}` : ""}`));
    lines.push("");
  });
  if (out.assumptions.length > 0) {
    lines.push("Assuming (override anything wrong):");
    out.assumptions.forEach((a) => lines.push(`   • ${a.statement}${a.default_value ? ` (${a.default_value})` : ""}`));
  }
  return lines.join("\n").trimEnd();
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

/** A saved aim paired with its materialized milestone-row count (the source of truth for the count). */
export interface GoalListItem {
  goal: Goal;
  milestoneCount: number;
}

/** Render the saved-aims list, one per line (id · title · #milestones · date). */
export function formatGoalList(items: GoalListItem[]): string {
  if (items.length === 0) return "No aims yet. Create one with: aim new \"<title>\"";
  return items
    .map(({ goal, milestoneCount: n }) => {
      const date = goal.created_at ? goal.created_at.slice(0, 10) : "";
      return `${shortId(goal.id)}  ${goal.title}  (${n} milestone${n === 1 ? "" : "s"}${date ? ` · ${date}` : ""})`;
    })
    .join("\n");
}

/** One-line summary of a re-plan merge: how many milestones were added/updated/kept/skipped. */
export function formatMergeSummary(merged: MergedItem[]): string {
  const n = (a: MergeAction): number => merged.filter((m) => m.action === a).length;
  return `re-plan: ${n("add")} added · ${n("update")} updated · ${n("freeze")} kept (done) · ${n("skip")} skipped`;
}

/** Render a saved aim + its materialized milestones. */
export function formatGoalDetail(goal: Goal, milestones: Milestone[]): string {
  const lines: string[] = [];
  lines.push(goal.title);
  if (goal.description) lines.push(goal.description);
  lines.push(`id: ${goal.id}`);
  lines.push(`${milestones.length} milestone${milestones.length === 1 ? "" : "s"}`);
  lines.push("");
  milestones.forEach((m, i) => {
    lines.push(`${i + 1}. ${m.title}  [${m.status}]  (+${m.xp_reward} xp)`);
    if (m.description) lines.push(`   ${m.description}`);
    lines.push(`   ✓ ${ruleSummary(m.acceptance_rule)}`);
  });
  return lines.join("\n").trimEnd();
}
