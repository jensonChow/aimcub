import { getLlmProviderDefinition } from "@aimcub/llm/providers";

import type { ResolvedProvider } from "./config";

export type SetupProblem = "unknown_provider" | "missing_api_key" | "missing_model";

export interface HomeInput {
  version: string;
  provider: ResolvedProvider;
  dataDir: string;
  goalCount: number;
  pendingContextCount: number;
}

export interface FirstRunInput {
  version: string;
  provider: ResolvedProvider;
  dataDir: string;
  settingsFile: string;
  interactive: boolean;
}

export function providerSetupProblems(provider: ResolvedProvider): SetupProblem[] {
  const problems: SetupProblem[] = [];
  if (!provider.provider) problems.push("unknown_provider");
  if (!provider.apiKey) problems.push("missing_api_key");
  const def = getLlmProviderDefinition(provider.provider);
  if (def?.protocol === "openai-compatible" && !provider.model) problems.push("missing_model");
  return problems;
}

export function providerSetupComplete(provider: ResolvedProvider): boolean {
  return providerSetupProblems(provider).length === 0;
}

function providerLabel(provider: ResolvedProvider): string {
  if (!provider.provider) return `${provider.providerLabel} (unknown)`;
  const def = getLlmProviderDefinition(provider.provider);
  if (def?.protocol === "openai-compatible" && provider.model) {
    return `${provider.provider} / ${provider.model}`;
  }
  if (provider.provider === "anthropic" && provider.model) {
    return `${provider.provider} / ${provider.model}`;
  }
  return provider.provider;
}

function setupProblemLines(provider: ResolvedProvider): string[] {
  return providerSetupProblems(provider).map((problem) => {
    if (problem === "unknown_provider") {
      return `unknown provider "${provider.providerLabel}"`;
    }
    if (problem === "missing_model") {
      return "model is required for this provider";
    }
    return "API key is missing";
  });
}

export function formatFirstRun(input: FirstRunInput): string {
  const problems = setupProblemLines(input.provider);
  const lines = [
    `aimcub ${input.version}`,
    "Aim management from the terminal.",
    "",
    "First run setup",
    "  Aimcub needs a provider before it can decompose aims.",
  ];

  if (problems.length > 0) {
    lines.push("", "Needs");
    for (const problem of problems) lines.push(`  - ${problem}`);
  }

  lines.push("", "Where this is saved", `  config: ${input.settingsFile}`, `  store:  ${input.dataDir}`);

  if (input.interactive) {
    lines.push(
      "",
      "Setup will ask for",
      "  1. Provider: anthropic, openai, deepseek, minimax, zai, google, qwen, or openai-compatible",
      "  2. Model: prefilled for built-in providers",
      "  3. API key: typed hidden, never echoed",
      "",
      "Press Ctrl-C to cancel.",
      "",
      "Starting setup...",
    );
    return lines.join("\n");
  }

  lines.push(
    "",
    "Run",
    "  aimcub setup",
    "",
    "For scripts",
    '  printf "%s\\n" "$ANTHROPIC_API_KEY" | aimcub setup --provider anthropic --api-key -',
    '  printf "%s\\n" "$DEEPSEEK_API_KEY" | aimcub setup --provider deepseek --api-key -',
    "",
    "Then",
    '  aimcub new "Ship the CLI"',
  );
  return lines.join("\n");
}

export function formatHome(input: HomeInput): string {
  const aimWord = input.goalCount === 1 ? "aim" : "aims";
  const contextWord = input.pendingContextCount === 1 ? "item" : "items";
  return [
    `aimcub ${input.version}`,
    "Aim cockpit",
    "",
    "Status",
    `  provider: ${providerLabel(input.provider)}`,
    `  aims:     ${input.goalCount} ${aimWord}`,
    `  context:  ${input.pendingContextCount} pending ${contextWord}`,
    `  store:    ${input.dataDir}`,
    "",
    "Next",
    '  aimcub new "Ship the CLI"',
    '  aimcub clarify "Ship auth" --save',
    "  aimcub ls",
    "  aimcub context review",
    "",
    "More",
    "  aimcub help",
    "  aimcub doctor",
  ].join("\n");
}

export function formatPostSetupNextSteps(): string {
  return [
    "Setup complete.",
    "",
    "Next",
    '  aimcub new "Ship the CLI"',
    '  aimcub clarify "Ship auth" --save',
    "  aimcub help",
  ].join("\n");
}
