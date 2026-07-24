/**
 * Claude-Code-style chips for the planning brain — two parallel choices beside
 * Build-the-plan: WHICH runtime is the brain (Claude Code / Codex; signed-out
 * runtimes show disabled with the reason) and WHICH of its live-advertised
 * models it runs (plus Auto). Picks apply to the NEXT planning session; a
 * running session keeps what it started with.
 */
import { useI18n } from "./i18n";
import { ActionMenu, ActionMenuRadioItem } from "./ui/ActionMenu";
import type { PlanningBrainMenu, PlanningModelMenu } from "./workflow/planningSession";

export interface PlanningBrainChipProps {
  menu: PlanningBrainMenu;
  disabled?: boolean;
  /** Null selects Auto (first session-ready runtime in registry order). */
  onSelect: (agentId: string | null) => void;
}

export function PlanningBrainChip(props: PlanningBrainChipProps) {
  const { t } = useI18n();
  const { menu } = props;
  return (
    <ActionMenu
      label={t("planningBrain.menuLabel")}
      className="od-model-chip-anchor"
      menuClassName="od-model-chip-menu"
      triggerClassName="od-model-chip"
      triggerContent={
        <>
          <span className="od-model-chip-label">{menu.currentLabel}</span>
          <span className="od-model-chip-caret" aria-hidden="true">▾</span>
        </>
      }
    >
      {({ closeMenu }) => (
        <>
          <div className="od-model-chip-heading" role="presentation">{t("planningBrain.heading")}</div>
          <ActionMenuRadioItem
            checked={menu.autoSelected}
            disabled={props.disabled}
            onClick={() => {
              props.onSelect(null);
              closeMenu(true);
            }}
          >
            {t("planningModel.auto")}
          </ActionMenuRadioItem>
          {menu.options.map((option) => (
            <ActionMenuRadioItem
              key={option.id}
              checked={option.selected}
              disabled={props.disabled || option.disabledReason !== null}
              title={option.disabledReason ?? undefined}
              onClick={() => {
                props.onSelect(option.id);
                closeMenu(true);
              }}
            >
              {option.label}
            </ActionMenuRadioItem>
          ))}
        </>
      )}
    </ActionMenu>
  );
}

export interface PlanningModelChipProps {
  menu: PlanningModelMenu;
  disabled?: boolean;
  /** Null selects Auto (follow the runtime's live-advertised default). */
  onSelect: (modelId: string | null) => void;
}

export function PlanningModelChip(props: PlanningModelChipProps) {
  const { t } = useI18n();
  const { menu } = props;
  return (
    <ActionMenu
      label={t("planningModel.menuLabel")}
      className="od-model-chip-anchor"
      menuClassName="od-model-chip-menu"
      triggerClassName="od-model-chip"
      triggerContent={
        <>
          <span className="od-model-chip-label">{menu.currentLabel ?? t("planningModel.auto")}</span>
          <span className="od-model-chip-caret" aria-hidden="true">▾</span>
        </>
      }
    >
      {({ closeMenu }) => (
        <>
          <div className="od-model-chip-heading" role="presentation">{t("planningModel.heading")}</div>
          <ActionMenuRadioItem
            checked={menu.autoSelected}
            disabled={props.disabled}
            onClick={() => {
              props.onSelect(null);
              closeMenu(true);
            }}
          >
            {t("planningModel.auto")}
          </ActionMenuRadioItem>
          {menu.options.map((option) => (
            <ActionMenuRadioItem
              key={option.id}
              checked={option.selected}
              disabled={props.disabled}
              onClick={() => {
                props.onSelect(option.id);
                closeMenu(true);
              }}
            >
              {option.label}
            </ActionMenuRadioItem>
          ))}
        </>
      )}
    </ActionMenu>
  );
}
