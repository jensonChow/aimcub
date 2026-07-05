import { useState } from "react";

import {
  LLM_PROVIDER_CATALOG,
  getDefaultBaseURL,
  getLlmProviderDefinition,
  modelBelongsToProvider,
  type LlmProvider,
} from "@core/llm/providers";

import type { ProviderConfig, ProviderStatus } from "../shared/ipc";

import { useI18n } from "./i18n";
import {
  CUSTOM_MODEL,
  baseURLOrDefault,
  modelOrDefault,
  modelSelectValue,
  providerConfigForFormState,
  providerFormStateForProvider,
  providerOrDefault,
} from "./providerFormState";
import { C, inputStyle, labelStyle, linkButton, optionButton, primaryButton, secondaryButton } from "./styles";

const PROVIDER_OPTIONS = LLM_PROVIDER_CATALOG;

interface ProviderFormProps {
  status: ProviderStatus | null;
  onSaved: (s: ProviderStatus) => void;
  onClose?: () => void;
}

export function ProviderForm({ status, onSaved, onClose }: ProviderFormProps) {
  const { t } = useI18n();
  const initialProvider = providerOrDefault(status?.provider);
  const [providerKind, setProviderKind] = useState<LlmProvider>(initialProvider);
  const [apiKey, setApiKey] = useState("");
  const [baseURL, setBaseURL] = useState(baseURLOrDefault(initialProvider, status?.baseURL));
  const [model, setModel] = useState(modelOrDefault(initialProvider, status?.model));
  const [busy, setBusy] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const providerDef = getLlmProviderDefinition(providerKind) ?? PROVIDER_OPTIONS[0]!;
  const usesEndpoint = providerDef.protocol === "openai-compatible";
  const selectedModel = modelSelectValue(providerDef, model);
  const hasCustomModelInput = selectedModel === CUSTOM_MODEL;

  // A stored key only counts for the provider it was saved under. After switching
  // providers, the user must enter a fresh key.
  const hasStoredKey = (status?.hasApiKey ?? false) && status?.provider === providerKind;
  const keyOk = apiKey.trim().length > 0 || hasStoredKey;
  const modelOk = hasCustomModelInput ? Boolean(model.trim()) : Boolean((model.trim() || providerDef.defaultModel).trim());
  const canSave = keyOk && modelOk && !busy && !testBusy;
  const canTest = keyOk && modelOk && !busy && !testBusy;

  function selectProvider(next: LlmProvider) {
    const nextState = providerFormStateForProvider(next);
    setProviderKind(nextState.providerKind);
    setBaseURL(nextState.baseURL);
    setModel(nextState.model);
  }

  function selectModel(next: string) {
    if (next === CUSTOM_MODEL) {
      setModel(modelBelongsToProvider(providerKind, model) ? "" : model);
      return;
    }
    setModel(next);
  }

  function currentConfig(): ProviderConfig {
    return providerConfigForFormState({ providerKind, apiKey, baseURL, model });
  }

  async function testConnection() {
    setFormError(null);
    setTestResult(null);
    setTestBusy(true);
    try {
      const result = await window.aimcub.testProviderConfig(currentConfig());
      setTestResult({
        ok: result.ok,
        message: result.ok ? t("pf.testOk", { ms: result.latencyMs }) : result.error ?? t("pf.testFailed"),
      });
    } catch (e) {
      setTestResult({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setTestBusy(false);
    }
  }

  async function save() {
    setFormError(null);
    setBusy(true);
    try {
      const nextStatus = await window.aimcub.setProviderConfig(currentConfig());
      if (!nextStatus.configured) {
        setFormError(t("pf.notUsableKeyModel"));
        return;
      }
      onSaved(nextStatus);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const selectedModelId = model.trim() || providerDef.defaultModel;
  const selectedModelHelp = providerDef.models.find((item) => item.id === selectedModelId)?.description;

  return (
    <div className="od-preference-card">
      <div className="od-form-head">
        <div>
          <div className="od-form-title">{t("pf.title")}</div>
          <div className="od-form-body">{t("pf.blurb")}</div>
        </div>
        {onClose ? <button onClick={onClose} style={{ ...linkButton() }}>{t("common.close")}</button> : null}
      </div>

      <label style={labelStyle()}>{t("pf.providerLabel")}</label>
      <div className="od-option-grid">
        {PROVIDER_OPTIONS.map((provider) => (
          <button key={provider.id} onClick={() => selectProvider(provider.id)} style={optionButton(providerKind === provider.id)}>
            <div style={{ fontWeight: 500 }}>{provider.label}</div>
            <div style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>{provider.description}</div>
          </button>
        ))}
      </div>

      <label style={{ ...labelStyle(), marginTop: 14 }}>{t("pf.model")}</label>
      {providerDef.models.length > 0 && (
        <select value={selectedModel} onChange={(e) => selectModel(e.target.value)} style={inputStyle()}>
          {providerDef.models.map((item) => (
            <option key={item.id} value={item.id}>{item.label}</option>
          ))}
          <option value={CUSTOM_MODEL}>{t("pf.customModel")}</option>
        </select>
      )}
      {hasCustomModelInput && (
        <input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder={t("pf.modelPlaceholder")}
          style={{ ...inputStyle(), marginTop: providerDef.models.length > 0 ? 8 : 0 }}
        />
      )}
      {selectedModelId && (
        <div style={{ color: C.muted, fontSize: 12, marginTop: 6 }}>
          {t("pf.modelId", { id: selectedModelId })}
          {selectedModelHelp ? ` · ${selectedModelHelp}` : ""}
        </div>
      )}

      {usesEndpoint && (
        <>
          <label style={{ ...labelStyle(), marginTop: 14 }}>{t("pf.endpoint")}</label>
          <input
            value={baseURL}
            onChange={(e) => setBaseURL(e.target.value)}
            placeholder={getDefaultBaseURL(providerKind) || t("pf.endpointPlaceholder")}
            style={inputStyle()}
          />
          <div style={{ color: C.muted, fontSize: 12, marginTop: 6 }}>
            {providerDef.baseURLHint || t("pf.endpointHint")}
          </div>
        </>
      )}

      <label style={{ ...labelStyle(), marginTop: 14 }}>{t("pf.apiKey")}</label>
      <input
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        placeholder={hasStoredKey ? t("pf.keyKeep") : providerDef.apiKeyPlaceholder}
        type="password"
        style={inputStyle()}
      />

      {formError && <div style={{ color: C.danger, fontSize: 13, marginTop: 10 }}>{formError}</div>}
      {testResult && (
        <div style={{ color: testResult.ok ? C.success : C.danger, fontSize: 13, marginTop: 10 }}>
          {testResult.message}
        </div>
      )}

      <div className="od-form-actions">
        <button onClick={testConnection} disabled={!canTest} style={{ ...secondaryButton(), opacity: canTest ? 1 : 0.65 }}>
          {testBusy ? t("pf.testing") : t("pf.testProvider")}
        </button>
        <button onClick={save} disabled={!canSave} style={primaryButton(!canSave)}>
          {busy ? t("pf.saving") : t("pf.saveProvider")}
        </button>
      </div>
    </div>
  );
}
