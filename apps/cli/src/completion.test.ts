import { describe, expect, it } from "vitest";

import { completionScript, normalizeShell } from "./completion";

describe("completionScript", () => {
  it("renders bash completions with the current command set", () => {
    const text = completionScript("bash");
    expect(text).toContain("complete -F _aimcub_completions aimcub");
    expect(text).toContain("doctor");
    expect(text).toContain("context");
    expect(text).toContain("evidence");
    expect(text).toContain("health accept reject deprioritize archive");
  });

  it("detects shells from common names", () => {
    expect(normalizeShell("/bin/zsh")).toBe("zsh");
    expect(normalizeShell("/usr/local/bin/fish")).toBe("fish");
    expect(normalizeShell(undefined)).toBe("bash");
  });
});
