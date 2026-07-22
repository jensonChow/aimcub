import type { PlanNodePatch, PlanNodeRoutingRecommendation, RoutingRuntimeAgentOption } from "@core/domain";
import type { DecompositionContract, PlanNode, PlanRoutingOwner } from "@core/types";

import { useDeveloperMode } from "../../developerMode";
import { useI18n } from "../../i18n";
import { decompositionOwnerLabel } from "../../labels";
import { summarizeRule } from "../../summarize";

interface PlanContractCardProps {
  node: PlanNode;
  index: number;
  nodeCount: number;
  editable: boolean;
  disabled: boolean;
  structureDisabled: boolean;
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

function selectedModelLabel(agent: RoutingRuntimeAgentOption | null, modelId: string): string | null {
  if (!modelId) return null;
  return agent?.models.find((model) => model.id === modelId)?.label ?? modelId;
}

function StructureActionIcon(props: { kind: "moveUp" | "moveDown" | "mergeUp" | "mergeDown" | "split" }) {
  if (props.kind === "moveUp") {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20" focusable="false">
        <path d="M10 15.5v-11" />
        <path d="m5.5 9 4.5-4.5L14.5 9" />
      </svg>
    );
  }
  if (props.kind === "moveDown") {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20" focusable="false">
        <path d="M10 4.5v11" />
        <path d="m5.5 11 4.5 4.5 4.5-4.5" />
      </svg>
    );
  }
  if (props.kind === "split") {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20" focusable="false">
        <path d="M10 4.5v11" />
        <path d="M5.5 7.5 10 4.5l4.5 3" />
        <path d="M5.5 12.5 10 15.5l4.5-3" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" focusable="false">
      <path d="M5 7h10" />
      <path d="M5 13h10" />
      <path d={props.kind === "mergeUp" ? "m8 10 2-2 2 2" : "m8 10 2 2 2-2"} />
    </svg>
  );
}

function StructureActionButton(props: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  kind: "moveUp" | "moveDown" | "mergeUp" | "mergeDown" | "split";
}) {
  return (
    <button
      type="button"
      className="od-plan-icon-action"
      aria-label={props.label}
      title={props.label}
      onClick={props.onClick}
      disabled={props.disabled}
    >
      <StructureActionIcon kind={props.kind} />
    </button>
  );
}

export function PlanContractCard(props: PlanContractCardProps) {
  const { t } = useI18n();
  // The acceptance rule's raw JSON is the plan's internal representation, not product copy — the
  // summarized rule above it is what a user reads. Hidden entirely unless developer mode is on.
  const developerMode = useDeveloperMode();
  const selectedOwnerLabel = props.owner === "human" ? t("os.actorHuman") : t("os.actorAgent");
  const selectedRoute = props.overrideActive ? t("routing.override") : t("routing.recommended", { owner: props.owner });
  const routeParts = props.owner === "agent"
    ? [selectedOwnerLabel, props.selectedAgent?.label ?? t("routing.noAgents"), selectedModelLabel(props.selectedAgent, props.selectedModel)]
    : [selectedOwnerLabel];
  const routeSummary = routeParts.filter(Boolean).join(" / ");
  const evidenceSummary = props.contract.required_evidence.join("; ");

  return (
    <article className={`od-plan-contract-card${props.nodeIssues.length ? " has-warning" : ""}`}>
      <div className="od-plan-contract-index">{props.index + 1}</div>
      <div className="od-plan-contract-main">
        <div className="od-plan-contract-head">
          {props.editable ? (
            <label className="od-plan-title-field">
              <span>{t("subAim.title")}</span>
              <input
                value={props.node.title}
                disabled={props.disabled}
                onChange={(event) => props.onNode({ title: event.target.value })}
              />
            </label>
          ) : (
            <div className="od-plan-readonly-title">
              <span>{t("subAim.title")}</span>
              <h3>{props.node.title}</h3>
            </div>
          )}
          <div className="od-plan-route-chips" aria-label={t("plan.selectedOwner")}>
            <span className="od-plan-route-chip">
              <strong>{routeSummary}</strong>
              <small>{selectedRoute}</small>
            </span>
            {props.nodeIssues.length ? (
              <span className="od-plan-route-chip is-warning">
                <strong>{t("routing.validationTitle")}</strong>
              </span>
            ) : null}
          </div>
        </div>

        <div className="od-plan-contract-summary" aria-label={t("plan.contract")}>
          <ContractTextRow label={t("plan.contractDone")}>{props.contract.definition_of_done}</ContractTextRow>
          <ContractTextRow label={t("plan.contractEvidence")}>{evidenceSummary}</ContractTextRow>
          <ContractTextRow label={t("routing.rationale")}>{props.recommendation.rationale}</ContractTextRow>
        </div>

        <details className="od-plan-edit-details">
          <summary>{t("plan.contractDetails")}</summary>
          {props.editable ? (
            <div className="od-plan-contract-grid">
              <label className="od-plan-field od-plan-field-wide">
                <span>{t("subAim.body")}</span>
                <textarea
                  value={props.node.description}
                  disabled={props.disabled}
                  onChange={(event) => props.onNode({ description: event.target.value })}
                  rows={2}
                />
              </label>
              <label className="od-plan-field od-plan-field-wide">
                <span>{t("plan.contractWhy")}</span>
                <textarea
                  value={props.contract.why}
                  disabled={props.disabled}
                  onChange={(event) => props.onContract({ why: event.target.value })}
                  rows={2}
                />
              </label>
              <label className="od-plan-field">
                <span>{t("plan.contractDone")}</span>
                <textarea
                  value={props.contract.definition_of_done}
                  disabled={props.disabled}
                  onChange={(event) => props.onContract({ definition_of_done: event.target.value })}
                  rows={2}
                />
              </label>
              <label className="od-plan-field">
                <span>{t("plan.contractEvidence")}</span>
                <textarea
                  value={props.contract.required_evidence.join("\n")}
                  disabled={props.disabled}
                  onChange={(event) => props.onContract({ required_evidence: event.target.value.split(/\r?\n/g) })}
                  rows={2}
                />
              </label>
              <label className="od-plan-field od-plan-field-wide">
                <span>{t("plan.contractEval")}</span>
                <textarea
                  value={props.contract.eval_signal}
                  disabled={props.disabled}
                  onChange={(event) => props.onContract({ eval_signal: event.target.value })}
                  rows={2}
                />
              </label>
            </div>
          ) : (
            <div className="od-plan-contract-review">
              {props.node.description ? <ContractTextRow label={t("subAim.body")}>{props.node.description}</ContractTextRow> : null}
              <ContractTextRow label={t("plan.contractWhy")}>{props.contract.why}</ContractTextRow>
              <ContractTextRow label={t("plan.contractEval")}>{props.contract.eval_signal}</ContractTextRow>
            </div>
          )}
        </details>

        {props.editable ? (
          <details className="od-plan-routing-details">
            <summary>{t("routing.controls")}</summary>
            <div className="od-plan-routing-context">
              <div>
                <span>{t("plan.suggestedOwner")}</span>
                <strong>{decompositionOwnerLabel(props.recommendation.likelyOwner, t)}</strong>
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
          </details>
        ) : null}

        {props.editable ? (
          <details className="od-plan-structure-details">
            <summary>{t("plan.structureActions")}</summary>
            <div className="od-plan-actions" aria-label={t("plan.structureActions")}>
              <StructureActionButton label={t("plan.moveUp")} kind="moveUp" onClick={props.onMoveUp} disabled={props.disabled || props.structureDisabled || props.index === 0} />
              <StructureActionButton label={t("plan.moveDown")} kind="moveDown" onClick={props.onMoveDown} disabled={props.disabled || props.structureDisabled || props.index >= props.nodeCount - 1} />
              <StructureActionButton label={t("plan.mergeUp")} kind="mergeUp" onClick={props.onMergeUp} disabled={props.disabled || props.structureDisabled || props.index === 0} />
              <StructureActionButton label={t("plan.mergeDown")} kind="mergeDown" onClick={props.onMergeDown} disabled={props.disabled || props.structureDisabled || props.index >= props.nodeCount - 1} />
              <StructureActionButton label={t("plan.split")} kind="split" onClick={props.onSplit} disabled={props.disabled || props.structureDisabled || props.nodeCount >= 15} />
            </div>
          </details>
        ) : null}

        {developerMode ? (
          <div className="od-plan-developer-row">
            <button
              className="od-plan-advanced-toggle"
              type="button"
              aria-expanded={props.advancedOpen}
              onClick={props.onAdvancedToggle}
            >
              {props.advancedOpen ? t("plan.hideDeveloperDetails") : t("plan.developerDetails")}
            </button>
          </div>
        ) : null}

        {developerMode && props.advancedOpen ? (
          <div className="od-plan-advanced-body">
            <RuleSummary node={props.node} />
            <div className="od-plan-field-head">
              <span>{t("plan.acceptanceRule")}</span>
              {props.editable ? (
                <button type="button" disabled={props.disabled} onClick={props.onRuleCommit}>
                  {t("plan.applyRule")}
                </button>
              ) : null}
            </div>
            {props.editable ? (
              <textarea
                aria-label={t("plan.acceptanceRule")}
                className="od-plan-rule-input"
                value={props.ruleText}
                disabled={props.disabled}
                onBlur={props.onRuleCommit}
                onChange={(event) => props.onRuleText(event.target.value)}
                rows={8}
                spellCheck={false}
              />
            ) : (
              <pre className="od-plan-rule-code" aria-label={t("plan.acceptanceRule")} tabIndex={0}>
                <code>{props.ruleText}</code>
              </pre>
            )}
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
