import { useState } from "react";

import {
  isPromptLikeContextCandidate,
  presentContextCandidateContent,
  recommendContextScope,
} from "@aimcub/core";
import type { Memory } from "@aimcub/types";
import type { AcceptContextCandidateRequest } from "../shared/ipc";

import { useI18n, type StringKey } from "./i18n";
import { Button, Pill, TextArea } from "./ui";

export type ContextInboxScope = "aim" | "global";

interface ContextInboxProps {
  candidates: Memory[];
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

/** Rows shown before the band asks to expand: enough to review, not a wall over the Journal. */
export const VISIBLE_CANDIDATE_LIMIT = 4;

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

export function ContextInbox({ candidates, disabled = false, onAccept, onReject }: ContextInboxProps) {
  const { t } = useI18n();
  // A draft's presence IS the row's edit mode; question-shaped rows force it open.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [scopes, setScopes] = useState<Record<string, ContextInboxScope>>({});
  const [showAll, setShowAll] = useState(false);

  if (candidates.length === 0) return null;
  const visible = showAll ? candidates : candidates.slice(0, VISIBLE_CANDIDATE_LIMIT);
  const hiddenCount = candidates.length - visible.length;

  return (
    <section className="od-context-inbox" aria-labelledby="context-inbox-title" data-od-id="context-inbox">
      <div className="od-context-inbox-head">
        <div>
          <h3 id="context-inbox-title">{t("context.inbox")}</h3>
          <p>{t("context.inboxBody")}</p>
        </div>
        <Pill>{t(candidates.length === 1 ? "context.pending_one" : "context.pending_other", { n: candidates.length })}</Pill>
      </div>

      <div className="od-context-candidate-list">
        {visible.map((candidate) => {
          // Presentation strips the legacy machine prefix, so accepting stores clean text.
          const presented = presentContextCandidateContent(candidate.content);
          const draft = drafts[candidate.id];
          const value = draft ?? presented;
          const promptLike = isPromptLikeContextCandidate(value);
          const editing = draft !== undefined || promptLike;
          const canAccept = canAcceptContextCandidateContent(value);
          const recommendedScope = recommendContextScope(candidate).scope;
          const scope = scopes[candidate.id] ?? recommendedScope;
          const provenance = [
            t(CATEGORY_KEYS[candidate.category]),
            t(SOURCE_KEYS[candidate.source]),
            candidate.created_at ? t("context.createdAt", { date: candidate.created_at.slice(0, 10) }) : "",
          ].filter(Boolean).join(" · ");
          return (
            <article key={candidate.id} className="od-context-candidate">
              {editing ? (
                <TextArea
                  aria-label={t("context.editCandidate")}
                  disabled={disabled}
                  value={value}
                  rows={3}
                  autoFocus={draft !== undefined}
                  fieldClassName="od-context-candidate-edit"
                  onChange={(event) => setDrafts((m) => ({ ...m, [candidate.id]: event.target.value }))}
                  onKeyDown={(event) => {
                    if (event.key !== "Escape") return;
                    event.preventDefault();
                    setDrafts((m) => {
                      const next = { ...m };
                      delete next[candidate.id];
                      return next;
                    });
                  }}
                />
              ) : (
                <p className="od-context-candidate-text">{presented}</p>
              )}
              {promptLike ? <p className="od-context-warning">{t("context.editRequired")}</p> : null}
              <div className="od-context-candidate-foot">
                <span className="od-context-candidate-provenance">{provenance}</span>
                <div className="od-context-candidate-controls" aria-label={t("context.scopeLabel")}>
                  {(candidate.goal_id ? (["aim", "global"] as const) : (["global"] as const)).map((nextScope) => (
                    <button
                      key={nextScope}
                      className={`od-scope-button${scope === nextScope ? " active" : ""}`}
                      type="button"
                      disabled={disabled}
                      title={t(nextScope === "global" ? "context.scopeGlobalHelp" : "context.scopeAimHelp")}
                      onClick={() => setScopes((m) => ({ ...m, [candidate.id]: nextScope }))}
                    >
                      {nextScope === "global" ? t("context.scopeGlobal") : t("context.scopeAim")}
                      {nextScope === recommendedScope ? ` ${t("context.recommended")}` : ""}
                    </button>
                  ))}
                  {!editing ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={disabled}
                      onClick={() => setDrafts((m) => ({ ...m, [candidate.id]: presented }))}
                    >
                      {t("context.edit")}
                    </Button>
                  ) : null}
                  <Button variant="ghost" size="sm" disabled={disabled} onClick={() => onReject(candidate)}>
                    {t("context.reject")}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={disabled || !canAccept}
                    onClick={() => onAccept(candidate, value, scope)}
                  >
                    {t("context.accept")}
                  </Button>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {hiddenCount > 0 ? (
        <Button
          variant="ghost"
          size="sm"
          className="od-context-show-all"
          disabled={disabled}
          onClick={() => setShowAll(true)}
        >
          {t("context.showAll", { n: candidates.length })}
        </Button>
      ) : null}
    </section>
  );
}
