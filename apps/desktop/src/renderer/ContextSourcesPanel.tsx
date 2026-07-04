import { useEffect, useState, type CSSProperties } from "react";

import type { ContextSourceConfig, ContextSourceStatus } from "../shared/ipc";
import { useI18n } from "./i18n";
import { C, inputStyle, primaryButton, secondaryButton } from "./styles";

type OnlineSource = ContextSourceConfig["online"]["sources"][number];
type OnlineProvider = OnlineSource["provider"];

interface ContextSourcesPanelProps {
  status: ContextSourceStatus | null;
  disabled?: boolean;
  compact?: boolean;
  onSaved: (status: ContextSourceStatus) => void;
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

export function ContextSourcesPanel({ status, disabled = false, compact = false, onSaved }: ContextSourcesPanelProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<ContextSourceConfig>(() => configFromStatus(status));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(configFromStatus(status));
  }, [status]);

  const localCount = draft.local.filePaths.length + (draft.local.workspaceRoot ? 1 : 0);
  const onlineEnabled = draft.online.sources.filter((source) => source.enabled).length;
  const localActive = draft.local.enabled && localCount > 0;
  const onlineActive = draft.online.enabled && onlineEnabled > 0;
  const webActive = draft.research.webEnabled;
  const deepActive = draft.research.deepResearch && webActive && localActive;
  const sessionActive = draft.userSession.enabled;
  const questionnaireActive = draft.questionnaire.enabled;
  const activeSourceCount = [localActive, onlineActive, webActive, deepActive, sessionActive, questionnaireActive]
    .filter(Boolean).length;

  const gateRows = [
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
      status: deepActive ? t("context.sources.status.active") : t("context.sources.status.waiting"),
      tone: deepActive ? "success" : "warn",
    },
    {
      key: "gaps",
      label: t("context.gate.gapQueue"),
      body: t("context.gate.gapQueueBody"),
      status: questionnaireActive ? t("context.sources.status.gaps", { n: 2 }) : t("context.sources.status.paused"),
      tone: questionnaireActive ? "warn" : "",
    },
    {
      key: "scope",
      label: t("context.gate.scopeGuard"),
      body: t("context.gate.scopeGuardBody"),
      status: t("context.sources.status.active"),
      tone: "",
    },
    {
      key: "subaim",
      label: t("context.gate.subAimGate"),
      body: t("context.gate.subAimGateBody"),
      status: activeSourceCount >= 4 ? t("intake.ready") : t("os.blocked"),
      tone: activeSourceCount >= 4 ? "success" : "warn",
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

  return (
    <section style={panelStyle(compact)}>
      <div style={headerStyle()}>
        <div>
          <div style={eyebrowStyle()}>{t("context.sources.title")}</div>
          <h2 style={titleStyle()}>{t("context.sources.heading")}</h2>
        </div>
        <button disabled={disabled || saving} onClick={() => void save()} style={{ ...primaryButton(disabled || saving), marginTop: 0 }}>
          {saving ? t("context.sources.saving") : t("context.sources.save")}
        </button>
      </div>

      <div style={summaryGridStyle()}>
        <Metric label={t("context.sources.local")} value={String(localCount)} />
        <Metric label={t("context.sources.online")} value={String(onlineEnabled)} />
        <Metric label={t("context.sources.web")} value={draft.research.webEnabled ? t("context.sources.on") : t("context.sources.off")} />
        <Metric label={t("context.sources.deep")} value={draft.research.deepResearch ? t("context.sources.on") : t("context.sources.off")} />
      </div>

      {error ? <div style={{ ...mutedTextStyle(), color: C.danger }}>{error}</div> : null}

      <div className="od-card-head">
        <div>
          <div style={eyebrowStyle()}>{t("context.sources.title")}</div>
          <h3 style={{ ...titleStyle(), marginTop: 2 }}>{t("context.sources.summary", { n: activeSourceCount })}</h3>
        </div>
        <span className={`od-pill ${activeSourceCount >= 4 ? "success" : "warn"}`}>
          {activeSourceCount}/6
        </span>
      </div>

      <div className="od-context-entry-grid" data-od-id="context-candidates">
        <article className="od-context-entry-card" data-state={localActive ? "active" : "disabled"} data-od-id="context-local-files">
          <div className="od-entry-head">
            <h3>{t("context.sources.localTitle")}</h3>
            <span className={`od-pill ${localActive ? "success" : "warn"}`}>
              {localActive ? t("context.sources.status.connected") : t("context.sources.status.pending")}
            </span>
          </div>
          <p>{t("context.sources.entry.localBody")}</p>
          <div className="od-context-action-row">
            <button type="button" disabled={disabled || saving} className="od-chip primary" onClick={() => void pickFolder()}>
              {t("context.sources.pickFolder")}
            </button>
            <button type="button" disabled={disabled || saving} className="od-chip" onClick={() => void pickFiles()}>
              {t("context.sources.pickFiles")}
            </button>
          </div>
        </article>

        <article className="od-context-entry-card" data-state={onlineActive ? "active" : "disabled"} data-od-id="context-online-folders">
          <div className="od-entry-head">
            <h3>{t("context.sources.onlineTitle")}</h3>
            <span className={`od-pill ${onlineActive ? "success" : "warn"}`}>
              {onlineActive ? t("context.sources.status.connected") : t("context.sources.status.pending")}
            </span>
          </div>
          <p>{t("context.sources.entry.onlineBody")}</p>
          <div className="od-context-action-row">
            <button type="button" disabled={disabled || saving} className="od-chip primary" onClick={addOnlineSource}>
              {t("context.sources.addOnline")}
            </button>
            <button
              type="button"
              disabled={disabled || saving}
              className="od-chip"
              onClick={() => setDraft((current) => ({ ...current, online: { ...current.online, enabled: !current.online.enabled } }))}
            >
              {draft.online.enabled ? t("context.sources.pause") : t("context.sources.enable")}
            </button>
          </div>
        </article>

        <article className="od-context-entry-card" data-state={webActive ? "active" : "disabled"} data-od-id="context-web-search">
          <div className="od-entry-head">
            <h3>{t("context.sources.webSearch")}</h3>
            <span className={`od-pill ${webActive ? "blue" : ""}`}>
              {webActive ? t("context.sources.status.optional") : t("context.sources.status.paused")}
            </span>
          </div>
          <p>{t("context.sources.entry.webBody")}</p>
          <div className="od-context-action-row">
            <button
              type="button"
              disabled={disabled || saving}
              className="od-chip primary"
              onClick={() => setDraft((current) => ({ ...current, research: { ...current.research, webEnabled: !current.research.webEnabled } }))}
            >
              {webActive ? t("context.sources.pause") : t("context.sources.enable")}
            </button>
          </div>
        </article>

        <article className="od-context-entry-card" data-state={deepActive ? "active" : "disabled"} data-od-id="context-deep-research">
          <div className="od-entry-head">
            <h3>{t("context.sources.deepResearch")}</h3>
            <span className={`od-pill ${deepActive ? "success" : "warn"}`}>
              {deepActive ? t("context.sources.status.active") : t("context.sources.status.waiting")}
            </span>
          </div>
          <p>{t("context.sources.entry.deepBody")}</p>
          <div className="od-context-action-row">
            <button
              type="button"
              disabled={disabled || saving}
              className="od-chip primary"
              onClick={() => setDraft((current) => ({ ...current, research: { ...current.research, deepResearch: !current.research.deepResearch } }))}
            >
              {draft.research.deepResearch ? t("context.sources.pause") : t("context.sources.enable")}
            </button>
          </div>
        </article>

        <article className="od-context-entry-card" data-state={sessionActive ? "active" : "disabled"} data-od-id="context-conversation-session">
          <div className="od-entry-head">
            <h3>{t("context.sources.conversation")}</h3>
            <span className={`od-pill ${sessionActive ? "success" : ""}`}>
              {sessionActive ? t("context.sources.status.active") : t("context.sources.status.paused")}
            </span>
          </div>
          <p>{t("context.sources.entry.sessionBody")}</p>
          <div className="od-context-action-row">
            <button
              type="button"
              disabled={disabled || saving}
              className="od-chip primary"
              onClick={() => setDraft((current) => ({ ...current, userSession: { enabled: !current.userSession.enabled } }))}
            >
              {sessionActive ? t("context.sources.pause") : t("context.sources.enable")}
            </button>
          </div>
        </article>

        <article className="od-context-entry-card" data-state={questionnaireActive ? "active" : "disabled"} data-od-id="context-choice-questions">
          <div className="od-entry-head">
            <h3>{t("context.sources.questionnaire")}</h3>
            <span className={`od-pill ${questionnaireActive ? "warn" : ""}`}>
              {questionnaireActive ? t("context.sources.status.gaps", { n: 2 }) : t("context.sources.status.paused")}
            </span>
          </div>
          <p>{t("context.sources.entry.questionsBody")}</p>
          <div className="od-context-action-row">
            <button
              type="button"
              disabled={disabled || saving}
              className="od-chip primary"
              onClick={() => setDraft((current) => ({ ...current, questionnaire: { enabled: !current.questionnaire.enabled } }))}
            >
              {questionnaireActive ? t("context.sources.pause") : t("context.sources.enable")}
            </button>
          </div>
        </article>
      </div>

      <div className="od-context-table" data-od-id="context-source-table">
        {gateRows.map((row) => (
          <div className="od-context-row" key={row.key}>
            <strong>{row.label}</strong>
            <span>{row.body}</span>
            <span className={`od-pill ${row.tone}`}>{row.status}</span>
          </div>
        ))}
      </div>

      <div style={gridStyle()}>
        <div style={sourceBlockStyle()}>
          <div style={blockHeaderStyle()}>
            <label style={toggleLabelStyle()}>
              <input
                type="checkbox"
                checked={draft.local.enabled}
                onChange={(event) => setDraft((current) => ({ ...current, local: { ...current.local, enabled: event.target.checked } }))}
              />
              {t("context.sources.localTitle")}
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={() => void pickFolder()} style={{ ...secondaryButton(), marginTop: 0 }}>
                {t("context.sources.pickFolder")}
              </button>
              <button type="button" onClick={() => void pickFiles()} style={{ ...secondaryButton(), marginTop: 0 }}>
                {t("context.sources.pickFiles")}
              </button>
            </div>
          </div>
          <input
            value={draft.local.workspaceRoot ?? ""}
            onChange={(event) => setDraft((current) => ({
              ...current,
              local: { ...current.local, workspaceRoot: event.target.value || undefined },
            }))}
            placeholder={t("context.sources.folderPlaceholder")}
            style={inputStyle()}
          />
          <div style={listStyle()}>
            {draft.local.filePaths.length === 0 ? <div style={mutedTextStyle()}>{t("context.sources.noFiles")}</div> : null}
            {draft.local.filePaths.map((filePath) => (
              <div key={filePath} style={pathRowStyle()}>
                <span>{filePath}</span>
                <button
                  type="button"
                  onClick={() => setDraft((current) => ({
                    ...current,
                    local: {
                      ...current.local,
                      filePaths: current.local.filePaths.filter((path) => path !== filePath),
                    },
                  }))}
                  style={smallButtonStyle()}
                >
                  {t("context.sources.remove")}
                </button>
              </div>
            ))}
          </div>
        </div>

        <div style={sourceBlockStyle()}>
          <div style={blockHeaderStyle()}>
            <label style={toggleLabelStyle()}>
              <input
                type="checkbox"
                checked={draft.online.enabled}
                onChange={(event) => setDraft((current) => ({ ...current, online: { ...current.online, enabled: event.target.checked } }))}
              />
              {t("context.sources.onlineTitle")}
            </label>
            <button type="button" onClick={addOnlineSource} style={{ ...secondaryButton(), marginTop: 0 }}>
              {t("context.sources.addOnline")}
            </button>
          </div>
          <div style={listStyle()}>
            {draft.online.sources.length === 0 ? <div style={mutedTextStyle()}>{t("context.sources.noOnline")}</div> : null}
            {draft.online.sources.map((source) => (
              <div key={source.id} style={onlineRowStyle()}>
                <select
                  value={source.provider}
                  onChange={(event) => updateOnlineSource(source.id, { provider: event.target.value as OnlineProvider })}
                  style={selectStyle()}
                >
                  {PROVIDERS.map((provider) => <option key={provider} value={provider}>{provider}</option>)}
                </select>
                <input
                  value={source.label}
                  onChange={(event) => updateOnlineSource(source.id, { label: event.target.value })}
                  placeholder={t("context.sources.labelPlaceholder")}
                  style={inputStyle()}
                />
                <input
                  value={source.reference}
                  onChange={(event) => updateOnlineSource(source.id, { reference: event.target.value })}
                  placeholder={t("context.sources.referencePlaceholder")}
                  style={{ ...inputStyle(), gridColumn: "1 / -1" }}
                />
                <label style={miniToggleStyle()}>
                  <input
                    type="checkbox"
                    checked={source.enabled}
                    onChange={(event) => updateOnlineSource(source.id, { enabled: event.target.checked })}
                  />
                  {t("context.sources.enabled")}
                </label>
                <button type="button" onClick={() => removeOnlineSource(source.id)} style={smallButtonStyle()}>
                  {t("context.sources.remove")}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={controlGridStyle()}>
        <Toggle
          label={t("context.sources.webSearch")}
          checked={draft.research.webEnabled}
          onChange={(checked) => setDraft((current) => ({ ...current, research: { ...current.research, webEnabled: checked } }))}
        />
        <Toggle
          label={t("context.sources.deepResearch")}
          checked={draft.research.deepResearch}
          onChange={(checked) => setDraft((current) => ({ ...current, research: { ...current.research, deepResearch: checked } }))}
        />
        <Toggle
          label={t("context.sources.conversation")}
          checked={draft.userSession.enabled}
          onChange={(checked) => setDraft((current) => ({ ...current, userSession: { enabled: checked } }))}
        />
        <Toggle
          label={t("context.sources.questionnaire")}
          checked={draft.questionnaire.enabled}
          onChange={(checked) => setDraft((current) => ({ ...current, questionnaire: { enabled: checked } }))}
        />
      </div>
    </section>
  );
}

function Toggle(props: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label style={toggleCardStyle(props.checked)}>
      <input type="checkbox" checked={props.checked} onChange={(event) => props.onChange(event.target.checked)} />
      <span>{props.label}</span>
    </label>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={metricStyle()}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function panelStyle(compact: boolean): CSSProperties {
  return {
    background: "#fff",
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    padding: compact ? 14 : 18,
  };
}

function headerStyle(): CSSProperties {
  return { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 14 };
}

function eyebrowStyle(): CSSProperties {
  return { color: C.accent, fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0 };
}

function titleStyle(): CSSProperties {
  return { margin: "4px 0 0", fontSize: 18, letterSpacing: 0 };
}

function summaryGridStyle(): CSSProperties {
  return { display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10, marginBottom: 12 };
}

function gridStyle(): CSSProperties {
  return { display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 12 };
}

function sourceBlockStyle(): CSSProperties {
  return { border: `1px solid ${C.border}`, borderRadius: 8, padding: 12, minWidth: 0 };
}

function blockHeaderStyle(): CSSProperties {
  return { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" };
}

function toggleLabelStyle(): CSSProperties {
  return { display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 800 };
}

function miniToggleStyle(): CSSProperties {
  return { display: "inline-flex", alignItems: "center", gap: 6, color: C.muted, fontSize: 12 };
}

function listStyle(): CSSProperties {
  return { display: "grid", gap: 8, marginTop: 10 };
}

function pathRowStyle(): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    gap: 8,
    alignItems: "center",
    color: C.muted,
    fontSize: 12,
    overflowWrap: "anywhere",
  };
}

function onlineRowStyle(): CSSProperties {
  return { display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: 8, alignItems: "center" };
}

function selectStyle(): CSSProperties {
  return { ...inputStyle(), height: 42 };
}

function smallButtonStyle(): CSSProperties {
  return {
    border: `1px solid ${C.border}`,
    background: "#fff",
    borderRadius: 6,
    padding: "6px 8px",
    color: C.muted,
    fontWeight: 750,
    cursor: "pointer",
  };
}

function controlGridStyle(): CSSProperties {
  return { display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10, marginTop: 12 };
}

function toggleCardStyle(active: boolean): CSSProperties {
  return {
    border: `1px solid ${active ? C.accent : C.border}`,
    borderRadius: 8,
    background: active ? "#eef6f8" : "#fff",
    color: active ? C.accent : C.text,
    padding: "10px 12px",
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    fontWeight: 800,
    minWidth: 0,
  };
}

function metricStyle(): CSSProperties {
  return {
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    padding: 10,
    background: "#fff",
    display: "grid",
    gap: 4,
  };
}

function mutedTextStyle(): CSSProperties {
  return { color: C.muted, fontSize: 12, lineHeight: 1.45, overflowWrap: "anywhere" };
}
