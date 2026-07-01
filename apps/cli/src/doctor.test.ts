import { describe, expect, it } from "vitest";

import { resolveProvider } from "./config";
import { buildDoctorReport, formatDoctor } from "./doctor";

describe("buildDoctorReport", () => {
  it("warns when no key is configured but does not fail the whole doctor report", () => {
    const report = buildDoctorReport({
      version: "0.0.0",
      dataDir: "/tmp/aimcub",
      settingsFile: "/tmp/aimcub/settings.json",
      provider: resolveProvider({}, null),
      goalCount: 0,
      storeReadable: true,
      storeWritable: true,
    });
    expect(report.ok).toBe(true);
    expect(report.checks.some((c) => c.level === "warn" && c.name === "provider-key")).toBe(true);
    expect(formatDoctor(report)).toContain("provider-key");
  });

  it("fails on an unknown provider", () => {
    const report = buildDoctorReport({
      version: "0.0.0",
      dataDir: "/tmp/aimcub",
      settingsFile: "/tmp/aimcub/settings.json",
      provider: resolveProvider({ AIMCUB_PROVIDER: "nope" }, null),
      goalCount: 0,
      storeReadable: true,
      storeWritable: true,
    });
    expect(report.ok).toBe(false);
  });
});
