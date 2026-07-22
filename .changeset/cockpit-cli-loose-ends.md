---
"@app/desktop": patch
"@app/cli": patch
"@core/local-agent": patch
---

Close four small loose ends carried from the permissions-inspection and artifact-capture work. The Context stage now mounts a raw planning-trace inspector behind developer mode (its data was already live, just unmounted since a prior layout pass). The Execute stage surfaces a `workspace-write` run a previous session left queued — "queued with access granted in an earlier session" — with an explicit re-grant (re-confirm and claim by the run's existing id) or cancel action, since the background drain never claims it on its own; `docs/agent-permissions.md` describes the affordance. `aimcub run --jsonl` now streams a tool event's `artifacts` instead of dropping them. Enqueue additionally records which surface (`desktop` or `cli`) queued a run, additive and optional so older queued rows keep working; the run timeline shows it as provenance ("Queued by CLI") and the desktop main process logs why a stranded run isn't executing, without changing what the background drain is allowed to claim.
