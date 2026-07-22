/**
 * A `workspace-write` run left queued by a session that closed before claiming it. The consent
 * died with that window (`docs/agent-permissions.md`), so this session must re-show the grant and
 * get an explicit click before it can execute — never claim it silently just because it exists.
 */
import { useI18n } from "../../i18n";
import { shortWorkspacePath } from "./runPermissions";
import type { StrandedRun } from "./strandedRun";

export function StrandedRunNotice(props: {
  run: StrandedRun;
  disabled: boolean;
  onRegrant: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const { run } = props;
  const sandboxBodyKey = run.sandbox === "workspace-write"
    ? "execute.stranded.sandbox.workspaceWrite"
    : "execute.stranded.sandbox.other";

  return (
    <div className="od-stranded-run" data-od-id="stranded-run-notice">
      <strong>{t("execute.stranded.title")}</strong>
      <p>{t("execute.stranded.body")}</p>
      <p>{t(sandboxBodyKey)}</p>
      {run.workspaceRoot ? (
        <code className="od-run-permission-path" title={run.workspaceRoot}>
          {shortWorkspacePath(run.workspaceRoot)}
        </code>
      ) : null}
      <p>{t(run.network ? "runPermission.network.onBody" : "runPermission.network.offBody")}</p>
      <div className="od-stranded-run-actions">
        <button
          className="od-aim-primary"
          type="button"
          disabled={props.disabled}
          onClick={props.onRegrant}
        >
          {t("execute.stranded.regrant")}
        </button>
        <button
          className="od-aim-secondary"
          type="button"
          disabled={props.disabled}
          onClick={props.onCancel}
        >
          {t("execute.stranded.cancel")}
        </button>
      </div>
    </div>
  );
}
