import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const scriptsDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: resolve(scriptsDir, ".."),
  test: {
    include: ["scripts/provider-live-smoke.ts"],
  },
});
