import { describe, expect, it } from "vitest";

import { aimNavigationLabels, aimNavigationTitle } from "./aimNavigationTitle";

describe("aimNavigationTitle", () => {
  it("prefers the generated plan summary without changing the canonical title", () => {
    const title = "I want to launch a privacy-first finance app for freelancers with current compliance research";

    expect(aimNavigationTitle({
      title,
      plan: { goal_summary: "Launch a privacy-first finance app" },
    })).toBe("Launch a privacy-first finance app");
    expect(title).toContain("current compliance research");
  });

  it("compacts common intent framing for a pre-plan Chinese draft", () => {
    expect(aimNavigationTitle({
      title: "我想要在30岁之前成为一家百亿美元独角兽公司的创始人",
    })).toBe("30岁前成为一家百亿美元独角兽公司创始人");
  });

  it("normalizes a pre-plan English intent and leaves the outcome intact", () => {
    expect(aimNavigationTitle({
      title: "  I want to   build a verified local CLI workflow.  ",
    })).toBe("Build a verified local CLI workflow");
    expect(aimNavigationTitle({ title: "iOS launch readiness" })).toBe("iOS launch readiness");
  });

  it("ignores malformed plan summaries and keeps a stable fallback", () => {
    expect(aimNavigationTitle({
      title: "",
      plan: { goal_summary: 42 },
      fallback: "Untitled draft",
    })).toBe("Untitled draft");
  });

  it("falls through when a generated summary contains only removable intent framing", () => {
    expect(aimNavigationTitle({
      title: "Build a resilient local app",
      plan: { goal_summary: "我想要" },
      fallback: "Untitled draft",
    })).toBe("Build a resilient local app");
  });

  it("bounds verbose non-prefix labels without splitting graphemes", () => {
    const source = "改进👩‍💻本地桌面应用的工作区排列和对齐方式，让每个界面在不同窗口宽度下都保持协调一致";
    const labels = aimNavigationLabels({ title: source });

    expect(labels.fullLabel).toBe(source);
    expect(labels.label).toContain("👩‍💻");
    expect(labels.label).toMatch(/…$/u);
    expect(labels.label).not.toContain("�");
  });

  it("truncates long English labels at a useful word boundary", () => {
    const labels = aimNavigationLabels({
      title: "Coordinate the entire desktop application layout and ensure every workbench surface shares a coherent alignment system",
    });

    expect(labels.fullLabel).toContain("coherent alignment system");
    expect(labels.label).toBe("Coordinate the entire desktop application…");
  });
});
