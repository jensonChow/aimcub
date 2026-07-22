import { describe, expect, it } from "vitest";

import { claudeAdapter } from "./claude";
import { codexAdapter } from "./codex";

/**
 * Artifact extraction from the two built-in runtimes, against the payload shapes they really
 * emit. A fixture that names no file must produce no artifacts at all — third-party adapters and
 * non-file tools rely on the fields simply staying unset.
 */

function parse(adapter: typeof codexAdapter, line: Record<string, unknown>) {
  return adapter.parseLine(JSON.stringify(line)) ?? [];
}

describe("codex artifact capture", () => {
  it("reads the changed paths off a file_change item", () => {
    const events = parse(codexAdapter, {
      type: "item.completed",
      item: {
        id: "item_2",
        type: "file_change",
        status: "completed",
        changes: [
          { path: "/repo/src/queue.ts", kind: "update" },
          { path: "/repo/src/queue.test.ts", kind: "add" },
        ],
      },
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "agent.tool.finished", toolId: "item_2", toolName: "file_change" });
    expect(events[0]?.artifacts).toEqual([
      { path: "/repo/src/queue.ts", kind: "file_edit" },
      { path: "/repo/src/queue.test.ts", kind: "file_write" },
    ]);
  });

  it("reads the patch protocol's path-keyed changes map", () => {
    const events = parse(codexAdapter, {
      type: "patch_apply_begin",
      call_id: "call_7",
      auto_approved: true,
      changes: {
        "/repo/docs/notes.md": { add: { content: "# Notes\n" } },
        "/repo/src/legacy.ts": { delete: {} },
      },
    });

    expect(events[0]).toMatchObject({ type: "agent.tool.started", toolId: "call_7", toolName: "apply_patch" });
    expect(events[0]?.artifacts).toEqual([
      { path: "/repo/docs/notes.md", kind: "file_write" },
      { path: "/repo/src/legacy.ts", kind: "file_delete" },
    ]);
  });

  it("leaves artifacts unset for a shell command that names no file", () => {
    const events = parse(codexAdapter, {
      type: "item.started",
      item: { id: "item_1", type: "command_execution", command: "pnpm test" },
    });

    expect(events[0]).toMatchObject({ type: "agent.tool.started", toolName: "pnpm test" });
    expect(events[0]?.artifacts).toBeUndefined();
  });
});

describe("claude artifact capture", () => {
  it("captures a Write tool call nested in an assistant message, alongside its text", () => {
    const events = parse(claudeAdapter, {
      type: "assistant",
      session_id: "s1",
      message: {
        id: "msg_1",
        role: "assistant",
        content: [
          { type: "text", text: "Adding the adapter." },
          { type: "tool_use", id: "toolu_1", name: "Write", input: { file_path: "/repo/src/adapters/new.ts", content: "export {};" } },
        ],
      },
    });

    expect(events.map((event) => event.type)).toEqual(["agent.message.delta", "agent.tool.started"]);
    expect(events[0]?.summary).toBe("Adding the adapter.");
    expect(events[1]).toMatchObject({ toolId: "toolu_1", toolName: "Write" });
    expect(events[1]?.artifacts).toEqual([{ path: "/repo/src/adapters/new.ts", kind: "file_write" }]);
    // Raw for a block event is the block itself: the exact payload it was normalized from.
    expect(events[1]?.raw).toMatchObject({ type: "tool_use", id: "toolu_1" });
  });

  it("classifies Edit, MultiEdit and NotebookEdit as edits of the path they name", () => {
    const events = parse(claudeAdapter, {
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", id: "toolu_2", name: "Edit", input: { file_path: "/repo/src/registry.ts", old_string: "a", new_string: "b" } },
          { type: "tool_use", id: "toolu_3", name: "MultiEdit", input: { file_path: "/repo/src/types.ts", edits: [{ old_string: "a", new_string: "b" }] } },
          { type: "tool_use", id: "toolu_4", name: "NotebookEdit", input: { notebook_path: "/repo/analysis.ipynb", new_source: "1 + 1" } },
        ],
      },
    });

    expect(events.flatMap((event) => event.artifacts ?? [])).toEqual([
      { path: "/repo/src/registry.ts", kind: "file_edit" },
      { path: "/repo/src/types.ts", kind: "file_edit" },
      { path: "/repo/analysis.ipynb", kind: "file_edit" },
    ]);
  });

  it("captures no artifact for a read-only tool, and none for its result", () => {
    const toolUse = parse(claudeAdapter, {
      type: "assistant",
      message: { content: [{ type: "tool_use", id: "toolu_5", name: "Read", input: { file_path: "/repo/README.md" } }] },
    });
    const toolResult = parse(claudeAdapter, {
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "toolu_5", content: "# Aimcub" }] },
    });

    expect(toolUse[0]).toMatchObject({ type: "agent.tool.started", toolName: "Read" });
    expect(toolUse[0]?.artifacts).toBeUndefined();
    expect(toolResult[0]).toMatchObject({ type: "agent.tool.finished", toolId: "toolu_5" });
    expect(toolResult[0]?.artifacts).toBeUndefined();
  });

  it("keeps the result event authoritative and artifact-free", () => {
    const events = parse(claudeAdapter, { type: "result", subtype: "success", result: "Done.", usage: { input_tokens: 12 } });

    expect(events.map((event) => event.type)).toEqual([
      "agent.message.delta",
      "agent.usage.reported",
      "agent.run.completed",
    ]);
    expect(events[0]?.replacesOutput).toBe(true);
    expect(events.every((event) => event.artifacts === undefined)).toBe(true);
  });
});
