/**
 * The honest face of `AimStore.getDiagnostics()`.
 *
 * The store quarantines a file it cannot read and falls back to the backup instead of silently
 * starting empty. Until now nothing said so, which is how a recovery looked identical to "you have
 * no aims". This banner is non-blocking and dismissible — it reports, it does not interrupt, and
 * it names the path the unusable file was kept at so the bytes stay findable.
 */
import type { StoreDiagnostic } from "../shared/ipc";

import { useI18n, type StringKey } from "./i18n";

const MESSAGE_KEY: Record<string, StringKey> = {
  corrupt_quarantined: "storeDiagnostics.message.corrupt_quarantined",
  recovered_from_backup: "storeDiagnostics.message.recovered_from_backup",
  backup_unusable: "storeDiagnostics.message.backup_unusable",
  no_backup: "storeDiagnostics.message.no_backup",
};

/** A kind this build does not know still gets a row — the store said something happened. */
export function storeDiagnosticMessageKey(kind: string): StringKey {
  return MESSAGE_KEY[kind] ?? "storeDiagnostics.message.unknown";
}

export function StoreDiagnosticsBanner(props: {
  diagnostics: readonly StoreDiagnostic[];
  onDismiss: () => void;
}) {
  const { t } = useI18n();
  if (props.diagnostics.length === 0) return null;

  // One incident produces several diagnostics (quarantine, then recovery) that name the SAME
  // quarantined file. Say where it is once — repeating the path reads like two separate losses.
  const shownPaths = new Set<string>();

  return (
    <div className="od-store-diagnostics" role="status" data-od-id="store-diagnostics-banner">
      <div className="od-store-diagnostics-copy">
        <strong>{t("storeDiagnostics.title")}</strong>
        {props.diagnostics.map((diagnostic, index) => {
          const path = diagnostic.quarantinePath;
          const showPath = Boolean(path) && !shownPaths.has(path!);
          if (path) shownPaths.add(path);
          return (
            <span key={`${diagnostic.kind}-${diagnostic.at}-${index}`}>
              {t(storeDiagnosticMessageKey(diagnostic.kind))}
              {showPath ? <small>{t("storeDiagnostics.quarantinedPath", { path: path! })}</small> : null}
            </span>
          );
        })}
      </div>
      <button className="od-settings-mini-button" type="button" onClick={props.onDismiss}>
        {t("storeDiagnostics.dismiss")}
      </button>
    </div>
  );
}
