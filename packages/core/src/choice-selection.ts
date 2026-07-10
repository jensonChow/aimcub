export const CHOICE_SELECTION_REASONS = [
  "mutually_exclusive",
  "primary_choice_requested",
  "compatible_options",
  "unclear_defaults_multiple",
] as const;

export type ChoiceSelectionMode = "single" | "multiple";
export type ChoiceSelectionReason = (typeof CHOICE_SELECTION_REASONS)[number];

export interface ChoiceSelectionOption {
  label: string;
  detail?: string;
}

export interface DecideChoiceSelectionInput {
  question: string;
  options: readonly ChoiceSelectionOption[];
  requestedMode?: unknown;
  requestedReason?: unknown;
}

export interface ChoiceSelectionDecision {
  mode: ChoiceSelectionMode;
  reason: ChoiceSelectionReason;
}

const AVAILABILITY_STATE_WORDS = new Set([
  "account", "access", "already", "available", "configured", "configuration",
  "credential", "credentials", "environment", "integration", "missing", "need",
  "needs", "permission", "permissions", "ready", "setup", "unavailable",
]);

function requestedMode(value: unknown): ChoiceSelectionMode | null {
  return value === "single" || value === "multiple" ? value : null;
}

function requestedReason(value: unknown): ChoiceSelectionReason | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return CHOICE_SELECTION_REASONS.find((reason) => reason === normalized) ?? null;
}

function asksForExactlyOne(question: string): boolean {
  const text = question.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!text) return false;
  if (/\bone\s+or\s+more\b/i.test(text) || /(?:\u4e00\u9879|\u4e00\u4e2a|\u4e00\u6761)\u6216(?:\u591a\u9879|\u591a\u4e2a|\u591a\u6761)/.test(text)) return false;

  const englishCues = [
    /\b(?:choose|select|pick)\s+(?:exactly\s+one|one\s+and\s+only\s+one|one\s+only)\b/i,
    /\b(?:choose|select|pick)\s+one\s+(?:option|answer|choice)\s+only\b/i,
    /\b(?:exactly|only)\s+one\s+(?:option|answer|choice)\b/i,
    /\bwhich\s+one\b/i,
    /\b(?:choose|select|pick)\s+(?:a\s+single\s+|one\s+)(?:[a-z-]+\s+){0,2}(?:option|answer|choice|route|path|region|platform|tool|team|style|format|language|owner|approver)\b/i,
  ];
  if (englishCues.some((cue) => cue.test(text))) return true;

  const chineseCues = [
    /(?:\u8bf7\u9009\u62e9|\u9009\u62e9|\u9009\u51fa|\u52fe\u9009)(?:\u4e14\u4ec5|\u4ec5\u9650|\u4ec5|\u53ea|\u53ea\u80fd|\u6070\u597d)(?:\u9009\u62e9|\u9009)?(?:\u4e00\u9879|\u4e00\u4e2a)/,
    /(?:\u4ec5|\u53ea|\u53ea\u80fd|\u5fc5\u987b|\u6070\u597d)(?:\u9009\u62e9|\u9009\u51fa|\u52fe\u9009)(?:\u4e00\u9879|\u4e00\u4e2a)/,
    /(?:\u8bf7\u9009\u62e9|\u9009\u62e9|\u9009\u51fa|\u52fe\u9009)(?:\u4e00\u9879|\u4e00\u4e2a|\u4e00\u6761)(?!\u6216)/,
  ];
  return chineseCues.some((cue) => cue.test(text.replace(/\s+/g, "")));
}

function asksForExclusiveScalar(question: string): boolean {
  const text = question.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!text) return false;
  return /\bwhich\s+(?:current\s+|target\s+|output\s+|launch\s+)?(?:status|stage|level|format|tier|mode|maturity\s+stage|maturity|language|locale|residency|location|region|date|deadline)\b(?=\s+(?:should|is|will|would|applies?|best|must)\b|[?.]|$)/i.test(text) ||
    /\bwhere\s+(?:must|should|will)\b.{0,48}\b(?:data\s+)?reside\b/i.test(text) ||
    /\bhow\s+(?:polished|detailed|strict|mature)\b/i.test(text) ||
    /\bwhat\s+(?:polish|maturity)\s+(?:level|stage)\b/i.test(text) ||
    /\u54ea(?:\u4e2a|\u79cd)(?:\u72b6\u6001|\u9636\u6bb5|\u7ea7\u522b|\u683c\u5f0f|\u6863\u4f4d|\u6a21\u5f0f|\u6210\u719f\u9636\u6bb5|\u6210\u719f\u5ea6|\u8bed\u8a00|\u5b8c\u6210\u5ea6)/.test(text);
}

function asksForPrimaryChoice(question: string): boolean {
  const text = question.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!text) return false;
  const selectionNoun = "option|answer|choice|route|path|priority|approach|approver|owner|format|level|target|platform|tool|team|style|language|region";
  return new RegExp(`^\\s*(?:which|what|choose|select|pick)\\s+(?:the\\s+)?(?:single|sole|primary|main|top|default|preferred)\\s+(?:(?:deployment|design|implementation|output|approval)\\s+)?(?:${selectionNoun})\\b(?=\\s+(?:should|is|will|would|do|does|best|fits)\\b|[?.]|$)`, "i").test(text) ||
    new RegExp(`^\\s*(?:which|what)\\s+(?:the\\s+)?(?:${selectionNoun})\\b.{0,24}\\b(?:is|should\\s+be|will\\s+be|would\\s+be)\\s+(?:the\\s+)?(?:single|sole|primary|main|top|default|preferred)\\b`, "i").test(text) ||
    /^\s*who\s+(?:is|should\s+be)\s+the\s+first\s+(?:real\s+)?(?:user|audience\s+segment)\b/i.test(text) ||
    /^\s*who\s+should\s+be\s+(?:the\s+)?(?:single|sole|primary|main|final)\s+(?:final\s+)?(?:approver|owner)\b/i.test(text) ||
    /^\s*who\s+should\s+(?:hold|own|have)\s+final\s+(?:approval|decision)\b/i.test(text) ||
    /^\s*which\s+(?:team|person|role|owner|approver)\b.{0,24}\b(?:own|hold|have)\b.{0,16}\bfinal\s+(?:approval|decision)\b/i.test(text) ||
    /^\s*which\s+(?:design\s+)?(?:style|format|platform|tool|team|route|path|approach)\b.{0,40}\b(?:best\s+fits?|fits?\b.{0,12}\bbest)\b/i.test(text) ||
    /^(?:\u8bf7\u9009\u62e9|\u9009\u62e9|\u9009\u51fa|\u54ea\u4e2a|\u54ea\u79cd)(?:\u552f\u4e00|\u9996\u8981|\u4e3b\u8981|\u4f18\u5148|\u9ed8\u8ba4|\u9996\u9009)(?:\u7684)?(?:\u90e8\u7f72|\u8bbe\u8ba1|\u8f93\u51fa)?(?:\u9009\u9879|\u7b54\u6848|\u8def\u7ebf|\u8def\u5f84|\u8d1f\u8d23\u4eba|\u5e73\u53f0|\u5de5\u5177|\u56e2\u961f|\u98ce\u683c)(?=\u5e94\u8be5|\u662f|\u5c06|\u6700|\uff1f|$)/.test(text.replace(/\s+/g, "")) ||
    /^(?:\u54ea\u4e2a|\u54ea\u79cd)(?:\u5e73\u53f0|\u5de5\u5177|\u56e2\u961f|\u98ce\u683c|\u8def\u7ebf|\u8def\u5f84).{0,12}(?:\u4f5c\u4e3a|\u662f)(?:\u9ed8\u8ba4|\u9996\u9009|\u4e3b\u8981|\u4f18\u5148)/.test(text.replace(/\s+/g, "")) ||
    /\u7b2c\u4e00\u9636\u6bb5.{0,24}(?:\u4e3b\u8def\u7ebf|\u9996\u8981\u8def\u7ebf|\u4f18\u5148\u8def\u7ebf|\u552f\u4e00\u8def\u7ebf)/.test(text);
}

function asksForCompatibleSet(input: DecideChoiceSelectionInput): boolean {
  const text = input.question.normalize("NFKC");
  return /\b(?:routes?|paths?|pathways?|approaches|strategies|evidence|proof|capabilities|constraints|requirements|sources|materials|tools|platforms|channels|skills|audiences|stakeholders|participants|reviewers|roles|teams|sections|features|outcomes|deliverables|qualities|attributes|values|principles|themes|styles|traits|integrations)\b/i.test(text) ||
    /\b(?:one\s+or\s+more|all\s+that\s+apply)\b/i.test(text) ||
    /\b(?:what|which)\b.{0,48}\b(?:coexist|apply\s+together)\b/i.test(text) ||
    /\b(?:participate|participating|involved|take part)\b/i.test(text) ||
    /\bwho\b.{0,24}\breview\b/i.test(text) ||
    /(?:\u8def\u5f84|\u8def\u7ebf|\u8bc1\u636e|\u80fd\u529b)/.test(text) ||
    /(?:\u54ea\u4e9b|\u54ea\u51e0|\u591a\u9009|\u5171\u540c|\u540c\u65f6|\u5e76\u884c|\u53c2\u4e0e|\u6d89\u53ca|\u5305\u542b)/.test(text);
}

function asksForUnclearAdditiveSet(question: string): boolean {
  const text = question.normalize("NFKC").replace(/\s+/g, " ").trim();
  return /\bwhat\s+is\s+true\b/i.test(text) ||
    /\b(?:what|which)\b.{0,48}\b(?:include|included)\b/i.test(text);
}

function normalizedLabel(label: string): string {
  return label
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[.!?\u3002\uff01\uff1f]+$/g, "")
    .trim();
}

function isClearYesNoBinary(options: readonly ChoiceSelectionOption[]): boolean {
  if (options.length !== 2) return false;
  const labels = new Set(options.map((option) => normalizedLabel(option.label)));
  return (labels.has("yes") && labels.has("no")) ||
    (labels.has("\u662f") && labels.has("\u5426"));
}

function asksAvailabilityQuestion(question: string): boolean {
  const text = question.normalize("NFKC").replace(/\s+/g, " ").trim();
  const resource = /\b(?:access|account|permission|credential|configuration|setup|environment|integration|connection)\b/i.test(text);
  const chineseResource = /(?:\u8d26\u53f7|\u6743\u9650|\u51ed\u8bc1|\u8bbf\u95ee|\u914d\u7f6e|\u73af\u5883|\u96c6\u6210|\u8fde\u63a5)/.test(text);
  return (resource && /\b(?:already\s+have|availability|available|ready|configured|set\s+up)\b/i.test(text)) ||
    (resource && /^\s*(?:is|are|do|does|have|has)\b/i.test(text)) ||
    (chineseResource && /(?:\u662f\u5426|\u6709\u6ca1\u6709|\u5df2\u6709|\u53ef\u7528|\u5c31\u7eea|\u51c6\u5907\u597d|\u5df2\u914d\u7f6e)/.test(text));
}

function isClearAvailabilityBinary(question: string, options: readonly ChoiceSelectionOption[]): boolean {
  if (options.length !== 2) return false;
  if (!asksAvailabilityQuestion(question)) return false;
  const labels = options.map((option) => normalizedLabel(option.label));
  const positive = (label: string) => /\b(?:already|available|configured|ready|set up)\b/i.test(label) || /(?:\u5df2\u6709|\u5df2\u914d\u7f6e|\u5df2\u5c31\u7eea|\u5df2\u51c6\u5907)/.test(label);
  const negative = (label: string) => /\b(?:missing|unavailable|not yet)\b/i.test(label) ||
    /\bneeds?\s+to\s+(?:set\s+(?:it|this|that)\s+up|configure|create|obtain|request|enable|connect|add\s+(?:it|this|that))\b/i.test(label) ||
    /\bneeds?\s+(?:access|an?\s+account|permissions?|credentials?|configuration|setup)\b/i.test(label) ||
    /(?:\u7f3a\u5c11|\u5c1a\u672a|\u6ca1\u6709|\u672a\u914d\u7f6e|\u9700\u8981(?:\u914d\u7f6e|\u8bbe\u7f6e|\u5f00\u901a|\u7533\u8bf7|\u521b\u5efa|\u83b7\u53d6|\u542f\u7528|\u8fde\u63a5))/.test(label);
  const namedTokens = (label: string) => label
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length >= 4 && !AVAILABILITY_STATE_WORDS.has(token));
  return labels.some((label, index) => {
    if (!positive(label)) return false;
    return labels.some((candidate, candidateIndex) => {
      if (candidateIndex === index || !negative(candidate)) return false;
      const positiveNames = namedTokens(label);
      const negativeNames = namedTokens(candidate);
      return positiveNames.length === 0 || negativeNames.length === 0 || positiveNames.some((token) => negativeNames.includes(token));
    });
  });
}

/**
 * Resolves a generated choice question conservatively.
 *
 * Single selection requires either strong deterministic evidence or an aligned
 * model mode/reason pair with no deterministic coexistence contradiction.
 * Everything else defaults to multiple so compatible context is not discarded.
 */
export function decideChoiceSelection(input: DecideChoiceSelectionInput): ChoiceSelectionDecision {
  const mode = requestedMode(input.requestedMode);
  const reason = requestedReason(input.requestedReason);

  if (asksForExactlyOne(input.question)) {
    return { mode: "single", reason: "primary_choice_requested" };
  }

  const availabilityQuestion = asksAvailabilityQuestion(input.question);
  if (isClearYesNoBinary(input.options) || isClearAvailabilityBinary(input.question, input.options)) {
    return { mode: "single", reason: "mutually_exclusive" };
  }

  if (asksForPrimaryChoice(input.question)) {
    return { mode: "single", reason: "primary_choice_requested" };
  }

  if (availabilityQuestion) {
    return {
      mode: "multiple",
      reason: mode === "multiple" && reason === "compatible_options"
        ? "compatible_options"
        : "unclear_defaults_multiple",
    };
  }

  if (asksForUnclearAdditiveSet(input.question)) {
    return {
      mode: "multiple",
      reason: mode === "multiple" && reason === "compatible_options"
        ? "compatible_options"
        : "unclear_defaults_multiple",
    };
  }

  if (asksForCompatibleSet(input)) {
    return { mode: "multiple", reason: "compatible_options" };
  }

  if (asksForExclusiveScalar(input.question)) {
    return { mode: "single", reason: "mutually_exclusive" };
  }

  if (mode === "multiple") {
    return {
      mode: "multiple",
      reason: reason === "compatible_options" ? "compatible_options" : "unclear_defaults_multiple",
    };
  }

  if (mode === "single" && (reason === "compatible_options" || reason === "unclear_defaults_multiple")) {
    return { mode: "multiple", reason: "unclear_defaults_multiple" };
  }

  if (mode === "single" && (reason === "mutually_exclusive" || reason === "primary_choice_requested")) {
    return { mode, reason };
  }

  if (reason === "compatible_options") {
    return { mode: "multiple", reason };
  }

  if (reason === "unclear_defaults_multiple") {
    return { mode: "multiple", reason };
  }

  return { mode: "multiple", reason: "unclear_defaults_multiple" };
}
