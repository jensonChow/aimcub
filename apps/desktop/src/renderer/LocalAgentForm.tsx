import { useState } from "react";

import type { LocalAgentDetection, LocalAgentId, LocalAgentRunResult } from "../shared/ipc";

import { useI18n } from "./i18n";
import { C, linkButton, secondaryButton } from "./styles";

interface LocalAgentFormProps {
  agents: LocalAgentDetection[] | null;
  onRefresh: () => Promise<void>;
}

type TestState = Record<LocalAgentId, { busy: boolean; result: LocalAgentRunResult | null; error: string | null }>;

function authLabelKey(status: LocalAgentDetection["authStatus"]) {
  if (status === "ok") return "laf.auth.ok";
  if (status === "missing") return "laf.auth.missing";
  return "laf.auth.unknown";
}

export function LocalAgentForm({ agents, onRefresh }: LocalAgentFormProps) {
  const { t } = useI18n();
  const [refreshing, setRefreshing] = useState(false);
  const [tests, setTests] = useState<TestState>({
    codex: { busy: false, result: null, error: null },
    claude: { busy: false, result: null, error: null },
  });

  async function refresh() {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }

  async function runSmokeTest(agent: LocalAgentDetection) {
    setTests((prev) => ({ ...prev, [agent.id]: { busy: true, result: null, error: null } }));
    try {
      const result = await window.aimcub.runLocalAgent({
        agentId: agent.id,
        prompt: "Reply with OK only.",
        model: agent.models[0]?.id ?? "default",
        permission: { sandbox: "read-only", network: false },
        timeoutMs: 45_000,
      });
      setTests((prev) => ({ ...prev, [agent.id]: { busy: false, result, error: result.error } }));
    } catch (err) {
      setTests((prev) => ({
        ...prev,
        [agent.id]: { busy: false, result: null, error: err instanceof Error ? err.message : String(err) },
      }));
    }
  }

  return (
    <div className="od-preference-card">
      <div className="od-form-head">
        <div>
          <div className="od-form-title">{t("laf.title")}</div>
          <div className="od-form-body">{t("laf.blurb")}</div>
        </div>
        <button onClick={refresh} style={linkButton()}>{refreshing ? t("laf.scanning") : t("laf.rescan")}</button>
      </div>

      <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
        {(agents ?? []).map((agent) => {
          const test = tests[agent.id];
          const ready = agent.available && agent.authStatus !== "missing";
          return (
            <div
              key={agent.id}
              style={{
                border: `1px solid ${ready ? C.border : C.warnBorder}`,
                borderRadius: 8,
                padding: 12,
                background: ready ? C.surface : C.warnBg,
                display: "grid",
                gap: 8,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700 }}>{agent.name}</div>
                  <div style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>
                    {agent.available ? t("laf.installed") : t("laf.notInstalled")}
                    {agent.version ? ` · ${agent.version}` : ""}
                    {agent.authStatus !== "unknown" ? ` · ${t(authLabelKey(agent.authStatus))}` : ""}
                  </div>
                </div>
                <button
                  onClick={() => runSmokeTest(agent)}
                  disabled={!ready || test?.busy}
                  style={{ ...secondaryButton(), padding: "7px 10px", opacity: ready && !test?.busy ? 1 : 0.55 }}
                >
                  {test?.busy ? t("laf.testing") : t("laf.test")}
                </button>
              </div>
              <div style={{ color: C.muted, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {agent.path ?? agent.diagnostics[0] ?? t("laf.noPath")}
              </div>
              <div style={{ color: C.muted, fontSize: 12 }}>
                {t("laf.models", { n: agent.models.length, source: agent.modelsSource })}
              </div>
              {agent.authMessage && agent.authStatus !== "ok" && (
                <div style={{ color: C.danger, fontSize: 12 }}>{agent.authMessage}</div>
              )}
              {test?.result && (
                <div style={{ color: test.result.ok ? C.success : C.danger, fontSize: 12 }}>
                  {test.result.ok ? t("laf.testOk", { ms: test.result.durationMs }) : test.result.error ?? t("laf.testFailed")}
                </div>
              )}
              {test?.error && !test.result && (
                <div style={{ color: C.danger, fontSize: 12 }}>{test.error}</div>
              )}
            </div>
          );
        })}
        {agents && agents.length === 0 && <div style={{ color: C.muted, fontSize: 13 }}>{t("laf.empty")}</div>}
        {!agents && <div style={{ color: C.muted, fontSize: 13 }}>{t("laf.loading")}</div>}
      </div>
    </div>
  );
}
