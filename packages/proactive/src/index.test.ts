import { describe, expect, it } from "vitest";
import { decideDelivery, isCelebration, localHour, withinQuietHours } from "./index";

describe("withinQuietHours", () => {
  it("handles a wrap-around window like 22..8", () => {
    expect(withinQuietHours(23, [22, 8])).toBe(true);
    expect(withinQuietHours(3, [22, 8])).toBe(true);
    expect(withinQuietHours(8, [22, 8])).toBe(false);
    expect(withinQuietHours(12, [22, 8])).toBe(false);
  });
});

describe("localHour", () => {
  it("applies tz offset and wraps", () => {
    const utc = Date.parse("2026-06-07T23:30:00Z");
    expect(localHour(utc, 60)).toBe(0); // +1h → 00:30 当地
    expect(localHour(utc, -120)).toBe(21); // -2h → 21:30 当地
  });
});

describe("decideDelivery · 打扰预算闸门", () => {
  const base = {
    channel: "in_app" as const,
    localHour: 12,
    quietHours: [22, 8] as [number, number],
    nudgeCountToday: 0,
    nudgeDailyCap: 2,
    isDuplicate: false,
  };

  it("suppresses duplicates", () => {
    expect(decideDelivery({ ...base, trigger: "milestone_done", isDuplicate: true }).reason).toBe("duplicate");
  });

  it("never rate-limits celebrations", () => {
    expect(isCelebration("milestone_done")).toBe(true);
    const d = decideDelivery({ ...base, trigger: "milestone_done", nudgeCountToday: 99 });
    expect(d.suppress).toBe(false);
  });

  it("rate-limits nudges at the user-level daily cap", () => {
    expect(decideDelivery({ ...base, trigger: "stale", nudgeCountToday: 2 }).reason).toBe("daily_cap");
    expect(decideDelivery({ ...base, trigger: "stale", nudgeCountToday: 1 }).suppress).toBe(false);
  });

  it("respects quiet hours only for push/email, not in_app", () => {
    const night = { ...base, localHour: 23, trigger: "milestone_done" as const };
    expect(decideDelivery({ ...night, channel: "push" }).reason).toBe("quiet_hours");
    expect(decideDelivery({ ...night, channel: "email" }).reason).toBe("quiet_hours");
    expect(decideDelivery({ ...night, channel: "in_app" }).suppress).toBe(false);
    expect(decideDelivery({ ...night, channel: "agent_inbox" }).suppress).toBe(false);
  });
});
