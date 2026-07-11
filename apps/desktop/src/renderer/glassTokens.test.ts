import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * Guard for the additive Aimcub Glass token layer in cockpit.css.
 *
 * The theme switches purely by reassigning CSS custom properties, and the dark
 * palette is hand-duplicated across two blocks (`@media (prefers-color-scheme: dark)`
 * and `:root:has([data-system-appearance="dark"])`). These assertions keep the Glass
 * tokens present in all three theme blocks and keep the two dark blocks in agreement,
 * so a future edit cannot silently desync them.
 */
const css = readFileSync(new URL("./cockpit.css", import.meta.url), "utf8");

const GLASS_TOKEN_NAMES = [
  "--desk",
  "--island",
  "--island2",
  "--field",
  "--ring",
  "--edge",
  "--ink",
  "--ink2",
  "--mut",
  "--faint",
  "--acc",
  "--acc-on",
  "--acc-soft",
  "--ok",
  "--okdot",
  "--warndot",
  "--warn",
  "--danger",
  "--sh-lg",
  "--sh-md",
  "--sh-btn",
  "--dim",
];

/** Returns a `{ token: value }` map of the Glass declarations inside one CSS block. */
function glassDeclarations(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of GLASS_TOKEN_NAMES) {
    const match = block.match(new RegExp(`${name.replace(/[-]/g, "\\-")}\\s*:\\s*([^;]+);`));
    const value = match?.[1];
    if (value) out[name] = value.trim();
  }
  return out;
}

function blockBetween(start: string, endMarker: string): string {
  const startIdx = css.indexOf(start);
  expect(startIdx, `expected to find "${start}" in cockpit.css`).toBeGreaterThanOrEqual(0);
  const endIdx = css.indexOf(endMarker, startIdx + start.length);
  return css.slice(startIdx, endIdx === -1 ? undefined : endIdx);
}

describe("Glass token layer in cockpit.css", () => {
  const lightBlock = blockBetween(":root {", "@media (prefers-color-scheme: dark)");
  const mediaDarkBlock = blockBetween("@media (prefers-color-scheme: dark)", '\n:root:has(.od-app[data-system-appearance="dark"])');
  const hasDarkBlock = blockBetween(':root:has(.od-app[data-system-appearance="dark"]) {', "\n}\n");

  it("declares every Glass token in the light :root block", () => {
    const light = glassDeclarations(lightBlock);
    for (const name of GLASS_TOKEN_NAMES) {
      expect(light[name], `missing ${name} in light :root`).toBeTruthy();
    }
    expect(light["--island"]).toBe("rgba(255, 255, 255, 0.62)");
  });

  it("declares every Glass token in both dark blocks with identical values", () => {
    const media = glassDeclarations(mediaDarkBlock);
    const has = glassDeclarations(hasDarkBlock);
    for (const name of GLASS_TOKEN_NAMES) {
      expect(media[name], `missing ${name} in @media dark`).toBeTruthy();
      expect(has[name], `missing ${name} in :has() dark`).toBeTruthy();
    }
    expect(media).toEqual(has);
    expect(media["--ink"]).toBe("#f2f2f7");
  });

  it("keeps light and dark values distinct (the theme actually changes)", () => {
    const light = glassDeclarations(lightBlock);
    const dark = glassDeclarations(mediaDarkBlock);
    expect(light["--desk"]).not.toBe(dark["--desk"]);
    expect(light["--ink"]).not.toBe(dark["--ink"]);
  });
});
