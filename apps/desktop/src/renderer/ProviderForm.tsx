import { useState } from "react";

import type { LlmProvider, ProviderConfig, ProviderStatus } from "../shared/ipc";

import { useI18n } from "./i18n";
import { C, card, inputStyle, labelStyle, linkButton, optionButton, primaryButton } from "./styles";

/** OpenRouter is the easy default for the OpenAI-compatible path (one key, 50+ models). */
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

interface ProviderFormProps {
  status: ProviderStatus | null;
  onSaved: (s: ProviderStatus) => void;
  onClose: () => void;
}

export function ProviderForm({ status, onSaved, onClose }: ProviderFormProps) {
  const { t } = useI18n();
  const [providerKind, setProviderKind] = useState<LlmProvider>(status?.provider ?? "anthropic");
  const [apiKey, setApiKey] = useState("");
  const [baseURL, setBaseURL] = useState(status?.baseURL ?? "");
  const [model, setModel] = useState(status?.model ?? "");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const isOpenAi = providerKind === "openai-compatible";
  // A stored key only counts for the provider it was saved under. After switching
  // providers, the user must enter a fresh key.
  const hasStoredKey = (status?.hasApiKey ?? false) && status?.provider === providerKind;
  const keyOk = apiKey.trim().length > 0 || hasStoredKey;
  const modelOk = !isOpenAi || model.trim().length > 0;
  const canSave = keyOk && modelOk && !busy;

  async function save() {
    setFormError(null);
    setBusy(true);
    try {
      const config: ProviderConfig = {
        provider: providerKind,
        apiKey: apiKey.trim(),
        baseURL: isOpenAi ? baseURL.trim() || undefined : undefined,
        model: isOpenAi ? model.trim() || undefined : undefined,
      };
      const nextStatus = await window.aimcub.setProviderConfig(config);
      if (!nextStatus.configured) {
        setFormError(t(isOpenAi ? "pf.notUsableKeyModel" : "pf.notUsableKey"));
        return;
      }
      onSaved(nextStatus);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ ...card(), background: "#fbfaf7" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div style={{ fontWeight: 600, fontSize: 15 }}>{t("pf.title")}</div>
        <button onClick={onClose} style={{ ...linkButton() }}>{t("common.close")}</button>
      </div>
      <div style={{ fontSize: 12, color: C.muted, margin: "4px 0 14px" }}>{t("pf.blurb")}</div>

      <label style={labelStyle()}>{t("pf.providerLabel")}</label>
      <div style={{ display: "flex", gap: 8 }}>
        {(["anthropic", "openai-compatible"] as LlmProvider[]).map((p) => (
          <button key={p} onClick={() => setProviderKind(p)} style={optionButton(providerKind === p)}>
            <div style={{ fontWeight: 500 }}>{p === "anthropic" ? t("pf.anthropic") : t("pf.openai")}</div>
            <div style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>
              {p === "anthropic" ? t("pf.anthropicDesc") : t("pf.openaiDesc")}
            </div>
          </button>
        ))}
      </div>

      {isOpenAi && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 14 }}>
            <label style={labelStyle()}>{t("pf.baseUrl")}</label>
            <button onClick={() => setBaseURL(OPENROUTER_BASE_URL)} style={linkButton()}>{t("pf.useOpenRouter")}</button>
          </div>
          <input
            value={baseURL}
            onChange={(e) => setBaseURL(e.target.value)}
            placeholder={t("pf.baseUrlPlaceholder")}
            style={inputStyle()}
          />
          <label style={{ ...labelStyle(), marginTop: 14 }}>{t("pf.model")}</label>
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={t("pf.modelPlaceholder")}
            style={inputStyle()}
          />
        </>
      )}

      <label style={{ ...labelStyle(), marginTop: 14 }}>{t("pf.apiKey")}</label>
      <input
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        placeholder={hasStoredKey ? t("pf.keyKeep") : isOpenAi ? "sk-or-... / sk-..." : "sk-ant-..."}
        type="password"
        style={inputStyle()}
      />

      {formError && <div style={{ color: C.danger, fontSize: 13, marginTop: 10 }}>{formError}</div>}

      <button onClick={save} disabled={!canSave} style={primaryButton(!canSave)}>
        {busy ? t("pf.saving") : t("pf.saveProvider")}
      </button>
    </div>
  );
}
