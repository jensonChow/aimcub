import type { PlanNodePatch, PlanNodeRoutingRecommendation, RoutingRuntimeAgentOption } from "@core/domain";
import type { DecompositionContract, PlanNode, PlanRoutingOwner } from "@core/types";

import { useI18n } from "../../i18n";
import { decompositionOwnerLabel } from "../../labels";
import { summarizeRule } from "../../summarize";

interface PlanContractCardProps {
  node: PlanNode;
  index: number;
  nodeCount: number;
  editable: boolean;
  disabled: boolean;
  contract: DecompositionContract;
  recommendation: PlanNodeRoutingRecommendation;
  owner: PlanRoutingOwner;
  selectedAgent: RoutingRuntimeAgentOption | null;
  selectedModel: string;
  readyAgents: RoutingRuntimeAgentOption[];
  nodeIssues: string[];
  overrideActive: boolean;
  ruleText: string;
  ruleError?: string;
  advancedOpen: boolean;
  onNode: (patch: PlanNodePatch) => void;
  onContract: (patch: Partial<DecompositionContract>) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onMergeUp: () => void;
  onMergeDown: () => void;
  onSplit: () => void;
  onOwner: (owner: PlanRoutingOwner) => void;
  onAgent: (agentId: string) => void;
  onModel: (model: string) => void;
  onRoutingReset: () => void;
  onAdvancedToggle: () => void;
  onRuleText: (text: string) => void;
  onRuleCommit: () => void;
}

function ContractTextRow({ label, children }: { label: string; children: string }) {
  return (
    <div className="od-contract-text-row">
      <span>{label}</span>
      <p>{children}</p>
    </div>
  );
}

function RuleSummary({ node }: { node: PlanNode }) {
  const { t } = useI18n();
  return (
    <div className="od-plan-rule-summary">
      <div>
        <span>{t("plan.acceptanceSummary")}</span>
        <strong>{summarizeRule(node.acceptance_rule)}</strong>
      </div>
    </div>
  );
}

export function PlanContractCard(props: PlanContractCardProps) {
  const { t } = useI18n();
  const selectedOwnerLabel = props.owner === "human" ? t("os.actorHuman") : t("os.actorAgent");
  const selectedRoute = props.overrideActive ? t("routing.override") : t("routing.recommended", { owner: props.owner });

  return (
    <article className={`od-plan-contract-card${props.nodeIssues.length ? " has-warning" : ""}`}>
      <div className="od-plan-contract-index">{props.index + 1}</div>
      <div className="od-plan-contract-main">
        <div className="od-plan-contract-head">
          {props.editable ? (
            <label className="od-plan-title-field">
              <span>{t("subAim.title")}</span>
              <input value={props.node.title} onChange={(event) => props.onNode({ title: event.target.value })} />
            </label>
          ) : (
            <div className="od-plan-readonly-title">
              <span>{t("subAim.title")}</span>
              <h3>{props.node.title}</h3>
            </div>
          )}
        </div>

        {props.editable ? (
          <div className="od-plan-contract-grid">
            <label className="od-plan-field od-plan-field-wide">
              <span>{t("subAim.body")}</span>
              <textarea
                value={props.node.description}
                onChange={(event) => props.onNode({ description: event.target.value })}
                rows={2}
              />
            </label>
            <label className="od-plan-field od-plan-field-wide">
              <span>{t("plan.contractWhy")}</span>
              <textarea
                value={props.contract.why}
                onChange={(event) => props.onContract({ why: event.target.value })}
                rows={2}
              />
            </label>
            <label className="od-plan-field">
              <span>{t("plan.contractDone")}</span>
              <textarea
                value={props.contract.definition_of_done}
                onChange={(event) => props.onContract({ definition_of_done: event.target.value })}
                rows={2}
              />
            </label>
            <label className="od-plan-field">
              <span>{t("plan.contractEvidence")}</span>
              <textarea
                value={props.contract.required_evidence.join("\n")}
                onChange={(event) => props.onContract({ required_evidence: event.target.value.split(/\r?\n/g) })}
                rows={2}
              />
            </label>
            <label className="od-plan-field od-plan-field-wide">
              <span>{t("plan.contractEval")}</span>
              <textarea
                value={props.contract.eval_signal}
                onChange={(event) => props.onContract({ eval_signal: event.target.value })}
                rows={2}
              />
            </label>
          </div>
        ) : (
          <div className="od-plan-contract-review">
            {props.node.description ? <ContractTextRow label={t("subAim.body")}>{props.node.description}</ContractTextRow> : null}
            <ContractTextRow label={t("plan.contractWhy")}>{props.contract.why}</ContractTextRow>
            <ContractTextRow label={t("plan.contractDone")}>{props.contract.definition_of_done}</ContractTextRow>
            <ContractTextRow label={t("plan.contractEvidence")}>{props.contract.required_evidence.join("; ")}</ContractTextRow>
            <ContractTextRow label={t("plan.contractEval")}>{props.contract.eval_signal}</ContractTextRow>
          </div>
        )}

        <div className="od-plan-routing-summary">
          <div>
            <span>{t("plan.suggestedOwner")}</span>
            <strong>{decompositionOwnerLabel(props.recommendation.likelyOwner, t)}</strong>
          </div>
          <div>
            <span>{t("plan.selectedOwner")}</span>
            <strong>{selectedOwnerLabel}</strong>
            <small>{selectedRoute}</small>
          </div>
          <div>
            <span>{t("routing.rationale")}</span>
            <p>{props.recommendation.rationale}</p>
          </div>
        </div>

        <div className="od-routing-controls" aria-label={t("routing.controls")}>
          <div className="od-routing-owner" role="group" aria-label={t("routing.owner")}>
            <button
              type="button"
              className={props.owner === "human" ? "active" : ""}
              disabled={!props.editable || props.disabled}
              onClick={() => props.onOwner("human")}
            >
              {t("os.actorHuman")}
            </button>
            <button
              type="button"
              className={props.owner === "agent" ? "active" : ""}
              disabled={!props.editable || props.disabled}
              onClick={() => props.onOwner("agent")}
            >
              {t("os.actorAgent")}
            </button>
          </div>

          {props.owner === "agent" ? (
            <div className="od-routing-selects">
              <label>
                <span>{t("routing.agent")}</span>
                <select
                  value={props.selectedAgent?.id ?? ""}
                  disabled={!props.editable || props.disabled || props.readyAgents.length === 0}
                  onChange={(event) => props.onAgent(event.target.value)}
                >
                  {props.readyAgents.length === 0 ? <option value="">{t("routing.noAgents")}</option> : null}
                  {props.readyAgents.map((agent) => (
                    <option key={agent.id} value={agent.id}>{agent.label}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>{t("routing.model")}</span>
                <select
                  value={props.selectedModel}
                  disabled={!props.editable || props.disabled || !props.selectedAgent || props.selectedAgent.models.length === 0}
                  onChange={(event) => props.onModel(event.target.value)}
                >
                  {props.selectedAgent?.models.length ? props.selectedAgent.models.map((model) => (
                    <option key={model.id} value={model.id}>{model.label ?? model.id}</option>
                  )) : <option value="">{t("routing.noModels")}</option>}
                </select>
              </label>
            </div>
          ) : null}

          {props.overrideActive && props.editable ? (
            <button
              className="od-routing-reset"
              type="button"
              disabled={props.disabled}
              onClick={props.onRoutingReset}
            >
              {t("routing.useRecommendation")}
            </button>
          ) : null}
        </div>

        {props.editable ? (
          <details className="od-plan-structure-details">
            <summary>{t("plan.structureActions")}</summary>
            <div className="od-plan-actions" aria-label={t("plan.structureActions")}>
              <button type="button" onClick={props.onMoveUp} disabled={props.index === 0}>
                {t("plan.moveUp")}
              </button>
              <button type="button" onClick={props.onMoveDown} disabled={props.index >= props.nodeCount - 1}>
                {t("plan.moveDown")}
              </button>
              <button type="button" onClick={props.onMergeUp} disabled={props.index === 0}>
                {t("plan.mergeUp")}
              </button>
              <button type="button" onClick={props.onMergeDown} disabled={props.index >= props.nodeCount - 1}>
                {t("plan.mergeDown")}
              </button>
              <button type="button" onClick={props.onSplit} disabled={props.nodeCount >= 15}>
                {t("plan.split")}
              </button>
            </div>
          </details>
        ) : null}

        <div className="od-plan-developer-row">
          <RuleSummary node={props.node} />
          <button
            className="od-plan-advanced-toggle"
            type="button"
            aria-expanded={props.advancedOpen}
            onClick={props.onAdvancedToggle}
          >
            {props.advancedOpen ? t("plan.hideDeveloperDetails") : t("plan.developerDetails")}
          </button>
        </div>

        {props.advancedOpen ? (
          <div className="od-plan-advanced-body">
            <div className="od-plan-field-head">
              <span>{t("plan.acceptanceRule")}</span>
              <button type="button" onClick={props.onRuleCommit}>
                {t("plan.applyRule")}
              </button>
            </div>
            <textarea
              aria-label={t("plan.acceptanceRule")}
              className="od-plan-rule-input"
              value={props.ruleText}
              onBlur={props.onRuleCommit}
              onChange={(event) => props.onRuleText(event.target.value)}
              rows={8}
              spellCheck={false}
            />
            {props.ruleError ? <small className="od-plan-error">{props.ruleError}</small> : null}
          </div>
        ) : null}

        {props.nodeIssues.length ? (
          <div className="od-routing-issue">{props.nodeIssues[0]}</div>
        ) : null}
      </div>
    </article>
  );
}
