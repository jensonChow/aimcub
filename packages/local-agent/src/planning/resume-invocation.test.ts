/**
 * Resuming a planning brain's OWN thread.
 *
 * A pass that stopped keeps the runtime's session/thread id, and a resume hands it back so the
 * brain regains its own reasoning history — not just the briefing Aimcub reconstructs. These
 * tests pin the two things that can go wrong in that path: the resume flag form each CLI actually
 * accepts (verified against the installed CLIs' own help), and the permission contract, which does
 * NOT relax just because a thread is being reopened.
 */
import { describe, expect, it } from "vitest";

import { claudeAdapter } from "../adapters/claude";
import { codexAdapter } from "../adapters/codex";
import type { PlanningSessionInvocationRequest } from "../types";

function request(overrides: Partial<PlanningSessionInvocationRequest> = {}): PlanningSessionInvocationRequest {
  return {
    prompt: "plan this aim",
    cwd: "/tmp/aim",
    network: false,
    extraAllowedDirs: ["/tmp/context"],
    mcp: { serverName: "aimcub", url: "http://127.0.0.1:5555/mcp", authToken: "tok" },
    ...overrides,
  };
}

describe("claude planning resume", () => {
  it("reopens the prior conversation with --resume, keeping every permission flag", () => {
    const fresh = claudeAdapter.buildPlanningSessionInvocation!(request());
    expect(fresh.args).not.toContain("--resume");

    const resumed = claudeAdapter.buildPlanningSessionInvocation!(request({ resumeSessionId: " sess-42 " }));
    expect(resumed.args).toContain("--resume");
    // Trimmed, and paired with the id.
    expect(resumed.args[resumed.args.indexOf("--resume") + 1]).toBe("sess-42");
    // `--resume` requires print mode, which the planning invocation always uses.
    expect(resumed.args).toContain("-p");
    // A resumed session is not a more trusted one: the read-only tool contract still ships.
    const disallowed = resumed.args[resumed.args.indexOf("--disallowedTools") + 1] ?? "";
    expect(disallowed.split(",")).toEqual(expect.arrayContaining(["Bash", "Write", "Edit", "WebSearch"]));
    expect(resumed.args).toContain("--strict-mcp-config");
  });
});

describe("codex planning resume", () => {
  it("uses the resume subcommand and keeps read-only via a config override", () => {
    const resumed = codexAdapter.buildPlanningSessionInvocation!(request({ resumeSessionId: "thread-7" }));

    // `codex exec resume <SESSION_ID>` — the id is positional and must follow the options.
    expect(resumed.args.slice(0, 2)).toEqual(["exec", "resume"]);
    expect(resumed.args.at(-1)).toBe("thread-7");
    expect(resumed.args).toContain("--json");

    // The permission contract holds in the only spelling this subcommand accepts: `codex exec
    // resume` rejects `--sandbox`, so the SAME read-only policy travels as a config override.
    // Losing this line would silently run a resumed brain under the default policy.
    expect(resumed.args).not.toContain("--sandbox");
    expect(resumed.args).toContain('sandbox_mode="read-only"');

    // Flags the subcommand does not accept must not be emitted at all.
    expect(resumed.args).not.toContain("-C");
    expect(resumed.args).not.toContain("--add-dir");

    // The prompt still arrives on stdin, which `codex exec resume` reads when no prompt arg is given.
    expect(resumed.stdin).toBe("plan this aim");
  });

  it("leaves a fresh session on the explicit --sandbox path", () => {
    const fresh = codexAdapter.buildPlanningSessionInvocation!(request());
    expect(fresh.args.slice(0, 2)).toEqual(["exec", "--json"]);
    expect(fresh.args).not.toContain("resume");
    expect(fresh.args).toContain("--sandbox");
    expect(fresh.args[fresh.args.indexOf("--sandbox") + 1]).toBe("read-only");
    // A fresh invocation can still point the brain at the workspace and its linked dirs.
    expect(fresh.args).toContain("-C");
    expect(fresh.args).toContain("--add-dir");
  });

  it("keeps live search opt-in on both paths", () => {
    const offline = codexAdapter.buildPlanningSessionInvocation!(request({ resumeSessionId: "t" }));
    expect(offline.args).not.toContain("--search");
    const online = codexAdapter.buildPlanningSessionInvocation!(request({ resumeSessionId: "t", network: true }));
    expect(online.args[0]).toBe("--search");
  });
});
