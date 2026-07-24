/**
 * Settings → Brain: the canonical home of the planning-brain choice (founder
 * direction 2026-07-24 — "the polish should happen in the settings and as a
 * main item"). The Journey chips stay as the quick switcher; this pane is the
 * full surface: which local agent is the brain (every planning-capable runtime
 * listed, signed-out ones disabled with the reason), which of its
 * live-advertised models it runs, and the API provider as the fallback path.
 */
import { useI18n } from "./i18n";
import { Select } from "./ui";
import type { DesktopPreferences, PlanningAgentDetection } from "../shared/ipc";
import { planningBrainMenu, planningModelMenu } from "./workflow/planningSession";

export interface SettingsPlanningBrainPaneProps {
  localAgents: readonly PlanningAgentDetection[];
  planningBrain: DesktopPreferences["planningBrain"];
  planningModel: DesktopPreferences["planningModel"];
  disabled?: boolean;
  onSelectBrain: (agentId: string | null) => void;
  onSelectModel: (agentId: string, modelId: string | null) => void;
}

const AUTO_VALUE = "__auto__";

export function SettingsPlanningBrainPane(props: SettingsPlanningBrainPaneProps) {
  const { t } = useI18n();
  const brainMenu = planningBrainMenu(props.localAgents, props.planningBrain);
  const modelMenu = planningModelMenu(props.localAgents, props.planningModel, props.planningBrain);

  if (!brainMenu) {
    return (
      <div className="od-settings-card">
        <div className="od-settings-card-row">
          <div className="od-settings-card-copy">
            <strong>{t("settings.planningBrain.brainTitle")}</strong>
            <span>{t("settings.planningBrain.none")}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="od-settings-card" role="radiogroup" aria-label={t("settings.planningBrain.brainTitle")}>
        <div className="od-settings-card-row">
          <div className="od-settings-card-copy">
            <strong>{t("settings.planningBrain.brainTitle")}</strong>
            <span>{t("settings.planningBrain.brainSub")}</span>
          </div>
        </div>
        <button
          type="button"
          role="radio"
          aria-checked={brainMenu.autoSelected}
          className="od-settings-card-row od-settings-choice-row"
          disabled={props.disabled}
          onClick={() => props.onSelectBrain(null)}
        >
          <i className="od-settings-ready-dot" aria-hidden="true" />
          <div className="od-settings-card-copy">
            <strong>{t("settings.planningBrain.auto")}</strong>
            <span>{t("settings.planningBrain.autoNow", { name: brainMenu.currentLabel })}</span>
          </div>
          {brainMenu.autoSelected ? <span className="od-settings-choice-check" aria-hidden="true">✓</span> : null}
        </button>
        {brainMenu.options.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={option.selected}
            className="od-settings-choice-row od-settings-card-row"
            disabled={props.disabled || option.disabledReason !== null}
            onClick={() => props.onSelectBrain(option.id)}
          >
            <i
              className={`od-settings-ready-dot${option.disabledReason ? " is-warn" : ""}`}
              aria-hidden="true"
            />
            <div className="od-settings-card-copy">
              <strong>{option.label}</strong>
              <span>{option.disabledReason ?? t("settings.planningBrain.ready")}</span>
            </div>
            {option.selected ? <span className="od-settings-choice-check" aria-hidden="true">✓</span> : null}
          </button>
        ))}
      </div>

      <div className="od-settings-card">
        <div className="od-settings-card-row">
          <div className="od-settings-card-copy">
            <strong>{t("settings.planningBrain.modelTitle")}</strong>
            <span>
              {modelMenu
                ? t("settings.planningBrain.modelSub", { name: brainMenu.currentLabel })
                : t("settings.planningBrain.modelHint")}
            </span>
          </div>
          {modelMenu ? (
            <Select
              aria-label={t("settings.planningBrain.modelTitle")}
              disabled={props.disabled}
              value={modelMenu.autoSelected ? AUTO_VALUE : modelMenu.options.find((option) => option.selected)?.id ?? AUTO_VALUE}
              onChange={(event) => {
                const value = event.currentTarget.value;
                props.onSelectModel(modelMenu.agentId, value === AUTO_VALUE ? null : value);
              }}
            >
              <option value={AUTO_VALUE}>
                {t("settings.planningBrain.modelAuto", { model: modelMenu.options[0]?.label ?? "" })}
              </option>
              {modelMenu.options.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </Select>
          ) : null}
        </div>
      </div>
    </>
  );
}
