import { useEffect, useState, type CSSProperties } from "react";

import type { ContextSourceConfig, ContextSourceStatus } from "../shared/ipc";
import { useI18n } from "./i18n";
import { C, TYPE, WEIGHT, inputStyle, primaryButton } from "./styles";

type OnlineSource = ContextSourceConfig["online"]["sources"][number];
type OnlineProvider = OnlineSource["provider"];
type SummaryTone = "" | "blue" | "success" | "warn";

interface ContextSourcesPanelProps {
  status: ContextSourceStatus | null;
  disabled?: boolean;
  compact?: boolean;
  variant?: "settings" | "workbench";
  onOpenSettings?: () => void;
  onSaved: (status: ContextSourceStatus) => void;
}

interface SourceSummaryItem {
  key: string;
  label: string;
  detail: string;
  status: string;
  tone: SummaryTone;
}

interface ContextGateRow {
  key: string;
  label: string;
  body: string;
  status: string;
  tone: SummaryTone;
}

const PROVIDERS: OnlineProvider[] = ["notion", "obsidian", "google-drive", "supabase", "database", "url", "other"];

function emptyConfig(): ContextSourceConfig {
  return {
    version: 1,
    local: { enabled: false, filePaths: [] },
    online: { enabled: false, sources: [] },
    research: { webEnabled: true, deepResearch: true },
    userSession: { enabled: true },
    questionnaire: { enabled: true },
  };
}

function configFromStatus(status: ContextSourceStatus | null): ContextSourceConfig {
  if (!status) return emptyConfig();
  return {
    version: 1,
    local: {
      enabled: status.local.enabled,
      ...(status.local.workspaceRoot ? { workspaceRoot: status.local.workspaceRoot } : {}),
      filePaths: status.local.filePaths,
    },
    online: {
      enabled: status.online.enabled,
      sources: status.online.sources,
    },
    research: status.research,
    userSession: status.userSession,
    questionnaire: status.questionnaire,
  };
}

function uniquePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const path of paths) {
    const cleaned = path.trim();
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
  }
  return out;
}

function nextSourceId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `source:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

export function ContextSourcesPanel({
  status,
  disabled = false,
  compact = false,
  variant = "settings",
  onOpenSettings,
  onSaved,
}: ContextSourcesPanelProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<ContextSourceConfig>(() => configFromStatus(status));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(configFromStatus(status));
  }, [status]);

  const localCount = draft.local.filePaths.length + (draft.local.workspaceRoot ? 1 : 0);
  const enabledOnlineSources = draft.online.sources.filter((source) => source.enabled);
  const onlineEnabled = enabledOnlineSources.length;
  const onlineMissingReferences = enabledOnlineSources.filter((source) => source.reference.trim().length === 0).length;
  const localActive = draft.local.enabled && localCount > 0;
  const onlineActive = draft.online.enabled && onlineEnabled > 0;
  const webActive = draft.research.webEnabled;
  const deepActive = draft.research.deepResearch && webActive && localActive;
  const sessionActive = draft.userSession.enabled;
  const questionnaireActive = draft.questionnaire.enabled;
  const activeSourceCount = [localActive, onlineActive, webActive, deepActive, sessionActive, questionnaireActive]
    .filter(Boolean).length;
  const hasUnsavedChanges = JSON.stringify(draft) !== JSON.stringify(configFromStatus(status));
  const onlineNeedsAttention = draft.online.enabled && (onlineEnabled === 0 || onlineMissingReferences > 0);
  const deepWaiting = draft.research.deepResearch && !deepActive;
  const intakePaused = !sessionActive && !questionnaireActive;
  const intakeActive = sessionActive || questionnaireActive;
  const summaryTone: SummaryTone = activeSourceCount >= 4 && !onlineNeedsAttention ? "success" : "warn";

  const attentionText = !localActive
    ? t("context.sources.attention.local")
    : onlineNeedsAttention
      ? onlineMissingReferences > 0
        ? t("context.sources.attention.onlineReference", { n: onlineMissingReferences })
        : t("context.sources.attention.onlineEmpty")
      : deepWaiting
        ? t("context.sources.attention.deepWaiting")
        : intakePaused
          ? t("context.sources.attention.intakePaused")
          : t("context.sources.attention.ready");

  const nextAction = hasUnsavedChanges
    ? t("context.sources.next.save")
    : !localActive
      ? t("context.sources.next.local")
      : onlineNeedsAttention
        ? onlineMissingReferences > 0
          ? t("context.sources.next.reference")
          : t("context.sources.next.online")
        : draft.research.deepResearch && !draft.research.webEnabled
          ? t("context.sources.next.web")
          : intakePaused
            ? t("context.sources.next.intake")
            : t("context.sources.next.plan");

  const sourceSummary: SourceSummaryItem[] = [
    {
      key: "local",
      label: t("context.sources.local"),
      detail: localActive ? t("context.sources.summary.localReady", { n: localCount }) : t("context.sources.summary.localEmpty"),
      status: localActive ? t("context.sources.status.connected") : t("context.sources.status.pending"),
      tone: localActive ? "success" : "warn",
    },
    {
      key: "online",
      label: t("context.sources.online"),
      detail: !draft.online.enabled
        ? t("context.sources.summary.onlinePaused")
        : onlineMissingReferences > 0
          ? t("context.sources.summary.onlineNeedsReference", { n: onlineMissingReferences })
          : onlineEnabled > 0
            ? t("context.sources.summary.onlineReady", { n: onlineEnabled })
            : t("context.sources.summary.onlineEmpty"),
      status: !draft.online.enabled
        ? t("context.sources.status.paused")
        : onlineMissingReferences > 0
          ? t("context.sources.status.needsReference")
          : onlineActive
            ? t("context.sources.status.connected")
            : t("context.sources.status.pending"),
      tone: !draft.online.enabled ? "" : onlineMissingReferences > 0 || !onlineActive ? "warn" : "success",
    },
    {
      key: "web",
      label: t("context.sources.web"),
      detail: webActive ? t("context.sources.summary.webReady") : t("context.sources.summary.webPaused"),
      status: webActive ? t("context.sources.status.optional") : t("context.sources.status.paused"),
      tone: webActive ? "blue" : "",
    },
    {
      key: "deep",
      label: t("context.sources.deep"),
      detail: !draft.research.deepResearch
        ? t("context.sources.summary.deepPaused")
        : deepActive
          ? t("context.sources.summary.deepReady")
          : t("context.sources.summary.deepWaiting"),
      status: !draft.research.deepResearch
        ? t("context.sources.status.paused")
        : deepActive
          ? t("context.sources.status.active")
          : t("context.sources.status.waiting"),
      tone: !draft.research.deepResearch ? "" : deepActive ? "success" : "warn",
    },
    {
      key: "session",
      label: t("context.sources.conversation"),
      detail: sessionActive ? t("context.sources.summary.sessionReady") : t("context.sources.summary.sessionPaused"),
      status: sessionActive ? t("context.sources.status.active") : t("context.sources.status.paused"),
      tone: sessionActive ? "success" : "",
    },
    {
      key: "questionnaire",
      label: t("context.sources.questionnaire"),
      detail: questionnaireActive ? t("context.sources.summary.questionsReady") : t("context.sources.summary.questionsPaused"),
      status: questionnaireActive ? t("context.sources.status.active") : t("context.sources.status.paused"),
      tone: questionnaireActive ? "success" : "",
    },
  ];

  const gateRows: ContextGateRow[] = [
    {
      key: "bundle",
      label: t("context.gate.contextBundle"),
      body: t("context.gate.contextBundleBody"),
      status: activeSourceCount > 0 ? t("context.sources.status.connected") : t("context.sources.status.pending"),
      tone: activeSourceCount > 0 ? "success" : "warn",
    },
    {
      key: "research",
      label: t("context.gate.researchFusion"),
      body: t("context.gate.researchFusionBody"),
      status: !draft.research.deepResearch
        ? t("context.sources.status.paused")
        : deepActive
          ? t("context.sources.status.active")
          : t("context.sources.status.waiting"),
      tone: !draft.research.deepResearch ? "" : deepActive ? "success" : "warn",
    },
    {
      key: "gaps",
      label: t("context.gate.gapQueue"),
      body: t("context.gate.gapQueueBody"),
      status: intakeActive ? t("context.sources.status.active") : t("context.sources.status.paused"),
      tone: intakeActive ? "blue" : "",
    },
    {
      key: "scope",
      label: t("context.gate.scopeGuard"),
      body: t("context.gate.scopeGuardBody"),
      status: t("context.sources.status.active"),
      tone: "blue",
    },
    {
      key: "subaim",
      label: t("context.gate.subAimGate"),
      body: t("context.gate.subAimGateBody"),
      status: activeSourceCount >= 4 && !onlineNeedsAttention ? t("intake.ready") : t("context.sources.status.waiting"),
      tone: activeSourceCount >= 4 && !onlineNeedsAttention ? "success" : "warn",
    },
  ];

  async function pickFolder() {
    setError(null);
    const result = await window.aimcub.pickLocalContextFolder();
    if (result.canceled || !result.paths[0]) return;
    setDraft((current) => ({
      ...current,
      local: { ...current.local, enabled: true, workspaceRoot: result.paths[0] },
    }));
  }

  async function pickFiles() {
    setError(null);
    const result = await window.aimcub.pickLocalContextFiles();
    if (result.canceled || result.paths.length === 0) return;
    setDraft((current) => ({
      ...current,
      local: {
        ...current.local,
        enabled: true,
        filePaths: uniquePaths([...current.local.filePaths, ...result.paths]),
      },
    }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const next = await window.aimcub.setContextSourceConfig(draft);
      onSaved(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  function addOnlineSource() {
    setDraft((current) => ({
      ...current,
      online: {
        ...current.online,
        enabled: true,
        sources: [
          ...current.online.sources,
          {
            id: nextSourceId(),
            provider: "notion",
            label: "Notion",
            reference: "",
            enabled: true,
          },
        ],
      },
    }));
  }

  function updateOnlineSource(id: string, patch: Partial<OnlineSource>) {
    setDraft((current) => ({
      ...current,
      online: {
        ...current.online,
        sources: current.online.sources.map((source) => source.id === id ? { ...source, ...patch } : source),
      },
    }));
  }

  function removeOnlineSource(id: string) {
    setDraft((current) => ({
      ...current,
      online: {
        ...current.online,
        sources: current.online.sources.filter((source) => source.id !== id),
      },
    }));
  }

  if (variant === "workbench") {
    const localSummary = localActive
      ? t("context.workbench.localReady", { n: localCount })
      : t("context.workbench.localEmpty");
    const helperSummary = [
      draft.online.enabled ? t("context.sources.online") : "",
      draft.research.webEnabled ? t("context.sources.web") : "",
      draft.research.deepResearch ? t("context.sources.deep") : "",
    ].filter(Boolean).join(" · ") || t("context.workbench.helpersQuiet");

    return (
      <section className="od-context-workbench-panel" data-od-id="context-workbench-sources">
        <div className="od-context-workbench-head">
          <div>
            <div style={eyebrowStyle()}>{t("context.workbench.eyebrow")}</div>
            <h2>{t("context.workbench.title")}</h2>
            <p>{t("context.workbench.body")}</p>
          </div>
          {hasUnsavedChanges ? (
            <button disabled={disabled || saving} onClick={() => void save()} style={{ ...primaryButton(disabled || saving), marginTop: 0 }}>
              {saving ? t("context.sources.saving") : t("context.workbench.save")}
            </button>
          ) : (
            <span className={`od-pill ${localActive ? "success" : ""}`}>{localActive ? t("intake.ready") : t("context.sources.status.optional")}</span>
          )}
        </div>

        {error ? <div style={{ ...mutedTextStyle(), color: C.danger }}>{error}</div> : null}

        <div className="od-context-workbench-steps">
          <div className="od-context-workbench-step">
            <span className="od-context-workbench-index">1</span>
            <div>
              <strong>{t("context.workbench.answerTitle")}</strong>
              <p>{t("context.workbench.answerBody")}</p>
            </div>
            <span className={`od-pill ${intakeActive ? "blue" : ""}`}>
              {intakeActive ? t("context.sources.status.active") : t("context.sources.status.paused")}
            </span>
          </div>

          <div className="od-context-workbench-step od-context-workbench-step-local">
            <span className="od-context-workbench-index">2</span>
            <div>
              <strong>{t("context.workbench.localTitle")}</strong>
              <p>{localSummary}</p>
              <div className="od-context-source-actions">
                <button type="button" disabled={disabled || saving} className="od-chip primary" onClick={() => void pickFolder()}>
                  {t("context.sources.pickFolder")}
                </button>
                <button type="button" disabled={disabled || saving} className="od-chip" onClick={() => void pickFiles()}>
                  {t("context.sources.pickFiles")}
                </button>
              </div>
              {draft.local.workspaceRoot ? <div className="od-context-workbench-path">{draft.local.workspaceRoot}</div> : null}
              {draft.local.filePaths.length > 0 ? (
                <div className="od-context-workbench-file-list">
                  {draft.local.filePaths.map((filePath) => (
                    <div key={filePath} className="od-context-path-row">
                      <span>{filePath}</span>
                      <button
                        type="button"
                        disabled={disabled || saving}
                        onClick={() => setDraft((current) => ({
                          ...current,
                          local: {
                            ...current.local,
                            filePaths: current.local.filePaths.filter((path) => path !== filePath),
                          },
                        }))}
                        className="od-context-small-button"
                      >
                        {t("context.sources.remove")}
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
            <span className={`od-pill ${localActive ? "success" : ""}`}>
              {localActive ? t("context.sources.status.connected") : t("context.sources.status.optional")}
            </span>
          </div>

          <div className="od-context-workbench-step">
            <span className="od-context-workbench-index">3</span>
            <div>
              <strong>{t("context.workbench.helpersTitle")}</strong>
              <p>{t("context.workbench.helpersBody")}</p>
              <small>{helperSummary}</small>
            </div>
            {onOpenSettings ? (
              <button type="button" className="od-context-small-button" onClick={onOpenSettings}>
                {t("context.workbench.manage")}
              </button>
            ) : (
              <span className="od-pill">{t("context.sources.status.optional")}</span>
            )}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="od-context-sources-panel" data-compact={compact ? "true" : "false"} style={panelStyle(compact)}>
      <div style={headerStyle()}>
        <div>
          <div style={eyebrowStyle()}>{t("context.sources.title")}</div>
          <h2 style={titleStyle()}>{t("context.sources.heading")}</h2>
        </div>
        <button disabled={disabled || saving} onClick={() => void save()} style={{ ...primaryButton(disabled || saving), marginTop: 0 }}>
          {saving ? t("context.sources.saving") : t("context.sources.save")}
        </button>
      </div>

      {error ? <div style={{ ...mutedTextStyle(), color: C.danger }}>{error}</div> : null}

      <div className="od-context-source-summary" data-od-id="context-source-summary">
        <div className="od-context-source-summary-head">
          <div>
            <span>{t("context.sources.summaryLabel")}</span>
            <strong>{t("context.sources.summary", { n: activeSourceCount })}</strong>
          </div>
          <span className={`od-pill ${summaryTone}`}>{activeSourceCount}/6</span>
        </div>

        <div className="od-context-next-action">
          <span>{t("context.sources.attention")}</span>
          <strong>{attentionText}</strong>
          <span>{t("context.sources.nextAction")}</span>
          <strong>{nextAction}</strong>
        </div>

        <div className="od-context-source-status-list">
          {sourceSummary.map((item) => (
            <div className="od-context-source-status" key={item.key}>
              <div>
                <strong>{item.label}</strong>
                <span>{item.detail}</span>
              </div>
              <span className={`od-pill ${item.tone}`}>{item.status}</span>
            </div>
          ))}
        </div>

        <div className="od-context-gate-list" data-od-id="context-source-gates">
          {gateRows.map((row) => (
            <div className="od-context-gate-row" key={row.key}>
              <strong>{row.label}</strong>
              <span>{row.body}</span>
              <span className={`od-pill ${row.tone}`}>{row.status}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="od-context-source-controls" data-od-id="context-source-controls">
        <section className="od-context-control-group">
          <div className="od-context-control-head">
            <label className="od-context-main-toggle">
              <input
                type="checkbox"
                checked={draft.local.enabled}
                disabled={disabled || saving}
                onChange={(event) => setDraft((current) => ({ ...current, local: { ...current.local, enabled: event.target.checked } }))}
              />
              <span>
                <strong>{t("context.sources.localTitle")}</strong>
                <small>{t("context.sources.entry.localBody")}</small>
              </span>
            </label>
            <span className={`od-pill ${localActive ? "success" : "warn"}`}>
              {localActive ? t("context.sources.status.connected") : t("context.sources.status.pending")}
            </span>
          </div>
          <div className="od-context-source-actions">
            <button type="button" disabled={disabled || saving} className="od-chip primary" onClick={() => void pickFolder()}>
              {t("context.sources.pickFolder")}
            </button>
            <button type="button" disabled={disabled || saving} className="od-chip" onClick={() => void pickFiles()}>
              {t("context.sources.pickFiles")}
            </button>
          </div>
          <label className="od-context-field">
            <span>{t("context.sources.localFolderLabel")}</span>
            <input
              value={draft.local.workspaceRoot ?? ""}
              disabled={disabled || saving}
              onChange={(event) => setDraft((current) => ({
                ...current,
                local: { ...current.local, workspaceRoot: event.target.value || undefined },
              }))}
              placeholder={t("context.sources.folderPlaceholder")}
              style={inputStyle()}
            />
          </label>
          <div className="od-context-attached-list">
            <div className="od-context-list-label">{t("context.sources.localFilesLabel")}</div>
            {draft.local.filePaths.length === 0 ? <div className="od-empty">{t("context.sources.noFiles")}</div> : null}
            {draft.local.filePaths.map((filePath) => (
              <div key={filePath} className="od-context-path-row">
                <span>{filePath}</span>
                <button
                  type="button"
                  disabled={disabled || saving}
                  onClick={() => setDraft((current) => ({
                    ...current,
                    local: {
                      ...current.local,
                      filePaths: current.local.filePaths.filter((path) => path !== filePath),
                    },
                  }))}
                  className="od-context-small-button"
                >
                  {t("context.sources.remove")}
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="od-context-control-group">
          <div className="od-context-control-head">
            <label className="od-context-main-toggle">
              <input
                type="checkbox"
                checked={draft.online.enabled}
                disabled={disabled || saving}
                onChange={(event) => setDraft((current) => ({ ...current, online: { ...current.online, enabled: event.target.checked } }))}
              />
              <span>
                <strong>{t("context.sources.onlineTitle")}</strong>
                <small>{t("context.sources.entry.onlineBody")}</small>
              </span>
            </label>
            <span className={`od-pill ${onlineActive && onlineMissingReferences === 0 ? "success" : draft.online.enabled ? "warn" : ""}`}>
              {!draft.online.enabled
                ? t("context.sources.status.paused")
                : onlineMissingReferences > 0
                  ? t("context.sources.status.needsReference")
                  : onlineActive
                    ? t("context.sources.status.connected")
                    : t("context.sources.status.pending")}
            </span>
          </div>
          <div className="od-context-source-actions">
            <button type="button" disabled={disabled || saving} className="od-chip primary" onClick={addOnlineSource}>
              {t("context.sources.addOnline")}
            </button>
          </div>
          <div className="od-context-online-list">
            {draft.online.sources.length === 0 ? <div className="od-empty">{t("context.sources.noOnline")}</div> : null}
            {draft.online.sources.map((source) => (
              <div key={source.id} className="od-context-online-row">
                <select
                  value={source.provider}
                  disabled={disabled || saving}
                  onChange={(event) => updateOnlineSource(source.id, { provider: event.target.value as OnlineProvider })}
                  style={selectStyle()}
                >
                  {PROVIDERS.map((provider) => <option key={provider} value={provider}>{provider}</option>)}
                </select>
                <input
                  value={source.label}
                  disabled={disabled || saving}
                  onChange={(event) => updateOnlineSource(source.id, { label: event.target.value })}
                  placeholder={t("context.sources.labelPlaceholder")}
                  style={inputStyle()}
                />
                <input
                  value={source.reference}
                  disabled={disabled || saving}
                  onChange={(event) => updateOnlineSource(source.id, { reference: event.target.value })}
                  placeholder={t("context.sources.referencePlaceholder")}
                  style={inputStyle()}
                />
                <label className="od-context-inline-toggle">
                  <input
                    type="checkbox"
                    checked={source.enabled}
                    disabled={disabled || saving}
                    onChange={(event) => updateOnlineSource(source.id, { enabled: event.target.checked })}
                  />
                  {t("context.sources.enabled")}
                </label>
                <button
                  type="button"
                  disabled={disabled || saving}
                  onClick={() => removeOnlineSource(source.id)}
                  className="od-context-small-button"
                >
                  {t("context.sources.remove")}
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="od-context-control-group">
          <div className="od-context-control-title">
            <strong>{t("context.sources.researchTitle")}</strong>
          </div>
          <div className="od-context-setting-grid">
            <label className="od-context-setting-row">
              <input
                type="checkbox"
                checked={draft.research.webEnabled}
                disabled={disabled || saving}
                onChange={(event) => setDraft((current) => ({ ...current, research: { ...current.research, webEnabled: event.target.checked } }))}
              />
              <span>
                <strong>{t("context.sources.webSearch")}</strong>
                <small>{t("context.sources.entry.webBody")}</small>
              </span>
              <span className={`od-pill ${webActive ? "blue" : ""}`}>
                {webActive ? t("context.sources.status.optional") : t("context.sources.status.paused")}
              </span>
            </label>
            <label className="od-context-setting-row">
              <input
                type="checkbox"
                checked={draft.research.deepResearch}
                disabled={disabled || saving}
                onChange={(event) => setDraft((current) => ({ ...current, research: { ...current.research, deepResearch: event.target.checked } }))}
              />
              <span>
                <strong>{t("context.sources.deepResearch")}</strong>
                <small>{t("context.sources.entry.deepBody")}</small>
              </span>
              <span className={`od-pill ${deepActive ? "success" : draft.research.deepResearch ? "warn" : ""}`}>
                {!draft.research.deepResearch
                  ? t("context.sources.status.paused")
                  : deepActive
                    ? t("context.sources.status.active")
                    : t("context.sources.status.waiting")}
              </span>
            </label>
          </div>
        </section>

        <section className="od-context-control-group">
          <div className="od-context-control-title">
            <strong>{t("context.sources.intakeTitle")}</strong>
          </div>
          <div className="od-context-setting-grid">
            <label className="od-context-setting-row">
              <input
                type="checkbox"
                checked={draft.userSession.enabled}
                disabled={disabled || saving}
                onChange={(event) => setDraft((current) => ({ ...current, userSession: { enabled: event.target.checked } }))}
              />
              <span>
                <strong>{t("context.sources.conversation")}</strong>
                <small>{t("context.sources.entry.sessionBody")}</small>
              </span>
              <span className={`od-pill ${sessionActive ? "success" : ""}`}>
                {sessionActive ? t("context.sources.status.active") : t("context.sources.status.paused")}
              </span>
            </label>
            <label className="od-context-setting-row">
              <input
                type="checkbox"
                checked={draft.questionnaire.enabled}
                disabled={disabled || saving}
                onChange={(event) => setDraft((current) => ({ ...current, questionnaire: { enabled: event.target.checked } }))}
              />
              <span>
                <strong>{t("context.sources.questionnaire")}</strong>
                <small>{t("context.sources.entry.questionsBody")}</small>
              </span>
              <span className={`od-pill ${questionnaireActive ? "success" : ""}`}>
                {questionnaireActive ? t("context.sources.status.active") : t("context.sources.status.paused")}
              </span>
            </label>
          </div>
        </section>
      </div>
    </section>
  );
}

function panelStyle(compact: boolean): CSSProperties {
  if (compact) {
    return {
      background: "transparent",
      border: "0",
      borderRadius: 0,
      padding: 0,
    };
  }
  return {
    background: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    padding: compact ? 14 : 18,
  };
}

function headerStyle(): CSSProperties {
  return { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 14 };
}

function eyebrowStyle(): CSSProperties {
  return { color: C.accent, fontSize: TYPE.meta, fontWeight: WEIGHT.strong, textTransform: "uppercase", letterSpacing: 0 };
}

function titleStyle(): CSSProperties {
  return { margin: "4px 0 0", fontSize: TYPE.title, letterSpacing: 0 };
}

function selectStyle(): CSSProperties {
  return { ...inputStyle(), height: 42 };
}

function mutedTextStyle(): CSSProperties {
  return { color: C.muted, fontSize: TYPE.meta, lineHeight: 1.45, overflowWrap: "anywhere" };
}
