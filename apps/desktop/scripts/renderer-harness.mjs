/**
 * Renderer harness — serves the REAL built renderer with a stubbed bridge, for verification a
 * unit test cannot do.
 *
 *   pnpm build && pnpm desktop:harness
 *
 * Then drive http://127.0.0.1:5599 with browser tools: read the accessibility tree, CLICK things,
 * inspect `window.__harnessCalls` / `window.__harnessErrors`, screenshot, resize, toggle dark mode.
 * Scenario flags ride on the query string (`?nopass`, `?planready`) so a reload picks a state.
 *
 * Why not jsdom: every founder-reported Desktop bug so far — a delete button whose pointerup was
 * stolen by a stacking context, planning restarting on re-entry, a start card shown for an aim that
 * was already planned — was invisible to a fully green suite. Pointer targets, CSS layering and
 * navigation state need a real browser and a real click.
 *
 * Deliberately NOT part of the CI gate: it is an interactive tool, not an automated test.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, statSync, writeFileSync, createReadStream } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BUILT_RENDERER = resolve(HERE, "..", "out", "renderer");
const STUB_SOURCE = join(HERE, "renderer-harness-stub.js");
const PORT = Number(process.env.AIMCUB_HARNESS_PORT ?? 5599);

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
};

if (!existsSync(join(BUILT_RENDERER, "index.html"))) {
  process.stderr.write(`No built renderer at ${BUILT_RENDERER}.\nRun \`pnpm build\` first — the harness serves the real bundle, not source.\n`);
  process.exit(1);
}

// A throwaway copy, so injecting the stub never mutates build output.
const root = mkdtempSync(join(tmpdir(), "aimcub-harness-"));
cpSync(BUILT_RENDERER, root, { recursive: true });
cpSync(STUB_SOURCE, join(root, "stub.js"));

// The stub must define `window.aimcub` BEFORE the module bundle runs, or the app reads an
// undefined bridge during its first render.
const indexPath = join(root, "index.html");
const html = readFileSync(indexPath, "utf8");
if (!html.includes('<script type="module"')) {
  process.stderr.write("Could not find the module script tag in index.html; the build output shape changed.\n");
  process.exit(1);
}
writeFileSync(indexPath, html.replace('<script type="module"', '<script src="./stub.js"></script>\n    <script type="module"', 1));

createServer((req, res) => {
  const requested = (req.url ?? "/").split("?")[0];
  const relative = normalize(requested === "/" ? "/index.html" : requested).replace(/^(\.\.[/\\])+/, "");
  const file = join(root, relative);
  // Path traversal guard: the harness serves one directory and nothing above it.
  if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, { "content-type": CONTENT_TYPES[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
}).listen(PORT, "127.0.0.1", () => {
  process.stdout.write([
    `Renderer harness on http://127.0.0.1:${PORT}`,
    `  serving ${root}`,
    "  scenarios: /?nopass  /?planready",
    "  in the page: window.__harnessCalls, window.__harnessErrors",
    "  fixtures: apps/desktop/scripts/renderer-harness-stub.js (expect to extend them)",
    "",
  ].join("\n"));
});
