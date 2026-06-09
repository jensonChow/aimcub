import { defineConfig } from "vitest/config";

// Unit tests for the app's pure helpers + mock data layer. We do NOT render React here —
// component/E2E coverage is out of scope for v1a; these tests cover the logic that drives
// the "decompose + progress + auto-light" experience.
export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts"],
    environment: "node",
  },
});
