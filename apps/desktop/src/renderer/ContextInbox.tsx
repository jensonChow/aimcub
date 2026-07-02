import { useState } from "react";

import { isPromptLikeContextCandidate, recommendContextScope } from "@core/domain";
import type { Memory } from "@core/types";

import { useI18n } from "./i18n";
import { C, card, inputStyle, primaryButton, scopeButton, secondaryButton } from "./styles";

interface ContextInboxProps {
  candidates: Memory[];
  onAccept: (candidate: Memory, content: string, scope: "aim" | "global") => void;
  onReject: (candidate: Memory) => void;
}

export function ContextInbox({ candidates, onAccept, onReject }: ContextInboxProps) {
  const { t } = useI18n();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [scopes, setScopes] = useState<Record<string, "aim" | "global">>({});

  if (candidates.length === 0) return null;

  return (
    <section style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>{t("context.inbox")}</h2>
        <span style={{ color: C.muted, fontSize: 12 }}>
          {t(candidates.length === 1 ? "context.pending_one" : "context.pending_other", { n: candidates.length })}
        </span>
      </div>

      {candidates.map((candidate) => {
        const value = edits[candidate.id] ?? candidate.content;
        const editRequired = isPromptLikeContextCandidate(value);
        const recommendedScope = recommendContextScope(candidate).scope;
        const scope = scopes[candidate.id] ?? recommendedScope;
        const confidence = Number.isFinite(candidate.confidence) ? `${Math.round(candidate.confidence * 100)}%` : "";
        const scopeLabel = scope === "global" ? t("context.scopeGlobal") : t("context.scopeAim");
        const meta = [candidate.category, candidate.source, scopeLabel, confidence].filter(Boolean).join(" · ");
        return (
          <div key={candidate.id} style={{ ...card(), background: "#fbfaf7" }}>
            <div style={{ color: C.muted, fontSize: 12, marginBottom: 8 }}>{meta}</div>
            <textarea
              value={value}
              onChange={(e) => setEdits((m) => ({ ...m, [candidate.id]: e.target.value }))}
              rows={3}
              style={{ ...inputStyle(), resize: "vertical", fontSize: 13 }}
            />
            {editRequired ? (
              <div style={{ color: "#8a5a10", fontSize: 12, marginTop: 8 }}>
                {t("context.editRequired")}
              </div>
            ) : null}
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              {(candidate.goal_id ? (["aim", "global"] as const) : (["global"] as const)).map((nextScope) => (
                <button
                  key={nextScope}
                  onClick={() => setScopes((m) => ({ ...m, [candidate.id]: nextScope }))}
                  style={scopeButton(scope === nextScope)}
                >
                  {nextScope === "global" ? t("context.scopeGlobal") : t("context.scopeAim")}
                  {nextScope === recommendedScope ? ` ${t("context.recommended")}` : ""}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <button
                onClick={() => onAccept(candidate, value, scope)}
                disabled={!value.trim() || editRequired}
                style={{ ...primaryButton(!value.trim() || editRequired), marginTop: 0 }}
              >
                {t("context.accept")}
              </button>
              <button onClick={() => onReject(candidate)} style={{ ...secondaryButton(), marginTop: 0 }}>{t("context.reject")}</button>
            </div>
          </div>
        );
      })}
    </section>
  );
}
