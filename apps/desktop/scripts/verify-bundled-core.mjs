import { readdirSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import process from "node:process";

const bundleRoots = [
  resolve("out/main/index.js"),
  resolve("out/preload/index.js"),
].map((entry) => resolve(entry, ".."));

function runtimeBundleFiles(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return runtimeBundleFiles(path);
    return [".js", ".cjs", ".mjs"].includes(extname(entry.name)) ? [path] : [];
  });
}

const bundlePaths = [...new Set(bundleRoots.flatMap(runtimeBundleFiles))];

const externalCoreImport = /(?:require|import)\s*\(\s*["']@core\/|(?:from|import)\s*["']@core\//gu;
const failures = [];

for (const bundlePath of bundlePaths) {
  const source = readFileSync(bundlePath, "utf8");
  if (externalCoreImport.test(source)) failures.push(bundlePath);
  externalCoreImport.lastIndex = 0;
}

if (failures.length > 0) {
  process.stderr.write("Electron runtime bundles contain external @core imports:\n");
  for (const failure of failures) process.stderr.write(`- ${failure}\n`);
  process.stderr.write("Raw-TypeScript @core packages must be bundled through electron.vite.config.ts.\n");
  process.exit(1);
}

process.stdout.write("Verified Electron runtime bundles contain no external @core imports.\n");
