import { useState } from "react";

import {
  LLM_PROVIDER_CATALOG,
  getDefaultBaseURL,
  getLlmProviderDefinition,
  modelBelongsToProvider,
  type LlmProvider,
} from "@aimcub/llm/providers";

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
import { Button, Panel, Select, TextField } from "./ui";

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
    <Panel variant="plain" className="od-preference-card">
      <div className="od-form-head">
        <div>
          <div className="od-form-title">{t("pf.title")}</div>
          <div className="od-form-body">{t("pf.blurb")}</div>
        </div>
        {onClose ? <Button variant="ghost" size="sm" onClick={onClose}>{t("common.close")}</Button> : null}
      </div>

      <div className="od-ui-field">
        <span className="od-ui-field-label">{t("pf.providerLabel")}</span>
        <div className="od-provider-pills" role="radiogroup" aria-label={t("pf.providerLabel")}>
          {PROVIDER_OPTIONS.map((provider) => (
            <button
              key={provider.id}
              type="button"
              role="radio"
              className="od-provider-pill"
              aria-checked={providerKind === provider.id}
              onClick={() => selectProvider(provider.id)}
            >
              {provider.label}
            </button>
          ))}
        </div>
        {providerDef.description ? (
          <div className="od-ui-status-text">{providerDef.description}</div>
        ) : null}
      </div>

      {providerDef.models.length > 0 && (
        <Select label={t("pf.model")} value={selectedModel} onChange={(e) => selectModel(e.target.value)}>
          {providerDef.models.map((item) => (
            <option key={item.id} value={item.id}>{item.label}</option>
          ))}
          <option value={CUSTOM_MODEL}>{t("pf.customModel")}</option>
        </Select>
      )}
      {hasCustomModelInput && (
        <TextField
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder={t("pf.modelPlaceholder")}
          label={providerDef.models.length > 0 ? undefined : t("pf.model")}
          aria-label={t("pf.model")}
        />
      )}
      {selectedModelId && (
        <div className="od-ui-status-text">
          {t("pf.modelId", { id: selectedModelId })}
          {selectedModelHelp ? ` · ${selectedModelHelp}` : ""}
        </div>
      )}

      {usesEndpoint && (
        <>
          <TextField
            label={t("pf.endpoint")}
            value={baseURL}
            onChange={(e) => setBaseURL(e.target.value)}
            placeholder={getDefaultBaseURL(providerKind) || t("pf.endpointPlaceholder")}
            hint={providerDef.baseURLHint || t("pf.endpointHint")}
          />
        </>
      )}

      <TextField
        label={t("pf.apiKey")}
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        placeholder={hasStoredKey ? t("pf.keyKeep") : providerDef.apiKeyPlaceholder}
        type="password"
      />

      {formError && <div className="od-ui-status-text" data-tone="danger">{formError}</div>}
      {testResult && (
        <div className="od-ui-status-text" data-tone={testResult.ok ? "success" : "danger"}>
          {testResult.message}
        </div>
      )}

      <div className="od-form-actions">
        <Button variant="secondary" size="lg" onClick={testConnection} disabled={!canTest}>
          {testBusy ? t("pf.testing") : t("pf.testProvider")}
        </Button>
        <Button variant="primary" size="lg" onClick={save} disabled={!canSave}>
          {busy ? t("pf.saving") : t("pf.saveProvider")}
        </Button>
      </div>
    </Panel>
  );
}
