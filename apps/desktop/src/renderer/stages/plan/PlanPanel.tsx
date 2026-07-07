import { useEffect, useState } from "react";

import {
  AcceptanceRule,
  mergePlanNodes,
  movePlanNode,
  routingRecommendationForPlanNode,
  splitPlanNode,
  updatePlanNode,
  validatePlanRouting,
  type PlanRoutingValidation,
  type RoutingRuntimeAgentOption,
} from "@core/domain";
import type {
  AcceptanceRule as AcceptanceRuleType,
  DecompositionContract,
  DecompositionOutput,
  PlanNode,
  PlanRoutingOverride,
  PlanRoutingOwner,
} from "@core/types";
import type { PlanResult } from "../../../shared/ipc";

import { useI18n } from "../../i18n";
import { PlanContractCard } from "./PlanContractCard";
import {
  editableContractForNode,
  evidenceLines,
  findRoutingAgent,
  firstModel,
  formatAcceptanceRule,
  makeRoutingOverride,
  readyRoutingAgents,
} from "./planContract";

export interface PlanPanelProps {
  plan: DecompositionOutput;
  quality: PlanResult["quality"] | null;
  review: PlanResult["review"] | null;
  saved: boolean;
  disabled: boolean;
  validationErrors: string[];
  routingAgents: RoutingRuntimeAgentOption[];
  routingValidation: PlanRoutingValidation | null;
  onChange?: (plan: DecompositionOutput) => void;
  onSave: () => void;
}

function StageMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="od-stage-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function PlanPanel(props: PlanPanelProps) {
  const { t } = useI18n();
  const editable = !props.saved && Boolean(props.onChange);
  const [ruleDrafts, setRuleDrafts] = useState<Record<string, string>>({});
  const [ruleErrors, setRuleErrors] = useState<Record<string, string>>({});
  const [advancedOpen, setAdvancedOpen] = useState<Record<string, boolean>>({});
  const hasRuleErrors = Object.keys(ruleErrors).length > 0;
  const validation = props.routingValidation ?? validatePlanRouting({ plan: props.plan, agents: props.routingAgents, allowHuman: true });
  const readyAgents = readyRoutingAgents(props.routingAgents);
  const issuesByNode = new Map<string, string[]>();

  for (const issue of validation.issues) {
    const rows = issuesByNode.get(issue.nodeKey) ?? [];
    rows.push(issue.message);
    issuesByNode.set(issue.nodeKey, rows);
  }

  const saveDisabled = props.disabled || hasRuleErrors || props.validationErrors.length > 0 || !validation.ok;

  useEffect(() => {
    const keys = new Set(props.plan.nodes.map((node) => node.key));
    setRuleDrafts((current) => {
      const next: Record<string, string> = {};
      for (const node of props.plan.nodes) {
        next[node.key] = current[node.key] ?? formatAcceptanceRule(node.acceptance_rule);
      }
      return next;
    });
    setRuleErrors((current) => {
      const next: Record<string, string> = {};
      for (const [key, value] of Object.entries(current)) {
        if (keys.has(key)) next[key] = value;
      }
      return next;
    });
    setAdvancedOpen((current) => {
      const next: Record<string, boolean> = {};
      for (const [key, value] of Object.entries(current)) {
        if (keys.has(key)) next[key] = value;
      }
      return next;
    });
  }, [props.plan.nodes]);

  function apply(nextPlan: DecompositionOutput) {
    props.onChange?.(nextPlan);
  }

  function applyStructureEdit(nextPlan: DecompositionOutput) {
    setRuleDrafts({});
    setRuleErrors({});
    setAdvancedOpen({});
    apply(nextPlan);
  }

  function updateNode(node: PlanNode, patch: Parameters<typeof updatePlanNode>[2]) {
    apply(updatePlanNode(props.plan, node.key, patch));
  }

  function updateContract(node: PlanNode, patch: Partial<DecompositionContract>) {
    updateNode(node, {
      decomposition_contract: {
        ...editableContractForNode(node),
        ...patch,
        ...(patch.required_evidence ? { required_evidence: evidenceLines(patch.required_evidence.join("\n")) } : {}),
      },
    });
  }

  function ruleTextFor(node: PlanNode): string {
    return ruleDrafts[node.key] ?? formatAcceptanceRule(node.acceptance_rule);
  }

  function parseRuleText(text: string): AcceptanceRuleType | string {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
    const parsed = AcceptanceRule.safeParse(value);
    if (!parsed.success) {
      return parsed.error.issues.map((issue) => `${issue.path.join(".") || "rule"}: ${issue.message}`).join("; ");
    }
    return parsed.data;
  }

  function applyRuleText(node: PlanNode, text: string) {
    const parsed = parseRuleText(text);
    if (typeof parsed === "string") {
      setRuleErrors((current) => ({ ...current, [node.key]: t("plan.ruleInvalid", { error: parsed }) }));
      return;
    }
    setRuleErrors((current) => {
      const next = { ...current };
      delete next[node.key];
      return next;
    });
    updateNode(node, { acceptance_rule: parsed });
  }

  function commitRule(node: PlanNode) {
    applyRuleText(node, ruleTextFor(node));
  }

  function applyOverride(node: PlanNode, override: PlanRoutingOverride | null) {
    apply(updatePlanNode(props.plan, node.key, { routing_override: override }));
  }

  function chooseOwner(node: PlanNode, owner: PlanRoutingOwner) {
    applyOverride(node, makeRoutingOverride({ owner, agents: props.routingAgents }));
  }

  function chooseAgent(node: PlanNode, agentId: string) {
    const current = node.routing_override;
    const agent = findRoutingAgent(props.routingAgents, agentId);
    applyOverride(node, makeRoutingOverride({
      owner: "agent",
      agents: props.routingAgents,
      agentId,
      model: agent?.models.some((model) => model.id === current?.model) ? current?.model : firstModel(agent),
    }));
  }

  function chooseModel(node: PlanNode, model: string) {
    const currentAgentId = node.routing_override?.agent_id ?? readyAgents[0]?.id ?? null;
    applyOverride(node, makeRoutingOverride({
      owner: "agent",
      agents: props.routingAgents,
      agentId: currentAgentId,
      model,
    }));
  }

  return (
    <section className="od-stage-panel od-plan-editor">
      <div className="od-stage-panel-head">
        <div>
          <div className="od-stage-kicker">{t("os.stepPlan")}</div>
          <h2>{t("os.planHeading")}</h2>
          <p>{editable ? t("plan.editBody") : t("plan.reviewBody")}</p>
        </div>
        {!props.saved ? (
          <button className="od-aim-primary" type="button" onClick={props.onSave} disabled={saveDisabled}>
            {t("os.saveAim")}
          </button>
        ) : null}
      </div>

      <div className="od-stage-metrics">
        <StageMetric label={t("os.metricSubAims")} value={String(props.plan.nodes.length)} />
        <StageMetric label={t("os.metricQuality")} value={props.quality ? `${props.quality.grade} - ${props.quality.score}` : "-"} />
        <StageMetric label={t("os.metricActions")} value={String(props.review?.actions.length ?? 0)} />
      </div>

      {props.validationErrors.length > 0 ? (
        <div className="od-plan-validation" role="status">
          <strong>{t("plan.validationIssues")}</strong>
          <span>{props.validationErrors.join("; ")}</span>
        </div>
      ) : null}

      {!validation.ok ? (
        <div className="od-routing-alert">
          <strong>{t("routing.validationTitle")}</strong>
          <span>{validation.issues[0]?.message ?? t("routing.validationBody")}</span>
        </div>
      ) : null}

      <div className="od-plan-list">
        {props.plan.nodes.map((node, index) => {
          const contract = editableContractForNode(node);
          const recommendation = routingRecommendationForPlanNode(node);
          const override = node.routing_override;
          const owner = override?.owner ?? recommendation.recommendedOwner;
          const selectedAgent = findRoutingAgent(props.routingAgents, override?.agent_id) ?? readyAgents[0] ?? null;
          const selectedModel = override?.model ?? firstModel(selectedAgent) ?? "";
          const nodeIssues = issuesByNode.get(node.key) ?? [];

          return (
            <PlanContractCard
              key={node.key}
              node={node}
              index={index}
              nodeCount={props.plan.nodes.length}
              editable={editable}
              disabled={props.disabled}
              contract={contract}
              recommendation={recommendation}
              owner={owner}
              selectedAgent={selectedAgent}
              selectedModel={selectedModel}
              readyAgents={readyAgents}
              nodeIssues={nodeIssues}
              overrideActive={Boolean(override)}
              ruleText={ruleTextFor(node)}
              ruleError={ruleErrors[node.key]}
              advancedOpen={Boolean(advancedOpen[node.key])}
              onNode={(patch) => updateNode(node, patch)}
              onContract={(patch) => updateContract(node, patch)}
              onMoveUp={() => applyStructureEdit(movePlanNode(props.plan, node.key, index - 1))}
              onMoveDown={() => applyStructureEdit(movePlanNode(props.plan, node.key, index + 1))}
              onMergeUp={() => applyStructureEdit(mergePlanNodes(props.plan, props.plan.nodes[index - 1]!.key, node.key))}
              onMergeDown={() => applyStructureEdit(mergePlanNodes(props.plan, node.key, props.plan.nodes[index + 1]!.key))}
              onSplit={() => applyStructureEdit(splitPlanNode(props.plan, node.key))}
              onOwner={(nextOwner) => chooseOwner(node, nextOwner)}
              onAgent={(agentId) => chooseAgent(node, agentId)}
              onModel={(model) => chooseModel(node, model)}
              onRoutingReset={() => applyOverride(node, null)}
              onAdvancedToggle={() => setAdvancedOpen((current) => ({ ...current, [node.key]: !current[node.key] }))}
              onRuleText={(text) => {
                setRuleDrafts((current) => ({ ...current, [node.key]: text }));
                applyRuleText(node, text);
              }}
              onRuleCommit={() => commitRule(node)}
            />
          );
        })}
      </div>
    </section>
  );
}
