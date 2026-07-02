/**
 * First-party planning tool contracts.
 *
 * These contracts are owned by Aimcub's runtime and permission model. They are not MCP
 * tools: MCP stays the external connector/plugin boundary, while these contracts define
 * the local substrate the planning engine may ask the runtime to execute.
 */

export type AimcubToolName =
  | "local.read"
  | "local.write"
  | "local.edit"
  | "local.search"
  | "local.glob"
  | "local.scan_workspace"
  | "memory.search"
  | "memory.write_candidate"
  | "web.search"
  | "web.fetch"
  | "context.distill"
  | "context.ask_user";

export type AimcubToolPermissionKind =
  | "filesystem.read"
  | "filesystem.write"
  | "filesystem.edit"
  | "filesystem.search"
  | "memory.read"
  | "memory.write_candidate"
  | "network.search"
  | "network.fetch"
  | "context.distill"
  | "user.ask";

export type AimcubToolAvailability =
  | "always"
  | "requires_workspace"
  | "requires_memory_store"
  | "requires_network_provider"
  | "requires_user";

export type AimcubToolRisk = "low" | "medium" | "high";

export type AimcubToolErrorCode =
  | "invalid_input"
  | "permission_denied"
  | "disabled"
  | "unavailable"
  | "not_found"
  | "outside_workspace"
  | "sensitive_path"
  | "is_directory"
  | "binary_file"
  | "bounds_exceeded"
  | "conflict"
  | "timeout"
  | "provider_error"
  | "io_error"
  | "unknown_error";

export type AimcubToolJsonPrimitive = string | number | boolean | null;

export interface AimcubToolJsonSchema {
  type?: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";
  description?: string;
  properties?: Record<string, AimcubToolJsonSchema>;
  items?: AimcubToolJsonSchema;
  required?: readonly string[];
  enum?: readonly AimcubToolJsonPrimitive[];
  additionalProperties?: boolean | AimcubToolJsonSchema;
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  default?: AimcubToolJsonPrimitive;
}

export interface AimcubToolPermission {
  kind: AimcubToolPermissionKind;
  risk: AimcubToolRisk;
  description: string;
  requiresUserApproval: boolean;
}

export interface AimcubToolContract<Name extends AimcubToolName = AimcubToolName> {
  name: Name;
  description: string;
  inputSchema: AimcubToolJsonSchema;
  outputSchema: AimcubToolJsonSchema;
  permission: AimcubToolPermission;
  availability: AimcubToolAvailability;
  errors: readonly AimcubToolErrorCode[];
  sourceMetadata: readonly AimcubToolSourceKind[];
}

export type AimcubToolSourceKind = "file" | "workspace" | "memory" | "web" | "user" | "tool";

export interface AimcubToolSource {
  kind: AimcubToolSourceKind;
  title?: string;
  uri?: string;
  path?: string;
  url?: string;
  lineStart?: number;
  lineEnd?: number;
  hash?: string;
  observedAt?: string;
}

export interface AimcubToolObservation<T = unknown> {
  summary: string;
  data: T;
  sources: AimcubToolSource[];
  warnings?: string[];
}

export interface AimcubToolFailure {
  code: AimcubToolErrorCode;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export type AimcubToolResult<T = unknown> =
  | { ok: true; observation: AimcubToolObservation<T> }
  | { ok: false; error: AimcubToolFailure };

export interface AimcubToolHandlerContext {
  ownerId?: string;
  aimId?: string;
  workspaceRoot?: string;
  now: () => Date;
  permissions: readonly AimcubToolPermissionKind[];
}

export type AimcubToolHandler<I = unknown, O = unknown> = (
  input: I,
  context: AimcubToolHandlerContext,
) => Promise<AimcubToolResult<O>>;

export interface LocalReadInput {
  path: string;
  startLine?: number;
  maxLines?: number;
  maxBytes?: number;
}

export interface LocalReadOutput {
  path: string;
  lines: Array<{ line: number; text: string }>;
  truncated: boolean;
  byteLength: number;
}

export interface LocalWriteInput {
  path: string;
  content: string;
  createParents?: boolean;
  expectedHash?: string;
}

export interface LocalWriteOutput {
  path: string;
  bytesWritten: number;
  hash?: string;
}

export interface LocalEditInput {
  path: string;
  edits: Array<{ oldText: string; newText: string; replaceAll?: boolean }>;
  expectedHash?: string;
}

export interface LocalEditOutput {
  path: string;
  replacements: number;
  hash?: string;
}

export interface LocalSearchInput {
  query: string;
  root?: string;
  glob?: string;
  maxMatches?: number;
  contextLines?: number;
}

export interface LocalSearchOutput {
  matches: Array<{ path: string; line: number; text: string; before?: string[]; after?: string[] }>;
  truncated: boolean;
}

export interface LocalGlobInput {
  pattern: string;
  root?: string;
  maxMatches?: number;
}

export interface LocalGlobOutput {
  paths: string[];
  truncated: boolean;
}

export interface LocalScanWorkspaceInput {
  root: string;
  maxDepth?: number;
  includeHidden?: boolean;
}

export interface LocalScanWorkspaceOutput {
  root: string;
  fileCount: number;
  directoryCount: number;
  likelyProjectTypes: string[];
  manifests: Array<{ path: string; kind: string }>;
  ignoredPatterns: string[];
  sensitivePathsExcluded: string[];
}

export interface MemorySearchInput {
  query: string;
  aimId?: string;
  scope?: "global" | "current_aim" | "both";
  limit?: number;
}

export interface MemorySearchOutput {
  memories: Array<{
    id: string;
    content: string;
    category: string;
    kind: string;
    scope: "global" | "current_aim";
    confidence?: number;
  }>;
}

export interface MemoryWriteCandidateInput {
  content: string;
  category: string;
  scope: "global" | "current_aim";
  aimId?: string;
  sourceToolCallId?: string;
}

export interface MemoryWriteCandidateOutput {
  candidateId: string;
  status: "pending";
}

export interface WebSearchInput {
  query: string;
  limit?: number;
  recencyDays?: number;
  domains?: string[];
}

export interface WebSearchOutput {
  results: Array<{
    title: string;
    url: string;
    snippet: string;
    source?: string;
    publishedAt?: string;
  }>;
}

export interface WebFetchInput {
  url: string;
  maxBytes?: number;
  extractMode?: "text" | "metadata" | "text_with_links";
}

export interface WebFetchOutput {
  finalUrl: string;
  status: number;
  title?: string;
  text?: string;
  links?: Array<{ text: string; url: string }>;
  truncated: boolean;
}

export interface ContextDistillInput {
  aimTitle: string;
  aimDescription?: string;
  observations: Array<AimcubToolObservation<unknown>>;
  maxTokens?: number;
}

export interface ContextDistillOutput {
  summary: string;
  usedSources: AimcubToolSource[];
  missingQuestions: Array<{ id: string; question: string; category?: string }>;
  durableMemoryCandidates: Array<{ content: string; category: string; scope: "global" | "current_aim" }>;
}

export interface ContextAskUserInput {
  questions: Array<{
    id: string;
    question: string;
    category?: string;
    choices?: string[];
    captureScope?: "global" | "current_aim" | "none";
  }>;
}

export interface ContextAskUserOutput {
  requestId: string;
  questions: ContextAskUserInput["questions"];
}

const stringSchema = (description: string, minLength = 1): AimcubToolJsonSchema => ({
  type: "string",
  minLength,
  description,
});

const integerSchema = (description: string, minimum = 1, maximum?: number): AimcubToolJsonSchema => ({
  type: "integer",
  minimum,
  ...(maximum === undefined ? {} : { maximum }),
  description,
});

const booleanSchema = (description: string): AimcubToolJsonSchema => ({ type: "boolean", description });

const stringArraySchema = (description: string): AimcubToolJsonSchema => ({
  type: "array",
  description,
  items: { type: "string" },
});

const sourceSchema: AimcubToolJsonSchema = {
  type: "object",
  required: ["kind"],
  additionalProperties: false,
  properties: {
    kind: { type: "string", enum: ["file", "workspace", "memory", "web", "user", "tool"] },
    title: { type: "string" },
    uri: { type: "string" },
    path: { type: "string" },
    url: { type: "string" },
    lineStart: { type: "integer", minimum: 1 },
    lineEnd: { type: "integer", minimum: 1 },
    hash: { type: "string" },
    observedAt: { type: "string" },
  },
};

const observationSchema = (data: AimcubToolJsonSchema): AimcubToolJsonSchema => ({
  type: "object",
  required: ["summary", "data", "sources"],
  additionalProperties: false,
  properties: {
    summary: stringSchema("Human-readable summary of the observation."),
    data,
    sources: { type: "array", items: sourceSchema },
    warnings: { type: "array", items: { type: "string" } },
  },
});

const fileSource = ["file"] as const;
const workspaceSource = ["workspace", "file"] as const;
const memorySource = ["memory"] as const;
const webSource = ["web"] as const;
const userSource = ["user"] as const;
const toolSource = ["tool", "file", "workspace", "memory", "web", "user"] as const;

function permission(
  kind: AimcubToolPermissionKind,
  risk: AimcubToolRisk,
  description: string,
  requiresUserApproval = false,
): AimcubToolPermission {
  return { kind, risk, description, requiresUserApproval };
}

function contract<Name extends AimcubToolName>(value: AimcubToolContract<Name>): AimcubToolContract<Name> {
  return value;
}

export const BUILT_IN_TOOL_CONTRACTS = [
  contract({
    name: "local.read",
    description: "Read a bounded slice of a text file inside the selected workspace.",
    availability: "requires_workspace",
    permission: permission("filesystem.read", "low", "Read-only access to approved workspace files."),
    errors: ["invalid_input", "permission_denied", "outside_workspace", "sensitive_path", "not_found", "is_directory", "binary_file", "bounds_exceeded", "io_error"],
    sourceMetadata: fileSource,
    inputSchema: {
      type: "object",
      required: ["path"],
      additionalProperties: false,
      properties: {
        path: stringSchema("Absolute path to read."),
        startLine: integerSchema("1-based line to start from.", 1),
        maxLines: integerSchema("Maximum lines to return.", 1, 500),
        maxBytes: integerSchema("Maximum bytes to read.", 1, 1_000_000),
      },
    },
    outputSchema: observationSchema({
      type: "object",
      required: ["path", "lines", "truncated", "byteLength"],
      additionalProperties: false,
      properties: {
        path: { type: "string" },
        lines: {
          type: "array",
          items: {
            type: "object",
            required: ["line", "text"],
            additionalProperties: false,
            properties: { line: { type: "integer", minimum: 1 }, text: { type: "string" } },
          },
        },
        truncated: { type: "boolean" },
        byteLength: { type: "integer", minimum: 0 },
      },
    }),
  }),
  contract({
    name: "local.write",
    description: "Write a text file inside the selected workspace with optional optimistic hash protection.",
    availability: "requires_workspace",
    permission: permission("filesystem.write", "high", "Write access to approved workspace files.", true),
    errors: ["invalid_input", "permission_denied", "outside_workspace", "sensitive_path", "conflict", "io_error"],
    sourceMetadata: fileSource,
    inputSchema: {
      type: "object",
      required: ["path", "content"],
      additionalProperties: false,
      properties: {
        path: stringSchema("Absolute path to write."),
        content: { type: "string", description: "UTF-8 text content." },
        createParents: booleanSchema("Create missing parent directories."),
        expectedHash: stringSchema("Optional existing file hash for optimistic concurrency.", 0),
      },
    },
    outputSchema: observationSchema({
      type: "object",
      required: ["path", "bytesWritten"],
      additionalProperties: false,
      properties: {
        path: { type: "string" },
        bytesWritten: { type: "integer", minimum: 0 },
        hash: { type: "string" },
      },
    }),
  }),
  contract({
    name: "local.edit",
    description: "Apply bounded text replacements to a file inside the selected workspace.",
    availability: "requires_workspace",
    permission: permission("filesystem.edit", "high", "Edit access to approved workspace files.", true),
    errors: ["invalid_input", "permission_denied", "outside_workspace", "sensitive_path", "not_found", "is_directory", "binary_file", "conflict", "io_error"],
    sourceMetadata: fileSource,
    inputSchema: {
      type: "object",
      required: ["path", "edits"],
      additionalProperties: false,
      properties: {
        path: stringSchema("Absolute path to edit."),
        edits: {
          type: "array",
          minItems: 1,
          maxItems: 50,
          items: {
            type: "object",
            required: ["oldText", "newText"],
            additionalProperties: false,
            properties: {
              oldText: stringSchema("Text to replace."),
              newText: { type: "string", description: "Replacement text." },
              replaceAll: booleanSchema("Replace all occurrences instead of one."),
            },
          },
        },
        expectedHash: stringSchema("Optional existing file hash for optimistic concurrency.", 0),
      },
    },
    outputSchema: observationSchema({
      type: "object",
      required: ["path", "replacements"],
      additionalProperties: false,
      properties: {
        path: { type: "string" },
        replacements: { type: "integer", minimum: 0 },
        hash: { type: "string" },
      },
    }),
  }),
  contract({
    name: "local.search",
    description: "Search text content inside the selected workspace and return bounded file/line matches.",
    availability: "requires_workspace",
    permission: permission("filesystem.search", "low", "Read-only search over approved workspace files."),
    errors: ["invalid_input", "permission_denied", "outside_workspace", "sensitive_path", "bounds_exceeded", "io_error"],
    sourceMetadata: fileSource,
    inputSchema: {
      type: "object",
      required: ["query"],
      additionalProperties: false,
      properties: {
        query: stringSchema("Literal or runtime-supported search query."),
        root: stringSchema("Optional absolute subdirectory root.", 0),
        glob: stringSchema("Optional file glob filter.", 0),
        maxMatches: integerSchema("Maximum matches to return.", 1, 200),
        contextLines: integerSchema("Context lines before/after each match.", 0, 5),
      },
    },
    outputSchema: observationSchema({
      type: "object",
      required: ["matches", "truncated"],
      additionalProperties: false,
      properties: {
        matches: {
          type: "array",
          items: {
            type: "object",
            required: ["path", "line", "text"],
            additionalProperties: false,
            properties: {
              path: { type: "string" },
              line: { type: "integer", minimum: 1 },
              text: { type: "string" },
              before: { type: "array", items: { type: "string" } },
              after: { type: "array", items: { type: "string" } },
            },
          },
        },
        truncated: { type: "boolean" },
      },
    }),
  }),
  contract({
    name: "local.glob",
    description: "Find workspace paths matching a glob without reading file contents.",
    availability: "requires_workspace",
    permission: permission("filesystem.search", "low", "Read-only path discovery inside the approved workspace."),
    errors: ["invalid_input", "permission_denied", "outside_workspace", "sensitive_path", "bounds_exceeded", "io_error"],
    sourceMetadata: fileSource,
    inputSchema: {
      type: "object",
      required: ["pattern"],
      additionalProperties: false,
      properties: {
        pattern: stringSchema("Glob pattern to match."),
        root: stringSchema("Optional absolute subdirectory root.", 0),
        maxMatches: integerSchema("Maximum paths to return.", 1, 500),
      },
    },
    outputSchema: observationSchema({
      type: "object",
      required: ["paths", "truncated"],
      additionalProperties: false,
      properties: {
        paths: { type: "array", items: { type: "string" } },
        truncated: { type: "boolean" },
      },
    }),
  }),
  contract({
    name: "local.scan_workspace",
    description: "Summarize a selected workspace without reading arbitrary file contents.",
    availability: "requires_workspace",
    permission: permission("filesystem.read", "low", "Read-only workspace inventory and manifest inspection."),
    errors: ["invalid_input", "permission_denied", "outside_workspace", "not_found", "io_error"],
    sourceMetadata: workspaceSource,
    inputSchema: {
      type: "object",
      required: ["root"],
      additionalProperties: false,
      properties: {
        root: stringSchema("Absolute workspace root to scan."),
        maxDepth: integerSchema("Maximum directory depth.", 1, 12),
        includeHidden: booleanSchema("Include hidden files when allowed by policy."),
      },
    },
    outputSchema: observationSchema({
      type: "object",
      required: ["root", "fileCount", "directoryCount", "likelyProjectTypes", "manifests", "ignoredPatterns", "sensitivePathsExcluded"],
      additionalProperties: false,
      properties: {
        root: { type: "string" },
        fileCount: { type: "integer", minimum: 0 },
        directoryCount: { type: "integer", minimum: 0 },
        likelyProjectTypes: stringArraySchema("Detected project kinds."),
        manifests: {
          type: "array",
          items: {
            type: "object",
            required: ["path", "kind"],
            additionalProperties: false,
            properties: { path: { type: "string" }, kind: { type: "string" } },
          },
        },
        ignoredPatterns: stringArraySchema("Ignored patterns."),
        sensitivePathsExcluded: stringArraySchema("Sensitive paths excluded from inspection."),
      },
    }),
  }),
  contract({
    name: "memory.search",
    description: "Search active global and current-aim memories for planning context.",
    availability: "requires_memory_store",
    permission: permission("memory.read", "low", "Read active memories relevant to the current aim."),
    errors: ["invalid_input", "permission_denied", "unavailable", "io_error"],
    sourceMetadata: memorySource,
    inputSchema: {
      type: "object",
      required: ["query"],
      additionalProperties: false,
      properties: {
        query: stringSchema("Search query."),
        aimId: stringSchema("Current aim id, when available.", 0),
        scope: { type: "string", enum: ["global", "current_aim", "both"], default: "both" },
        limit: integerSchema("Maximum memories to return.", 1, 50),
      },
    },
    outputSchema: observationSchema({
      type: "object",
      required: ["memories"],
      additionalProperties: false,
      properties: {
        memories: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "content", "category", "kind", "scope"],
            additionalProperties: false,
            properties: {
              id: { type: "string" },
              content: { type: "string" },
              category: { type: "string" },
              kind: { type: "string" },
              scope: { type: "string", enum: ["global", "current_aim"] },
              confidence: { type: "number", minimum: 0, maximum: 1 },
            },
          },
        },
      },
    }),
  }),
  contract({
    name: "memory.write_candidate",
    description: "Create a pending memory candidate without silently changing durable memory.",
    availability: "requires_memory_store",
    permission: permission("memory.write_candidate", "medium", "Write a pending memory candidate for user/runtime review.", true),
    errors: ["invalid_input", "permission_denied", "unavailable", "io_error"],
    sourceMetadata: memorySource,
    inputSchema: {
      type: "object",
      required: ["content", "category", "scope"],
      additionalProperties: false,
      properties: {
        content: stringSchema("Candidate memory content."),
        category: stringSchema("Context category."),
        scope: { type: "string", enum: ["global", "current_aim"] },
        aimId: stringSchema("Aim id required for current_aim scope.", 0),
        sourceToolCallId: stringSchema("Tool call id that produced the candidate.", 0),
      },
    },
    outputSchema: observationSchema({
      type: "object",
      required: ["candidateId", "status"],
      additionalProperties: false,
      properties: {
        candidateId: { type: "string" },
        status: { type: "string", enum: ["pending"] },
      },
    }),
  }),
  contract({
    name: "web.search",
    description: "Search the public web for planning context when a configured provider is available.",
    availability: "requires_network_provider",
    permission: permission("network.search", "medium", "Network search over public web sources.", true),
    errors: ["invalid_input", "permission_denied", "disabled", "unavailable", "timeout", "provider_error"],
    sourceMetadata: webSource,
    inputSchema: {
      type: "object",
      required: ["query"],
      additionalProperties: false,
      properties: {
        query: stringSchema("Search query."),
        limit: integerSchema("Maximum results to return.", 1, 10),
        recencyDays: integerSchema("Optional recency filter in days.", 1, 3650),
        domains: stringArraySchema("Optional domain allowlist."),
      },
    },
    outputSchema: observationSchema({
      type: "object",
      required: ["results"],
      additionalProperties: false,
      properties: {
        results: {
          type: "array",
          items: {
            type: "object",
            required: ["title", "url", "snippet"],
            additionalProperties: false,
            properties: {
              title: { type: "string" },
              url: { type: "string" },
              snippet: { type: "string" },
              source: { type: "string" },
              publishedAt: { type: "string" },
            },
          },
        },
      },
    }),
  }),
  contract({
    name: "web.fetch",
    description: "Fetch a bounded public URL and extract text/metadata for planning context.",
    availability: "requires_network_provider",
    permission: permission("network.fetch", "medium", "Network fetch for a public URL.", true),
    errors: ["invalid_input", "permission_denied", "disabled", "unavailable", "timeout", "provider_error", "bounds_exceeded"],
    sourceMetadata: webSource,
    inputSchema: {
      type: "object",
      required: ["url"],
      additionalProperties: false,
      properties: {
        url: stringSchema("Public URL to fetch."),
        maxBytes: integerSchema("Maximum response bytes to process.", 1, 2_000_000),
        extractMode: { type: "string", enum: ["text", "metadata", "text_with_links"], default: "text" },
      },
    },
    outputSchema: observationSchema({
      type: "object",
      required: ["finalUrl", "status", "truncated"],
      additionalProperties: false,
      properties: {
        finalUrl: { type: "string" },
        status: { type: "integer", minimum: 100, maximum: 599 },
        title: { type: "string" },
        text: { type: "string" },
        links: {
          type: "array",
          items: {
            type: "object",
            required: ["text", "url"],
            additionalProperties: false,
            properties: { text: { type: "string" }, url: { type: "string" } },
          },
        },
        truncated: { type: "boolean" },
      },
    }),
  }),
  contract({
    name: "context.distill",
    description: "Compact tool observations into planning context, durable memory candidates, and remaining questions.",
    availability: "always",
    permission: permission("context.distill", "low", "Pure context transformation over already-observed tool results."),
    errors: ["invalid_input", "bounds_exceeded"],
    sourceMetadata: toolSource,
    inputSchema: {
      type: "object",
      required: ["aimTitle", "observations"],
      additionalProperties: false,
      properties: {
        aimTitle: stringSchema("Aim title."),
        aimDescription: stringSchema("Aim description.", 0),
        observations: { type: "array", items: observationSchema({ type: "object", additionalProperties: true }) },
        maxTokens: integerSchema("Approximate output token budget.", 1, 8000),
      },
    },
    outputSchema: observationSchema({
      type: "object",
      required: ["summary", "usedSources", "missingQuestions", "durableMemoryCandidates"],
      additionalProperties: false,
      properties: {
        summary: { type: "string" },
        usedSources: { type: "array", items: sourceSchema },
        missingQuestions: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "question"],
            additionalProperties: false,
            properties: { id: { type: "string" }, question: { type: "string" }, category: { type: "string" } },
          },
        },
        durableMemoryCandidates: {
          type: "array",
          items: {
            type: "object",
            required: ["content", "category", "scope"],
            additionalProperties: false,
            properties: {
              content: { type: "string" },
              category: { type: "string" },
              scope: { type: "string", enum: ["global", "current_aim"] },
            },
          },
        },
      },
    }),
  }),
  contract({
    name: "context.ask_user",
    description: "Represent missing-context questions as structured runtime requests instead of prose.",
    availability: "requires_user",
    permission: permission("user.ask", "low", "Ask the user for missing context."),
    errors: ["invalid_input", "unavailable"],
    sourceMetadata: userSource,
    inputSchema: {
      type: "object",
      required: ["questions"],
      additionalProperties: false,
      properties: {
        questions: {
          type: "array",
          minItems: 1,
          maxItems: 5,
          items: {
            type: "object",
            required: ["id", "question"],
            additionalProperties: false,
            properties: {
              id: { type: "string" },
              question: { type: "string" },
              category: { type: "string" },
              choices: { type: "array", items: { type: "string" } },
              captureScope: { type: "string", enum: ["global", "current_aim", "none"], default: "current_aim" },
            },
          },
        },
      },
    },
    outputSchema: observationSchema({
      type: "object",
      required: ["requestId", "questions"],
      additionalProperties: false,
      properties: {
        requestId: { type: "string" },
        questions: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "question"],
            additionalProperties: true,
            properties: { id: { type: "string" }, question: { type: "string" } },
          },
        },
      },
    }),
  }),
] as const satisfies readonly AimcubToolContract[];

export const BUILT_IN_TOOL_NAMES = BUILT_IN_TOOL_CONTRACTS.map((tool) => tool.name) as readonly AimcubToolName[];

export function isBuiltInToolName(value: string): value is AimcubToolName {
  return (BUILT_IN_TOOL_NAMES as readonly string[]).includes(value);
}

export function getBuiltInToolContract<Name extends AimcubToolName>(
  name: Name,
): Extract<(typeof BUILT_IN_TOOL_CONTRACTS)[number], { name: Name }> {
  const found = BUILT_IN_TOOL_CONTRACTS.find((tool) => tool.name === name);
  if (!found) throw new Error(`unknown built-in Aimcub tool: ${name}`);
  return found as Extract<(typeof BUILT_IN_TOOL_CONTRACTS)[number], { name: Name }>;
}

export interface AimcubToolContractValidation {
  ok: boolean;
  errors: string[];
}

export function validateToolContracts(contracts: readonly AimcubToolContract[]): AimcubToolContractValidation {
  const errors: string[] = [];
  const names = new Set<string>();
  for (const tool of contracts) {
    if (names.has(tool.name)) errors.push(`duplicate tool name: ${tool.name}`);
    names.add(tool.name);
    if (!tool.description.trim()) errors.push(`${tool.name}: description is required`);
    if (tool.inputSchema.type !== "object") errors.push(`${tool.name}: inputSchema must be an object schema`);
    if (tool.outputSchema.type !== "object") errors.push(`${tool.name}: outputSchema must be an object schema`);
    if (!tool.permission.description.trim()) errors.push(`${tool.name}: permission description is required`);
    if (tool.errors.length === 0) errors.push(`${tool.name}: at least one error code is required`);
    if (tool.sourceMetadata.length === 0) errors.push(`${tool.name}: at least one source metadata kind is required`);
  }
  return { ok: errors.length === 0, errors };
}

export function assertValidToolContracts(contracts: readonly AimcubToolContract[]): void {
  const validation = validateToolContracts(contracts);
  if (!validation.ok) throw new Error(validation.errors.join("; "));
}
