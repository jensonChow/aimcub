import { describe, expect, it } from "vitest";

import { createContextAskUserHandler } from "./context-ask-user";
import type { AimcubToolHandlerContext } from "./tool-contract";

const context: AimcubToolHandlerContext = {
  now: () => new Date("2026-07-02T00:00:00.000Z"),
  permissions: ["user.ask"],
};

describe("createContextAskUserHandler", () => {
  it("normalizes missing-context questions into a runtime user request", async () => {
    const handler = createContextAskUserHandler();

    const result = await handler({
      questions: [
        {
          id: " eval ",
          question: " What evidence proves this is complete? ",
          category: "eval_signal",
          choices: ["Tests pass", "Tests pass", "User confirms"],
          captureScope: "global",
        },
      ],
    }, context);

    expect(result).toMatchObject({
      ok: true,
      observation: {
        summary: "Prepared 1 user context question.",
        data: {
          requestId: "ask_2026-07-02T00:00:00.000Z_eval",
          questions: [{
            id: "eval",
            question: "What evidence proves this is complete?",
            category: "eval_signal",
            choices: ["Tests pass", "User confirms"],
            selectionMode: "multiple",
            selectionModeReason: "compatible_options",
            captureScope: "global",
          }],
        },
      },
    });
  });

  it("keeps explicit multi-select mode for richer context choices", async () => {
    const handler = createContextAskUserHandler();

    const result = await handler({
      questions: [
        {
          id: "sources",
          question: "Which sources should Aimcub inspect?",
          choices: ["Local files", "Web research", "Notion"],
          selectionMode: "multiple",
        },
      ],
    }, context);

    expect(result).toMatchObject({
      ok: true,
      observation: {
        data: {
          questions: [{
            id: "sources",
            selectionMode: "multiple",
            selectionModeReason: "compatible_options",
          }],
        },
      },
    });
  });

  it("corrects an explicit single mode when two evidence options can coexist", async () => {
    const handler = createContextAskUserHandler();

    const result = await handler({
      questions: [{
        id: "evidence",
        question: "Which evidence should count?",
        choices: ["CI result", "User acceptance"],
        selectionMode: "single",
        selectionModeReason: "compatible_options",
      }],
    }, context);

    expect(result).toMatchObject({
      ok: true,
      observation: { data: { questions: [{
        selectionMode: "multiple",
        selectionModeReason: "compatible_options",
      }] } },
    });
  });

  it("keeps one explicitly primary approver as single choice", async () => {
    const handler = createContextAskUserHandler();

    const result = await handler({
      questions: [{
        id: "approver",
        question: "Who should be the single final approver?",
        choices: ["Product lead", "Legal lead", "Executive sponsor"],
        selectionMode: "single",
        selectionModeReason: "primary_choice_requested",
      }],
    }, context);

    expect(result).toMatchObject({
      ok: true,
      observation: { data: { questions: [{
        selectionMode: "single",
        selectionModeReason: "primary_choice_requested",
      }] } },
    });
  });

  it("requires user.ask permission", async () => {
    const handler = createContextAskUserHandler();

    const result = await handler({
      questions: [{ id: "q1", question: "What should we ask?" }],
    }, { ...context, permissions: [] });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "permission_denied", retryable: false },
    });
  });
});
