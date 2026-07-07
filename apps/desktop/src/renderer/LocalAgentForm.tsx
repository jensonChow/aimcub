import { useState } from "react";

import type { LocalAgentDetection, LocalAgentId, LocalAgentRunResult } from "../shared/ipc";

import { useI18n } from "./i18n";
import { Button, EmptyState, Panel, Row } from "./ui";

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
    <Panel variant="plain" className="od-preference-card">
      <div className="od-form-head">
        <div>
          <div className="od-form-title">{t("laf.title")}</div>
          <div className="od-form-body">{t("laf.blurb")}</div>
        </div>
        <Button variant="ghost" size="sm" onClick={refresh}>{refreshing ? t("laf.scanning") : t("laf.rescan")}</Button>
      </div>

      <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
        {(agents ?? []).map((agent) => {
          const test = tests[agent.id];
          const ready = agent.available && agent.authStatus !== "missing";
          return (
            <Panel
              as="article"
              key={agent.id}
              tone={ready ? "neutral" : "warn"}
              style={{ display: "grid", gap: 8 }}
            >
              <Row
                trailing={(
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => runSmokeTest(agent)}
                    disabled={!ready || test?.busy}
                  >
                    {test?.busy ? t("laf.testing") : t("laf.test")}
                  </Button>
                )}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: "var(--od-font-weight-strong)" }}>{agent.name}</div>
                  <div className="od-ui-status-text" style={{ marginTop: 2 }}>
                    {agent.available ? t("laf.installed") : t("laf.notInstalled")}
                    {agent.version ? ` · ${agent.version}` : ""}
                    {agent.authStatus !== "unknown" ? ` · ${t(authLabelKey(agent.authStatus))}` : ""}
                  </div>
                </div>
              </Row>
              <div className="od-ui-status-text" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {agent.path ?? agent.diagnostics[0] ?? t("laf.noPath")}
              </div>
              <div className="od-ui-status-text">
                {t("laf.models", { n: agent.models.length, source: agent.modelsSource })}
              </div>
              {agent.authMessage && agent.authStatus !== "ok" && (
                <div className="od-ui-status-text" data-tone="danger">{agent.authMessage}</div>
              )}
              {test?.result && (
                <div className="od-ui-status-text" data-tone={test.result.ok ? "success" : "danger"}>
                  {test.result.ok ? t("laf.testOk", { ms: test.result.durationMs }) : test.result.error ?? t("laf.testFailed")}
                </div>
              )}
              {test?.error && !test.result && (
                <div className="od-ui-status-text" data-tone="danger">{test.error}</div>
              )}
            </Panel>
          );
        })}
        {agents && agents.length === 0 && <EmptyState style={{ minHeight: 96 }} title={t("laf.empty")} />}
        {!agents && <EmptyState style={{ minHeight: 96 }} title={t("laf.loading")} />}
      </div>
    </Panel>
  );
}
