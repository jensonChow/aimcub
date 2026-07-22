---
"@aimcub/local-agent": patch
---

Give local agent execution a durable run queue with streamed, persisted events. Queued runs live in the existing `runs` collection and are claimed atomically, so Desktop and the CLI can drain the same store safely. The CLI and Desktop run pipelines are unified behind one orchestrator in `@aimcub/local-agent`; Desktop's `runMilestoneAgent` now enqueues and returns while events stream to the cockpit, retryable failures re-enqueue once, executing runs can be cancelled, and `aimcub run --until-blocked` drains every ready agent-owned sub-aim.
