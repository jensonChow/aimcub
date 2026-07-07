import type {
  AcceptanceRule as AcceptanceRuleType,
  DecompositionContract,
  PlanNode,
  PlanRoutingOverride,
  PlanRoutingOwner,
} from "@core/types";
import type { RoutingRuntimeAgentOption } from "@core/domain";

export function formatAcceptanceRule(rule: AcceptanceRuleType): string {
  return JSON.stringify(rule, null, 2);
}

export function defaultContractForNode(node: PlanNode): DecompositionContract {
  return {
    why: "This sub-aim supports the aim.",
    definition_of_done: node.description.trim() || node.title,
    required_evidence: ["Evidence that the sub-aim is complete."],
    likely_owner: "either",
    context_gaps: [],
    eval_signal: "Evidence confirms the sub-aim is complete.",
  };
}

export function editableContractForNode(node: PlanNode): DecompositionContract {
  return node.decomposition_contract ?? defaultContractForNode(node);
}

export function evidenceLines(value: string): string[] {
  const lines = value.split(/\r?\n/g).map((line) => line.trim()).filter(Boolean);
  return lines.length > 0 ? lines : ["Evidence that the sub-aim is complete."];
}

export function readyRoutingAgents(agents: readonly RoutingRuntimeAgentOption[]): RoutingRuntimeAgentOption[] {
  return agents.filter((agent) => agent.available && agent.authenticated);
}

export function findRoutingAgent(
  agents: readonly RoutingRuntimeAgentOption[],
  id: string | null | undefined,
): RoutingRuntimeAgentOption | null {
  return id ? agents.find((agent) => agent.id === id) ?? null : null;
}

export function firstModel(agent: RoutingRuntimeAgentOption | null | undefined): string | null {
  return agent?.models[0]?.id ?? null;
}

function modelLabel(agent: RoutingRuntimeAgentOption | null | undefined, modelId: string | null | undefined): string | null {
  if (!agent || !modelId) return modelId ?? null;
  return agent.models.find((model) => model.id === modelId)?.label ?? modelId;
}

export function makeRoutingOverride(input: {
  owner: PlanRoutingOwner;
  agents: readonly RoutingRuntimeAgentOption[];
  agentId?: string | null;
  model?: string | null;
}): PlanRoutingOverride {
  if (input.owner === "human") {
    return {
      owner: "human",
      agent_id: null,
      agent_label: null,
      run_mode: null,
      model: null,
      model_label: null,
      reason: "User selected the human route.",
    };
  }

  const ready = readyRoutingAgents(input.agents);
  const agent = findRoutingAgent(ready, input.agentId) ?? ready[0] ?? null;
  const selectedModel = input.model ?? firstModel(agent);
  return {
    owner: "agent",
    agent_id: agent?.id ?? input.agentId ?? null,
    agent_label: agent?.label ?? null,
    run_mode: "local_cli",
    model: selectedModel,
    model_label: modelLabel(agent, selectedModel),
    reason: "User selected the agent route.",
  };
}
