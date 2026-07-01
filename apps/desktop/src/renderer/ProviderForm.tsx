import { useState } from "react";

import type { LlmProvider, ProviderConfig, ProviderStatus } from "../shared/ipc";

import { useI18n } from "./i18n";
import { C, card, inputStyle, labelStyle, linkButton, optionButton, primaryButton } from "./styles";

const OPENAI_COMPATIBLE_PRESETS = [
  {
    id: "openrouter",
    label: "OpenRouter",
    baseURL: "https://openrouter.ai/api/v1",
    model: "anthropic/claude-sonnet-4",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    baseURL: "https://api.deepseek.com",
    model: "deepseek-chat",
  },
  {
    id: "siliconflow",
    label: "SiliconFlow",
    baseURL: "https://api.siliconflow.cn/v1",
    model: "",
  },
  {
    id: "dashscope",
    label: "Qwen/DashScope",
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
  },
  {
    id: "moonshot",
    label: "Kimi/Moonshot",
    baseURL: "https://api.moonshot.cn/v1",
    model: "moonshot-v1-8k",
  },
  {
    id: "ollama",
    label: "Ollama",
    baseURL: "http://localhost:11434/v1",
    model: "",
  },
] as const;

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

  function applyOpenAiCompatiblePreset(preset: (typeof OPENAI_COMPATIBLE_PRESETS)[number]) {
    setProviderKind("openai-compatible");
    setBaseURL(preset.baseURL);
    if (!model.trim() && preset.model) setModel(preset.model);
  }

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
          <label style={{ ...labelStyle(), marginTop: 14 }}>{t("pf.presets")}</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {OPENAI_COMPATIBLE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                onClick={() => applyOpenAiCompatiblePreset(preset)}
                style={{
                  ...linkButton(),
                  border: `1px solid ${baseURL === preset.baseURL ? C.accent : C.border}`,
                  borderRadius: 8,
                  padding: "6px 9px",
                  color: baseURL === preset.baseURL ? C.accent : C.muted,
                  background: baseURL === preset.baseURL ? C.accentBg : "#fff",
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div style={{ color: C.muted, fontSize: 12, marginTop: 8 }}>
            {t("pf.openaiCompatibleHint")}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 14 }}>
            <label style={labelStyle()}>{t("pf.baseUrl")}</label>
            <button
              onClick={() => applyOpenAiCompatiblePreset(OPENAI_COMPATIBLE_PRESETS[0])}
              style={linkButton()}
            >
              {t("pf.useOpenRouter")}
            </button>
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
