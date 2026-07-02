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
            captureScope: "global",
          }],
        },
      },
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
