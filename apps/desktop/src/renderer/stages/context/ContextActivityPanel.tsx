import { useI18n, type I18n } from "../../i18n";
import type { ContextActivityState, ContextLoopMessage, ContextLoopModel } from "./contextLoop";

interface ContextActivityPanelProps {
  model: ContextLoopModel;
}

function renderMessage(t: I18n["t"], message: ContextLoopMessage): string {
  return t(message.key, message.vars);
}

function stateLabelKey(state: ContextActivityState) {
  switch (state) {
    case "active":
      return "context.activity.status.active";
    case "complete":
      return "context.activity.status.complete";
    case "blocked":
      return "context.activity.status.blocked";
    case "waiting":
      return "context.activity.status.waiting";
    case "idle":
      return "context.activity.status.idle";
  }
}

function levelLabelKey(level: ContextLoopModel["sufficiency"]["level"]) {
  switch (level) {
    case "strong":
      return "context.sufficiency.level.strong";
    case "useful":
      return "context.sufficiency.level.useful";
    case "thin":
      return "context.sufficiency.level.thin";
  }
}

export function ContextActivityPanel({ model }: ContextActivityPanelProps) {
  const { t } = useI18n();
  return (
    <section
      className="od-context-loop"
      data-od-id="context-activity-surface"
      data-empty={model.hasLiveResearchData ? "false" : "true"}
    >
      <div className="od-stage-panel-head od-context-loop-head">
        <div>
          <div className="od-stage-kicker">{t("context.activity.eyebrow")}</div>
          <h2>{t("context.activity.title")}</h2>
          <p>
            {model.hasLiveResearchData
              ? t("context.activity.body")
              : t("context.activity.placeholder")}
          </p>
        </div>
      </div>

      <div className="od-context-sufficiency" data-level={model.sufficiency.level}>
        <div className="od-context-sufficiency-main">
          <span>{t("context.sufficiency.label")}</span>
          <strong>{t(levelLabelKey(model.sufficiency.level))} · {model.sufficiency.score}/100</strong>
          <p>{renderMessage(t, model.sufficiency.summary)}</p>
        </div>
        <div className="od-context-sufficiency-meter" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="od-context-sufficiency-next">
          <span>{t("context.sufficiency.next")}</span>
          <strong>{renderMessage(t, model.sufficiency.next)}</strong>
        </div>
      </div>

      {model.sufficiency.warnings.length > 0 ? (
        <div className="od-context-sufficiency-warnings" data-od-id="context-sufficiency-warnings">
          {model.sufficiency.warnings.slice(0, 3).map((warning) => (
            <span key={`${warning.key}:${JSON.stringify(warning.vars ?? {})}`}>{renderMessage(t, warning)}</span>
          ))}
        </div>
      ) : null}

      <div className="od-context-activity-list">
        {model.activity.map((item) => (
          <article key={item.id} className="od-context-activity-row" data-state={item.state}>
            <div>
              <strong>{renderMessage(t, item.title)}</strong>
              <p>{renderMessage(t, item.body)}</p>
            </div>
            <span className={`od-pill ${item.state === "complete" ? "success" : item.state === "blocked" ? "warn" : item.state === "active" ? "blue" : ""}`}>
              {t(stateLabelKey(item.state))}
            </span>
          </article>
        ))}
      </div>
    </section>
  );
}
