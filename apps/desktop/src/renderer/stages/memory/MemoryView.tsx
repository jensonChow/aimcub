/**
 * Aimcub Glass — the Memory page.
 *
 * A net-new top-level surface that lists the durable memory Aimcub has accrued
 * (grouped by category, with provenance). It reads active memories through the
 * `listMemories` IPC and "Forget" reuses the existing `archiveContextMemory` path;
 * both are threaded in from App as props so this view stays render-only.
 */
import { presentContextCandidateContent } from "@aimcub/core";
import type { ContextCategory, Goal, Memory } from "@aimcub/types";

import { useI18n, type StringKey } from "../../i18n";

const CATEGORY_ORDER: ContextCategory[] = [
  "preference",
  "constraint",
  "capability",
  "eval_signal",
  "project_fact",
  "procedure",
];

const CATEGORY_KEY: Record<ContextCategory, StringKey> = {
  preference: "glass.memory.cat.preference",
  constraint: "glass.memory.cat.constraint",
  capability: "glass.memory.cat.capability",
  eval_signal: "glass.memory.cat.eval_signal",
  project_fact: "glass.memory.cat.project_fact",
  procedure: "glass.memory.cat.procedure",
};

const SOURCE_KEY: Record<Memory["source"], StringKey> = {
  agent_inferred: "glass.memory.src.agent_inferred",
  user_stated: "glass.memory.src.user_stated",
  evidence_derived: "glass.memory.src.evidence_derived",
};

export interface MemoryViewProps {
  memories: Memory[];
  goals: Goal[];
  disabled?: boolean;
  onForget: (memory: Memory) => void;
}

export function MemoryView(props: MemoryViewProps) {
  const { t } = useI18n();
  const goalTitleById = new Map(props.goals.map((goal) => [goal.id, goal.title]));

  const groups = CATEGORY_ORDER.map((category) => ({
    category,
    items: props.memories.filter((memory) => memory.category === category),
  })).filter((group) => group.items.length > 0);

  return (
    <section className="od-memory" data-od-id="memory-view" aria-label={t("glass.memory.title")}>
      <header className="od-memory-head">
        <h1 className="od-memory-title">{t("glass.memory.title")}</h1>
        <p className="od-memory-sub">{t("glass.memory.sub")}</p>
      </header>

      {groups.length === 0 ? (
        <div className="od-memory-empty">
          <div className="od-memory-empty-title">{t("glass.memory.emptyTitle")}</div>
          <p className="od-memory-empty-body">{t("glass.memory.emptyBody")}</p>
        </div>
      ) : (
        groups.map((group) => (
          <div className="od-memory-group" key={group.category}>
            <div className="od-memory-group-label">{t(CATEGORY_KEY[group.category])}</div>
            {group.items.map((memory) => {
              const scope = memory.goal_id
                ? goalTitleById.get(memory.goal_id) ?? t("glass.memory.scopeAim")
                : t("glass.memory.scopeGlobal");
              // Rows accepted before 2026-08-09 carry the machine-composed provenance
              // prefix in their stored text; presentation strips it here too.
              const content = presentContextCandidateContent(memory.content);
              return (
                <div className="od-memory-row" key={memory.id}>
                  <div className="od-memory-row-main">
                    <div className="od-memory-content">{content}</div>
                    <div className="od-memory-source">
                      {t(SOURCE_KEY[memory.source])} · {scope}
                    </div>
                  </div>
                  <button
                    className="od-memory-forget"
                    type="button"
                    disabled={props.disabled}
                    aria-label={`${t("glass.memory.forget")}: ${content}`}
                    title={t("glass.memory.forget")}
                    onClick={() => props.onForget(memory)}
                  >
                    {t("glass.memory.forget")}
                  </button>
                </div>
              );
            })}
          </div>
        ))
      )}
    </section>
  );
}
