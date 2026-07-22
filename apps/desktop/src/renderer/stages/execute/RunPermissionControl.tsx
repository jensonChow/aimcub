/**
 * The consent control: before a local agent runs, the user says what it may touch.
 *
 * Read-only + network-off is the default and reads as the calm state; anything wider is an
 * explicit, per-run grant with copy that says what it actually allows. `danger-full-access` is not
 * offered — see `docs/agent-permissions.md` for why, and for what each level maps to per runtime.
 */
import { useI18n } from "../../i18n";
import {
  isRunPermissionEscalated,
  runPermissionBlockedReason,
  RUN_SANDBOX_OPTIONS,
  shortWorkspacePath,
  type RunPermissionDraft,
} from "./runPermissions";

export function RunPermissionControl(props: {
  draft: RunPermissionDraft;
  disabled: boolean;
  pickingWorkspace: boolean;
  onChange: (next: RunPermissionDraft) => void;
  onPickWorkspace: () => void;
}) {
  const { t } = useI18n();
  const { draft } = props;
  const blocked = runPermissionBlockedReason(draft);
  const escalated = isRunPermissionEscalated(draft);
  const sandboxBodyKey = draft.sandbox === "workspace-write"
    ? "runPermission.sandbox.workspaceWriteBody"
    : "runPermission.sandbox.readOnlyBody";

  return (
    <section
      className="od-run-permission"
      data-escalated={escalated ? "true" : "false"}
      aria-label={t("runPermission.title")}
    >
      <div className="od-run-permission-head">
        <strong>{t("runPermission.title")}</strong>
      </div>

      <div className="od-run-permission-row">
        <span className="od-run-permission-label">{t("runPermission.sandboxLabel")}</span>
        <div className="od-run-permission-seg" role="radiogroup" aria-label={t("runPermission.sandboxLabel")}>
          {RUN_SANDBOX_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={draft.sandbox === option}
              data-active={draft.sandbox === option ? "true" : "false"}
              disabled={props.disabled}
              onClick={() => props.onChange({ ...draft, sandbox: option })}
            >
              {t(option === "read-only" ? "runPermission.sandbox.readOnly" : "runPermission.sandbox.workspaceWrite")}
            </button>
          ))}
        </div>
      </div>
      <p className="od-run-permission-body">{t(sandboxBodyKey)}</p>

      {draft.sandbox === "workspace-write" ? (
        <div className="od-run-permission-row">
          <span className="od-run-permission-label">{t("runPermission.folderLabel")}</span>
          {draft.workspace ? (
            <code className="od-run-permission-path" title={draft.workspace}>
              {shortWorkspacePath(draft.workspace)}
            </code>
          ) : null}
          <button
            className="od-settings-mini-button"
            type="button"
            disabled={props.disabled || props.pickingWorkspace}
            onClick={props.onPickWorkspace}
          >
            {t(draft.workspace ? "runPermission.changeFolder" : "runPermission.chooseFolder")}
          </button>
        </div>
      ) : null}

      <div className="od-run-permission-row">
        <span className="od-run-permission-label">{t("runPermission.networkLabel")}</span>
        <div className="od-run-permission-seg" role="radiogroup" aria-label={t("runPermission.networkLabel")}>
          {[false, true].map((value) => (
            <button
              key={value ? "on" : "off"}
              type="button"
              role="radio"
              aria-checked={draft.network === value}
              data-active={draft.network === value ? "true" : "false"}
              disabled={props.disabled}
              onClick={() => props.onChange({ ...draft, network: value })}
            >
              {t(value ? "runPermission.networkOn" : "runPermission.networkOff")}
            </button>
          ))}
        </div>
      </div>
      <p className="od-run-permission-body">
        {t(draft.network ? "runPermission.network.onBody" : "runPermission.network.offBody")}
      </p>

      {blocked === "workspace_required" ? (
        <p className="od-run-permission-blocked" role="alert">{t("runPermission.folderRequired")}</p>
      ) : null}
      {escalated ? <p className="od-run-permission-body">{t("runPermission.sessionOnly")}</p> : null}
      <p className="od-run-permission-learn">{t("runPermission.learnMore")}</p>
    </section>
  );
}
