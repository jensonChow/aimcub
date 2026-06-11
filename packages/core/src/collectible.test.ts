import { describe, expect, it } from "vitest";
import {
  planMint,
  RARITY_ORDER,
  rollFromHashHex,
  SHINY_UPGRADE_PROBABILITY,
  upgradeRarity,
} from "./collectible";

/**
 * Deterministic fake digest (NOT a real hash — @core tests must stay free of
 * node:crypto). Same input → same 64-char hex, which is all planMint relies on.
 */
function fakeHashHex(input: string): string {
  let h = 0;
  for (const ch of input) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h.toString(16).padStart(8, "0").repeat(8);
}

const COMPLETION = {
  id: "11111111-0000-4000-8000-000000000001",
  awarded_xp: 25,
  created_at: "2026-06-10T12:00:00.000Z",
};
const MILESTONE = { title: "Ship the login flow", rarity: "rare" as const };
const OPTS = { goalTitle: "Launch Aimcub", hashHex: fakeHashHex };

describe("RARITY_ORDER", () => {
  it("exposes the five tiers lowest → highest", () => {
    expect(RARITY_ORDER).toEqual(["common", "uncommon", "rare", "epic", "legendary"]);
  });
});

describe("upgradeRarity", () => {
  it("moves exactly one tier up", () => {
    expect(upgradeRarity("common")).toBe("uncommon");
    expect(upgradeRarity("rare")).toBe("epic");
    expect(upgradeRarity("epic")).toBe("legendary");
  });
  it("caps at legendary", () => {
    expect(upgradeRarity("legendary")).toBe("legendary");
  });
});

describe("rollFromHashHex", () => {
  it("maps the first 8 bytes (16 hex chars) to [0,1)", () => {
    expect(rollFromHashHex("0".repeat(64))).toBe(0);
    expect(rollFromHashHex("8" + "0".repeat(63))).toBeCloseTo(0.5, 10);
    // only the first 16 chars matter — the tail is ignored
    expect(rollFromHashHex("8" + "0".repeat(15) + "f".repeat(48))).toBeCloseTo(0.5, 10);
  });
  it("approaches 1 at the top of the range", () => {
    expect(rollFromHashHex("f".repeat(64))).toBeGreaterThan(0.999);
  });
  it("returns 1 (never shiny) for malformed or too-short input", () => {
    expect(rollFromHashHex("")).toBe(1);
    expect(rollFromHashHex("abc")).toBe(1);
    expect(rollFromHashHex("zz".repeat(32))).toBe(1);
    expect(rollFromHashHex("ffzz" + "0".repeat(60))).toBe(1); // partial-parse guard
  });
});

describe("planMint — determinism (same completion id → same roll, always)", () => {
  it("produces an identical plan on every call (retries never re-roll)", () => {
    const a = planMint(COMPLETION, MILESTONE, OPTS);
    const b = planMint(COMPLETION, MILESTONE, OPTS);
    expect(a).toEqual(b);
  });

  it("seeds the roll from completion.id only", () => {
    const other = { ...COMPLETION, id: "22222222-0000-4000-8000-000000000002" };
    const a = planMint(COMPLETION, MILESTONE, OPTS);
    const b = planMint(other, MILESTONE, OPTS);
    // shiny outcomes are determined per id; both must be stable regardless of value
    expect(planMint(other, MILESTONE, OPTS)).toEqual(b);
    expect(a.metadata.milestone_title).toBe(b.metadata.milestone_title);
  });
});

describe("planMint — floor rarity + seeded one-tier upgrade", () => {
  it("keeps the milestone rarity as the floor when the roll loses", () => {
    const plan = planMint(COMPLETION, MILESTONE, { goalTitle: "G", roll: 0.5 });
    expect(plan.rarity).toBe("rare");
    expect(plan.shiny).toBe(false);
    expect(plan.metadata.shiny).toBe(false);
    expect(plan.metadata.base_rarity).toBe("rare");
  });

  it("upgrades exactly one tier and sets shiny when the roll wins", () => {
    const plan = planMint(COMPLETION, MILESTONE, { goalTitle: "G", roll: 0 });
    expect(plan.rarity).toBe("epic");
    expect(plan.shiny).toBe(true);
    expect(plan.metadata.shiny).toBe(true);
    expect(plan.metadata.base_rarity).toBe("rare");
  });

  it("boundary: roll exactly at the probability does NOT upgrade (strict <)", () => {
    const at = planMint(COMPLETION, MILESTONE, {
      goalTitle: "G",
      roll: SHINY_UPGRADE_PROBABILITY,
    });
    expect(at.shiny).toBe(false);
    const justBelow = planMint(COMPLETION, MILESTONE, {
      goalTitle: "G",
      roll: SHINY_UPGRADE_PROBABILITY - 1e-9,
    });
    expect(justBelow.shiny).toBe(true);
  });

  it("hashHex path: digest below/above the threshold decides the upgrade", () => {
    // 0x1000… / 2^64 = 0.0625 < 0.1 → shiny
    const win = planMint(COMPLETION, MILESTONE, {
      goalTitle: "G",
      hashHex: () => "1" + "0".repeat(63),
    });
    expect(win.shiny).toBe(true);
    // 0x2000… / 2^64 = 0.125 ≥ 0.1 → no upgrade
    const lose = planMint(COMPLETION, MILESTONE, {
      goalTitle: "G",
      hashHex: () => "2" + "0".repeat(63),
    });
    expect(lose.shiny).toBe(false);
  });

  it("tier cap: a winning roll on a legendary milestone stays legendary (still shiny)", () => {
    const plan = planMint(COMPLETION, { title: "Final boss", rarity: "legendary" }, {
      goalTitle: "G",
      roll: 0,
    });
    expect(plan.rarity).toBe("legendary");
    expect(plan.shiny).toBe(true);
  });

  it("defaults to never-shiny when neither roll nor hashHex is provided", () => {
    const plan = planMint(COMPLETION, MILESTONE, { goalTitle: "G" });
    expect(plan.shiny).toBe(false);
    expect(plan.rarity).toBe("rare");
  });
});

describe("planMint — metadata snapshot", () => {
  it("carries the real snapshot of the moment", () => {
    const plan = planMint(COMPLETION, MILESTONE, { goalTitle: "Launch Aimcub", roll: 1 });
    expect(plan.kind).toBe("milestone_badge");
    expect(plan.metadata).toEqual({
      goal_title: "Launch Aimcub",
      milestone_title: "Ship the login flow",
      completed_at: "2026-06-10T12:00:00.000Z",
      awarded_xp: 25,
      shiny: false,
      base_rarity: "rare",
    });
  });

  it("tolerates a missing created_at (empty string, never undefined)", () => {
    const plan = planMint({ id: "x", awarded_xp: 5 }, MILESTONE, { goalTitle: "G" });
    expect(plan.metadata.completed_at).toBe("");
  });
});
