import type { LlmGateway } from "@aimcub/llm";
import {
  LocalCliLlmGateway,
  listLocalAgents,
  type LocalAgentDetection,
  type LocalAgentId,
} from "@aimcub/local-agent";

export interface LocalPlanningDependencies {
  listLocalAgents: () => Promise<LocalAgentDetection[]>;
  createGateway: (agentIds: readonly LocalAgentId[]) => LlmGateway;
}

const defaultDependencies: LocalPlanningDependencies = {
  listLocalAgents,
  createGateway: (agentIds) => new LocalCliLlmGateway({ agentIds }),
};

export async function localPlanningGateway(
  dependencies: LocalPlanningDependencies = defaultDependencies,
): Promise<LlmGateway | null> {
  const agents = await dependencies.listLocalAgents();
  const readyIds = agents
    .filter((agent) => agent.available && agent.authStatus === "ok")
    .map((agent) => agent.id);
  return readyIds.length > 0 ? dependencies.createGateway(readyIds) : null;
}
