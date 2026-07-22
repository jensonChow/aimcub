import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { bundleFromSource } from "../../electron.vite.config";

describe("desktop package boundaries", () => {
  it("bundles every raw-TypeScript @aimcub runtime dependency into Electron", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ) as { dependencies?: Record<string, string> };
    const coreDependencies = Object.keys(manifest.dependencies ?? {})
      .filter((name) => name.startsWith("@aimcub/"))
      .sort();

    expect([...bundleFromSource].sort()).toEqual(coreDependencies);
  });
});
