---
"@app/desktop": patch
---

Make agent execution permissions explicit and inspectable in the cockpit. The Execute stage now asks for per-run consent (sandbox read-only/workspace-write, network off/on; `danger-full-access` is never offered) and shows a per-run timeline built from persisted run events, rendering unknown event types generically. Store corruption/recovery is surfaced as a dismissible banner instead of looking like an empty workspace, and a Settings → General developer-mode toggle (off by default) now gates every debug-shaped surface. The queue's safety property is preserved and generalized: the background drain stays scoped to read-only runs, so a widened run only ever executes via claim-by-id in the session that consented to it. New: `docs/agent-permissions.md`.
