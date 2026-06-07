import { describe, expect, it } from "vitest";
import { Models, routeModel } from "./index";

describe("routeModel · 精简模型路由", () => {
  it("uses Sonnet for decompose/replan/celebrate", () => {
    expect(routeModel("decompose")).toBe(Models.sonnet);
    expect(routeModel("replan")).toBe(Models.sonnet);
    expect(routeModel("celebrate")).toBe(Models.sonnet);
  });
  it("uses Haiku for high-frequency tasks", () => {
    expect(routeModel("nudge")).toBe(Models.haiku);
    expect(routeModel("classify")).toBe(Models.haiku);
    expect(routeModel("extract_memory")).toBe(Models.haiku);
  });
  it("reserves Opus for the rare goal-complete highlight", () => {
    expect(routeModel("goal_complete")).toBe(Models.opus);
  });
});
