import { getLlmProviderDefinition } from "@aimcub/llm/providers";

import type { ResolvedProvider } from "./config";

export type DoctorLevel = "ok" | "warn" | "error";

export interface DoctorCheck {
  name: string;
  level: DoctorLevel;
  message: string;
}

export interface DoctorInput {
  version: string;
  dataDir: string;
  settingsFile: string;
  provider: ResolvedProvider;
  goalCount: number;
  storeReadable: boolean;
  storeWritable: boolean;
}

export interface DoctorReport {
  ok: boolean;
  checks: DoctorCheck[];
}

export function buildDoctorReport(input: DoctorInput): DoctorReport {
  const checks: DoctorCheck[] = [
    { name: "cli", level: "ok", message: `aimcub ${input.version}` },
    {
      name: "store",
      level: input.storeReadable && input.storeWritable ? "ok" : "error",
      message:
        input.storeReadable && input.storeWritable
          ? `${input.dataDir} (${input.goalCount} aim${input.goalCount === 1 ? "" : "s"})`
          : `${input.dataDir} is not readable/writable`,
    },
    {
      name: "config",
      level: input.provider.provider ? "ok" : "error",
      message: input.provider.provider
        ? `${input.provider.provider} (${input.settingsFile})`
        : `unknown provider "${input.provider.providerLabel}"`,
    },
  ];

  if (!input.provider.apiKey) {
    checks.push({
      name: "provider-key",
      level: "warn",
      message: "No API key configured; planning commands will fail until `aimcub setup` runs.",
    });
  } else {
    checks.push({ name: "provider-key", level: "ok", message: `key from ${input.provider.keySource}` });
  }

  const def = getLlmProviderDefinition(input.provider.provider);
  if (def?.protocol === "openai-compatible" && !input.provider.model) {
    checks.push({
      name: "provider-model",
      level: "error",
      message: "This provider requires a model (`aimcub setup` or `aimcub config set model <id>`).",
    });
  } else if (def?.protocol === "openai-compatible") {
    checks.push({ name: "provider-model", level: "ok", message: input.provider.model ?? "" });
  }

  return { ok: checks.every((c) => c.level !== "error"), checks };
}

export function formatDoctor(report: DoctorReport): string {
  const mark: Record<DoctorLevel, string> = { ok: "ok", warn: "warn", error: "error" };
  return report.checks.map((c) => `${mark[c.level]}  ${c.name}: ${c.message}`).join("\n");
}
