---
"@aimcub/local-agent": patch
---

Capture a run's file-level work product and type its selection failures. Adapters may now report the files a tool touched (`LocalAgentEvent.artifacts`, implemented for Codex `file_change`/patch payloads and Claude `Write`/`Edit` tool calls); the orchestrator persists each newly seen path as an `artifact.created` run event, folds a deduped artifacts summary into the run's `mcp_report` evidence, and writes one `evidence.reported` event linking that evidence back into the run timeline. Runtime `raw` payloads are now retained on persisted events under an 8 KB per-event cap and a 256 KB per-run budget, with explicit truncation markers. Selection failures (no ready sub-aim or runtime, unknown id, not installed, not authenticated) throw typed `RunSelectionError`s, so `aimcub run --agent claude` prints "Claude Code is not authenticated." instead of "Unexpected error: ...".
