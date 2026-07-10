import { describe, expect, it, vi } from "vitest";

import {
  clarify,
  clarifyAnswersToMemories,
  clarifyImpactReportFromMetadata,
  summarizeClarifyLearning,
  traceClarifyAnswerImpact,
  buildRefinedDescription,
  type ClarifyInput,
  type ClarifyAnswer,
} from "./clarify";
import type { DecompositionOutput } from "@core/types";
import type { LlmGateway, LlmRequest, LlmResponse, LlmUsage } from "./index";

const FIXED_USAGE: LlmUsage = {
  model: "claude-haiku-4-5-20251001",
  inputTokens: 21,
  outputTokens: 40,
};

function mockGateway(output: unknown): LlmGateway & { calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  return {
    calls,
    async complete(req: LlmRequest): Promise<LlmResponse<string>> {
      calls.push(req);
      return { output: typeof output === "string" ? output : JSON.stringify(output), usage: FIXED_USAGE };
    },
    async completeStructured<T>(req: LlmRequest & { schema: unknown }): Promise<LlmResponse<T>> {
      calls.push(req);
      return { output: output as T, usage: FIXED_USAGE };
    },
  };
}

function throwingGateway(message: string): LlmGateway {
  return {
    async complete(): Promise<LlmResponse<string>> {
      throw new Error(message);
    },
    async completeStructured<T>(): Promise<LlmResponse<T>> {
      throw new Error(message);
    },
  };
}

/** A minimal first-pass draft to ground questions in (shape-only; not zod-parsed). */
const DRAFT = {
  goal_summary: "Build a CLI todo app.",
  domain: "software",
  rationale: "Scaffold, implement, test, release.",
  nodes: [
    {
      key: "m1",
      title: "Scaffold the CLI",
      description: "Init the project.",
      est_effort: "s",
      xp_reward: 10,
      decomposition_contract: {
        why: "The CLI needs a runnable base before commands can be added.",
        definition_of_done: "The CLI project is initialized and runnable.",
        required_evidence: ["A scaffold commit."],
        likely_owner: "agent",
        context_gaps: [
          {
            category: "procedure",
            question: "Which package manager and test command should this CLI use?",
            reason: "draft_contract_gap",
          },
        ],
        eval_signal: "The milestone is done when the project can run locally.",
      },
      acceptance_rule: { logic: "all", clauses: [], threshold: 1, completion_mode: "auto" },
    },
    {
      key: "m2",
      title: "Implement add/list/done",
      description: "Core commands.",
      est_effort: "m",
      xp_reward: 20,
      decomposition_contract: {
        why: "Core commands are the first user-visible capability.",
        definition_of_done: "The add, list, and done commands work end to end.",
        required_evidence: ["A feature commit for the command handlers."],
        likely_owner: "either",
        context_gaps: [],
        eval_signal: "The milestone is done when users can complete the main todo workflow.",
      },
      acceptance_rule: { logic: "all", clauses: [], threshold: 1, completion_mode: "auto" },
    },
  ],
  edges: [{ from: "m1", to: "m2" }],
} as unknown as DecompositionOutput;

const INPUT: ClarifyInput = {
  title: "Build a CLI todo app with tests + CI",
  description: "A small command-line todo app.",
  domain: "software",
  draft: DRAFT,
};

/** A canned, valid clarify output: two real forks + a disclosed assumption. */
function validQuestions() {
  return {
    questions: [
      {
        id: "scope",
        question: "How polished should it be?",
        why_high_impact: "Decides milestone count and acceptance strictness.",
        kind: "scope",
        source_dimension: "granularity",
        allow_other: true,
        selection_mode: "single",
        selection_mode_reason: "mutually_exclusive",
        options: [
          { label: "Prototype", tradeoff: "Fastest, looser." },
          { label: "Production", tradeoff: "Slower, strict CI gates." },
        ],
      },
      {
        id: "lang",
        question: "Which language?",
        why_high_impact: "Changes the scaffold and CI workflow.",
        kind: "constraint",
        allow_other: true,
        selection_mode: "single",
        selection_mode_reason: "mutually_exclusive",
        options: [
          { label: "TypeScript", tradeoff: "Node ecosystem." },
          { label: "Go", tradeoff: "Single static binary." },
        ],
      },
    ],
    assumptions: [
      { statement: "Assumed GitHub + CI as the evidence source.", default_value: "github" },
    ],
  };
}

function validThreeQuestions() {
  return {
    questions: [
      ...validQuestions().questions,
      {
        id: "proof",
        question: "What evidence proves the main workflow is complete?",
        why_high_impact: "Changes acceptance rules and eval signal.",
        kind: "assumption",
        source_dimension: "verifiability",
        allow_other: true,
        selection_mode: "multiple",
        selection_mode_reason: "compatible_options",
        options: [
          { label: "Passing smoke test", tradeoff: "Clear and automatable." },
          { label: "Manual demo", tradeoff: "Faster but less repeatable." },
        ],
      },
    ],
    assumptions: [],
  };
}

describe("clarify · happy path", () => {
  it("maps a canned question set, validates it, and returns it + usage", async () => {
    const gw = mockGateway(validQuestions());
    const result = await clarify(gw, INPUT);

    expect(result.validation.ok).toBe(true);
    expect(result.validation.errors).toEqual([]);
    expect(result.output).not.toBeNull();
    expect(gw.calls[0]!.system).toContain("Return 0-7 questions");
    expect(gw.calls[0]!.system).not.toContain("usually 4-6 questions");
    expect(result.output?.questions.map((q) => q.id)).toEqual(["scope", "lang"]);
    expect(result.output?.questions[0]?.source_dimension).toBe("granularity");
    expect(result.output?.questions[0]?.selection_mode).toBe("single");
    expect(result.output?.questions[1]?.selection_mode).toBe("single");
    expect(result.output?.questions[0]?.capture).toMatchObject({
      category: "constraint",
      scope: "global",
      purpose: "shape_plan",
      improvesDimension: "granularity",
      reason: "clarify_granularity",
    });
    expect(result.output?.questions[0]?.options).toHaveLength(2);
    expect(result.output?.assumptions[0]?.default_value).toBe("github");
    expect(result.usage).toEqual(FIXED_USAGE);
  });

  it("marks constraint-set questions as multi-select while keeping mutually exclusive choices single-select", async () => {
    const result = await clarify(mockGateway({
      questions: [
        {
          id: "constraints",
          question: "Which constraints, tools, platforms, or data requirements apply?",
          why_high_impact: "Changes scope, routing, and evidence choices.",
          kind: "constraint",
          source_dimension: "context_fit",
          allow_other: true,
          options: [
            { label: "Must support iOS and Android", tradeoff: "Adds cross-platform work." },
            { label: "Must work offline", tradeoff: "Requires local-first storage." },
          ],
        },
        {
          id: "polish",
          question: "How polished should the first version be?",
          why_high_impact: "Changes milestone count and acceptance strictness.",
          kind: "scope",
          source_dimension: "granularity",
          allow_other: true,
          selection_mode: "single",
          selection_mode_reason: "mutually_exclusive",
          options: [
            { label: "Prototype", tradeoff: "Fastest path." },
            { label: "Production-ready", tradeoff: "More quality gates." },
          ],
        },
      ],
      assumptions: [],
    }), INPUT);

    expect(result.validation.ok).toBe(true);
    expect(result.output?.questions.find((q) => q.id === "constraints")?.selection_mode).toBe("multiple");
    expect(result.output?.questions.find((q) => q.id === "polish")?.selection_mode).toBe("single");
  });

  it("overrides an explicit single mode when the model says route options are compatible", async () => {
    const result = await clarify(mockGateway({
      questions: [{
        id: "legacy_routes",
        question: "\u4f60\u7684\u2018\u540d\u5782\u9752\u53f2\u2019\u5177\u4f53\u60f3\u901a\u8fc7\u54ea\u6761\u8def\u5f84\u5b9e\u73b0\uff1f",
        why_high_impact: "\u4e0d\u540c\u8def\u5f84\u4f1a\u6539\u53d8\u8ba1\u5212\u8fb9\u754c\u548c\u8d44\u6e90\u914d\u7f6e\u3002",
        kind: "scope",
        source_dimension: "context_fit",
        allow_other: true,
        selection_mode: "single",
        selection_mode_reason: "compatible_options",
        options: [
          { label: "\u6587\u5b66\u521b\u4f5c", tradeoff: "\u9700\u8981\u957f\u671f\u5199\u4f5c\u548c\u51fa\u7248\u3002" },
          { label: "\u79d1\u5b66\u7a81\u7834", tradeoff: "\u9700\u8981\u4e13\u4e1a\u7814\u7a76\u548c\u540c\u884c\u8ba4\u53ef\u3002" },
          { label: "\u521b\u4e1a\u521b\u65b0", tradeoff: "\u9700\u8981\u56e2\u961f\u3001\u8d44\u672c\u548c\u5e02\u573a\u9a8c\u8bc1\u3002" },
          { label: "\u793e\u4f1a\u5f71\u54cd", tradeoff: "\u9700\u8981\u7ec4\u7ec7\u884c\u52a8\u548c\u516c\u5171\u6210\u679c\u3002" },
        ],
      }],
      assumptions: [],
    }), {
      ...INPUT,
      title: "\u6211\u60f3\u8981\u540d\u5782\u9752\u53f2",
      outputLanguage: "simplified_chinese",
    });

    expect(result.validation.ok).toBe(true);
    expect(result.output?.questions[0]).toMatchObject({
      selection_mode: "multiple",
      selection_mode_reason: "compatible_options",
    });
  });

  it("routes the request as a `classify` task and supplies the JSON schema + draft", async () => {
    const gw = mockGateway(validQuestions());
    await clarify(gw, INPUT);

    expect(gw.calls).toHaveLength(1);
    const call = gw.calls[0]!;
    expect(call.task).toBe("classify");
    expect(call.schema).toBeDefined();
    expect(JSON.stringify(call.schema)).toContain("source_dimension");
    expect(JSON.stringify(call.schema)).toContain("selection_mode");
    expect(JSON.stringify(call.schema)).toContain("selection_mode_reason");
    expect(call.system).toContain("CLARIFYING");
    expect(call.system).toContain("source_dimension");
    expect(call.system).toContain("selection_mode");
    expect(call.system).toContain("Test every option pair");
    expect(call.prompt).toContain(INPUT.title);
    expect(call.prompt).toContain("Scaffold the CLI"); // draft is grounded in
    expect(call.prompt).toContain("contract: owner=agent");
    expect(call.prompt).toContain("A scaffold commit.");
    expect(call.prompt).toContain("gap [procedure]");
  });

  it("includes known user context so the model can avoid repeated questions", async () => {
    const gw = mockGateway(validQuestions());
    await clarify(gw, {
      ...INPUT,
      memories: [
        {
          category: "constraint",
          kind: "semantic",
          source: "user_stated",
          content: "User prefers TypeScript.",
          confidence: 1,
        },
      ],
    });

    expect(gw.calls[0]!.prompt).toContain("Known user context");
    expect(gw.calls[0]!.prompt).toContain("constraint:");
    expect(gw.calls[0]!.prompt).toContain("User prefers TypeScript.");
    expect(gw.calls[0]!.system).toContain("preference: shape scope");
    expect(gw.calls[0]!.system).toContain("capability: use for routing");
  });

  it("includes historical clarify learning so question choice can optimize for impact", async () => {
    const gw = mockGateway(validQuestions());
    await clarify(gw, {
      ...INPUT,
      learning: summarizeClarifyLearning([
        {
          version: 1,
          answered_count: 1,
          impacted_count: 1,
          changed_node_count: 1,
          quality_delta: [
            {
              dimension: "verifiability",
              beforeScore: 70,
              afterScore: 100,
              delta: 30,
              beforeGrade: "warn",
              afterGrade: "pass",
            },
          ],
          rows: [
            {
              question_id: "proof",
              question: "What proves this is complete?",
              answer: "Passing smoke test",
              kind: "scope",
              source_dimension: "verifiability",
              memory_category: "eval_signal",
              memory_content: "Eval signal: Passing smoke test.",
              affected_node_keys: ["m1"],
              signals: ["quality_dimension_improved"],
            },
          ],
        },
      ]),
    });

    expect(gw.calls[0]!.system).toContain("historical clarify learning");
    expect(gw.calls[0]!.prompt).toContain("Historical clarify learning");
    expect(gw.calls[0]!.prompt).toContain("verifiability: ask_more");
    expect(gw.calls[0]!.prompt).toContain("1/1 impacted");
  });

  it("includes historical capture learning so question choice can optimize for fulfilled context", async () => {
    const gw = mockGateway(validQuestions());
    await clarify(gw, {
      ...INPUT,
      captureLearning: {
        version: 1,
        totalAsked: 2,
        totalAnswered: 2,
        totalCaptured: 1,
        totalImpacted: 1,
        rows: [
          {
            category: "eval_signal",
            scope: "global",
            purpose: "define_eval",
            improvesDimension: "verifiability",
            askedCount: 1,
            answeredCount: 1,
            memoryCapturedCount: 1,
            impactedCount: 1,
            answerRate: 1,
            captureRate: 1,
            impactRate: 1,
            recommendation: "ask_more",
          },
          {
            category: "procedure",
            scope: "aim",
            purpose: "document_procedure",
            improvesDimension: "verifiability",
            askedCount: 1,
            answeredCount: 1,
            memoryCapturedCount: 0,
            impactedCount: 0,
            answerRate: 1,
            captureRate: 0,
            impactRate: 0,
            recommendation: "fix_capture",
          },
        ],
        originRows: [
          {
            source: "review_gap",
            gapSource: "decomposition_contract",
            nodeKey: "m1",
            nodeTitle: "Scaffold the CLI",
            category: "eval_signal",
            scope: "global",
            purpose: "define_eval",
            improvesDimension: "verifiability",
            askedCount: 1,
            answeredCount: 1,
            memoryCapturedCount: 1,
            impactedCount: 1,
            answerRate: 1,
            captureRate: 1,
            impactRate: 1,
            avgRoiScore: 88,
            roiSignals: ["high_priority", "decomposition_contract", "node_specific", "eval_signal"],
            issueCodes: ["missing_contract_eval_signal"],
            recommendation: "ask_more",
          },
        ],
        guidance: ["Prefer eval-signal questions for verifiability.", "Revise procedure questions."],
      },
    });

    expect(gw.calls[0]!.system).toContain("historical capture learning");
    expect(gw.calls[0]!.prompt).toContain("Historical capture learning");
    expect(gw.calls[0]!.prompt).toContain("2 asked · 2 answered · 1 captured · 1 impacted");
    expect(gw.calls[0]!.prompt).toContain("global/eval_signal · define_eval · improves verifiability: ask_more");
    expect(gw.calls[0]!.prompt).toContain("aim/procedure · document_procedure · improves verifiability: fix_capture");
    expect(gw.calls[0]!.prompt).toContain("Origin-specific capture signals");
    expect(gw.calls[0]!.prompt).toContain("m1 (Scaffold the CLI) · global/eval_signal · define_eval: ask_more");
  });

  it("includes historical context lineage learning so question choice can optimize for downstream impact", async () => {
    const gw = mockGateway(validQuestions());
    await clarify(gw, {
      ...INPUT,
      lineageLearning: {
        version: 1,
        totalQuestions: 3,
        totalAnswered: 3,
        totalCaptured: 2,
        totalImpacted: 2,
        totalPending: 1,
        rows: [
          {
            source: "review_gap",
            gapSource: "decomposition_contract",
            category: "procedure",
            capturePurpose: "document_procedure",
            improvesDimension: "verifiability",
            askedCount: 2,
            answeredCount: 2,
            memoryCapturedCount: 2,
            impactedCount: 2,
            pendingContextCount: 1,
            answerRate: 1,
            captureRate: 1,
            impactRate: 1,
            recommendation: "reuse_pattern",
            exampleQuestion: "Which command proves this milestone?",
            exampleAnswer: "Run pnpm test.",
            exampleNodeTitle: "Scaffold the CLI",
            signals: ["procedure", "decomposition_contract"],
          },
        ],
        guidance: ["Reuse procedure verifiability questions from decomposition-contract gaps."],
      },
    });

    expect(gw.calls[0]!.system).toContain("historical context lineage learning");
    expect(gw.calls[0]!.prompt).toContain("Historical context lineage learning");
    expect(gw.calls[0]!.prompt).toContain("Past context lineage: 3 questions · 3 answered · 2 captured · 2 impacted · 1 pending");
    expect(gw.calls[0]!.prompt).toContain("decomposition_contract/procedure · document_procedure · improves verifiability: reuse_pattern");
    expect(gw.calls[0]!.prompt).toContain("Reuse procedure verifiability questions");
  });

  it("uses decomposition strategy to constrain the prompt and default question budget", async () => {
    const gw = mockGateway(validThreeQuestions());
    const result = await clarify(gw, {
      ...INPUT,
      decompositionStrategy: {
        version: 1,
        title: INPUT.title,
        actionCount: 1,
        actions: [
          {
            focus: "context_fit",
            priority: "high",
            recommendation: "Surface context_gaps before locking the plan.",
            reason: "Historical accepted context changed decompositions.",
            sourceRows: 3,
          },
        ],
        guidance: [
          "Collect only context that can change milestone boundaries, owner routing, evidence choice, or eval signals.",
        ],
      },
    });

    expect(gw.calls[0]!.system).toContain("current decomposition strategy");
    expect(gw.calls[0]!.prompt).toContain("Current decomposition strategy");
    expect(gw.calls[0]!.prompt).toContain("Effective question budget: 6");
    expect(gw.calls[0]!.prompt).toContain("[high] context_fit");
    expect(gw.calls[0]!.prompt).toContain("change milestone boundaries, owner routing, required evidence, or eval signals");
    expect(result.validation.ok).toBe(true);
    expect(result.output?.questions.map((q) => q.id)).toEqual(["scope", "lang", "proof"]);
  });

  it("annotates returned questions with decomposition-strategy why-asked signals", async () => {
    const result = await clarify(
      mockGateway({
        questions: [
          {
            id: "context_fit",
            question: "Which user workflow should shape the milestone boundaries?",
            why_high_impact: "Changes milestone boundaries and required evidence.",
            kind: "scope",
            source_dimension: "context_fit",
            allow_other: true,
            options: [
              { label: "Developer CLI workflow", tradeoff: "Optimizes terminal evidence." },
              { label: "Desktop workflow", tradeoff: "Optimizes UI evidence." },
            ],
          },
        ],
        assumptions: [],
      }),
      {
        ...INPUT,
        review: {
          quality: { score: 100, grade: "pass", issues: [], dimensions: [] },
          context: { total: 0, applied: [], unapplied: [], ignoredLowConfidence: [], gaps: [] },
          actions: [],
          guidance: [],
        },
        decompositionStrategy: {
          version: 1,
          title: INPUT.title,
          actionCount: 1,
          actions: [
            {
              focus: "context_fit",
              priority: "medium",
              recommendation: "Ask only context that can change the next decomposition.",
              reason: "Past context answers changed milestone contracts.",
              sourceRows: 2,
            },
          ],
          guidance: [],
        },
      },
    );

    expect(result.validation.ok).toBe(true);
    expect(result.output?.questions[0]?.why_asked).toContainEqual(expect.objectContaining({
      code: "decomposition_strategy",
      strategyFocus: "context_fit",
      priority: "medium",
      sourceRows: 2,
    }));
    expect(result.output?.questions[0]?.capture?.origin).toMatchObject({
      source: "decomposition_strategy",
      reason: expect.stringContaining("context_fit"),
      prompt: expect.stringContaining("context_fit"),
    });
  });

  it("orders review gaps by ROI and historical capture learning in the clarify prompt", async () => {
    const gw = mockGateway(validQuestions());
    await clarify(gw, {
      ...INPUT,
      review: {
        quality: { score: 100, grade: "pass", issues: [], dimensions: [] },
        context: {
          total: 0,
          applied: [],
          unapplied: [],
          ignoredLowConfidence: [],
          gaps: [
            {
              category: "eval_signal",
              priority: "high",
              reason: "missing_eval",
              prompt: "What evidence proves the whole aim is complete?",
              source: "missing_context",
              roiScore: 82,
              roiSignals: ["high_priority", "eval_signal", "missing_context"],
            },
            {
              category: "procedure",
              priority: "medium",
              reason: "missing_verification_command",
              prompt: "For milestone \"Scaffold the CLI\": Which command proves it?",
              source: "decomposition_contract",
              nodeKey: "m1",
              nodeTitle: "Scaffold the CLI",
              roiScore: 78,
              roiSignals: ["medium_priority", "procedure", "decomposition_contract", "node_specific"],
            },
          ],
        },
        actions: [],
        guidance: [],
      },
      captureLearning: {
        version: 1,
        totalAsked: 4,
        totalAnswered: 4,
        totalCaptured: 4,
        totalImpacted: 2,
        rows: [
          {
            category: "procedure",
            scope: "aim",
            purpose: "document_procedure",
            improvesDimension: "verifiability",
            askedCount: 2,
            answeredCount: 2,
            memoryCapturedCount: 2,
            impactedCount: 2,
            answerRate: 1,
            captureRate: 1,
            impactRate: 1,
            recommendation: "ask_more",
          },
          {
            category: "eval_signal",
            scope: "global",
            purpose: "define_eval",
            improvesDimension: "verifiability",
            askedCount: 2,
            answeredCount: 2,
            memoryCapturedCount: 2,
            impactedCount: 0,
            answerRate: 1,
            captureRate: 1,
            impactRate: 0,
            recommendation: "ask_less",
          },
        ],
        guidance: [],
      },
    });

    const prompt = gw.calls[0]!.prompt;
    expect(prompt.indexOf("procedure · decomposition_contract")).toBeLessThan(prompt.indexOf("eval_signal · missing_context"));
    expect(prompt).toContain("roi 78");
    expect(prompt).toContain("roi 82");
  });

  it("uses origin-specific capture learning before broad category learning when ranking gaps", async () => {
    const gw = mockGateway(validQuestions());
    await clarify(gw, {
      ...INPUT,
      review: {
        quality: { score: 100, grade: "pass", issues: [], dimensions: [] },
        context: {
          total: 0,
          applied: [],
          unapplied: [],
          ignoredLowConfidence: [],
          gaps: [
            {
              category: "procedure",
              priority: "medium",
              reason: "missing_verification_command",
              prompt: "For milestone \"Scaffold the CLI\": Which command proves it?",
              source: "decomposition_contract",
              nodeKey: "m1",
              nodeTitle: "Scaffold the CLI",
              roiScore: 70,
              roiSignals: ["medium_priority", "procedure", "decomposition_contract", "node_specific"],
              issueCodes: ["missing_contract_evidence"],
            },
            {
              category: "procedure",
              priority: "medium",
              reason: "missing_verification_command",
              prompt: "For milestone \"Wire storage\": Which command proves it?",
              source: "decomposition_contract",
              nodeKey: "m2",
              nodeTitle: "Wire storage",
              roiScore: 70,
              roiSignals: ["medium_priority", "procedure", "decomposition_contract", "node_specific"],
              issueCodes: ["missing_contract_evidence"],
            },
          ],
        },
        actions: [],
        guidance: [],
      },
      captureLearning: {
        version: 1,
        totalAsked: 4,
        totalAnswered: 4,
        totalCaptured: 3,
        totalImpacted: 2,
        rows: [
          {
            category: "procedure",
            scope: "aim",
            purpose: "document_procedure",
            improvesDimension: "verifiability",
            askedCount: 4,
            answeredCount: 4,
            memoryCapturedCount: 3,
            impactedCount: 1,
            answerRate: 1,
            captureRate: 0.75,
            impactRate: 0.33,
            recommendation: "ask_selectively",
          },
        ],
        originRows: [
          {
            source: "review_gap",
            gapSource: "decomposition_contract",
            nodeKey: "m1",
            nodeTitle: "Scaffold the CLI",
            category: "procedure",
            scope: "aim",
            purpose: "document_procedure",
            improvesDimension: "verifiability",
            askedCount: 2,
            answeredCount: 2,
            memoryCapturedCount: 2,
            impactedCount: 2,
            answerRate: 1,
            captureRate: 1,
            impactRate: 1,
            avgRoiScore: 82,
            roiSignals: ["medium_priority", "procedure", "decomposition_contract", "node_specific"],
            issueCodes: ["missing_contract_evidence"],
            recommendation: "ask_more",
          },
          {
            source: "review_gap",
            gapSource: "decomposition_contract",
            nodeKey: "m2",
            nodeTitle: "Wire storage",
            category: "procedure",
            scope: "aim",
            purpose: "document_procedure",
            improvesDimension: "verifiability",
            askedCount: 2,
            answeredCount: 2,
            memoryCapturedCount: 1,
            impactedCount: 0,
            answerRate: 1,
            captureRate: 0.5,
            impactRate: 0,
            avgRoiScore: 70,
            roiSignals: ["medium_priority", "procedure", "decomposition_contract", "node_specific"],
            issueCodes: ["missing_contract_evidence"],
            recommendation: "ask_less",
          },
        ],
        guidance: [],
      },
    });

    const prompt = gw.calls[0]!.prompt;
    expect(prompt.indexOf("m1 (Scaffold the CLI)")).toBeLessThan(prompt.indexOf("m2 (Wire storage)"));
    expect(prompt).toContain("Origin-specific capture signals");
  });

  it("includes aim intake readiness so question choice can target missing context", async () => {
    const gw = mockGateway(validQuestions());
    await clarify(gw, {
      ...INPUT,
      intake: {
        title: INPUT.title,
        readiness: "needs_targeted_context",
        score: 52,
        coverage: {
          profile: {
            totalActive: 0,
            totalPending: 0,
            highConfidenceActive: 0,
            coverageScore: 12,
            rows: [],
            gaps: [],
          },
          selectedTotal: 0,
          selectedByCategory: [],
          missingCoreCategories: ["eval_signal", "procedure"],
        },
        questions: [
          {
            id: "intake_1",
            category: "eval_signal",
            priority: "high",
            source: "context_profile",
            reason: "profile_missing",
            prompt: "Ask what would make this aim count as genuinely complete.",
          },
        ],
        acquisition: [
          {
            id: "acq_1",
            channel: "web_research",
            priority: "high",
            scope: "aim",
            categories: ["project_fact", "procedure"],
            reason: "External docs may shape this aim.",
            action: "Run first-party web research before finalizing milestones.",
            suggestedTools: ["web.search", "web.fetch"],
            memoryTargets: [
              {
                scope: "aim",
                kind: "semantic",
                categories: ["project_fact", "procedure"],
              },
            ],
          },
        ],
        loop: {
          version: 1,
          shouldContinue: true,
          nextStepId: "loop_1",
          stopCondition: "Continue context intake until high-priority gaps are answered, skipped, or converted into aim-local context or pending durable memory candidates.",
          steps: [
            {
              id: "loop_1",
              acquisitionId: "acq_1",
              channel: "web_research",
              priority: "high",
              status: "needs_permission",
              action: "Run first-party web research before finalizing milestones.",
              reason: "External docs may shape this aim.",
              toolCalls: [
                { name: "web.search", boundary: "first_party", reason: "Find current external sources related to the aim." },
                { name: "web.fetch", boundary: "first_party", reason: "Fetch bounded source text from selected web results for citation-grade context." },
              ],
              memoryPlan: [
                {
                  scope: "aim",
                  kind: "semantic",
                  categories: ["project_fact", "procedure"],
                  source: "tool_observation",
                },
              ],
              outputs: ["aim_context"],
              repeatMode: "until_context_ready",
              blocksPlanAcceptance: true,
            },
          ],
          aimContextTargets: ["project_fact", "procedure"],
          durableMemoryTargets: [],
        },
        nextActions: ["Answer 1 high-priority intake question before accepting a plan."],
      },
    });

    expect(gw.calls[0]!.system).toContain("aim intake readiness");
    expect(gw.calls[0]!.prompt).toContain("Aim intake readiness");
    expect(gw.calls[0]!.prompt).toContain("needs_targeted_context");
    expect(gw.calls[0]!.prompt).toContain("Missing core context: eval_signal, procedure");
    expect(gw.calls[0]!.prompt).toContain("Ask what would make this aim count as genuinely complete");
    expect(gw.calls[0]!.prompt).toContain("Recommended context acquisition channels");
    expect(gw.calls[0]!.prompt).toContain("web_research");
    expect(gw.calls[0]!.prompt).toContain("web.search");
    expect(gw.calls[0]!.prompt).toContain("Context intake loop");
    expect(gw.calls[0]!.prompt).toContain("nextStep: loop_1");
    expect(gw.calls[0]!.prompt).toContain("outputs: aim_context");
  });

  it("includes draft plan review gaps so high-value questions target decomposition quality", async () => {
    const draft = structuredClone(DRAFT);
    draft.nodes[0]!.est_effort = "xl";
    draft.nodes[0]!.acceptance_rule.clauses = [
      {
        evaluator: "commit_pattern",
        auto_verifiable: true,
        match: { path_glob: "packages/core/**", min_files: 1, message_pattern: "context review" },
      },
    ];
    draft.nodes[1]!.acceptance_rule = {
      logic: "any",
      threshold: 1,
      completion_mode: "auto_then_confirm",
      clauses: [
        {
          evaluator: "commit_pattern",
          auto_verifiable: true,
          match: { path_glob: "packages/core/**", min_files: 1, message_pattern: "context review" },
        },
        {
          evaluator: "ci_status",
          auto_verifiable: true,
          match: { workflow: "test", conclusion: "success" },
        },
      ],
    };
    const gw = mockGateway(validQuestions());

    await clarify(gw, { ...INPUT, draft });

    expect(gw.calls[0]!.prompt).toContain("Plan review signals");
    expect(gw.calls[0]!.prompt).toContain("granularity: warn");
    expect(gw.calls[0]!.prompt).toContain("distinctness: warn");
    expect(gw.calls[0]!.prompt).toContain("Context gaps to turn into high-impact questions");
    expect(gw.calls[0]!.prompt).toContain("separate milestones");
    expect(gw.calls[0]!.prompt).toContain("one event cannot complete unrelated work");
  });

  it("uses decomposition-contract review gaps to annotate why and capture category", async () => {
    const result = await clarify(
      mockGateway({
        questions: [
          {
            id: "proof_command",
            question: "Which command proves the scaffold works?",
            why_high_impact: "Locks the milestone evidence path.",
            kind: "assumption",
            source_dimension: "verifiability",
            allow_other: true,
            options: [
              { label: "pnpm test", tradeoff: "Uses the existing JS workflow." },
              { label: "custom script", tradeoff: "More precise but needs setup." },
            ],
          },
        ],
        assumptions: [],
      }),
      {
        ...INPUT,
        review: {
          quality: { score: 100, grade: "pass", issues: [], dimensions: [] },
          context: {
            total: 0,
            applied: [],
            unapplied: [],
            ignoredLowConfidence: [],
            gaps: [
              {
                category: "procedure",
                priority: "medium",
                reason: "missing_verification_command",
                prompt: "For milestone \"Scaffold the CLI\": Which command proves it?",
                source: "decomposition_contract",
                nodeKey: "m1",
                nodeTitle: "Scaffold the CLI",
              },
            ],
          },
          actions: [],
          guidance: [],
        },
      },
    );

    expect(result.validation.ok).toBe(true);
    const question = result.output?.questions[0];
    expect(question?.why_asked).toEqual([
      expect.objectContaining({
        code: "review_gap",
        category: "procedure",
        priority: "medium",
        detail: expect.stringContaining("Which command proves it"),
      }),
    ]);
    expect(question?.capture).toMatchObject({
      category: "procedure",
      scope: "aim",
      purpose: "document_procedure",
      improvesDimension: "verifiability",
      origin: {
        source: "review_gap",
        gapSource: "decomposition_contract",
        nodeKey: "m1",
        nodeTitle: "Scaffold the CLI",
      },
    });
  });

  it("annotates returned questions with deterministic why-asked signals", async () => {
    const draft = structuredClone(DRAFT);
    draft.nodes[0]!.est_effort = "xl";
    const result = await clarify(mockGateway(validQuestions()), {
      ...INPUT,
      draft,
      learning: summarizeClarifyLearning([
        {
          version: 1,
          answered_count: 1,
          impacted_count: 1,
          changed_node_count: 1,
          quality_delta: [
            {
              dimension: "granularity",
              beforeScore: 80,
              afterScore: 95,
              delta: 15,
              beforeGrade: "warn",
              afterGrade: "pass",
            },
          ],
          rows: [
            {
              question_id: "scope",
              question: "How polished should it be?",
              answer: "Production",
              kind: "scope",
              source_dimension: "granularity",
              memory_category: "constraint",
              memory_content: "Constraint: Production.",
              affected_node_keys: ["m1"],
              signals: ["quality_dimension_improved"],
            },
          ],
        },
      ]),
    });

    expect(result.validation.ok).toBe(true);
    const why = result.output?.questions.find((q) => q.id === "scope")?.why_asked ?? [];
    expect(why.map((item) => item.code)).toContain("quality_dimension");
    expect(why.map((item) => item.code)).toContain("historical_learning");
    expect(why.find((item) => item.code === "historical_learning")?.recommendation).toBe("ask_more");
  });

  it("annotates returned questions with aim-intake why-asked signals", async () => {
    const result = await clarify(mockGateway(validQuestions()), {
      ...INPUT,
      intake: {
        title: INPUT.title,
        readiness: "needs_targeted_context",
        score: 60,
        coverage: {
          profile: {
            totalActive: 0,
            totalPending: 0,
            highConfidenceActive: 0,
            coverageScore: 10,
            rows: [],
            gaps: [],
          },
          selectedTotal: 0,
          selectedByCategory: [],
          missingCoreCategories: ["constraint"],
        },
        questions: [
          {
            id: "intake_1",
            category: "constraint",
            priority: "medium",
            source: "aim_text",
            reason: "thin_aim_statement",
            prompt: "Ask for non-negotiable scope boundaries.",
          },
        ],
        acquisition: [],
        loop: {
          version: 1,
          shouldContinue: false,
          nextStepId: null,
          stopCondition: "Context is sufficient for decomposition; continue collecting eval signals from evidence after execution.",
          steps: [],
          aimContextTargets: [],
          durableMemoryTargets: [],
        },
        nextActions: ["Answer 1 targeted intake question if it would change scope or evidence."],
      },
    });

    expect(result.validation.ok).toBe(true);
    const why = result.output?.questions.find((q) => q.id === "scope")?.why_asked ?? [];
    expect(why.map((item) => item.code)).toContain("aim_intake");
    expect(why.find((item) => item.code === "aim_intake")).toMatchObject({
      category: "constraint",
      priority: "medium",
    });
  });

  it("annotates returned questions with context-lineage why-asked signals", async () => {
    const result = await clarify(
      mockGateway({
        questions: [
          {
            id: "proof_command",
            question: "Which command proves the scaffold works?",
            why_high_impact: "Locks the milestone evidence path.",
            kind: "assumption",
            source_dimension: "verifiability",
            allow_other: true,
            options: [
              { label: "pnpm test", tradeoff: "Uses the existing JS workflow." },
              { label: "custom script", tradeoff: "More precise but needs setup." },
            ],
          },
        ],
        assumptions: [],
      }),
      {
        ...INPUT,
        review: {
          quality: { score: 100, grade: "pass", issues: [], dimensions: [] },
          context: { total: 0, applied: [], unapplied: [], ignoredLowConfidence: [], gaps: [] },
          actions: [],
          guidance: [],
        },
        lineageLearning: {
          version: 1,
          totalQuestions: 2,
          totalAnswered: 2,
          totalCaptured: 2,
          totalImpacted: 2,
          totalPending: 0,
          rows: [
            {
              source: "review_gap",
              gapSource: "decomposition_contract",
              category: "procedure",
              capturePurpose: "document_procedure",
              improvesDimension: "verifiability",
              askedCount: 2,
              answeredCount: 2,
              memoryCapturedCount: 2,
              impactedCount: 2,
              pendingContextCount: 0,
              answerRate: 1,
              captureRate: 1,
              impactRate: 1,
              recommendation: "reuse_pattern",
              exampleQuestion: "Which command proves this milestone?",
              exampleAnswer: "Run pnpm test.",
              exampleNodeTitle: "Scaffold the CLI",
              signals: ["procedure", "decomposition_contract"],
            },
          ],
          guidance: [],
        },
      },
    );

    expect(result.validation.ok).toBe(true);
    const question = result.output?.questions[0];
    expect(question?.why_asked).toContainEqual(expect.objectContaining({
      code: "context_lineage",
      category: "procedure",
      recommendation: "reuse_pattern",
    }));
    expect(question?.capture).toMatchObject({
      category: "procedure",
      scope: "aim",
      purpose: "document_procedure",
      improvesDimension: "verifiability",
      origin: {
        source: "clarify",
        gapSource: "decomposition_contract",
        roiSignals: expect.arrayContaining(["lineage_learning", "procedure", "decomposition_contract"]),
      },
    });
  });

  it("turns questions already answered by known context into disclosed assumptions", async () => {
    const gw = mockGateway(validQuestions());
    const result = await clarify(gw, {
      ...INPUT,
      memories: [
        {
          category: "constraint",
          kind: "semantic",
          source: "user_stated",
          content: "Constraint: Use TypeScript for CLI projects.",
          confidence: 1,
        },
      ],
    });

    expect(result.validation.ok).toBe(true);
    expect(result.output?.questions.map((q) => q.id)).toEqual(["scope"]);
    expect(result.output?.questions.map((q) => q.id)).not.toContain("lang");
    expect(result.output?.assumptions.some((a) => a.statement.includes("Which language?"))).toBe(true);
    expect(result.output?.assumptions.some((a) => a.default_value.includes("TypeScript"))).toBe(true);
  });

  it("does not let low-confidence context suppress high-impact questions", async () => {
    const gw = mockGateway(validQuestions());
    const result = await clarify(gw, {
      ...INPUT,
      memories: [
        {
          category: "constraint",
          kind: "semantic",
          source: "agent_inferred",
          content: "Constraint: Use TypeScript for CLI projects.",
          confidence: 0.4,
        },
      ],
    });

    expect(result.validation.ok).toBe(true);
    expect(result.output?.questions.map((q) => q.id)).toEqual(["scope", "lang"]);
  });

  it("truncates to maxQuestions", async () => {
    const gw = mockGateway(validQuestions());
    const result = await clarify(gw, { ...INPUT, maxQuestions: 1 });
    expect(result.output?.questions).toHaveLength(1);
    expect(result.output?.questions[0]?.id).toBe("scope");
  });

  it("fills baseline context intake when the model returns an empty question set", async () => {
    const gw = mockGateway({ questions: [], assumptions: [{ statement: "Assumed solo.", default_value: "solo" }] });
    const result = await clarify(gw, INPUT);
    expect(result.validation.ok).toBe(true);
    expect(result.output?.questions.map((q) => q.id)).toEqual([
      "aim_target_context",
      "durable_eval_signal",
    ]);
    expect(result.output?.questions.map((q) => q.capture?.scope)).toEqual(["aim", "global"]);
    expect(result.output?.questions.map((q) => q.selection_mode)).toEqual(["multiple", "multiple"]);
    expect(result.output?.questions.map((q) => q.selection_mode_reason)).toEqual([
      "compatible_options",
      "compatible_options",
    ]);
    expect(result.output?.assumptions).toHaveLength(1);
  });

  it("keeps one high-impact model question without padding to a form length", async () => {
    const output = validQuestions();
    output.questions = [output.questions[0]!];

    const result = await clarify(mockGateway(output), INPUT);

    expect(result.output?.questions.map((question) => question.id)).toEqual(["scope"]);
    expect(result.validation.ok).toBe(true);
  });

  it("localizes baseline context intake for a Chinese aim", async () => {
    const gw = mockGateway({ questions: [], assumptions: [] });
    const result = await clarify(gw, {
      ...INPUT,
      title: "\u6211\u60f3\u627e\u4e00\u4e2a\u5de5\u4f5c",
      description: "\u5e0c\u671b\u5148\u62c6\u6210\u6e05\u6670\u7684\u6c42\u804c\u8ba1\u5212\u3002",
      outputLanguage: "simplified_chinese",
    });

    expect(result.validation.ok).toBe(true);
    expect(result.output?.questions[0]?.question).toContain("\u4e0a\u4e0b\u6587\u6765\u6e90");
    expect(result.output?.questions[0]?.options[0]?.label).toBe("\u672c\u5730\u9879\u76ee\u6216\u6587\u4ef6");
    expect(result.output?.questions[1]?.question).toContain("\u8bc1\u636e");
    expect(result.output?.questions[0]?.selection_mode).toBe("multiple");
  });

  it("keeps backward compatibility when source dimensions are missing or invalid", async () => {
    const output = validQuestions();
    delete output.questions[0]!.source_dimension;
    (output.questions[1] as unknown as Record<string, unknown>).source_dimension = "budget";

    const result = await clarify(mockGateway(output), INPUT);

    expect(result.validation.ok).toBe(true);
    expect(result.output?.questions.slice(0, 2).map((q) => q.source_dimension)).toEqual([undefined, undefined]);
    expect(result.output?.questions.map((q) => q.id)).toEqual(["scope", "lang"]);
  });
});

describe("clarify · validation rejections (returned, never thrown)", () => {
  it("rejects a question with fewer than 2 options", async () => {
    const bad = validQuestions();
    bad.questions[0]!.options = [{ label: "only one", tradeoff: "n/a" }];
    const result = await clarify(mockGateway(bad), INPUT);
    expect(result.validation.ok).toBe(false);
    expect(result.output).toBeNull();
    expect(result.validation.errors.some((e) => e.includes("at least 2 options"))).toBe(true);
  });

  it("keeps the custom-answer escape hatch and rejects duplicate option labels", async () => {
    const customAnswer = validQuestions();
    customAnswer.questions[0]!.allow_other = false;
    const customResult = await clarify(mockGateway(customAnswer), INPUT);
    expect(customResult.output?.questions[0]?.allow_other).toBe(true);

    const duplicate = validQuestions();
    duplicate.questions[0]!.options = [
      { label: "Prototype", tradeoff: "Fast." },
      { label: " prototype ", tradeoff: "Still fast." },
    ];
    const duplicateResult = await clarify(mockGateway(duplicate), INPUT);
    expect(duplicateResult.validation.ok).toBe(false);
    expect(duplicateResult.validation.errors.some((error) => error.includes("at least 2 options"))).toBe(true);
  });

  it("rejects duplicate question ids", async () => {
    const bad = validQuestions();
    bad.questions[1]!.id = "scope"; // collide
    const result = await clarify(mockGateway(bad), INPUT);
    expect(result.validation.ok).toBe(false);
    expect(result.validation.errors.some((e) => e.includes("duplicate question id"))).toBe(true);
  });
});

describe("clarify · malformed model output (returned, never thrown)", () => {
  it("rejects output that is not question-set-shaped", async () => {
    const result = await clarify(mockGateway({ totally: "wrong" }), INPUT);
    expect(result.validation.ok).toBe(false);
    expect(result.output).toBeNull();
    expect(result.usage).toEqual(FIXED_USAGE);
  });

  it("reports a gateway transport failure instead of throwing", async () => {
    const result = await clarify(throwingGateway("boom: 503"), INPUT);
    expect(result.validation.ok).toBe(false);
    expect(result.output).toBeNull();
    expect(result.usage).toBeNull();
    expect(result.validation.errors[0]).toContain("boom: 503");
  });

  it("never rejects the returned promise", async () => {
    const spy = vi.fn();
    await clarify(throwingGateway("x"), INPUT).then(spy);
    expect(spy).toHaveBeenCalledOnce();
  });
});

describe("buildRefinedDescription", () => {
  it("folds answers into the description, rendering the question text", () => {
    const questions = validQuestions().questions as unknown as Parameters<typeof buildRefinedDescription>[1];
    const answers: ClarifyAnswer[] = [
      { question_id: "scope", selected_label: "Production", other_text: null },
      { question_id: "lang", selected_label: null, other_text: "Rust" },
    ];
    const refined = buildRefinedDescription("A small CLI.", questions, answers);
    expect(refined).toContain("A small CLI.");
    expect(refined).toContain("Clarifications from the user:");
    expect(refined).toContain("How polished should it be? → Production");
    expect(refined).toContain("Which language? → Rust");
  });

  it("returns the base description unchanged when there are no answers", () => {
    expect(buildRefinedDescription("base", [], [])).toBe("base");
  });
});

describe("clarifyAnswersToMemories", () => {
  it("turns source-dimensioned answers into structured user-stated memories", () => {
    const memories = clarifyAnswersToMemories(
      [
        {
          ...validQuestions().questions[0]!,
          source_dimension: "verifiability",
          question: "What proves this is complete?",
        },
        {
          ...validQuestions().questions[1]!,
          kind: "capability",
          source_dimension: "context_fit",
          question: "Who should own the implementation?",
        },
      ],
      [
        { question_id: "scope", selected_label: "Passing smoke tests", other_text: null },
        { question_id: "lang", selected_label: "Codex can implement it", other_text: null },
      ],
    );

    expect(memories).toEqual([
      {
        content: "Eval signal: Passing smoke tests. Clarify question: What proves this is complete? Source dimension: verifiability.",
        kind: "semantic",
        category: "eval_signal",
        source: "user_stated",
      },
      {
        content: "Capability: Codex can implement it. Clarify question: Who should own the implementation? Source dimension: context-fit.",
        kind: "semantic",
        category: "capability",
        source: "user_stated",
      },
    ]);
  });

  it("uses the question capture contract when folding answers into memories", () => {
    const memories = clarifyAnswersToMemories(
      [
        {
          ...validQuestions().questions[0]!,
          capture: {
            category: "procedure",
            scope: "aim",
            purpose: "document_procedure",
            improvesDimension: "verifiability",
            reason: "test_capture_contract",
          },
        },
      ],
      [{ question_id: "scope", selected_label: "Run pnpm test before release", other_text: null }],
    );

    expect(memories[0]).toMatchObject({
      category: "procedure",
      kind: "procedural",
      content: "Procedure: Run pnpm test before release. Clarify question: How polished should it be? Source dimension: granularity.",
    });
  });
});

describe("traceClarifyAnswerImpact", () => {
  it("links answered clarify questions to quality deltas and changed milestones", () => {
    const beforePlan = structuredClone(DRAFT);
    const afterPlan = structuredClone(DRAFT);
    afterPlan.nodes[0]!.description = "Add a smoke test command that proves the CLI works.";
    afterPlan.nodes[0]!.acceptance_rule.clauses = [
      {
        evaluator: "commit_pattern",
        auto_verifiable: true,
        match: { path_glob: "apps/cli/**", min_files: 1, message_pattern: "smoke test" },
      },
    ];

    const report = traceClarifyAnswerImpact({
      questions: [
        {
          ...validQuestions().questions[0]!,
          question: "What proves this is complete?",
          source_dimension: "verifiability",
        },
      ],
      answers: [{ question_id: "scope", selected_label: "Passing CLI smoke test", other_text: null }],
      beforePlan,
      afterPlan,
      beforeQuality: {
        score: 80,
        grade: "warn",
        issues: [],
        dimensions: [
          { dimension: "verifiability", score: 70, grade: "warn", issueCount: 1, issueCodes: ["manual_only_verification"] },
        ],
      },
      afterQuality: {
        score: 96,
        grade: "pass",
        issues: [],
        dimensions: [
          { dimension: "verifiability", score: 100, grade: "pass", issueCount: 0, issueCodes: [] },
        ],
      },
    });

    expect(report.answered_count).toBe(1);
    expect(report.impacted_count).toBe(1);
    expect(report.changed_node_count).toBe(1);
    expect(report.quality_delta.find((row) => row.dimension === "verifiability")?.delta).toBe(30);
    expect(report.rows[0]!.memory_category).toBe("eval_signal");
    expect(report.rows[0]!.affected_node_keys).toContain("m1");
    expect(report.rows[0]!.signals).toContain("quality_dimension_improved");
    expect(report.rows[0]!.signals).toContain("acceptance_rule_changed");
  });

  it("returns an empty trace when no real answers were provided", () => {
    const report = traceClarifyAnswerImpact({
      questions: validQuestions().questions as never,
      answers: [{ question_id: "scope", selected_label: null, other_text: "   " }],
      afterPlan: DRAFT,
    });

    expect(report.answered_count).toBe(0);
    expect(report.rows).toEqual([]);
  });
});

describe("summarizeClarifyLearning", () => {
  it("summarizes historical impact metadata into dimension recommendations", () => {
    const report = clarifyImpactReportFromMetadata({
      clarify_answer_impact: {
        version: 1,
        answered_count: 2,
        impacted_count: 1,
        changed_node_count: 1,
        quality_delta: [
          { dimension: "verifiability", beforeScore: 80, afterScore: 95, delta: 15, beforeGrade: "warn", afterGrade: "pass" },
          { dimension: "distinctness", beforeScore: 90, afterScore: 90, delta: 0, beforeGrade: "pass", afterGrade: "pass" },
        ],
        rows: [
          {
            question_id: "proof",
            question: "What proves this is complete?",
            answer: "Passing CLI smoke test",
            kind: "scope",
            source_dimension: "verifiability",
            memory_category: "eval_signal",
            memory_content: "Eval signal: Passing CLI smoke test.",
            affected_node_keys: ["m1"],
            signals: ["quality_dimension_improved"],
          },
          {
            question_id: "same",
            question: "What evidence should stay unique?",
            answer: "No preference",
            kind: "scope",
            source_dimension: "distinctness",
            memory_category: "eval_signal",
            memory_content: "Eval signal: No preference.",
            affected_node_keys: [],
            signals: [],
          },
        ],
      },
    });
    const learning = summarizeClarifyLearning([report]);

    expect(learning.total_answered).toBe(2);
    expect(learning.total_impacted).toBe(1);
    expect(learning.rows.find((row) => row.source_dimension === "verifiability")?.recommendation).toBe("ask_more");
    expect(learning.rows.find((row) => row.source_dimension === "distinctness")?.recommendation).toBe("ask_selectively");
    expect(learning.guidance[0]).toContain("verifiability");
  });
});
