/**
 * Report rendering — pure, so the report can be regenerated (and tested) from persisted results
 * without re-running a single provider call.
 *
 * The summary line is written to be able to say "no difference" or "context made it worse". A
 * benchmark that can only produce good news is a marketing asset, not an instrument.
 */
import { RUBRIC_CRITERIA, RUBRIC_MAX_TOTAL, totalScore } from "./rubric.ts";
import type { BenchmarkRun, ConditionId, PlanCell, ResolvedJudgement } from "./types.ts";

const CONDITION_LABEL: Record<ConditionId, string> = {
  bare: "bare",
  contexted: "contexted",
};

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function fixed(value: number | null, digits = 2): string {
  return value === null ? "—" : value.toFixed(digits);
}

function signed(value: number | null, digits = 2): string {
  if (value === null) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
}

export interface JudgeSummary {
  perCondition: Record<ConditionId, number | null>;
  delta: number | null;
  perCriterion: Array<{ criterion: string; bare: number | null; contexted: number | null; delta: number | null }>;
  contextedWins: number;
  bareWins: number;
  ties: number;
  comparisons: number;
}

/** Aggregate blind judgements into the numbers the summary line is allowed to lean on. */
export function summarizeJudgements(judgements: readonly ResolvedJudgement[]): JudgeSummary {
  const totals: Record<ConditionId, number[]> = { bare: [], contexted: [] };
  let contextedWins = 0;
  let bareWins = 0;
  let ties = 0;

  for (const judgement of judgements) {
    const bare = totalScore(judgement.byCondition.bare);
    const contexted = totalScore(judgement.byCondition.contexted);
    totals.bare.push(bare);
    totals.contexted.push(contexted);
    if (contexted > bare) contextedWins += 1;
    else if (bare > contexted) bareWins += 1;
    else ties += 1;
  }

  const perCriterion = RUBRIC_CRITERIA.map((criterion) => {
    const pick = (condition: ConditionId): number[] =>
      judgements.flatMap((judgement) =>
        judgement.byCondition[condition]
          .filter((row) => row.criterion === criterion.id)
          .map((row) => row.score),
      );
    const bare = mean(pick("bare"));
    const contexted = mean(pick("contexted"));
    return {
      criterion: criterion.id,
      bare,
      contexted,
      delta: bare === null || contexted === null ? null : contexted - bare,
    };
  });

  const bareMean = mean(totals.bare);
  const contextedMean = mean(totals.contexted);
  return {
    perCondition: { bare: bareMean, contexted: contextedMean },
    delta: bareMean === null || contextedMean === null ? null : contextedMean - bareMean,
    perCriterion,
    contextedWins,
    bareWins,
    ties,
    comparisons: judgements.length,
  };
}

function cellFor(cells: readonly PlanCell[], aimId: string, condition: ConditionId): PlanCell[] {
  return cells.filter((cell) => cell.aimId === aimId && cell.condition === condition);
}

function qualityMean(cells: readonly PlanCell[]): number | null {
  return mean(cells.flatMap((cell) => (cell.groundTruthQuality ? [cell.groundTruthQuality.score] : [])));
}

/**
 * The one sentence a reader will quote. It must be true even when the answer is "no difference",
 * and it must never imply significance from a handful of samples.
 */
export function summaryLine(run: BenchmarkRun, summary: JudgeSummary): string {
  if (run.mode === "dry-run") {
    const empty = run.diffs.filter((diff) => !diff.nonEmpty);
    if (run.diffs.length === 0) return "Dry run produced no context diffs — nothing was measured.";
    if (empty.length > 0) {
      return `Dry run: ${empty.length} of ${run.diffs.length} aim(s) injected NO extra context in the contexted condition — the fixture, not the product, is the problem.`;
    }
    return `Dry run only: the contexted condition injects context the bare condition cannot (${run.diffs.reduce((total, diff) => total + diff.injectedOnly.length, 0)} rows across ${run.diffs.length} aim(s)). No plans were generated, so nothing is claimed about plan quality.`;
  }

  if (summary.comparisons === 0) return "Live run produced no judged comparisons — no claim can be made.";
  const delta = summary.delta;
  const direction =
    delta === null ? "unmeasured" : delta > 0 ? "higher" : delta < 0 ? "LOWER" : "identical";
  const magnitude = delta === null ? "—" : `${signed(delta)} of ${RUBRIC_MAX_TOTAL}`;
  return [
    `Live run, ${summary.comparisons} blind comparison(s) at ${run.repeat} repetition(s) per cell:`,
    `the contexted condition scored ${direction} than bare (${magnitude};`,
    `${summary.contextedWins} win / ${summary.bareWins} loss / ${summary.ties} tie).`,
    summary.comparisons < 10
      ? "This is a directional signal from a small sample, not a significance test."
      : "Treat the spread across aims, not the mean alone, as the finding.",
  ].join(" ");
}

export function renderReport(run: BenchmarkRun): string {
  const summary = summarizeJudgements(run.judgements);
  const lines: string[] = [
    "# Eval-moat benchmark report",
    "",
    "> Does accrued context and personalized eval demonstrably improve later decompositions?",
    "> This report is the instrument's raw output. A null or negative result is a valid finding.",
    "",
    "## Run",
    "",
    `- mode: **${run.mode}**`,
    `- started: ${run.startedAt}`,
    `- aims: ${run.aims.join(", ")}`,
    `- seed: \`${run.seed}\` · repetitions per cell: ${run.repeat}`,
    `- provider: ${run.provider ?? "(none — no provider call was made)"}`,
    `- model: ${run.model ?? "(none)"}`,
    `- provider calls made: **${run.providerCalls}**`,
    "",
    "## Summary",
    "",
    summaryLine(run, summary),
    "",
  ];

  if (run.warnings.length > 0) {
    lines.push("### Warnings", "");
    for (const warning of run.warnings) lines.push(`- ${warning}`);
    lines.push("");
  }

  lines.push("## Context diff (provider-free)", "");
  lines.push("What the contexted store injects into the decomposition prompt that the bare store cannot.", "");
  for (const diff of run.diffs) {
    lines.push(`### ${diff.aimId}`, "");
    lines.push(
      `- injected: **${diff.injectedRows} row(s)** / ${diff.injectedChars} chars (bare: ${diff.bareRows} row(s) / ${diff.bareChars} chars)`,
    );
    if (diff.byCategory.length > 0) {
      lines.push(`- categories: ${diff.byCategory.map((row) => `${row.category} ×${row.count}`).join(", ")}`);
    }
    lines.push(`- withheld from planning: ${diff.withheld.length} row(s) held back by selection`);
    lines.push("");
    if (diff.injectedOnly.length > 0) {
      lines.push("| scope | category | why selected | context |", "| --- | --- | --- | --- |");
      for (const row of diff.injectedOnly) {
        lines.push(`| ${row.scope} | ${row.category} | ${row.reason} (${row.score}) | ${row.content} |`);
      }
      lines.push("");
    }
    if (diff.weakMatches.length > 0) {
      lines.push(
        `- ⚠ ${diff.weakMatches.length} row(s) from another aim were admitted on function-word overlap alone:`,
      );
      for (const row of diff.weakMatches) {
        lines.push(`  - matched on \`${row.matchedTokens.join("`, `")}\` · [${row.category}] ${row.content}`);
      }
      lines.push("");
    }
    if (diff.withheld.length > 0) {
      lines.push("<details><summary>Withheld rows and why</summary>", "");
      for (const row of diff.withheld) lines.push(`- \`${row.reason}\` · [${row.category}] ${row.content}`);
      lines.push("", "</details>", "");
    }
    for (const line of diff.learningDelta) lines.push(`- ${line}`);
    lines.push("");
  }

  if (run.mode === "dry-run") {
    lines.push(
      "## Plans",
      "",
      "No plans were generated: dry-run mode never calls a provider. Run with `--live` and a",
      "configured provider key to produce plans, blind judgements, and scores.",
      "",
    );
    return `${lines.join("\n")}\n`;
  }

  lines.push("## Blind judgement", "");
  lines.push(
    `Rubric: ${RUBRIC_CRITERIA.length} criteria × 5 points = ${RUBRIC_MAX_TOTAL} max. The judge saw both plans`,
    "labelled A/B in a seeded random order, with the persona's ground truth but no condition labels.",
    "",
    "| aim | rep | bare | contexted | delta |",
    "| --- | --- | --- | --- | --- |",
  );
  for (const judgement of run.judgements) {
    const bare = totalScore(judgement.byCondition.bare);
    const contexted = totalScore(judgement.byCondition.contexted);
    lines.push(
      `| ${judgement.aimId} | ${judgement.repetition} | ${bare} | ${contexted} | ${signed(contexted - bare, 0)} |`,
    );
  }
  lines.push("");

  lines.push("### Per criterion (mean across all judged cells)", "");
  lines.push("| criterion | bare | contexted | delta |", "| --- | --- | --- | --- |");
  for (const row of summary.perCriterion) {
    lines.push(`| ${row.criterion} | ${fixed(row.bare)} | ${fixed(row.contexted)} | ${signed(row.delta)} |`);
  }
  lines.push("");

  lines.push("### Deterministic cross-check (no judge involved)", "");
  lines.push(
    "`critiquePlan` scored against the persona's full ground-truth context — the same yardstick held",
    "to both plans. This number is computed locally and does not depend on the judge model.",
    "",
    "Read it with the manual-only and owner-mix columns below, not on its own. The scorer used to",
    "punish honest human routing — `manual_only_verification` and `duplicate_acceptance_rule` fired",
    "on every human-owned milestone verified by confirmation, which is the only verification real",
    "approvals, waivers, and sign-offs can have. That was this benchmark's first finding and it is",
    "fixed in `@core`: the two rules now fire only where machine-checkable evidence was plausibly",
    "available and went unused. Where this table and the blind judge still disagree, that gap is a",
    "finding about the scorer, not proof that the judge is wrong.",
    "",
    "| aim | bare | contexted | delta |",
    "| --- | --- | --- | --- |",
  );
  for (const aimId of run.aims) {
    const bare = qualityMean(cellFor(run.cells, aimId, "bare"));
    const contexted = qualityMean(cellFor(run.cells, aimId, "contexted"));
    const delta = bare === null || contexted === null ? null : contexted - bare;
    lines.push(`| ${aimId} | ${fixed(bare, 1)} | ${fixed(contexted, 1)} | ${signed(delta, 1)} |`);
  }
  lines.push("");

  lines.push("### Plan shape", "");
  lines.push("| aim | condition | rep | milestones | manual-only | owner mix | valid |", "| --- | --- | --- | --- | --- | --- | --- |");
  for (const cell of run.cells) {
    const owners = Object.entries(cell.ownerMix)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([owner, count]) => `${owner}:${count}`)
      .join(" ");
    lines.push(
      `| ${cell.aimId} | ${CONDITION_LABEL[cell.condition]} | ${cell.repetition} | ${cell.nodeCount} | ${cell.manualOnlyNodes} | ${owners || "—"} | ${cell.ok ? "yes" : `no (${cell.errors[0] ?? "unknown"})`} |`,
    );
  }
  lines.push("");

  lines.push("### Judge notes", "");
  for (const judgement of run.judgements) {
    if (!judgement.notes.trim()) continue;
    lines.push(`- **${judgement.aimId}** (rep ${judgement.repetition}, A=${judgement.labelMap.A}): ${judgement.notes.trim()}`);
  }
  lines.push("");

  lines.push(
    "## Re-score this by hand",
    "",
    "Every plan and every raw judge response is written next to this report: `plans/` holds the",
    "generated plans, `context/` the exact context block each cell was given, and `judge/` the",
    "prompt, the raw response, and the A/B label map. Re-scoring by hand needs nothing else.",
    "",
  );

  return `${lines.join("\n")}\n`;
}
