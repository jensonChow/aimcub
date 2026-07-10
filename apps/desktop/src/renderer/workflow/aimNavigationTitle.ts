const MAX_NAVIGATION_TITLE_UNITS = 48;

export interface AimNavigationTitleInput {
  title: string | undefined | null;
  plan?: unknown;
  fallback?: string;
}

export interface AimNavigationLabels {
  label: string;
  fullLabel: string;
}

interface AimNavigationSearchInput extends AimNavigationTitleInput {
  description?: string | undefined | null;
  status?: string | undefined | null;
}

function cleanText(value: string | undefined | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function planSummary(plan: unknown): string {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) return "";
  const summary = (plan as { goal_summary?: unknown }).goal_summary;
  return typeof summary === "string" ? cleanText(summary) : "";
}

function conciseIntent(value: string): string {
  let result = value;
  const prefixes = [
    /^(?:我(?:的目标是|想要?|希望|计划|打算)|目标是(?:要)?)\s*/u,
    /^(?:i want to|i would like to|i'd like to|my (?:goal|aim) is to|i plan to|the (?:goal|aim) is to)\s+/iu,
  ];

  for (const prefix of prefixes) {
    result = result.replace(prefix, "");
  }

  result = result
    .replace(/^在([^，。,.!?！？]{1,12})(?:之前|以前)/u, "$1前")
    .replace(/的(?=(?:创始人|负责人|领导者|成员|专家|作者|设计师|工程师)(?:$|[，。,.!?！？]))/u, "")
    .replace(/[。.!！?？]+$/u, "")
    .trim();

  if (/^[a-z][a-z]/u.test(result)) {
    result = `${result[0]!.toUpperCase()}${result.slice(1)}`;
  }
  return result;
}

function displayUnit(segment: string): number {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Extended_Pictographic}]/u.test(segment)
    ? 2
    : 1;
}

function boundedNavigationLabel(value: string): string {
  const segments = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)]
    .map((item) => item.segment);
  const totalUnits = segments.reduce((total, segment) => total + displayUnit(segment), 0);
  if (totalUnits <= MAX_NAVIGATION_TITLE_UNITS) return value;

  const contentBudget = MAX_NAVIGATION_TITLE_UNITS - 1;
  const included: string[] = [];
  let usedUnits = 0;
  let lastBoundaryIndex = -1;
  let lastBoundaryUnits = 0;

  for (const segment of segments) {
    const units = displayUnit(segment);
    if (usedUnits + units > contentBudget) break;
    included.push(segment);
    usedUnits += units;
    if (/^[\s，、,；;：:]+$/u.test(segment)) {
      lastBoundaryIndex = included.length;
      lastBoundaryUnits = usedUnits;
    }
  }

  const boundaryIsUseful = lastBoundaryIndex > 0 && lastBoundaryUnits >= contentBudget * 0.7;
  const clipped = (boundaryIsUseful ? included.slice(0, lastBoundaryIndex) : included)
    .join("")
    .replace(/[\s，、,；;：:。.!！?？-]+$/u, "")
    .trim();
  return `${clipped}…`;
}

export function aimNavigationLabels({ title, plan, fallback = "" }: AimNavigationTitleInput): AimNavigationLabels {
  for (const candidate of [planSummary(plan), cleanText(title), cleanText(fallback)]) {
    const fullLabel = conciseIntent(candidate);
    if (fullLabel) {
      return { label: boundedNavigationLabel(fullLabel), fullLabel };
    }
  }
  return { label: "", fullLabel: "" };
}

/**
 * Returns a compact navigation label without mutating the canonical Aim title.
 * Generated plan summaries win; pre-plan drafts receive conservative
 * intent-prefix cleanup and a grapheme-safe display bound before CSS applies
 * narrower width-aware ellipsis.
 */
export function aimNavigationTitle({ title, plan, fallback = "" }: AimNavigationTitleInput): string {
  return aimNavigationLabels({ title, plan, fallback }).label;
}

export function aimMatchesNavigationQuery(
  input: AimNavigationSearchInput,
  normalizedQuery: string,
): boolean {
  if (!normalizedQuery) return true;
  const { label, fullLabel } = aimNavigationLabels(input);
  return [label, fullLabel, cleanText(input.title), cleanText(input.description), cleanText(input.status)]
    .join(" ")
    .toLowerCase()
    .includes(normalizedQuery);
}
