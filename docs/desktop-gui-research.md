# Desktop GUI Research Memo

Status: historical. Current Desktop visual and interaction decisions are owned by `docs/memory/design-system.md` and `docs/memory/desktop.md`. If this memo conflicts with those memory files, the memory files win.

This memo records the information architecture behind the first Aim OS desktop shell. The goal is not to copy another agent UI, but to make Aimcub's own primitive clear: an Aim is the primary object, and process, context, quality, and evidence are supporting layers.

## Source Scan

- Claude Code exposes one agent engine across terminal, IDE, desktop, and web surfaces. Its useful pattern for Aimcub is process visibility without turning the main workspace into a log stream: plans, tools, permissions, diffs, sessions, and review surfaces stay inspectable while work remains centered on the task. Source: https://code.claude.com/docs/en/overview
- Codex desktop is closer to a command center: project/thread navigation, parallel work, a review pane, and command-oriented workflows. The transferable pattern is a persistent project/thread rail plus a focused review/inspection layer. Sources: https://developers.openai.com/codex/app, https://developers.openai.com/codex/app/features, https://developers.openai.com/codex/app/review
- OpenClaw frames gateway, sessions, channels, and memory as first-class operational state. The transferable pattern is to make memory/context health visible as controls and diagnostics, not as the central work product. Sources: https://docs.openclaw.ai/, https://docs.openclaw.ai/concepts/memory
- Hermes did not have a stable official product documentation surface in this research pass. Treat it as a design hypothesis only: post-task reflection and reusable procedural skill reuse can inform future UI, but should not become a hard dependency until verified against a durable source.

## Transferable Principles

### Claude Code

- Show what the user is doing now through a focused working surface, not an overloaded dashboard.
- Show what the system is using through inspectable process, tool, permission, and review artifacts.
- Keep the next valuable action obvious: approve, clarify, review, save, or continue.

### Codex

- Keep navigation persistent so a user can switch work without losing orientation.
- Separate creation from review: the primary pane is for the current thread/task, while review panes make changes and evidence inspectable.
- Support parallel mental models: project list, active thread, terminal/process/review each have stable places.

### OpenClaw

- Treat sessions, channels, and memory as operational state with status and controls.
- Make memory visible as a substrate that helps current work, not as the main artifact.
- Put control-plane information in a compact console/inspector rather than the main task flow.

### Hermes Hypothesis

- If verified later, post-task reflection should surface as an Activity or Learning view.
- Reusable skill candidates should be explicit candidates, not silently installed behavior.
- Skill reuse should show invocation conditions and confidence before it affects future planning.

## Aimcub Mapping

- Aim maps above project/thread: it is the durable user intent and the center of the GUI.
- Milestone is the verifiable progress unit: title, owner, acceptance summary, and status are visible by default; contracts and evidence rules are expanded on demand.
- Context is the personalization substrate: Used, Missing, Learned, and Pending context belongs in the Inspector, not the main stream.
- Process is the audit trail: display stage summaries, timestamps, and tool/context usage, never hidden model chain-of-thought.
- Quality is the pre-save review surface: scorecards, decomposition strategy, review actions, and retry status live beside the plan.

## Implemented Direction

- Three-column desktop shell: Aim navigation, current Aim surface, and Inspector.
- Home emphasizes active/recent aims with a single New Aim CTA in the empty state.
- Aim Detail emphasizes title, description, milestone count, next action, and compact milestones.
- Inspector tabs hold Process, Context, Quality, and Activity.
- Existing IPC and storage are reused; no schema, runtime, MCP, or tool boundary changes are introduced by this GUI pass.
