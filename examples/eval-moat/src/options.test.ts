import { describe, expect, it } from "vitest";

import { BENCHMARK_AIMS } from "./aims.ts";
import { DEFAULT_SEED, estimateProviderCalls, parseArgs, resolveOutputDir } from "./options.ts";

describe("parseArgs", () => {
  it("defaults to a provider-free dry run over every aim", () => {
    const { options, errors } = parseArgs(["--out", "/tmp/run"]);
    expect(errors).toEqual([]);
    expect(options.live).toBe(false);
    expect(options.repeat).toBe(1);
    expect(options.seed).toBe(DEFAULT_SEED);
    expect(options.aimIds).toEqual(BENCHMARK_AIMS.map((aim) => aim.id));
    expect(options.maxCalls).toBe(estimateProviderCalls(BENCHMARK_AIMS.length, 1));
  });

  it("accepts both --flag value and --flag=value", () => {
    const spaced = parseArgs(["--out", "/tmp/a", "--repeat", "3", "--seed", "s1", "--aims", "impact-report"]);
    const inline = parseArgs(["--out=/tmp/a", "--repeat=3", "--seed=s1", "--aims=impact-report"]);
    expect(spaced.errors).toEqual([]);
    expect(inline.options).toEqual(spaced.options);
    expect(spaced.options.repeat).toBe(3);
    expect(spaced.options.aimIds).toEqual(["impact-report"]);
  });

  it("rejects unknown aims, bad numbers, and unknown flags", () => {
    expect(parseArgs(["--out", "/tmp/a", "--aims", "nope"]).errors.join(" ")).toContain("Unknown aim id(s): nope");
    expect(parseArgs(["--out", "/tmp/a", "--repeat", "0"]).errors.join(" ")).toContain("--repeat must be");
    expect(parseArgs(["--out", "/tmp/a", "--repeat", "1.5"]).errors.join(" ")).toContain("--repeat must be");
    expect(parseArgs(["--out", "/tmp/a", "--wat"]).errors.join(" ")).toContain("Unknown option: --wat");
    expect(parseArgs([]).errors.join(" ")).toContain("Provide --out");
  });

  it("does not need an output directory when only re-rendering a report", () => {
    const { options, errors } = parseArgs(["--rerender", "/tmp/run/results.json"]);
    expect(errors).toEqual([]);
    expect(options.rerender).toBe("/tmp/run/results.json");
  });

  it("reads the output directory from the environment when no flag is given", () => {
    const { options, errors } = parseArgs([], { AIMCUB_EVAL_MOAT_OUT: "/tmp/from-env" });
    expect(errors).toEqual([]);
    expect(options.outDir).toBe("/tmp/from-env");
  });

  it("estimates one call per cell plus one judging call per aim and repetition", () => {
    expect(estimateProviderCalls(3, 1)).toBe(9);
    expect(estimateProviderCalls(3, 2)).toBe(18);
    expect(estimateProviderCalls(1, 1)).toBe(3);
  });
});

describe("resolveOutputDir", () => {
  const home = "/Users/example";

  it("resolves a disposable directory", () => {
    expect(resolveOutputDir({ outDir: "run", cwd: "/tmp", homeDir: home })).toBe("/tmp/run");
  });

  it("refuses the home directory, a real store, and the filesystem root", () => {
    expect(() => resolveOutputDir({ outDir: home, cwd: "/tmp", homeDir: home })).toThrow(/Refusing/);
    expect(() => resolveOutputDir({ outDir: `${home}/.aimcub`, cwd: "/tmp", homeDir: home })).toThrow(/Refusing/);
    expect(() => resolveOutputDir({ outDir: `${home}/.aimcub/nested`, cwd: "/tmp", homeDir: home })).toThrow(/Refusing/);
    expect(() => resolveOutputDir({ outDir: "/", cwd: "/tmp", homeDir: home })).toThrow(/Refusing/);
  });

  it("refuses to write inside an explicit AIMCUB_HOME", () => {
    expect(() =>
      resolveOutputDir({ outDir: "/tmp/store/bench", cwd: "/tmp", homeDir: home, env: { AIMCUB_HOME: "/tmp/store" } }),
    ).toThrow(/AIMCUB_HOME/);
  });

  it("allows a dangerous path only with --force", () => {
    expect(resolveOutputDir({ outDir: `${home}/.aimcub`, cwd: "/tmp", homeDir: home, force: true })).toBe(`${home}/.aimcub`);
  });

  it("requires a directory at all", () => {
    expect(() => resolveOutputDir({ outDir: "  " })).toThrow(/Provide --out/);
  });
});
