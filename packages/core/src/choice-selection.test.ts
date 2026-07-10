import { describe, expect, it } from "vitest";

import {
  CHOICE_SELECTION_REASONS,
  decideChoiceSelection,
  type ChoiceSelectionDecision,
  type DecideChoiceSelectionInput,
} from "./choice-selection";

interface ChoiceSelectionCase {
  name: string;
  input: DecideChoiceSelectionInput;
  expected: ChoiceSelectionDecision;
}

const cases: ChoiceSelectionCase[] = [
  {
    name: "defaults a legacy route question to multiple when the options can coexist",
    input: {
      question: "\u4f60\u7684\u201c\u540d\u5782\u9752\u53f2\u201d\u5177\u4f53\u60f3\u901a\u8fc7\u54ea\u6761\u8def\u5f84\u5b9e\u73b0\uff1f",
      options: [
        { label: "\u5148\u505a\u7528\u6237\u7814\u7a76" },
        { label: "\u5236\u4f5c\u539f\u578b" },
        { label: "\u9080\u8bf7\u9886\u57df\u4e13\u5bb6\u8bc4\u5ba1" },
      ],
      requestedMode: "single",
      requestedReason: "mutually_exclusive",
    },
    expected: { mode: "multiple", reason: "compatible_options" },
  },
  {
    name: "keeps an explicitly requested primary route single",
    input: {
      question: "\u54ea\u6761\u8def\u7ebf\u5e94\u8be5\u4f5c\u4e3a\u7b2c\u4e00\u9636\u6bb5\u7684\u4e3b\u8def\u7ebf\uff1f",
      options: [
        { label: "\u5148\u9a8c\u8bc1\u9700\u6c42" },
        { label: "\u5148\u6784\u5efa\u5b8c\u6574\u4ea7\u54c1" },
      ],
      requestedMode: "single",
      requestedReason: "primary_choice_requested",
    },
    expected: { mode: "single", reason: "primary_choice_requested" },
  },
  {
    name: "keeps two compatible context sources multiple despite a single request",
    input: {
      question: "\u89c4\u5212\u65f6\u9700\u8981\u53c2\u8003\u54ea\u4e9b\u4fe1\u606f\u6765\u6e90\uff1f",
      options: [
        { label: "\u56e2\u961f\u8bbf\u8c08", detail: "\u8865\u5145\u9690\u6027\u6d41\u7a0b\u548c\u7ea6\u675f" },
        { label: "\u73b0\u6709\u4ea7\u54c1\u6570\u636e", detail: "\u9a8c\u8bc1\u5f53\u524d\u884c\u4e3a\u548c\u6548\u679c" },
      ],
      requestedMode: "single",
      requestedReason: "compatible_options",
    },
    expected: { mode: "multiple", reason: "compatible_options" },
  },
  {
    name: "keeps a mutually exclusive maturity level single",
    input: {
      question: "\u8fd9\u4e2a\u4ea7\u54c1\u76ee\u524d\u5904\u4e8e\u54ea\u4e2a\u6210\u719f\u9636\u6bb5\uff1f",
      options: [
        { label: "\u6982\u5ff5\u9a8c\u8bc1" },
        { label: "\u53ef\u7528\u539f\u578b" },
        { label: "\u5df2\u89c4\u6a21\u5316\u8fd0\u8425" },
      ],
      requestedMode: "single",
      requestedReason: "mutually_exclusive",
    },
    expected: { mode: "single", reason: "mutually_exclusive" },
  },
  {
    name: "does not let explanatory tradeoff prose override an exclusive decision",
    input: {
      question: "How polished should the release be?",
      options: [
        { label: "Prototype", detail: "Fastest path to user feedback." },
        { label: "Production-ready", detail: "More time for resilience and finish." },
      ],
      requestedMode: "single",
      requestedReason: "mutually_exclusive",
    },
    expected: { mode: "single", reason: "mutually_exclusive" },
  },
  {
    name: "does not treat the first release scope as a primary-choice request",
    input: {
      question: "What polish level should the first release target?",
      options: [
        { label: "Prototype" },
        { label: "Production-ready" },
      ],
      requestedMode: "single",
      requestedReason: "mutually_exclusive",
    },
    expected: { mode: "single", reason: "mutually_exclusive" },
  },
  {
    name: "defaults compatible completion proof to multiple",
    input: {
      question: "\u54ea\u4e9b\u6750\u6599\u53ef\u4ee5\u5171\u540c\u8bc1\u660e\u8fd9\u4e2a Aim \u5df2\u5b8c\u6210\uff1f",
      options: [
        { label: "\u901a\u8fc7\u7684\u81ea\u52a8\u5316\u6d4b\u8bd5" },
        { label: "\u7528\u6237\u9a8c\u6536\u8bb0\u5f55" },
        { label: "\u4e0a\u7ebf\u540e\u7684\u7ed3\u679c\u6570\u636e" },
      ],
      requestedMode: "single",
    },
    expected: { mode: "multiple", reason: "compatible_options" },
  },
  {
    name: "keeps compatible English constraints multiple",
    input: {
      question: "Which constraints should the plan respect?",
      options: [
        { label: "Budget ceiling" },
        { label: "Launch deadline" },
        { label: "Data residency" },
      ],
      requestedMode: "multiple",
      requestedReason: "compatible_options",
    },
    expected: { mode: "multiple", reason: "compatible_options" },
  },
  {
    name: "keeps the final single approver single",
    input: {
      question: "Who should hold final approval authority?",
      options: [
        { label: "Product lead" },
        { label: "Legal lead" },
        { label: "Executive sponsor" },
      ],
      requestedMode: "single",
      requestedReason: "primary_choice_requested",
    },
    expected: { mode: "single", reason: "primary_choice_requested" },
  },
  {
    name: "rejects a model claim that compatible review participants are exclusive",
    input: {
      question: "Who should participate in review?",
      options: [
        { label: "Designers" },
        { label: "Engineers" },
        { label: "Legal" },
      ],
      requestedMode: "single",
      requestedReason: "mutually_exclusive",
    },
    expected: { mode: "multiple", reason: "compatible_options" },
  },
  {
    name: "rejects a model claim that compatible experience qualities are exclusive",
    input: {
      question: "Which qualities should describe the experience?",
      options: [{ label: "Warm" }, { label: "Clear" }, { label: "Confident" }],
      requestedMode: "single",
      requestedReason: "mutually_exclusive",
    },
    expected: { mode: "multiple", reason: "compatible_options" },
  },
  {
    name: "does not infer single selection merely from two evidence sources",
    input: {
      question: "Which evidence sources should be used?",
      options: [
        { label: "Repository checks" },
        { label: "User acceptance notes" },
      ],
      requestedMode: "single",
    },
    expected: { mode: "multiple", reason: "compatible_options" },
  },
  {
    name: "supports an explicit legacy exactly-one residency cue",
    input: {
      question: "Select exactly one current residency.",
      options: [
        { label: "Mainland China" },
        { label: "Singapore" },
        { label: "United States" },
      ],
      requestedMode: "single",
    },
    expected: { mode: "single", reason: "primary_choice_requested" },
  },
  {
    name: "recognizes a clear Chinese yes-no binary without a model reason",
    input: {
      question: "\u662f\u5426\u9700\u8981\u5728\u53d1\u5e03\u524d\u83b7\u5f97\u6cd5\u52a1\u6279\u51c6\uff1f",
      options: [{ label: "\u662f" }, { label: "\u5426" }],
    },
    expected: { mode: "single", reason: "mutually_exclusive" },
  },
  {
    name: "keeps a yes-no binary single despite contradictory multiple metadata",
    input: {
      question: "Do we need legal approval before launch?",
      options: [{ label: "Yes" }, { label: "No" }],
      requestedMode: "multiple",
      requestedReason: "compatible_options",
    },
    expected: { mode: "single", reason: "mutually_exclusive" },
  },
  {
    name: "keeps one-resource availability single despite contradictory multiple metadata",
    input: {
      question: "Is the deployment account ready?",
      options: [{ label: "Already configured" }, { label: "Need to set it up" }],
      requestedMode: "multiple",
      requestedReason: "compatible_options",
    },
    expected: { mode: "single", reason: "mutually_exclusive" },
  },
  {
    name: "does not treat unrelated availability-sounding options as one binary",
    input: {
      question: "What is true before launch?",
      options: [{ label: "Account already available" }, { label: "Need legal review" }],
      requestedMode: "single",
      requestedReason: "mutually_exclusive",
    },
    expected: { mode: "multiple", reason: "unclear_defaults_multiple" },
  },
  {
    name: "does not treat a different needed action as the negative availability state",
    input: {
      question: "Is the deployment account ready?",
      options: [{ label: "Account already available" }, { label: "Need legal review" }],
      requestedMode: "single",
      requestedReason: "mutually_exclusive",
    },
    expected: { mode: "multiple", reason: "unclear_defaults_multiple" },
  },
  {
    name: "does not collapse readiness across two named resources into one binary",
    input: {
      question: "Which account access is ready?",
      options: [{ label: "Apple account ready" }, { label: "Need Stripe setup" }],
      requestedMode: "multiple",
      requestedReason: "compatible_options",
    },
    expected: { mode: "multiple", reason: "compatible_options" },
  },
  {
    name: "lets an explicit multiple request override a contradictory single reason",
    input: {
      question: "Which launch channels apply?",
      options: [{ label: "App Store" }, { label: "Direct sales" }],
      requestedMode: "multiple",
      requestedReason: "mutually_exclusive",
    },
    expected: { mode: "multiple", reason: "compatible_options" },
  },
  {
    name: "lets explicit exactly-one wording override contradictory multiple metadata",
    input: {
      question: "Choose exactly one deployment region.",
      options: [{ label: "Americas" }, { label: "Europe" }, { label: "Asia Pacific" }],
      requestedMode: "multiple",
      requestedReason: "compatible_options",
    },
    expected: { mode: "single", reason: "primary_choice_requested" },
  },
  {
    name: "recognizes natural choose-one wording",
    input: {
      question: "Choose one deployment region.",
      options: [{ label: "Americas" }, { label: "Europe" }, { label: "Asia Pacific" }],
      requestedMode: "single",
      requestedReason: "primary_choice_requested",
    },
    expected: { mode: "single", reason: "primary_choice_requested" },
  },
  {
    name: "recognizes natural Chinese choose-one wording",
    input: {
      question: "\u8bf7\u9009\u62e9\u4e00\u4e2a\u90e8\u7f72\u533a\u57df\u3002",
      options: [{ label: "\u4e9a\u592a" }, { label: "\u6b27\u6d32" }, { label: "\u7f8e\u6d32" }],
      requestedMode: "single",
      requestedReason: "primary_choice_requested",
    },
    expected: { mode: "single", reason: "primary_choice_requested" },
  },
  {
    name: "keeps a committed launch date single when the model confirms one scalar",
    input: {
      question: "Which launch date should be committed?",
      options: [{ label: "September 1" }, { label: "October 1" }],
      requestedMode: "single",
      requestedReason: "mutually_exclusive",
    },
    expected: { mode: "single", reason: "mutually_exclusive" },
  },
  {
    name: "corrects contradictory multiple metadata for one current scalar stage",
    input: {
      question: "Which current maturity stage applies?",
      options: [{ label: "Concept" }, { label: "Prototype" }, { label: "Production" }],
      requestedMode: "multiple",
      requestedReason: "compatible_options",
    },
    expected: { mode: "single", reason: "mutually_exclusive" },
  },
  {
    name: "keeps plural launch-date candidates multiple",
    input: {
      question: "Which launch dates should be considered?",
      options: [{ label: "September 1" }, { label: "October 1" }],
      requestedMode: "multiple",
      requestedReason: "compatible_options",
    },
    expected: { mode: "multiple", reason: "compatible_options" },
  },
  {
    name: "keeps required data residency single when the model confirms one scalar",
    input: {
      question: "Where must customer data reside?",
      options: [{ label: "European Union" }, { label: "United States" }],
      requestedMode: "single",
      requestedReason: "mutually_exclusive",
    },
    expected: { mode: "single", reason: "mutually_exclusive" },
  },
  {
    name: "does not mistake one-or-more wording for an exactly-one request",
    input: {
      question: "Choose one or more deployment regions.",
      options: [{ label: "Americas" }, { label: "Europe" }, { label: "Asia Pacific" }],
      requestedMode: "multiple",
      requestedReason: "compatible_options",
    },
    expected: { mode: "multiple", reason: "compatible_options" },
  },
  {
    name: "keeps parallel first-stage routes multiple",
    input: {
      question: "\u7b2c\u4e00\u9636\u6bb5\u6709\u54ea\u4e9b\u8def\u5f84\u53ef\u5e76\u884c\u63a8\u8fdb\uff1f",
      options: [{ label: "\u7528\u6237\u7814\u7a76" }, { label: "\u539f\u578b\u9a8c\u8bc1" }],
      requestedMode: "multiple",
      requestedReason: "compatible_options",
    },
    expected: { mode: "multiple", reason: "compatible_options" },
  },
  {
    name: "keeps an explicit primary tool single",
    input: {
      question: "Which primary tool should the team use?",
      options: [{ label: "Figma" }, { label: "Sketch" }],
      requestedMode: "single",
      requestedReason: "primary_choice_requested",
    },
    expected: { mode: "single", reason: "primary_choice_requested" },
  },
  {
    name: "keeps a preferred default platform single",
    input: {
      question: "Which platform is the preferred default?",
      options: [{ label: "Web platform" }, { label: "Desktop platform" }],
      requestedMode: "single",
      requestedReason: "primary_choice_requested",
    },
    expected: { mode: "single", reason: "primary_choice_requested" },
  },
  {
    name: "keeps preferred platform capabilities multiple",
    input: {
      question: "Which preferred platform capabilities apply?",
      options: [{ label: "Offline use" }, { label: "System notifications" }],
      requestedMode: "multiple",
      requestedReason: "compatible_options",
    },
    expected: { mode: "multiple", reason: "compatible_options" },
  },
  {
    name: "keeps main team stakeholders multiple",
    input: {
      question: "Which main team stakeholders should participate?",
      options: [{ label: "Design" }, { label: "Engineering" }, { label: "Legal" }],
      requestedMode: "multiple",
      requestedReason: "compatible_options",
    },
    expected: { mode: "multiple", reason: "compatible_options" },
  },
  {
    name: "keeps participants in final approval multiple",
    input: {
      question: "Who should participate in final approval?",
      options: [{ label: "Product" }, { label: "Legal" }, { label: "Security" }],
      requestedMode: "multiple",
      requestedReason: "compatible_options",
    },
    expected: { mode: "multiple", reason: "compatible_options" },
  },
  {
    name: "keeps a best-fit design style single",
    input: {
      question: "Which design style best fits the brand?",
      options: [{ label: "Editorial" }, { label: "Technical" }],
      requestedMode: "single",
      requestedReason: "primary_choice_requested",
    },
    expected: { mode: "single", reason: "primary_choice_requested" },
  },
  {
    name: "defaults an unclassified compatible feature set to multiple despite a model claim",
    input: {
      question: "What should the first version include?",
      options: [{ label: "Offline mode" }, { label: "Export" }, { label: "Collaboration" }],
      requestedMode: "single",
      requestedReason: "mutually_exclusive",
    },
    expected: { mode: "multiple", reason: "unclear_defaults_multiple" },
  },
  {
    name: "defaults unknown relation metadata to multiple",
    input: {
      question: "Which capabilities matter?",
      options: [{ label: "Research" }, { label: "Implementation" }],
      requestedMode: "single",
      requestedReason: "probably_one",
    },
    expected: { mode: "multiple", reason: "compatible_options" },
  },
];

describe("decideChoiceSelection", () => {
  it.each(cases)("$name", ({ input, expected }) => {
    expect(decideChoiceSelection(input)).toEqual(expected);
  });

  it.each([
    "Which route activities can advance the main goal in parallel?",
    "Which tool integrations should support the primary workflow?",
    "Which platform capabilities belong in the default experience?",
    "Which capabilities should serve the first real user?",
    "\u9ed8\u8ba4\u4f53\u9a8c\u5e94\u8be5\u5305\u542b\u54ea\u4e9b\u5e73\u53f0\u80fd\u529b\uff1f",
    "\u4e3b\u8981\u5de5\u4f5c\u6d41\u9700\u8981\u54ea\u4e9b\u5de5\u5177\u96c6\u6210\uff1f",
  ])("keeps contextual priority wording multiple: %s", (question) => {
    expect(decideChoiceSelection({
      question,
      options: [{ label: "Option A" }, { label: "Option B" }],
      requestedMode: "multiple",
      requestedReason: "compatible_options",
    })).toEqual({ mode: "multiple", reason: "compatible_options" });
  });

  it("publishes one stable reason vocabulary for generators and consumers", () => {
    expect(CHOICE_SELECTION_REASONS).toEqual([
      "mutually_exclusive",
      "primary_choice_requested",
      "compatible_options",
      "unclear_defaults_multiple",
    ]);
  });
});
