import { describe, expect, it } from "vitest";
import { Models, routeModel } from "./index";

describe("routeModel · lean model routing", () => {
  it("uses Sonnet for aim decompose/replan", () => {
    expect(routeModel("decompose")).toBe(Models.sonnet);
    expect(routeModel("replan")).toBe(Models.sonnet);
  });
  it("uses Haiku for the high-frequency classify / extract_memory tasks", () => {
    expect(routeModel("classify")).toBe(Models.haiku);
    expect(routeModel("extract_memory")).toBe(Models.haiku);
  });
});
