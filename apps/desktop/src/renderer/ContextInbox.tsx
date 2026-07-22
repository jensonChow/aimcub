import { useState } from "react";

import { isPromptLikeContextCandidate, recommendContextScope } from "@aimcub/core";
import type { Memory } from "@aimcub/types";
import type { AcceptContextCandidateRequest } from "../shared/ipc";

import { useI18n, type StringKey } from "./i18n";

export type ContextInboxScope = "aim" | "global";

interface ContextInboxProps {
  candidates: Memory[];
  currentAimTitle?: string;
  disabled?: boolean;
  onAccept: (candidate: Memory, content: string, scope: ContextInboxScope) => void;
  onReject: (candidate: Memory) => void;
}

const CATEGORY_KEYS: Record<Memory["category"], StringKey> = {
  capability: "context.category.capability",
  constraint: "context.category.constraint",
  eval_signal: "context.category.evalSignal",
  preference: "context.category.preference",
  procedure: "context.category.procedure",
  project_fact: "context.category.projectFact",
};

const SOURCE_KEYS: Record<Memory["source"], StringKey> = {
  agent_inferred: "context.memorySource.agentInferred",
  evidence_derived: "context.memorySource.evidenceDerived",
  user_stated: "context.memorySource.userStated",
};

function shortId(value: string): string {
  return value.length <= 8 ? value : value.slice(0, 8);
}

export function canAcceptContextCandidateContent(content: string): boolean {
  return content.trim().length > 0 && !isPromptLikeContextCandidate(content);
}

export function buildContextCandidateAcceptRequest(
  candidate: Memory,
  content: string,
  scope: ContextInboxScope,
): AcceptContextCandidateRequest {
  return {
    id: candidate.id,
    content,
    scope,
  };
}

export function ContextInbox({ candidates, currentAimTitle, disabled = false, onAccept, onReject }: ContextInboxProps) {
  const { t } = useI18n();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [scopes, setScopes] = useState<Record<string, ContextInboxScope>>({});

  if (candidates.length === 0) return null;

  return (
    <section className="od-context-inbox" aria-labelledby="context-inbox-title">
      <div className="od-context-inbox-head">
        <div>
          <h3 id="context-inbox-title">{t("context.inbox")}</h3>
          <p>{t("context.inboxBody")}</p>
        </div>
        <span className="od-pill">{t(candidates.length === 1 ? "context.pending_one" : "context.pending_other", { n: candidates.length })}</span>
      </div>

      <div className="od-context-candidate-list">
        {candidates.map((candidate) => {
          const value = edits[candidate.id] ?? candidate.content;
          const editRequired = isPromptLikeContextCandidate(value);
          const canAccept = canAcceptContextCandidateContent(value);
          const recommendedScope = recommendContextScope(candidate).scope;
          const scope = scopes[candidate.id] ?? recommendedScope;
          const source = t(SOURCE_KEYS[candidate.source]);
          const category = t(CATEGORY_KEYS[candidate.category]);
          const origin = candidate.goal_id
            ? t("context.originAim", { aim: currentAimTitle || shortId(candidate.goal_id) })
            : t("context.originGlobal");
          const confidence = Number.isFinite(candidate.confidence)
            ? t("context.confidence", { n: Math.round(candidate.confidence * 100) })
            : "";
          const created = candidate.created_at ? t("context.createdAt", { date: candidate.created_at.slice(0, 10) }) : "";
          const meta = [origin, category, source, confidence, created, t("context.candidateId", { id: shortId(candidate.id) })].filter(Boolean);
          return (
            <article key={candidate.id} className="od-context-candidate">
              <div className="od-context-candidate-meta">
                {meta.map((item) => <span key={item}>{item}</span>)}
              </div>
              <textarea
                aria-label={t("context.editCandidate")}
                disabled={disabled}
                value={value}
                onChange={(e) => setEdits((m) => ({ ...m, [candidate.id]: e.target.value }))}
                rows={4}
              />
              {editRequired ? (
                <div className="od-context-warning">{t("context.editRequired")}</div>
              ) : null}
              <div className="od-context-scope-row" aria-label={t("context.scopeLabel")}>
                {(candidate.goal_id ? (["aim", "global"] as const) : (["global"] as const)).map((nextScope) => (
                  <button
                    key={nextScope}
                    className={`od-scope-button${scope === nextScope ? " active" : ""}`}
                    type="button"
                    disabled={disabled}
                    onClick={() => setScopes((m) => ({ ...m, [candidate.id]: nextScope }))}
                  >
                    {nextScope === "global" ? t("context.scopeGlobal") : t("context.scopeAim")}
                    {nextScope === recommendedScope ? ` ${t("context.recommended")}` : ""}
                  </button>
                ))}
              </div>
              <p className="od-context-scope-help">
                {t(scope === "global" ? "context.scopeGlobalHelp" : "context.scopeAimHelp")}
              </p>
              <div className="od-context-actions">
                <button
                  className="od-aim-primary"
                  type="button"
                  onClick={() => onAccept(candidate, value, scope)}
                  disabled={disabled || !canAccept}
                >
                  {t("context.accept")}
                </button>
                <button className="od-aim-secondary" type="button" disabled={disabled} onClick={() => onReject(candidate)}>
                  {t("context.reject")}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
