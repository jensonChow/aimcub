import { useState } from "react";

import type { WebResearchConfig, WebResearchStatus } from "../shared/ipc";

import { useI18n } from "./i18n";
import { C, TYPE, WEIGHT, inputStyle, labelStyle, primaryButton, secondaryButton } from "./styles";

interface WebResearchFormProps {
  status: WebResearchStatus | null;
  onSaved: (s: WebResearchStatus) => void;
}

export function WebResearchForm({ status, onSaved }: WebResearchFormProps) {
  const { t } = useI18n();
  const [apiKey, setApiKey] = useState("");
  const [enabled, setEnabled] = useState(status?.enabled ?? false);
  const [fetchPages, setFetchPages] = useState(status?.fetchPages ?? true);
  const [busy, setBusy] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const hasStoredKey = status?.hasApiKey ?? false;
  const keyOk = apiKey.trim().length > 0 || hasStoredKey;
  const canSave = !busy && !testBusy && (!enabled || keyOk);
  const canTest = !busy && !testBusy && keyOk;

  function currentConfig(): WebResearchConfig {
    return {
      provider: "brave",
      apiKey,
      enabled,
      fetchPages,
    };
  }

  async function testConnection() {
    setMessage(null);
    setTestBusy(true);
    try {
      const result = await window.aimcub.testWebResearchConfig(currentConfig());
      setMessage({
        ok: result.ok,
        text: result.ok ? t("wf.testOk", { n: result.resultCount, ms: result.latencyMs }) : result.error ?? t("wf.testFailed"),
      });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setTestBusy(false);
    }
  }

  async function save() {
    setMessage(null);
    setBusy(true);
    try {
      const next = await window.aimcub.setWebResearchConfig(currentConfig());
      onSaved(next);
      setMessage({ ok: next.configured || !next.enabled, text: t(next.configured ? "wf.saved" : "wf.savedDisabled") });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="od-preference-card">
      <div className="od-form-head">
        <div>
          <div className="od-form-title">{t("wf.title")}</div>
          <div className="od-form-body">{t("wf.blurb")}</div>
        </div>
        <div style={{ color: status?.configured ? C.success : C.muted, fontSize: TYPE.meta, fontWeight: WEIGHT.strong, whiteSpace: "nowrap" }}>
          {status?.configured ? t("wf.ready") : t("wf.notReady")}
        </div>
      </div>

      <label style={{ ...labelStyle(), display: "flex", gap: 8, alignItems: "center", marginTop: 14 }}>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        {t("wf.enable")}
      </label>

      <label style={labelStyle()}>{t("wf.provider")}</label>
      <output className="od-static-config-value" aria-label={t("wf.provider")}>Brave Search</output>

      <label style={{ ...labelStyle(), marginTop: 14 }}>{t("wf.apiKey")}</label>
      <input
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        placeholder={hasStoredKey ? t("wf.keyKeep") : t("wf.keyPlaceholder")}
        type="password"
        style={inputStyle()}
      />

      <label style={{ ...labelStyle(), display: "flex", gap: 8, alignItems: "center", marginTop: 14 }}>
        <input type="checkbox" checked={fetchPages} onChange={(e) => setFetchPages(e.target.checked)} />
        {t("wf.fetchPages")}
      </label>

      {message && (
        <div style={{ color: message.ok ? C.success : C.danger, fontSize: TYPE.body, marginTop: 10 }}>
          {message.text}
        </div>
      )}

      <div className="od-form-actions">
        <button onClick={testConnection} disabled={!canTest} style={{ ...secondaryButton(), opacity: canTest ? 1 : 0.65 }}>
          {testBusy ? t("wf.testing") : t("wf.test")}
        </button>
        <button onClick={save} disabled={!canSave} style={primaryButton(!canSave)}>
          {busy ? t("wf.saving") : t("wf.save")}
        </button>
      </div>
    </div>
  );
}
