/**
 * Aimcub CLI — the headless, scriptable face of `@core` (developers first; "humans are
 * agents too"). It runs the same planning loop as the desktop app over the same local
 * store, exposing the planning cognitive verbs:
 *   - plan     — one-shot draft: pipe a title through `@core`, print, store nothing.
 *   - clarify  — the full loop: draft → surface high-impact questions → (answer) → refine.
 *   - new      — quick decompose AND save (no questions).
 *   - ls/show/board/rm — saved aim surfaces over the SHARED local store.
 *   - evidence/confirm — append evidence and derive local completions.
 *   - memories/context — inspect and add the context that future planning reads.
 *   - replan   — re-decompose a saved aim via the LLM, freezing completed milestones.
 *   - edit     — hand-edit a saved aim's plan JSON (in $EDITOR or via --plan), then validate.
 *   - setup    — configure + persist the provider to settings.json (shared with the desktop).
 *   - config   — show the resolved provider + store path (API key redacted).
 *
 * No daemon, no agent-running. Provider config is read from settings.json (`aimcub setup`) with
 * `AIMCUB_*` env vars overriding it. The store is a
 * local JSON file today, behind the async `AimStore` interface so a Supabase adapter can
 * swap in later without changing these call sites. Deeper verbs (`eval`/`route`/`why`) wait
 * on the eval pillar.
 */
import { spawnSync } from "node:child_process";
import { accessSync, constants, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

import {
  extractMemoryCandidatesFromEvidence,
  planMerge,
  reviewAimLearning,
  reviewContextLineage,
  reviewContextCaptureFulfillment,
  reviewContextIntakeProgress,
  reviewContextSedimentation,
  reviewPlan,
  reviewContextHealth,
  reviewContextProfile,
  type AimIntakeReport,
  type ContextIntakeProgressSignal,
  type ContextLineageLearningReport,
  type DecompositionLearningReport,
  type DecompositionStrategyReport,
} from "@core/domain";
import {
  decomposeWithQuality,
  planQualityMetadata,
  clarify,
  buildRefinedDescription,
  traceClarifyAnswerImpact,
  buildAimIntakeReport,
  planningContextReportsFromGoals,
  recordAssumptionContextCandidatesForStore,
  recordReviewContextCandidatesForStore,
  recordSedimentationAimContextForStore,
  recordSedimentationMemoryCandidatesForStore,
  reviewDecompositionStrategyForStore,
  selectPlanningContextForStore,
  summarizeClarifyLearningForStore,
  summarizeContextCaptureLearningForStore,
  summarizeContextLineageLearningForStore,
  summarizeDecompositionLearningForStore,
  AnthropicLlmGateway,
  OpenAiCompatibleLlmGateway,
  type LlmGateway,
  type ClarifyAnswer,
  type PlanningMemory,
  type DecomposeWithQualityResult,
} from "@core/llm";
import { getDefaultModel, getLlmProviderDefinition } from "@core/llm/providers";
import { createJsonFileStore, defaultDataDir, loadSettings, saveSettings, settingsPath, type LocalStore } from "@core/store";
import type {
  ContextCategory,
  DecompositionOutput,
  Evidence,
  EvidenceKind,
  Goal,
  Memory,
  MemoryKind,
  Milestone,
  MilestoneCompletion,
} from "@core/types";

import { resolveProvider, formatConfig, buildSettingsFromInput, type SetupInput } from "./config";
import { parseAnswers, answersToIntakeSignals, answersToMemories, promptAnswers } from "./answers";
import { promptSetup } from "./setup";
import { completionScript, normalizeShell } from "./completion";
import { buildDoctorReport, formatDoctor } from "./doctor";
import { formatFirstRun, formatHome, formatPostSetupNextSteps, providerSetupComplete } from "./home";
import {
  formatBoard,
  formatPlanPretty,
  formatClarifyPretty,
  formatGoalList,
  formatGoalDetail,
  formatEvidenceList,
  formatConfirmResult,
  formatEvidenceResult,
  formatImportSummary,
  formatMemoryList,
  formatMemoryCandidateList,
  formatContext,
  formatContextProfile,
  formatAimIntake,
  formatContextHealth,
  formatClarifyLearning,
  formatContextCaptureLearning,
  formatContextLineageLearning,
  formatDecompositionLearning,
  formatDecompositionStrategy,
  formatClarifyImpact,
  formatContextCaptureFulfillment,
  formatMergeSummary,
} from "./format";

/** A user-facing error: printed without a stack trace; exit code 1. */
class UserError extends Error {}

function out(s: string): void {
  process.stdout.write(`${s}\n`);
}
function err(s: string): void {
  process.stderr.write(`${s}\n`);
}

/** True when both ends are a real terminal — the precondition for interactive prompting. */
function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

const HELP = `aimcub — Aimcub CLI: turn an aim into a verifiable plan.

Planning (prints, stores nothing):
  aimcub intake "<title>" [--desc "..."] [--json]     Check context readiness before decomposition
  aimcub plan "<title>" [--desc "..."] [--json]       Decompose an aim into milestones
  aimcub clarify "<title>" [opts]                      Draft → ask high-impact questions → refine
       [--answers <file|-|json>] [--yes] [--max N] [--save] [--json]

Stored (shared ~/.aimcub store — the desktop app sees these too):
  aimcub new "<title>" [--desc "..."] [--json]         Decompose AND save the aim
  aimcub ls [--json]                                   List saved aims
  aimcub show <id> [--json]                            Show a saved aim + milestones
  aimcub board <id> [--json]                           Show progress + evidence counts
  aimcub confirm <id> <milestone> [--summary "..."]     Append manual confirmation evidence
  aimcub evidence add <id> [opts] [--json]              Append local evidence, then evaluate
  aimcub evidence ls <id> [--json]                      List local evidence for an aim
  aimcub memories ls [--json]                           List saved context memories
  aimcub memories add "<text>" [--kind semantic] [--category preference]
                                                       Add a user-stated memory
  aimcub context [--json]                               Show grouped context used for planning
  aimcub context profile [--json]                       Show context profile coverage and gaps
  aimcub context review [--json]                        Review pending context candidates
  aimcub context learning [--json]                      Show clarify-question learning from saved aims
  aimcub context capture-learning [--json]              Show capture-contract learning from saved aims
  aimcub context lineage-learning [--json]              Show question→memory→plan lineage learning
  aimcub context decomposition-learning [--json]        Show aim decomposition learning from saved aims
  aimcub context decomposition-strategy "<title>" [--desc "..."] [--json]
                                                       Review the current aim's decomposition strategy
  aimcub context health [--json]                        Review stale/ignored planning context
  aimcub context deprioritize <id> [--confidence 0.5]    Lower an active context row's planning priority
  aimcub context archive <id>                             Archive an active context row
  aimcub context accept <id> [--text "..."] [--kind k] [--category c] [--scope aim|global]
                                                       Accept a pending context candidate
  aimcub context reject <id>                             Reject a pending context candidate
  aimcub replan <id> [--title "..."] [--desc "..."] [--json]
                                                       Re-decompose a saved aim (keeps done work)
  aimcub edit <id> [--plan <file|-|json>] [--json]     Edit a saved aim's plan ($EDITOR or --plan)
  aimcub rm <id>                                       Delete a saved aim

  aimcub setup [--provider <p>] [--api-key <k|->] [--model <m>] [--base-url <u>]
                                                       Configure + save the LLM provider (wizard)
  aimcub config [get [key] | set <key> <value> | edit] [--json]
                                                       Show/edit the resolved provider + store path
  aimcub doctor [--json]                               Check local store + provider wiring
  aimcub completion [bash|zsh|fish]                    Print shell completion script
  aimcub export [--out <file>]                         Export the local store JSON
  aimcub import <file|-|json> [--replace --yes]         Import local store JSON
  aimcub help | --help | --version

Run \`aimcub setup\` with NO flags for the interactive wizard (the key is typed hidden). With flags
each is optional; a literal --api-key <k> is recorded in your shell history — prefer the wizard,
or pipe the key: echo "$KEY" | aimcub setup --provider anthropic --api-key -

The title may be piped on stdin (use "-" or omit it): echo "ship auth" | aimcub plan -

Provider config — run \`aimcub setup\` once; it saves to ~/.aimcub/settings.json (shared with the
desktop app). Environment variables override the saved settings for one-off / CI use:
  AIMCUB_PROVIDER   anthropic | openai | deepseek | minimax | zai | google | qwen | openai-compatible
  AIMCUB_API_KEY    API key (or provider-specific vars like ANTHROPIC_API_KEY / DEEPSEEK_API_KEY)
  AIMCUB_MODEL      model id (prefilled for built-in providers)
  AIMCUB_BASE_URL   endpoint override for OpenAI-compatible providers
  AIMCUB_HOME       data dir for the shared store (default ~/.aimcub)

Examples:
  aimcub setup                                # interactive: pick provider, paste key (hidden)
  aimcub new "Build a CLI todo app with tests + CI"
  aimcub clarify "ship auth" --save           # guided: answer the forks, then save
  aimcub ls && aimcub board 1a2b
  aimcub confirm 1a2b 2 --summary "I verified this manually"
  aimcub evidence add 1a2b --milestone 2 --kind manual_check --payload '{"confirmed":true}'
  aimcub context review && aimcub context accept abcd1234
  aimcub memories add "I prefer production-ready CLI tools with tests"
  aimcub replan 1a2b --desc "now mobile-first"`;

const noopMeter = { async record(): Promise<void> {} };
const OWNER = "cli-local";
const store = createJsonFileStore(defaultDataDir());

/** The CLI's own version, read at runtime from the shipped package.json (next to dist/). */
function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      version?: string;
    };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** Read all of stdin synchronously (fd 0); "" if nothing is piped / on error. */
function readStdin(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

/**
 * Resolve a `--answers` / `--plan` value into text: "-" → stdin, a leading "[" or "{" → inline
 * JSON, otherwise a file path. Throws a friendly UserError if the file cannot be read.
 */
function loadTextArg(value: string): string {
  const s = value.trim();
  if (s === "-") return readStdin();
  if (s.startsWith("[") || s.startsWith("{")) return value;
  try {
    return readFileSync(s, "utf8");
  } catch {
    throw new UserError(`Cannot read file: ${s}`);
  }
}

/** Build a gateway from the resolved config (env over settings.json), or a friendly UserError. */
function buildGateway(): LlmGateway {
  const r = resolveProvider(process.env, loadSettings());
  if (r.provider === null) {
    throw new UserError(`Unknown provider "${r.providerLabel}". Use anthropic, openai, deepseek, minimax, zai, google, qwen, or openai-compatible.`);
  }
  if (!r.apiKey) {
    throw new UserError(`No API key for the ${r.provider} provider. Run \`aimcub setup\` to configure one.`);
  }
  const def = getLlmProviderDefinition(r.provider);
  if (!def) {
    throw new UserError(`Unknown provider "${r.providerLabel}".`);
  }
  if (def.protocol === "openai-compatible") {
    if (!r.model) {
      throw new UserError("No model for this provider. Run `aimcub setup` (or set AIMCUB_MODEL).");
    }
    return new OpenAiCompatibleLlmGateway({
      meter: noopMeter,
      ownerId: OWNER,
      apiKey: r.apiKey,
      model: r.model,
      baseURL: r.baseURL ?? undefined,
      maxTokensParam: def.maxTokensParam,
      structuredOutputMode: def.structuredOutputMode,
    });
  }
  return new AnthropicLlmGateway({
    meter: noopMeter,
    ownerId: OWNER,
    apiKey: r.apiKey,
    model: r.model ?? getDefaultModel("anthropic"),
  });
}

/** Resolve a full or unique-prefix goal id to a full id. */
async function resolveGoalId(prefix: string): Promise<string> {
  const goals = await store.listGoals();
  const exact = goals.find((g) => g.id === prefix);
  if (exact) return exact.id;
  const matches = goals.filter((g) => g.id.startsWith(prefix));
  if (matches.length === 1) return matches[0]!.id;
  if (matches.length === 0) throw new UserError(`No aim matches id "${prefix}". Try \`aimcub ls\`.`);
  throw new UserError(`Ambiguous id "${prefix}" (${matches.length} matches). Use more characters.`);
}

async function getGoalOrThrow(idPrefix: string): Promise<{ goal: Goal; milestones: Milestone[] }> {
  const id = await resolveGoalId(idPrefix);
  const got = await store.getGoal(id);
  if (!got) throw new UserError(`Aim ${id} not found.`);
  return got;
}

function resolveMilestoneRef(ref: string, milestones: Milestone[]): Milestone {
  const asIndex = Number(ref);
  if (Number.isInteger(asIndex) && asIndex >= 1 && asIndex <= milestones.length) {
    return milestones[asIndex - 1]!;
  }
  const exact = milestones.find((m) => m.id === ref);
  if (exact) return exact;
  const matches = milestones.filter((m) => m.id.startsWith(ref));
  if (matches.length === 1) return matches[0]!;
  if (matches.length === 0) throw new UserError(`No milestone matches "${ref}". Use a 1-based index or id prefix.`);
  throw new UserError(`Ambiguous milestone "${ref}" (${matches.length} matches). Use more characters.`);
}

const EVIDENCE_KINDS = new Set<EvidenceKind>([
  "git_commit",
  "pr_opened",
  "pr_merged",
  "ci_passed",
  "ci_failed",
  "mcp_report",
  "manual_check",
  "file_artifact",
  "external_event",
  "note",
]);

const MEMORY_KINDS = new Set<MemoryKind>(["episodic", "semantic", "procedural"]);
const CONTEXT_CATEGORIES = new Set<ContextCategory>([
  "preference",
  "constraint",
  "capability",
  "eval_signal",
  "project_fact",
  "procedure",
]);

function parseEvidenceKind(raw: string | undefined): EvidenceKind {
  const kind = (raw ?? "manual_check").trim();
  if (EVIDENCE_KINDS.has(kind as EvidenceKind)) return kind as EvidenceKind;
  throw new UserError(`Unknown evidence kind "${kind}".`);
}

function parseMemoryKind(raw: string | undefined): MemoryKind {
  const kind = (raw ?? "semantic").trim();
  if (MEMORY_KINDS.has(kind as MemoryKind)) return kind as MemoryKind;
  throw new UserError(`Unknown memory kind "${kind}". Use episodic, semantic, or procedural.`);
}

function parseContextCategory(raw: string | undefined): ContextCategory | undefined {
  if (raw === undefined) return undefined;
  const category = raw.trim();
  if (CONTEXT_CATEGORIES.has(category as ContextCategory)) return category as ContextCategory;
  throw new UserError(
    `Unknown context category "${category}". Use preference, constraint, capability, eval_signal, project_fact, or procedure.`,
  );
}

function parseContextScope(raw: string | undefined): "aim" | "global" | undefined {
  if (raw === undefined) return undefined;
  const scope = raw.trim();
  if (scope === "aim" || scope === "global") return scope;
  throw new UserError('Unknown context scope. Use "aim" or "global".');
}

function parsePayload(raw: string | undefined): Record<string, unknown> {
  if (raw === undefined) return {};
  const text = loadTextArg(raw);
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new UserError("--payload must be a JSON object.");
    }
    return parsed as Record<string, unknown>;
  } catch (e) {
    if (e instanceof UserError) throw e;
    throw new UserError("--payload is not valid JSON.");
  }
}

function parseTrust(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) throw new UserError("--trust must be a number from 0 to 1.");
  return n;
}

function parseConfidence(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) throw new UserError("--confidence must be a number from 0 to 1.");
  return n;
}

async function planningMemories(input: {
  title: string;
  description?: string;
  currentGoalId?: string | null;
  limit?: number;
}): Promise<PlanningMemory[]> {
  return (await planningContext(input)).memories;
}

async function planningContext(input: {
  title: string;
  description?: string;
  currentGoalId?: string | null;
  limit?: number;
}) {
  return selectPlanningContextForStore(store, input);
}

function contextIntakeArtifacts(
  intake: AimIntakeReport,
  signals: readonly ContextIntakeProgressSignal[] = [],
) {
  const intakeProgress = reviewContextIntakeProgress({
    loop: intake.loop,
    signals,
  });
  const contextSedimentation = reviewContextSedimentation({
    loop: intake.loop,
    progress: intakeProgress,
    signals,
  });
  return { intakeProgress, contextSedimentation };
}

async function clarifyLearning() {
  return summarizeClarifyLearningForStore(store);
}

async function captureLearning() {
  return summarizeContextCaptureLearningForStore(store);
}

async function contextLineageLearning(): Promise<ContextLineageLearningReport> {
  return summarizeContextLineageLearningForStore(store);
}

async function decompositionLearning(): Promise<DecompositionLearningReport> {
  return summarizeDecompositionLearningForStore(store);
}

async function decompositionStrategy(
  title: string,
  description?: string,
  learning?: DecompositionLearningReport | null,
): Promise<DecompositionStrategyReport> {
  return reviewDecompositionStrategyForStore(store, title, description, learning);
}

async function resolveMemoryCandidateId(prefix: string): Promise<string> {
  const candidates = await store.listMemoryCandidates();
  const exact = candidates.find((m) => m.id === prefix);
  if (exact) return exact.id;
  const matches = candidates.filter((m) => m.id.startsWith(prefix));
  if (matches.length === 1) return matches[0]!.id;
  if (matches.length === 0) throw new UserError(`No context candidate matches id "${prefix}". Try \`aimcub context review\`.`);
  throw new UserError(`Ambiguous context candidate "${prefix}" (${matches.length} matches). Use more characters.`);
}

async function resolveMemoryId(prefix: string): Promise<string> {
  const memories = await store.listMemories();
  const exact = memories.find((m) => m.id === prefix);
  if (exact) return exact.id;
  const matches = memories.filter((m) => m.id.startsWith(prefix));
  if (matches.length === 1) return matches[0]!.id;
  if (matches.length === 0) throw new UserError(`No active context memory matches id "${prefix}". Try \`aimcub memories ls\`.`);
  throw new UserError(`Ambiguous context memory "${prefix}" (${matches.length} matches). Use more characters.`);
}

async function recordContextCandidates(input: {
  goal: Goal;
  milestones: Milestone[];
  evidence: Evidence;
  completions: MilestoneCompletion[];
}): Promise<Memory[]> {
  const candidates = extractMemoryCandidatesFromEvidence(input);
  const saved: Memory[] = [];
  for (const candidate of candidates) {
    const memory = await store.addMemoryCandidate({
      goalId: input.goal.id,
      content: candidate.content,
      kind: candidate.kind,
      category: candidate.category,
      source: candidate.source,
      confidence: candidate.confidence,
    });
    if (memory.status === "pending") saved.push(memory);
  }
  return saved;
}

async function decomposeOrThrow(
  title: string,
  description: string | undefined,
  memories?: readonly PlanningMemory[],
  lineageLearning?: ContextLineageLearningReport | null,
  decompositionLearningReport?: DecompositionLearningReport | null,
  decompositionStrategyReport?: DecompositionStrategyReport | null,
): Promise<DecomposeWithQualityResult & { output: DecompositionOutput }> {
  const gw = buildGateway();
  const effectiveLineageLearning = lineageLearning === undefined ? await contextLineageLearning() : lineageLearning;
  const effectiveDecompositionLearning = decompositionLearningReport === undefined ? await decompositionLearning() : decompositionLearningReport;
  const effectiveDecompositionStrategy = decompositionStrategyReport === undefined
    ? await decompositionStrategy(title, description, effectiveDecompositionLearning)
    : decompositionStrategyReport;
  const res = await decomposeWithQuality(gw, {
    title,
    description,
    memories: memories ?? (await planningMemories({ title, description })),
    lineageLearning: effectiveLineageLearning,
    decompositionLearning: effectiveDecompositionLearning,
    decompositionStrategy: effectiveDecompositionStrategy,
  });
  if (!res.output) {
    throw new UserError(`Could not produce a valid plan:\n  - ${res.validation.errors.join("\n  - ")}`);
  }
  return res as DecomposeWithQualityResult & { output: DecompositionOutput };
}

/** Re-plan via the store, mapping its "not found" / invalid-plan failures to UserErrors. */
async function updateGoalOrThrow(input: {
  id: string;
  title?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  plan: DecompositionOutput;
}): Promise<{ goal: Goal; milestones: Milestone[] }> {
  let res;
  try {
    res = await store.updateGoal(input);
  } catch (e) {
    throw new UserError(e instanceof Error ? e.message : String(e));
  }
  if (!res) throw new UserError(`Aim ${input.id} not found.`);
  return res;
}

interface ClarifyOpts {
  json: boolean;
  save: boolean;
  yes: boolean;
  max: number | undefined;
  answersRaw: string | undefined;
}

async function runIntake(title: string, description: string | undefined, json: boolean): Promise<void> {
  const planning = await planningContext({ title, description });
  const intake = buildAimIntakeReport({ title, description, planning, lineageLearning: await contextLineageLearning() });
  out(json ? JSON.stringify({ intake, planningContext: planning.report }, null, 2) : formatAimIntake(intake));
}

async function runPlan(title: string, description: string | undefined, json: boolean): Promise<void> {
  const planning = await planningContext({ title, description });
  const memories = planning.memories;
  const [lineageLearning, decompositionLearningReport] = await Promise.all([contextLineageLearning(), decompositionLearning()]);
  const decompositionStrategyReport = await decompositionStrategy(title, description, decompositionLearningReport);
  const result = await decomposeOrThrow(title, description, memories, lineageLearning, decompositionLearningReport, decompositionStrategyReport);
  const qualityRetry = { retried: result.retried, attempts: result.attempts, firstQuality: result.firstQuality };
  const review = reviewPlan({ plan: result.output, context: memories, quality: result.quality });
  const intake = buildAimIntakeReport({ title, description, planning, draftReview: review, lineageLearning });
  out(
    json
      ? JSON.stringify({ plan: result.output, quality: result.quality, qualityRetry, review, intake, planningContext: planning.report, lineageLearning, decompositionLearning: decompositionLearningReport, decompositionStrategy: decompositionStrategyReport }, null, 2)
      : formatPlanPretty(result.output, result.quality ?? undefined, review, planning.report, intake),
  );
}

async function runClarify(title: string, description: string | undefined, opts: ClarifyOpts): Promise<void> {
  const gw = buildGateway();
  const planning = await planningContext({ title, description });
  const memories = planning.memories;
  const [lineageLearning, decompositionLearningReport] = await Promise.all([contextLineageLearning(), decompositionLearning()]);
  const decompositionStrategyReport = await decompositionStrategy(title, description, decompositionLearningReport);
  const draft = await decomposeWithQuality(gw, { title, description, memories, lineageLearning, decompositionLearning: decompositionLearningReport, decompositionStrategy: decompositionStrategyReport });
  if (!draft.output) {
    throw new UserError(`Could not draft a plan to clarify:\n  - ${draft.validation.errors.join("\n  - ")}`);
  }

  const [learning, captureLearningReport] = await Promise.all([clarifyLearning(), captureLearning()]);
  const draftReview = reviewPlan({ plan: draft.output, context: memories, quality: draft.quality });
  const draftIntake = buildAimIntakeReport({ title, description, planning, draftReview, lineageLearning });
  const cl = await clarify(gw, {
    title,
    description,
    draft: draft.output,
    maxQuestions: opts.max,
    memories,
    learning,
    captureLearning: captureLearningReport,
    lineageLearning,
    decompositionStrategy: decompositionStrategyReport,
    intake: draftIntake,
    review: draftReview,
  });
  const questions = cl.output?.questions ?? [];
  const assumptions = cl.output?.assumptions ?? [];
  if (!cl.output) err(`(clarify step unavailable: ${cl.validation.errors.join("; ")} — using the draft)`);

  // Gather answers: explicit --answers wins; otherwise prompt only when we can (TTY, not --yes).
  let answers: ClarifyAnswer[] = [];
  if (opts.answersRaw !== undefined) {
    try {
      answers = parseAnswers(opts.answersRaw);
    } catch (e) {
      throw new UserError(e instanceof Error ? e.message : String(e));
    }
  } else if (!opts.yes && isInteractive() && questions.length > 0) {
    answers = await promptAnswers(questions);
  }

  // Refine only when there is something to fold in; otherwise the draft stands.
  let plan = draft.output;
  let quality = draft.quality;
  let qualityRetry = { retried: draft.retried, attempts: draft.attempts, firstQuality: draft.firstQuality };
  if (answers.length > 0) {
    const refined = await decomposeWithQuality(gw, {
      title,
      description: buildRefinedDescription(description, questions, answers),
      memories,
      lineageLearning,
      decompositionLearning: decompositionLearningReport,
      decompositionStrategy: decompositionStrategyReport,
    });
    if (!refined.output) {
      throw new UserError(`Could not refine the plan:\n  - ${refined.validation.errors.join("\n  - ")}`);
    }
    plan = refined.output;
    quality = refined.quality;
    qualityRetry = { retried: refined.retried, attempts: refined.attempts, firstQuality: refined.firstQuality };
  }
  const review = reviewPlan({ plan, context: memories, quality });
  const intake = buildAimIntakeReport({ title, description, planning, draftReview: review, lineageLearning });
  const answerSignals = answersToIntakeSignals(questions, answers);
  const { intakeProgress, contextSedimentation } = contextIntakeArtifacts(intake, answerSignals);
  const answerImpact = answers.length > 0
    ? traceClarifyAnswerImpact({
        questions,
        answers,
        beforePlan: draft.output,
        afterPlan: plan,
        beforeQuality: draft.quality,
        afterQuality: quality,
      })
    : null;
  const answerMemories = answersToMemories(questions, answers);
  const captureFulfillment = reviewContextCaptureFulfillment({
    questions,
    answers,
    memories: answerMemories,
    impacts: answerImpact?.rows ?? [],
  });

  let saved: { goal: Goal; milestones: Milestone[] } | null = null;
  let contextCandidates: Memory[] = [];
  if (opts.save) {
    saved = await store.createGoal({
      title,
      description,
      plan,
      metadata: {
        ...planQualityMetadata({ quality, ...qualityRetry, output: plan }, review, {
          selectedContext: [...answerMemories, ...memories],
        }),
        aim_intake: intake,
        context_intake_progress: intakeProgress,
        context_sedimentation: contextSedimentation,
        planning_context: planning.report,
        ...(answerImpact ? { clarify_answer_impact: answerImpact } : {}),
        ...(captureFulfillment.total > 0 ? { context_capture_fulfillment: captureFulfillment } : {}),
      },
      memories: answerMemories,
    });
    contextCandidates = [
      ...(await recordSedimentationAimContextForStore(store, saved.goal, contextSedimentation)),
      ...(await recordSedimentationMemoryCandidatesForStore(store, contextSedimentation)),
      ...(await recordAssumptionContextCandidatesForStore(store, saved.goal, assumptions)),
      ...(await recordReviewContextCandidatesForStore(store, saved.goal, review)),
    ];
  }

  if (opts.json) {
    out(JSON.stringify({ questions, assumptions, plan, quality, qualityRetry, review, intake, contextIntakeProgress: intakeProgress, contextSedimentation, planningContext: planning.report, clarifyLearning: learning, captureLearning: captureLearningReport, lineageLearning, decompositionLearning: decompositionLearningReport, decompositionStrategy: decompositionStrategyReport, answerImpact, captureFulfillment, ...(saved ? { goal: saved.goal, milestones: saved.milestones, contextCandidates } : {}) }, null, 2));
    return;
  }
  // When we never refined but there were forks, surface them so the user sees what was assumed.
  if (answers.length === 0 && questions.length > 0) {
    out(formatClarifyPretty(title, { questions, assumptions }));
    out("");
  }
  if (saved) {
    out(`Created aim ${saved.goal.id}`);
    if (contextCandidates.length > 0) out(`context candidates: ${contextCandidates.length} pending`);
    out("");
  }
  if (answerImpact) {
    out(formatClarifyImpact(answerImpact));
    out("");
  }
  if (captureFulfillment.total > 0) {
    out(formatContextCaptureFulfillment(captureFulfillment));
    out("");
  }
  out(formatPlanPretty(plan, quality ?? undefined, review, planning.report, intake));
}

async function runNew(title: string, description: string | undefined, json: boolean): Promise<void> {
  const planning = await planningContext({ title, description });
  const memories = planning.memories;
  const [lineageLearning, decompositionLearningReport] = await Promise.all([contextLineageLearning(), decompositionLearning()]);
  const decompositionStrategyReport = await decompositionStrategy(title, description, decompositionLearningReport);
  const result = await decomposeOrThrow(title, description, memories, lineageLearning, decompositionLearningReport, decompositionStrategyReport);
  const qualityRetry = { retried: result.retried, attempts: result.attempts, firstQuality: result.firstQuality };
  const review = reviewPlan({ plan: result.output, context: memories, quality: result.quality });
  const intake = buildAimIntakeReport({ title, description, planning, draftReview: review, lineageLearning });
  const { intakeProgress, contextSedimentation } = contextIntakeArtifacts(intake);
  const { goal, milestones } = await store.createGoal({
    title,
    description,
    plan: result.output,
    metadata: {
      ...planQualityMetadata(result, review, { selectedContext: memories }),
      aim_intake: intake,
      context_intake_progress: intakeProgress,
      context_sedimentation: contextSedimentation,
      planning_context: planning.report,
    },
  });
  const contextCandidates = await recordReviewContextCandidatesForStore(store, goal, review);
  if (json) {
    out(JSON.stringify({ goal, milestones, quality: result.quality, qualityRetry, review, intake, contextIntakeProgress: intakeProgress, contextSedimentation, planningContext: planning.report, lineageLearning, decompositionLearning: decompositionLearningReport, decompositionStrategy: decompositionStrategyReport, contextCandidates }, null, 2));
    return;
  }
  out(`Created aim ${goal.id}`);
  if (contextCandidates.length > 0) out(`context candidates: ${contextCandidates.length} pending`);
  out("");
  out(formatPlanPretty(result.output, result.quality ?? undefined, review, planning.report, intake));
}

async function runLs(json: boolean): Promise<void> {
  const goals = await store.listGoals();
  if (json) {
    out(JSON.stringify(goals, null, 2));
    return;
  }
  // Count the materialized milestone rows (not plan_json.nodes) so `aimcub ls` agrees with
  // `aimcub show` after a replan/edit that froze or skipped a milestone. N+1 reads are fine for
  // the local single-user JSON store.
  const items = await Promise.all(
    goals.map(async (goal) => ({ goal, milestoneCount: (await store.getGoal(goal.id))?.milestones.length ?? 0 })),
  );
  out(formatGoalList(items));
}

async function runShow(idPrefix: string, json: boolean): Promise<void> {
  const got = await getGoalOrThrow(idPrefix);
  const pendingContext = await store.listMemoryCandidates(got.goal.id);
  const contextOutcomes = await store.listMemoryHistory();
  const learning = reviewAimLearning({ goal: got.goal, pendingContext, contextOutcomes });
  const lineage = reviewContextLineage({ goal: got.goal, milestones: got.milestones, pendingContext, contextOutcomes });
  out(json ? JSON.stringify({ ...got, aimLearning: learning, contextLineage: lineage }, null, 2) : formatGoalDetail(got.goal, got.milestones, learning, lineage));
}

async function runBoard(idPrefix: string, json: boolean): Promise<void> {
  const got = await getGoalOrThrow(idPrefix);
  const evidence = await store.listEvidence(got.goal.id);
  if (json) {
    out(JSON.stringify({ ...got, evidence }, null, 2));
    return;
  }
  out(formatBoard(got.goal, got.milestones, evidence));
}

async function runConfirm(
  idPrefix: string,
  milestoneRef: string | undefined,
  summary: string | undefined,
  json: boolean,
): Promise<void> {
  if (!milestoneRef) throw new UserError("Missing milestone. Usage: aimcub confirm <aim-id> <milestone>");
  const got = await getGoalOrThrow(idPrefix);
  const milestone = resolveMilestoneRef(milestoneRef, got.milestones);
  const result = await store.confirmMilestone({ goalId: got.goal.id, milestoneId: milestone.id, summary });
  if (!result) throw new UserError(`Could not confirm milestone ${milestone.id}.`);
  const memoryCandidates =
    result.evidence && !result.alreadyCompleted
      ? await recordContextCandidates({
          goal: got.goal,
          milestones: got.milestones,
          evidence: result.evidence,
          completions: result.completion ? [result.completion] : [],
        })
      : [];
  if (json) {
    out(JSON.stringify({ milestone, ...result, memoryCandidates }, null, 2));
    return;
  }
  out(formatConfirmResult(milestone, result.completion, result.alreadyCompleted, memoryCandidates.length));
}

async function runEvidence(args: {
  subcommand: string | undefined;
  idPrefix: string | undefined;
  milestoneRef: string | undefined;
  kind: string | undefined;
  summary: string | undefined;
  sourceEventId: string | undefined;
  payloadRaw: string | undefined;
  trustRaw: string | undefined;
  json: boolean;
}): Promise<void> {
  let sub = args.subcommand ?? "ls";
  let idPrefix = args.idPrefix;
  if (sub !== "add" && sub !== "report" && sub !== "ls" && idPrefix === undefined) {
    idPrefix = sub;
    sub = "ls";
  }
  if (!idPrefix) throw new UserError("Missing aim id. Usage: aimcub evidence <add|ls> <aim-id>");
  const got = await getGoalOrThrow(idPrefix);

  if (sub === "ls") {
    const evidence = await store.listEvidence(got.goal.id);
    out(args.json ? JSON.stringify(evidence, null, 2) : formatEvidenceList(evidence));
    return;
  }

  if (sub !== "add" && sub !== "report") {
    throw new UserError(`Unknown evidence command "${sub}". Use add, report, or ls.`);
  }

  const milestone = args.milestoneRef ? resolveMilestoneRef(args.milestoneRef, got.milestones) : null;
  const payload = parsePayload(args.payloadRaw);
  const kind = parseEvidenceKind(args.kind);
  if (kind === "manual_check" && Object.keys(payload).length === 0) payload.confirmed = true;
  const result = await store.addEvidence({
    goalId: got.goal.id,
    milestoneId: milestone?.id ?? null,
    kind,
    sourceEventId: args.sourceEventId ?? null,
    summary: args.summary,
    payload,
    trustScore: parseTrust(args.trustRaw),
  });
  const memoryCandidates = result.deduped
    ? []
    : await recordContextCandidates({
        goal: got.goal,
        milestones: got.milestones,
        evidence: result.evidence,
        completions: result.completions,
      });
  out(
    args.json
      ? JSON.stringify({ ...result, memoryCandidates }, null, 2)
      : formatEvidenceResult(result.evidence, result.completions, result.deduped, memoryCandidates.length),
  );
}

async function runMemories(args: {
  subcommand: string | undefined;
  text: string | undefined;
  kind: string | undefined;
  category: string | undefined;
  goalPrefix: string | undefined;
  json: boolean;
}): Promise<void> {
  const sub = args.subcommand ?? "ls";
  if (sub === "ls") {
    const goalId = args.goalPrefix ? await resolveGoalId(args.goalPrefix) : null;
    const memories = await store.listMemories(goalId);
    out(args.json ? JSON.stringify(memories, null, 2) : formatMemoryList(memories));
    return;
  }
  if (sub !== "add") throw new UserError(`Unknown memories command "${sub}". Use add or ls.`);
  if (!args.text) throw new UserError('Missing memory text. Usage: aimcub memories add "<text>"');
  const goalId = args.goalPrefix ? await resolveGoalId(args.goalPrefix) : null;
  const memory = await store.addMemory({
    content: args.text,
    kind: parseMemoryKind(args.kind),
    category: parseContextCategory(args.category),
    goalId,
    source: "user_stated",
  });
  out(args.json ? JSON.stringify(memory, null, 2) : `Remembered: ${memory.content}`);
}

async function runContext(args: {
  subcommand: string | undefined;
  idPrefix: string | undefined;
  description: string | undefined;
  text: string | undefined;
  kind: string | undefined;
  category: string | undefined;
  scope: string | undefined;
  confidence: string | undefined;
  json: boolean;
}): Promise<void> {
  const sub = args.subcommand ?? "ls";
  if (sub === "ls") {
    const memories = await store.listMemories();
    out(args.json ? JSON.stringify({ memories }, null, 2) : formatContext(memories));
    return;
  }

  if (sub === "review" || sub === "candidates") {
    const candidates = await store.listMemoryCandidates();
    out(args.json ? JSON.stringify(candidates, null, 2) : formatMemoryCandidateList(candidates));
    return;
  }

  if (sub === "profile") {
    const memories = await store.listMemories();
    const profile = reviewContextProfile({ memories });
    out(args.json ? JSON.stringify(profile, null, 2) : formatContextProfile(profile));
    return;
  }

  if (sub === "health") {
    const memories = await store.listMemories();
    const traces = planningContextReportsFromGoals(await store.listGoals());
    const rows = reviewContextHealth({ memories, traces });
    out(args.json ? JSON.stringify({ traceCount: traces.length, rows }, null, 2) : formatContextHealth(rows));
    return;
  }

  if (sub === "learning") {
    const learning = await clarifyLearning();
    out(args.json ? JSON.stringify(learning, null, 2) : formatClarifyLearning(learning));
    return;
  }

  if (sub === "capture-learning") {
    const learning = await captureLearning();
    out(args.json ? JSON.stringify(learning, null, 2) : formatContextCaptureLearning(learning));
    return;
  }

  if (sub === "lineage-learning") {
    const learning = await contextLineageLearning();
    out(args.json ? JSON.stringify(learning, null, 2) : formatContextLineageLearning(learning));
    return;
  }

  if (sub === "decomposition-learning") {
    const learning = await decompositionLearning();
    out(args.json ? JSON.stringify(learning, null, 2) : formatDecompositionLearning(learning));
    return;
  }

  if (sub === "decomposition-strategy") {
    const title = args.idPrefix?.trim();
    if (!title) throw new UserError('Missing aim title. Usage: aimcub context decomposition-strategy "<title>" [--desc "..."]');
    const learning = await decompositionLearning();
    const strategy = await decompositionStrategy(title, args.description, learning);
    out(args.json ? JSON.stringify(strategy, null, 2) : formatDecompositionStrategy(strategy));
    return;
  }

  if (sub === "accept") {
    if (!args.idPrefix) throw new UserError("Missing context candidate id. Usage: aimcub context accept <id> [--text \"...\"]");
    const id = await resolveMemoryCandidateId(args.idPrefix);
    const scope = parseContextScope(args.scope);
    const memory = await store.acceptMemoryCandidate({
      id,
      content: args.text,
      kind: args.kind ? parseMemoryKind(args.kind) : undefined,
      category: parseContextCategory(args.category),
      goalId: scope === "global" ? null : undefined,
    });
    if (!memory) throw new UserError(`Context candidate ${id} not found.`);
    out(args.json ? JSON.stringify(memory, null, 2) : `Accepted context: ${memory.content}`);
    return;
  }

  if (sub === "deprioritize") {
    if (!args.idPrefix) throw new UserError("Missing context memory id. Usage: aimcub context deprioritize <id> [--confidence 0.5]");
    const id = await resolveMemoryId(args.idPrefix);
    const memory = await store.deprioritizeMemory({ id, confidence: parseConfidence(args.confidence) });
    if (!memory) throw new UserError(`Context memory ${id} not found.`);
    out(args.json ? JSON.stringify(memory, null, 2) : `Deprioritized context: ${memory.content} (${Math.round(memory.confidence * 100)}%)`);
    return;
  }

  if (sub === "archive") {
    if (!args.idPrefix) throw new UserError("Missing context memory id. Usage: aimcub context archive <id>");
    const id = await resolveMemoryId(args.idPrefix);
    const memory = await store.archiveMemory(id);
    if (!memory) throw new UserError(`Context memory ${id} not found.`);
    out(args.json ? JSON.stringify(memory, null, 2) : `Archived context: ${memory.content}`);
    return;
  }

  if (sub === "reject") {
    if (!args.idPrefix) throw new UserError("Missing context candidate id. Usage: aimcub context reject <id>");
    const id = await resolveMemoryCandidateId(args.idPrefix);
    const memory = await store.rejectMemoryCandidate(id);
    if (!memory) throw new UserError(`Context candidate ${id} not found.`);
    out(args.json ? JSON.stringify(memory, null, 2) : `Rejected context: ${memory.content}`);
    return;
  }

  throw new UserError(`Unknown context command "${sub}". Use ls, profile, review, learning, capture-learning, lineage-learning, decomposition-learning, decomposition-strategy, health, accept, reject, deprioritize, or archive.`);
}

async function runReplan(
  idPrefix: string,
  title: string | undefined,
  description: string | undefined,
  json: boolean,
): Promise<void> {
  const id = await resolveGoalId(idPrefix);
  const got = await store.getGoal(id);
  if (!got) throw new UserError(`Aim ${id} not found.`);

  const nextTitle = title?.trim() || got.goal.title;
  const nextDescription = description ?? got.goal.description;
  const planning = await planningContext({ title: nextTitle, description: nextDescription, currentGoalId: id });
  const memories = planning.memories;
  const [lineageLearning, decompositionLearningReport] = await Promise.all([contextLineageLearning(), decompositionLearning()]);
  const decompositionStrategyReport = await decompositionStrategy(nextTitle, nextDescription, decompositionLearningReport);
  const result = await decomposeOrThrow(nextTitle, nextDescription, memories, lineageLearning, decompositionLearningReport, decompositionStrategyReport);
  const qualityRetry = { retried: result.retried, attempts: result.attempts, firstQuality: result.firstQuality };
  const review = reviewPlan({ plan: result.output, context: memories, quality: result.quality });
  const intake = buildAimIntakeReport({ title: nextTitle, description: nextDescription, planning, draftReview: review, lineageLearning });
  const { intakeProgress, contextSedimentation } = contextIntakeArtifacts(intake);
  const merged = planMerge(
    got.milestones.map((m) => ({ id: m.id, title: m.title, status: m.status })),
    result.output,
  );
  const res = await updateGoalOrThrow({
    id,
    title,
    description,
    plan: result.output,
    metadata: {
      ...planQualityMetadata(result, review, { selectedContext: memories }),
      aim_intake: intake,
      context_intake_progress: intakeProgress,
      context_sedimentation: contextSedimentation,
      planning_context: planning.report,
    },
  });
  const contextCandidates = await recordReviewContextCandidatesForStore(store, res.goal, review);

  if (json) {
    out(JSON.stringify({ goal: res.goal, milestones: res.milestones, merge: merged, quality: result.quality, qualityRetry, review, intake, contextIntakeProgress: intakeProgress, contextSedimentation, planningContext: planning.report, lineageLearning, decompositionLearning: decompositionLearningReport, decompositionStrategy: decompositionStrategyReport, contextCandidates }, null, 2));
    return;
  }
  out(formatMergeSummary(merged));
  if (result.quality) out(`quality: ${result.quality.grade} (${result.quality.score}/100)`);
  out(`intake: ${intake.readiness.replace(/_/g, "-")} (${intake.score}/100)`);
  out(`context: ${review.context.applied.length} applied · ${review.context.unapplied.length} unapplied`);
  if (contextCandidates.length > 0) out(`context candidates: ${contextCandidates.length} pending`);
  out("");
  out(formatGoalDetail(res.goal, res.milestones));
}

/**
 * Open $EDITOR on `initial`; returns the edited text, or null if the editor exited nonzero.
 * Throws a UserError if the editor binary cannot be launched (e.g. a typo'd $EDITOR / not on
 * PATH). Always removes its temp dir, on every exit path.
 */
function editViaEditor(initial: string): string | null {
  const editor = (process.env.VISUAL || process.env.EDITOR || "vi").trim();
  const [cmd, ...editorArgs] = editor.split(/\s+/);
  const dir = mkdtempSync(join(tmpdir(), "aim-edit-"));
  const file = join(dir, "plan.json");
  try {
    writeFileSync(file, initial, "utf8");
    const res = spawnSync(cmd ?? "vi", [...editorArgs, file], { stdio: "inherit" });
    // spawnSync sets `error` (e.g. ENOENT) when the binary can't be launched — distinct from
    // the editor running and exiting nonzero (a deliberate abort).
    if (res.error) throw new UserError(`Could not launch editor "${cmd ?? "vi"}": ${res.error.message}`);
    if (res.status !== 0) return null;
    return readFileSync(file, "utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function runEdit(idPrefix: string, planRaw: string | undefined, json: boolean): Promise<void> {
  const id = await resolveGoalId(idPrefix);
  const got = await store.getGoal(id);
  if (!got) throw new UserError(`Aim ${id} not found.`);
  const current = JSON.stringify(got.goal.plan_json ?? {}, null, 2);

  let edited: string;
  if (planRaw !== undefined) {
    edited = planRaw;
  } else if (isInteractive()) {
    const result = editViaEditor(current);
    if (result === null) throw new UserError("Editor exited without saving — no changes.");
    if (result.trim() === current.trim()) {
      out("No changes.");
      return;
    }
    edited = result;
  } else {
    throw new UserError("No TTY for an editor. Pass --plan <file|-|json> to set the plan non-interactively.");
  }

  let plan: DecompositionOutput;
  try {
    plan = JSON.parse(edited) as DecompositionOutput;
  } catch {
    throw new UserError("Edited plan is not valid JSON.");
  }

  const res = await updateGoalOrThrow({ id, plan });
  if (json) {
    out(JSON.stringify({ goal: res.goal, milestones: res.milestones }, null, 2));
    return;
  }
  out(`Updated aim ${res.goal.id}`);
  out("");
  out(formatGoalDetail(res.goal, res.milestones));
}

async function runRm(idPrefix: string): Promise<void> {
  const id = await resolveGoalId(idPrefix);
  await store.deleteGoal(id);
  out(`Deleted aim ${id}`);
}

function runConfig(json: boolean): void {
  const r = resolveProvider(process.env, loadSettings());
  const dataDir = defaultDataDir();
  const version = readVersion();
  if (json) {
    // Never emit the raw key — only whether one is set and where it came from.
    out(
      JSON.stringify(
        {
          version,
          provider: r.provider,
          providerLabel: r.providerLabel,
          providerSource: r.providerSource,
          model: r.model,
          modelSource: r.modelSource,
          baseURL: r.baseURL,
          baseURLSource: r.baseURLSource,
          keySet: Boolean(r.apiKey),
          keySource: r.keySource,
          store: dataDir,
          config: settingsPath(),
        },
        null,
        2,
      ),
    );
    return;
  }
  out(formatConfig(r, dataDir, version, settingsPath()));
}

function runConfigGet(key: string | undefined, json: boolean): void {
  const r = resolveProvider(process.env, loadSettings());
  const data = {
    version: readVersion(),
    provider: r.provider,
    providerLabel: r.providerLabel,
    providerSource: r.providerSource,
    model: r.model,
    modelSource: r.modelSource,
    baseURL: r.baseURL,
    baseURLSource: r.baseURLSource,
    keySet: Boolean(r.apiKey),
    keySource: r.keySource,
    store: defaultDataDir(),
    config: settingsPath(),
  };
  if (!key) {
    out(JSON.stringify(data, null, 2));
    return;
  }
  const normalized = key.replace(/_/g, "-");
  const value =
    normalized === "provider"
      ? data.provider
      : normalized === "model"
        ? data.model
        : normalized === "base-url"
          ? data.baseURL
          : normalized === "api-key"
            ? (data.keySet ? "set" : "")
            : normalized === "store"
              ? data.store
              : normalized === "config"
                ? data.config
                : normalized === "version"
                  ? data.version
                  : undefined;
  if (value === undefined) throw new UserError(`Unknown config key "${key}".`);
  out(json ? JSON.stringify({ [normalized]: value }, null, 2) : String(value ?? ""));
}

function settingsFromPartial(key: string, value: string): SetupInput {
  const current = loadSettings();
  const next: SetupInput = {
    provider: current?.provider ?? "anthropic",
    apiKey: current?.apiKey ?? "",
    model: current?.model,
    baseURL: current?.baseURL,
  };
  switch (key) {
    case "provider":
      next.provider = value;
      break;
    case "api-key":
    case "api_key":
      next.apiKey = value;
      break;
    case "model":
      next.model = value;
      break;
    case "base-url":
    case "base_url":
      next.baseURL = value;
      break;
    default:
      throw new UserError(`Unknown config key "${key}". Use provider, api-key, model, or base-url.`);
  }
  return next;
}

function runConfigSet(key: string | undefined, value: string | undefined, json: boolean): void {
  if (!key || value === undefined) throw new UserError("Usage: aimcub config set <key> <value>");
  const rawValue = value === "-" ? readStdin().trim() : value;
  const current = loadSettings();
  const result = buildSettingsFromInput(settingsFromPartial(key, rawValue), current);
  if (!result.settings) throw new UserError(`Could not save settings:\n  - ${result.errors.join("\n  - ")}`);
  saveSettings(result.settings);
  if (json) {
    out(JSON.stringify({ saved: true, config: settingsPath() }, null, 2));
    return;
  }
  out(`Saved ${key} to ${settingsPath()}`);
}

function runConfigEdit(json: boolean): void {
  const current = loadSettings() ?? { provider: "anthropic", apiKey: "", model: undefined, baseURL: undefined };
  const initial = JSON.stringify(current, null, 2);
  if (!isInteractive()) throw new UserError("No TTY for an editor. Use `aimcub setup` or `aimcub config set`.");
  const edited = editViaEditor(initial);
  if (edited === null) throw new UserError("Editor exited without saving — no changes.");
  if (edited.trim() === initial.trim()) {
    out("No changes.");
    return;
  }
  let parsed: SetupInput;
  try {
    parsed = JSON.parse(edited) as SetupInput;
  } catch {
    throw new UserError("Edited config is not valid JSON.");
  }
  const result = buildSettingsFromInput(
    {
      provider: String(parsed.provider ?? ""),
      apiKey: String(parsed.apiKey ?? ""),
      model: typeof parsed.model === "string" ? parsed.model : undefined,
      baseURL: typeof parsed.baseURL === "string" ? parsed.baseURL : undefined,
    },
    null,
  );
  if (!result.settings) throw new UserError(`Could not save settings:\n  - ${result.errors.join("\n  - ")}`);
  saveSettings(result.settings);
  out(json ? JSON.stringify({ saved: true, config: settingsPath() }, null, 2) : `Saved provider settings to ${settingsPath()}`);
}

async function runDoctor(json: boolean): Promise<number> {
  const dataDir = defaultDataDir();
  let storeReadable = true;
  let storeWritable = true;
  try {
    mkdirSync(dataDir, { recursive: true });
    accessSync(dataDir, constants.R_OK);
  } catch {
    storeReadable = false;
  }
  try {
    mkdirSync(dataDir, { recursive: true });
    accessSync(dataDir, constants.W_OK);
  } catch {
    storeWritable = false;
  }
  const goals = await store.listGoals().catch(() => []);
  const report = buildDoctorReport({
    version: readVersion(),
    dataDir,
    settingsFile: settingsPath(),
    provider: resolveProvider(process.env, loadSettings()),
    goalCount: goals.length,
    storeReadable,
    storeWritable,
  });
  out(json ? JSON.stringify(report, null, 2) : formatDoctor(report));
  return report.ok ? 0 : 1;
}

async function runHome(): Promise<void> {
  const dataDir = defaultDataDir();
  const provider = resolveProvider(process.env, loadSettings());
  if (!providerSetupComplete(provider)) {
    out(
      formatFirstRun({
        version: readVersion(),
        provider,
        dataDir,
        settingsFile: settingsPath(),
        interactive: isInteractive(),
      }),
    );
    if (isInteractive()) {
      out("");
      await runSetup({ json: false });
    }
    return;
  }

  const [goals, pendingContext] = await Promise.all([store.listGoals(), store.listMemoryCandidates()]);
  out(
    formatHome({
      version: readVersion(),
      provider,
      dataDir,
      goalCount: goals.length,
      pendingContextCount: pendingContext.length,
    }),
  );
}

async function runExport(outFile: string | undefined): Promise<void> {
  const snapshot = await store.exportData();
  const text = JSON.stringify(snapshot, null, 2);
  if (outFile) {
    writeFileSync(outFile, text, "utf8");
    out(`Exported local store to ${outFile}`);
    return;
  }
  out(text);
}

async function runImport(raw: string | undefined, replace: boolean, yes: boolean, json: boolean): Promise<void> {
  if (!raw) throw new UserError("Usage: aimcub import <file|-|json> [--replace --yes]");
  if (replace && !yes) throw new UserError("Refusing to replace the local store without --yes.");
  let snapshot: LocalStore;
  try {
    snapshot = JSON.parse(loadTextArg(raw)) as LocalStore;
  } catch {
    throw new UserError("Import input is not valid JSON.");
  }
  const result = await store.importData(snapshot, replace ? "replace" : "merge");
  out(json ? JSON.stringify(result, null, 2) : formatImportSummary(result));
}

/** `aimcub setup` — configure + persist the provider (interactive wizard, or flags). */
async function runSetup(opts: {
  provider?: string;
  apiKey?: string;
  model?: string;
  baseURL?: string;
  json: boolean;
}): Promise<void> {
  const current = loadSettings();
  const hasFlags =
    opts.provider !== undefined || opts.apiKey !== undefined || opts.model !== undefined || opts.baseURL !== undefined;

  let input: SetupInput;
  if (hasFlags) {
    // `--api-key -` reads the key from stdin so it need not appear in argv / shell history.
    const flagKey = opts.apiKey === "-" ? readStdin().trim() : opts.apiKey;
    input = {
      provider: opts.provider ?? current?.provider ?? "anthropic",
      apiKey: flagKey ?? "",
      model: opts.model,
      baseURL: opts.baseURL,
    };
  } else if (isInteractive()) {
    input = await promptSetup(current);
  } else {
    throw new UserError(
      "aimcub setup needs a terminal, or pass flags: --provider <p> --api-key <k> [--model <m>] [--base-url <u>].",
    );
  }

  const result = buildSettingsFromInput(input, current);
  if (!result.settings) {
    throw new UserError(`Could not save settings:\n  - ${result.errors.join("\n  - ")}`);
  }
  saveSettings(result.settings);

  if (opts.json) {
    out(
      JSON.stringify(
        {
          saved: true,
          provider: result.settings.provider,
          model: result.settings.model ?? null,
          baseURL: result.settings.baseURL ?? null,
          config: settingsPath(),
        },
        null,
        2,
      ),
    );
    return;
  }
  out(`Saved provider settings to ${settingsPath()}`);
  out("");
  out(formatConfig(resolveProvider(process.env, result.settings), defaultDataDir(), readVersion(), settingsPath()));
  out("");
  out(formatPostSetupNextSteps());
}

/**
 * Resolve the title argument, falling back to stdin ("-" or omitted + piped). `stdinClaimed`
 * is true when `--answers -`/`--plan -` already drained stdin — a single stdin stream can't
 * feed two consumers, so we say so plainly instead of the misleading "missing title".
 */
function resolveTitle(arg: string | undefined, stdinClaimed: boolean): string {
  if (arg && arg !== "-") return arg;
  if (arg === "-" || !process.stdin.isTTY) {
    if (stdinClaimed) {
      throw new UserError("Cannot read the title from stdin: --answers/--plan already consumed it. Pass the title as an argument or a file.");
    }
    const piped = readStdin().trim();
    if (piped) return piped;
  }
  throw new UserError("Missing aim title. Pass it as an argument or pipe it on stdin.");
}

async function main(): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: process.argv.slice(2),
      allowPositionals: true,
      options: {
        desc: { type: "string", short: "d" },
        title: { type: "string" },
        text: { type: "string" },
        answers: { type: "string" },
        plan: { type: "string" },
        max: { type: "string" },
        provider: { type: "string" },
        "api-key": { type: "string" },
        model: { type: "string" },
        "base-url": { type: "string" },
        milestone: { type: "string", short: "m" },
        kind: { type: "string" },
        category: { type: "string" },
        scope: { type: "string" },
        goal: { type: "string" },
        summary: { type: "string" },
        "source-event-id": { type: "string" },
        payload: { type: "string" },
        trust: { type: "string" },
        confidence: { type: "string" },
        out: { type: "string" },
        save: { type: "boolean" },
        yes: { type: "boolean", short: "y" },
        replace: { type: "boolean" },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
    });
  } catch (e) {
    err(e instanceof Error ? e.message : String(e));
    err("Run `aimcub --help` for usage.");
    return 2;
  }

  const { values, positionals } = parsed;
  if (values.version) {
    out(readVersion());
    return 0;
  }
  const command = positionals[0];
  if (values.help || command === "help") {
    out(HELP);
    return 0;
  }
  if (!command) {
    await runHome();
    return 0;
  }

  const arg = positionals[1];
  const description = values.desc;
  const json = Boolean(values.json);
  // A single stdin stream can't feed both the title and an --answers/--plan value.
  const stdinClaimed = values.answers?.trim() === "-" || values.plan?.trim() === "-";

  try {
    // These derive user input and may throw (bad --max, unreadable file); keep them inside the
    // catch so they surface as clean UserErrors, not a "Fatal:" crash.
    let max: number | undefined;
    if (values.max !== undefined) {
      const n = Number(values.max);
      if (!Number.isInteger(n) || n < 1) throw new UserError("--max must be a positive integer.");
      max = n;
    }
    const answersRaw = values.answers !== undefined ? loadTextArg(values.answers) : undefined;
    const planRaw = values.plan !== undefined ? loadTextArg(values.plan) : undefined;

    switch (command) {
      case "intake":
        await runIntake(resolveTitle(arg, stdinClaimed), description, json);
        return 0;
      case "plan":
        await runPlan(resolveTitle(arg, stdinClaimed), description, json);
        return 0;
      case "clarify":
        await runClarify(resolveTitle(arg, stdinClaimed), description, {
          json,
          save: Boolean(values.save),
          yes: Boolean(values.yes),
          max,
          answersRaw,
        });
        return 0;
      case "new":
        await runNew(resolveTitle(arg, stdinClaimed), description, json);
        return 0;
      case "ls":
        await runLs(json);
        return 0;
      case "show":
        if (!arg) throw new UserError("Missing aim id. Usage: aimcub show <id>");
        await runShow(arg, json);
        return 0;
      case "board":
        if (!arg) throw new UserError("Missing aim id. Usage: aimcub board <id>");
        await runBoard(arg, json);
        return 0;
      case "confirm":
        if (!arg) throw new UserError("Missing aim id. Usage: aimcub confirm <id> <milestone>");
        await runConfirm(arg, positionals[2], values.summary, json);
        return 0;
      case "evidence":
        await runEvidence({
          subcommand: positionals[1],
          idPrefix: positionals[2],
          milestoneRef: values.milestone,
          kind: values.kind,
          summary: values.summary,
          sourceEventId: values["source-event-id"],
          payloadRaw: values.payload,
          trustRaw: values.trust,
          json,
        });
        return 0;
      case "memories":
        await runMemories({
          subcommand: positionals[1],
          text: positionals[2],
          kind: values.kind,
          category: values.category,
          goalPrefix: values.goal,
          json,
        });
        return 0;
      case "context":
        await runContext({
          subcommand: positionals[1],
          idPrefix: positionals[2],
          description,
          text: values.text,
          kind: values.kind,
          category: values.category,
          scope: values.scope,
          confidence: values.confidence,
          json,
        });
        return 0;
      case "replan":
        if (!arg) throw new UserError("Missing aim id. Usage: aimcub replan <id>");
        await runReplan(arg, values.title, description, json);
        return 0;
      case "edit":
        if (!arg) throw new UserError("Missing aim id. Usage: aimcub edit <id>");
        await runEdit(arg, planRaw, json);
        return 0;
      case "rm":
        if (!arg) throw new UserError("Missing aim id. Usage: aimcub rm <id>");
        await runRm(arg);
        return 0;
      case "config":
        if (!arg) {
          runConfig(json);
        } else if (arg === "get") {
          runConfigGet(positionals[2], json);
        } else if (arg === "set") {
          runConfigSet(positionals[2], positionals[3], json);
        } else if (arg === "edit") {
          runConfigEdit(json);
        } else {
          throw new UserError(`Unknown config command "${arg}". Use get, set, or edit.`);
        }
        return 0;
      case "doctor":
        return await runDoctor(json);
      case "completion":
        out(completionScript(normalizeShell(arg ?? process.env.SHELL)));
        return 0;
      case "export":
        await runExport(values.out);
        return 0;
      case "import":
        await runImport(arg, Boolean(values.replace), Boolean(values.yes), json);
        return 0;
      case "setup":
        if (positionals.length > 1) {
          throw new UserError(
            'aimcub setup takes no positional arguments. Run `aimcub setup` for the wizard, or use flags: --provider <p> --api-key <k> [--model <m>] [--base-url <u>].',
          );
        }
        await runSetup({
          provider: values.provider,
          apiKey: values["api-key"],
          model: values.model,
          baseURL: values["base-url"],
          json,
        });
        return 0;
      default:
        err(`Unknown command "${command}". Run \`aimcub --help\` for usage.`);
        return 2;
    }
  } catch (e) {
    if (e instanceof UserError) {
      err(e.message);
      return 1;
    }
    err(`Unexpected error: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((e) => {
    err(`Fatal: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  });
