import type { PlanRoutingValidation, RoutingRuntimeAgentOption } from "@core/domain";

import type { LocalAgentDetection } from "../../shared/ipc";

export function routingAgentsFromDetections(
  agents: readonly LocalAgentDetection[],
): RoutingRuntimeAgentOption[] {
  return agents.map((agent) => ({
    id: agent.id,
    label: agent.name,
    available: agent.available,
    authenticated: agent.authStatus !== "missing",
    models: agent.models,
    unavailableReason: agent.authMessage ?? agent.diagnostics[0] ?? null,
  }));
}

export function formatRoutingValidation(validation: PlanRoutingValidation): string {
  return validation.issues.map((issue) => `${issue.title}: ${issue.message}`).join("\n");
}
