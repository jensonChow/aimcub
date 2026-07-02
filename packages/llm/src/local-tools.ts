import { promises as fs } from "node:fs";
import path from "node:path";

import type {
  AimcubToolFailure,
  AimcubToolHandlerContext,
  AimcubToolPermissionKind,
  AimcubToolResult,
  AimcubToolSource,
  LocalGlobInput,
  LocalReadInput,
  LocalScanWorkspaceInput,
  LocalScanWorkspaceOutput,
  LocalSearchInput,
  LocalSearchOutput,
} from "./tool-contract";
import type { AimcubToolHandlerMap } from "./tool-registry";

export interface LocalToolRuntimeOptions {
  workspaceRoot: string;
  readMaxBytes?: number;
  searchFileMaxBytes?: number;
  defaultMaxDepth?: number;
}

interface WalkFile {
  absolutePath: string;
  relativePath: string;
}

interface WalkOptions {
  includeHidden: boolean;
  maxDepth: number;
  includeDirectories?: boolean;
}

interface WalkResult {
  files: WalkFile[];
  directoryCount: number;
  sensitivePathsExcluded: string[];
}

const DEFAULT_READ_MAX_BYTES = 120_000;
const DEFAULT_READ_LINES = 160;
const HARD_READ_LINES = 800;
const DEFAULT_SEARCH_FILE_MAX_BYTES = 160_000;
const DEFAULT_SEARCH_MATCHES = 60;
const HARD_SEARCH_MATCHES = 250;
const DEFAULT_GLOB_MATCHES = 200;
const HARD_GLOB_MATCHES = 1_000;
const DEFAULT_MAX_DEPTH = 6;
const HARD_MAX_DEPTH = 12;

const IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  ".next",
  ".turbo",
  ".cache",
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
]);

const SENSITIVE_FILE_NAMES = new Set([
  ".env",
  ".env.local",
  ".env.production",
  ".env.development",
  ".env.test",
  "id_rsa",
  "id_ed25519",
  "credentials.json",
  "secrets.json",
]);

const MANIFEST_KINDS: Array<{ fileName: string; kind: string; projectType?: string }> = [
  { fileName: "package.json", kind: "node-package", projectType: "node" },
  { fileName: "pnpm-workspace.yaml", kind: "pnpm-workspace", projectType: "monorepo" },
  { fileName: "vite.config.ts", kind: "vite-config", projectType: "vite" },
  { fileName: "vite.config.js", kind: "vite-config", projectType: "vite" },
  { fileName: "electron.vite.config.ts", kind: "electron-vite-config", projectType: "electron" },
  { fileName: "next.config.ts", kind: "next-config", projectType: "nextjs" },
  { fileName: "next.config.js", kind: "next-config", projectType: "nextjs" },
  { fileName: "tsconfig.json", kind: "typescript-config", projectType: "typescript" },
  { fileName: "pyproject.toml", kind: "python-project", projectType: "python" },
  { fileName: "Cargo.toml", kind: "rust-package", projectType: "rust" },
  { fileName: "go.mod", kind: "go-module", projectType: "go" },
];

const IGNORED_PATTERNS = [
  ".git/",
  "node_modules/",
  "dist/",
  "build/",
  "out/",
  "coverage/",
  ".next/",
  ".turbo/",
  ".cache/",
  ".env*",
  "*secrets*",
  "id_rsa",
  "id_ed25519",
];

function fail<T>(
  code: AimcubToolFailure["code"],
  message: string,
  retryable = false,
  details?: Record<string, unknown>,
): AimcubToolResult<T> {
  return { ok: false, error: { code, message, retryable, details } };
}

function hasPermission(context: AimcubToolHandlerContext, permission: AimcubToolPermissionKind): boolean {
  return context.permissions.includes(permission);
}

function observedAt(context: AimcubToolHandlerContext): string {
  try {
    return context.now().toISOString();
  } catch {
    return new Date().toISOString();
  }
}

function normalizeDepth(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isInteger(value) || value < 0) return fallback;
  return Math.min(value, HARD_MAX_DEPTH);
}

function normalizePositiveInteger(value: number | undefined, fallback: number, hardMax: number): number {
  if (value === undefined || !Number.isInteger(value) || value < 1) return fallback;
  return Math.min(value, hardMax);
}

function workspaceRoot(options: LocalToolRuntimeOptions): string {
  return path.resolve(options.workspaceRoot);
}

function resolveInsideWorkspace(root: string, candidate: string): string | null {
  const resolved = path.resolve(path.isAbsolute(candidate) ? candidate : path.join(root, candidate));
  const relative = path.relative(root, resolved);
  if (relative === "") return resolved;
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return resolved;
}

function toRelative(root: string, absolutePath: string): string {
  return path.relative(root, absolutePath).split(path.sep).join("/");
}

function pathSegments(relativePath: string): string[] {
  return relativePath.split(/[\\/]+/).filter(Boolean);
}

function isHiddenRelativePath(relativePath: string): boolean {
  return pathSegments(relativePath).some((segment) => segment.startsWith("."));
}

function isSensitiveRelativePath(relativePath: string): boolean {
  const normalized = relativePath.split(path.sep).join("/");
  const segments = pathSegments(normalized);
  return segments.some((segment) => {
    const lower = segment.toLowerCase();
    return SENSITIVE_FILE_NAMES.has(lower) || lower.startsWith(".env.") || lower.includes("secret");
  });
}

function shouldIgnoreDirectory(name: string, includeHidden: boolean): boolean {
  if (IGNORED_DIRECTORY_NAMES.has(name)) return true;
  return !includeHidden && name.startsWith(".");
}

async function readTextFile(absolutePath: string, maxBytes: number): Promise<{ text: string; byteLength: number; truncated: boolean } | null> {
  const handle = await fs.open(absolutePath, "r");
  try {
    const stat = await handle.stat();
    const byteLength = stat.size;
    const buffer = Buffer.alloc(Math.min(byteLength, maxBytes));
    const read = await handle.read(buffer, 0, buffer.length, 0);
    const slice = buffer.subarray(0, read.bytesRead);
    if (slice.includes(0)) return null;
    return {
      text: slice.toString("utf8"),
      byteLength,
      truncated: byteLength > slice.length,
    };
  } finally {
    await handle.close();
  }
}

async function walkWorkspace(root: string, start: string, options: WalkOptions): Promise<WalkResult> {
  const files: WalkFile[] = [];
  const sensitivePathsExcluded: string[] = [];
  let directoryCount = 0;

  async function visit(directory: string, depth: number): Promise<void> {
    if (depth > options.maxDepth) return;
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = toRelative(root, absolutePath);
      if (entry.isDirectory()) {
        if (shouldIgnoreDirectory(entry.name, options.includeHidden)) continue;
        directoryCount += 1;
        if (options.includeDirectories) {
          files.push({ absolutePath, relativePath });
        }
        await visit(absolutePath, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      if (isSensitiveRelativePath(relativePath)) {
        sensitivePathsExcluded.push(relativePath);
        continue;
      }
      if (!options.includeHidden && isHiddenRelativePath(relativePath)) continue;
      files.push({ absolutePath, relativePath });
    }
  }

  await visit(start, 0);
  return { files, directoryCount, sensitivePathsExcluded };
}

function globToRegExp(pattern: string): RegExp {
  const normalized = pattern;
  let source = "^";
  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    const next = normalized[i + 1];
    if (char === "*" && next === "*") {
      source += ".*";
      i += 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else if ("\\.^$+{}()|[]".includes(char ?? "")) {
      source += `\\${char}`;
    } else {
      source += char;
    }
  }
  source += "$";
  return new RegExp(source);
}

function matchesGlob(relativePath: string, pattern: string | undefined): boolean {
  if (!pattern?.trim()) return true;
  const normalized = relativePath.split(path.sep).join("/");
  const trimmed = pattern.trim();
  const regex = globToRegExp(trimmed);
  if (regex.test(normalized)) return true;
  if (!trimmed.includes("/")) return regex.test(path.posix.basename(normalized));
  if (trimmed.startsWith("**/")) return matchesGlob(normalized, trimmed.slice(3));
  return false;
}

function lineMatches(line: string, query: string): boolean {
  return line.toLowerCase().includes(query.toLowerCase());
}

function sourceForLocalPath(root: string, absolutePath: string, context: AimcubToolHandlerContext): AimcubToolSource {
  return {
    kind: "file",
    path: absolutePath,
    uri: `file:${absolutePath}`,
    title: toRelative(root, absolutePath),
    observedAt: observedAt(context),
  };
}

function scanManifest(files: WalkFile[]): Pick<LocalScanWorkspaceOutput, "likelyProjectTypes" | "manifests"> {
  const projectTypes = new Set<string>();
  const manifests: LocalScanWorkspaceOutput["manifests"] = [];

  for (const file of files) {
    const base = path.basename(file.relativePath);
    const match = MANIFEST_KINDS.find((manifest) => manifest.fileName === base);
    if (!match) continue;
    manifests.push({ path: file.absolutePath, kind: match.kind });
    if (match.projectType) projectTypes.add(match.projectType);
  }

  return {
    likelyProjectTypes: [...projectTypes].sort(),
    manifests: manifests.sort((a, b) => a.path.localeCompare(b.path)).slice(0, 40),
  };
}

export function createLocalReadOnlyToolHandlers(options: LocalToolRuntimeOptions): Pick<
  AimcubToolHandlerMap,
  "local.read" | "local.search" | "local.glob" | "local.scan_workspace"
> {
  const configuredRoot = path.resolve(options.workspaceRoot);
  const defaultMaxDepth = normalizeDepth(options.defaultMaxDepth, DEFAULT_MAX_DEPTH);

  return {
    "local.read": async (input: LocalReadInput, context: AimcubToolHandlerContext) => {
      if (!hasPermission(context, "filesystem.read")) {
        return fail("permission_denied", "local.read requires the filesystem.read permission.");
      }
      if (!input || typeof input.path !== "string" || !input.path.trim()) {
        return fail("invalid_input", "local.read requires a non-empty path.");
      }

      const root = workspaceRoot({ ...options, workspaceRoot: configuredRoot });
      const absolutePath = resolveInsideWorkspace(root, input.path);
      if (!absolutePath) return fail("outside_workspace", "local.read can only read files inside the configured workspace.");
      const relativePath = toRelative(root, absolutePath);
      if (isSensitiveRelativePath(relativePath)) return fail("sensitive_path", "local.read refused to read a sensitive path.");

      try {
        const stat = await fs.stat(absolutePath);
        if (stat.isDirectory()) return fail("is_directory", "local.read expected a file but received a directory.");
        const maxBytes = normalizePositiveInteger(input.maxBytes, options.readMaxBytes ?? DEFAULT_READ_MAX_BYTES, DEFAULT_READ_MAX_BYTES);
        const read = await readTextFile(absolutePath, maxBytes);
        if (!read) return fail("binary_file", "local.read refused to read a binary file.");

        const startLine = normalizePositiveInteger(input.startLine, 1, Number.MAX_SAFE_INTEGER);
        const maxLines = normalizePositiveInteger(input.maxLines, DEFAULT_READ_LINES, HARD_READ_LINES);
        const allLines = read.text.split(/\r?\n/);
        const selected = allLines.slice(startLine - 1, startLine - 1 + maxLines).map((text, index) => ({
          line: startLine + index,
          text,
        }));
        return {
          ok: true,
          observation: {
            summary: `Read ${selected.length} lines from ${relativePath}.`,
            data: {
              path: absolutePath,
              lines: selected,
              truncated: read.truncated || startLine - 1 + maxLines < allLines.length,
              byteLength: read.byteLength,
            },
            sources: [sourceForLocalPath(root, absolutePath, context)],
          },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return fail("io_error", `local.read failed: ${message}`, true);
      }
    },

    "local.search": async (input: LocalSearchInput, context: AimcubToolHandlerContext) => {
      if (!hasPermission(context, "filesystem.search")) {
        return fail("permission_denied", "local.search requires the filesystem.search permission.");
      }
      if (!input || typeof input.query !== "string" || !input.query.trim()) {
        return fail("invalid_input", "local.search requires a non-empty query.");
      }

      const root = workspaceRoot({ ...options, workspaceRoot: configuredRoot });
      const start = resolveInsideWorkspace(root, input.root ?? ".");
      if (!start) return fail("outside_workspace", "local.search can only search inside the configured workspace.");
      const maxMatches = normalizePositiveInteger(input.maxMatches, DEFAULT_SEARCH_MATCHES, HARD_SEARCH_MATCHES);
      const contextLines = normalizePositiveInteger(input.contextLines, 0, 3);
      const fileMaxBytes = options.searchFileMaxBytes ?? DEFAULT_SEARCH_FILE_MAX_BYTES;
      const matches: LocalSearchOutput["matches"] = [];
      let truncated = false;

      try {
        const walk = await walkWorkspace(root, start, { includeHidden: false, maxDepth: defaultMaxDepth });
        for (const file of walk.files) {
          if (!matchesGlob(file.relativePath, input.glob)) continue;
          const read = await readTextFile(file.absolutePath, fileMaxBytes);
          if (!read) continue;
          const lines = read.text.split(/\r?\n/);
          for (let index = 0; index < lines.length; index += 1) {
            const text = lines[index] ?? "";
            if (!lineMatches(text, input.query)) continue;
            matches.push({
              path: file.absolutePath,
              line: index + 1,
              text,
              ...(contextLines > 0 ? { before: lines.slice(Math.max(0, index - contextLines), index) } : {}),
              ...(contextLines > 0 ? { after: lines.slice(index + 1, index + 1 + contextLines) } : {}),
            });
            if (matches.length >= maxMatches) {
              truncated = true;
              break;
            }
          }
          if (truncated) break;
        }
        return {
          ok: true,
          observation: {
            summary: matches.length === 1 ? "Found 1 local match." : `Found ${matches.length} local matches.`,
            data: { matches, truncated },
            sources: matches.slice(0, 30).map((match) => sourceForLocalPath(root, match.path, context)),
            warnings: walk.sensitivePathsExcluded.length > 0 ? [`Excluded ${walk.sensitivePathsExcluded.length} sensitive paths.`] : undefined,
          },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return fail("io_error", `local.search failed: ${message}`, true);
      }
    },

    "local.glob": async (input: LocalGlobInput, context: AimcubToolHandlerContext) => {
      if (!hasPermission(context, "filesystem.search")) {
        return fail("permission_denied", "local.glob requires the filesystem.search permission.");
      }
      if (!input || typeof input.pattern !== "string" || !input.pattern.trim()) {
        return fail("invalid_input", "local.glob requires a non-empty pattern.");
      }

      const root = workspaceRoot({ ...options, workspaceRoot: configuredRoot });
      const start = resolveInsideWorkspace(root, input.root ?? ".");
      if (!start) return fail("outside_workspace", "local.glob can only search inside the configured workspace.");
      const maxMatches = normalizePositiveInteger(input.maxMatches, DEFAULT_GLOB_MATCHES, HARD_GLOB_MATCHES);

      try {
        const walk = await walkWorkspace(root, start, { includeHidden: false, maxDepth: defaultMaxDepth });
        const paths: string[] = [];
        for (const file of walk.files) {
          if (!matchesGlob(file.relativePath, input.pattern)) continue;
          paths.push(file.absolutePath);
          if (paths.length >= maxMatches) break;
        }
        return {
          ok: true,
          observation: {
            summary: paths.length === 1 ? "Matched 1 local path." : `Matched ${paths.length} local paths.`,
            data: { paths, truncated: paths.length >= maxMatches },
            sources: paths.slice(0, 30).map((matchedPath) => sourceForLocalPath(root, matchedPath, context)),
            warnings: walk.sensitivePathsExcluded.length > 0 ? [`Excluded ${walk.sensitivePathsExcluded.length} sensitive paths.`] : undefined,
          },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return fail("io_error", `local.glob failed: ${message}`, true);
      }
    },

    "local.scan_workspace": async (input: LocalScanWorkspaceInput, context: AimcubToolHandlerContext) => {
      if (!hasPermission(context, "filesystem.read")) {
        return fail("permission_denied", "local.scan_workspace requires the filesystem.read permission.");
      }
      if (!input || typeof input.root !== "string" || !input.root.trim()) {
        return fail("invalid_input", "local.scan_workspace requires a non-empty root.");
      }

      const root = workspaceRoot({ ...options, workspaceRoot: configuredRoot });
      const start = resolveInsideWorkspace(root, input.root);
      if (!start) return fail("outside_workspace", "local.scan_workspace can only scan inside the configured workspace.");
      const maxDepth = normalizeDepth(input.maxDepth, defaultMaxDepth);

      try {
        const stat = await fs.stat(start);
        if (!stat.isDirectory()) return fail("invalid_input", "local.scan_workspace root must be a directory.");
        const includeHidden = input.includeHidden === true;
        const walk = await walkWorkspace(root, start, { includeHidden, maxDepth });
        const manifestScan = scanManifest(walk.files);
        const output: LocalScanWorkspaceOutput = {
          root: start,
          fileCount: walk.files.length,
          directoryCount: walk.directoryCount,
          likelyProjectTypes: manifestScan.likelyProjectTypes,
          manifests: manifestScan.manifests,
          ignoredPatterns: IGNORED_PATTERNS,
          sensitivePathsExcluded: walk.sensitivePathsExcluded.sort().slice(0, 100),
        };
        return {
          ok: true,
          observation: {
            summary: `Scanned workspace ${toRelative(root, start) || "."}: ${output.fileCount} files, ${output.directoryCount} directories.`,
            data: output,
            sources: [{
              kind: "workspace",
              path: start,
              uri: `file:${start}`,
              title: toRelative(root, start) || path.basename(start),
              observedAt: observedAt(context),
            }],
            warnings: output.sensitivePathsExcluded.length > 0 ? [`Excluded ${output.sensitivePathsExcluded.length} sensitive paths.`] : undefined,
          },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return fail("io_error", `local.scan_workspace failed: ${message}`, true);
      }
    },
  };
}
