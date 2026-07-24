/**
 * Claude-Code-style model chip for the planning brain: a compact labeled
 * trigger showing the effective model, opening a checked menu of the runtime's
 * LIVE-advertised models plus an Auto row (first advertised model). The pick
 * applies to the NEXT planning session; a running session keeps its model.
 */
import { useI18n } from "./i18n";
import { ActionMenu, ActionMenuRadioItem } from "./ui/ActionMenu";
import type { PlanningModelMenu } from "./workflow/planningSession";

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
