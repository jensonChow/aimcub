# Desktop Local Alpha Polish Audit

Last updated: 2026-07-07

## Scope

This audit covers the current Desktop local alpha loop:

- Aim
- Context
- Plan / Contracts
- Execute
- Eval
- Settings only where it affects the stage loop

The goal is a focused polish spec for the next product-quality pass. It is not
an implementation plan for broad redesign, and it must not change the tuned
Desktop shell/sidebar/window-chrome framework.

## Inspection Summary

Code and CSS inspected:

- `apps/desktop/src/renderer/App.tsx`
- `apps/desktop/src/renderer/CockpitShell.tsx`
- `apps/desktop/src/renderer/cockpit.css`
- `apps/desktop/src/renderer/stages/context/`
- `apps/desktop/src/renderer/stages/plan/`
- `apps/desktop/src/renderer/stages/execute/`
- `apps/desktop/src/renderer/stages/eval/`
- `apps/desktop/src/renderer/ui/`
- `apps/desktop/src/renderer/ContextSourcesPanel.tsx`

Live visual pass:

- Installed dependencies with `pnpm install --frozen-lockfile --store-dir /private/tmp/aimcub-pnpm-store`.
- Built Desktop with `pnpm --filter @app/desktop build`.
- Launched compiled Electron with an isolated temporary profile and CDP remote debugging.
- CDP did not expose native window bounds APIs, so screenshots used viewport emulation at 960x680, 760x600, and 640x520.
- Live inspection covered empty Aim, opened Aim composer, and generated Context intake. Plan/Execute/Eval findings below are code/CSS-backed because the seeded visual run hit the context gate before a savable plan.

## Current State

The Desktop loop is no longer a raw debug cockpit. It has a real five-stage
product path: Aim, Context, Plan/Contracts, Execute, and Eval. Context, Plan,
Execute, and Eval now live mostly in stage-owned components instead of large
inline `App.tsx` bodies. The shell remains the stable two-column Desktop frame,
with the normal sidebar collapsed by default at narrow sizes.

The strongest product state is:

- Aim has a quiet empty workspace and a compact composer that stays stable down to 640x520.
- Context has a first-party intake flow, one active blocking question at a time, local material attachment, settings handoff, and context bundle review.
- Plan/Contracts has editable decomposition contracts, direct structure edits, routing override controls, validation, and raw acceptance-rule JSON hidden behind an explicit developer disclosure.
- Execute shows assignment/run/evidence state, human proof submission, child breakdown, and compact activity summaries without default raw run-event streams.
- Eval is the trust center: evaluator matches, evidence rows, trust scores, missing/low-trust proof, completion recap, and Context Inbox are in the Eval flow.

The main remaining problem is not feature absence. It is first-viewport
prioritization, density, and stage-level hierarchy.

## Top 10 Issues

1. Workflow step pills overlap the sidebar toggle in live Context screenshots at 960x680 and 760x600.
   - Do not move or rewrite the shell toggle. Fix this from the stage-nav/workspace safe-area side.

2. Context does not fully honor one primary task when a blocking question is active.
   - The live Context view shows aim summary, blocking question, disabled Continue, and the source workbench in the same scroll flow.

3. The Context aim summary consumes too much first-viewport space.
   - At 640x520, the user sees a card-like summary and the top of the question, but not enough of the actual answer task.

4. Context shows a disabled primary action before the active question can be answered.
   - The disabled Continue to Plan is visible as a major pill beside the question heading. It reads like the main action but cannot be used yet.

5. Plan/Contracts is productized, but each sub-aim card is doing too much.
   - One repeated card holds title/body editing, why/done/evidence/eval fields, routing summary, routing controls, five structure actions, rule summary, developer details, and validation.

6. Plan structure actions are text-heavy and visually equal to contract review.
   - Move/merge/split are important edit commands, but repeated text buttons create clutter and should move toward compact icon/overflow controls with tooltips.

7. Execute has no single dominant next-work pattern.
   - Each milestone row contains a full local-agent summary, evidence preview, next action, and three equal secondary actions. Run Agent, Confirm Proof, and Break Down all compete.

8. Execute and Eval duplicate evidence review density.
   - Execute should answer "what should happen next?" Eval should answer "what evidence passed, failed, or needs review?" Today Execute already carries enough evidence detail to feel like a second Eval.

9. Eval risks report overload.
   - Metrics, review strip, evaluator rows, evidence rows, milestone cards, empty context-candidate state, and recap sections are all useful individually, but the default view should lead with the smallest actionable trust summary.

10. Stage content still mixes CSS primitives with inline style islands.
   - `ContextClarifyPanel`, `ContextSourcesPanel`, locked panels, and some Aim/Settings pieces still rely on inline style helpers. This makes 4px grid consistency and low-risk polish harder.

## Stage Fixes

### Aim

Current state:

- Empty workspace is quiet and correctly avoids chat, textarea, workflow pills, and helper setup.
- New Aim composer is compact, centered, and stable at 640x520 in the live pass.
- Existing aims open an overview before workflow details. Completed aims route to Eval recap.

Fixes:

- Keep the initial empty workspace as-is.
- Keep the composer as the first product-quality reference surface.
- Make sure any future Aim helper guidance remains below the composer and does not become an onboarding card stack.
- If the global busy notice appears while the user is still on the Aim composer, keep it physically tied to the current action; a detached top notice can read like unrelated system state.

Do not touch:

- Home Panel / New Aim sidebar actions.
- Sidebar selected state, hover state, or shortcut reveal.
- Sidebar collapsed / pinned / peek behavior.

### Context

Current state:

- `ContextStage` correctly has separate pieces for aim summary, clarify panel, context source workbench, context review, and Continue to Plan.
- Intake mode shows one generated question at a time.
- The workbench variant of `ContextSourcesPanel` is much leaner than the full Settings setup surface.
- Context review omits empty buckets and avoids raw prompts/traces.

Fixes:

- When `clarifyPhase === "intake"`, make the blocking question the only dominant workbench surface.
  - Keep aim title as a compact sticky/header row or single-line context, not a bordered summary block.
  - Move local material attachment below a collapsed "Add source material" row or show it only after the active question is answered.
  - Hide the disabled Continue to Plan until it can become actionable, or keep it visually subordinate.
- Keep the source setup handoff to Settings, but make it secondary while a blocking question exists.
- Preserve context bundle review, but show it after planning context exists or after the active intake step is complete.
- Reduce nested border perception: avoid a large summary panel followed by a large question panel followed by a large source panel.
- Maintain no horizontal overflow at 960x680, 760x600, and 640x520.

Do not touch:

- Context source Settings variant behavior.
- File/folder picker IPC.
- The shell/sidebar/window-chrome selectors.

### Plan / Contracts

Current state:

- `PlanPanel` has direct editing for sub-aim text, why, definition of done, required evidence, eval signal, routing, and acceptance rules.
- Save Aim is the clear top-level primary action.
- Routing validation blocks saving when the plan is not executable.
- Raw acceptance-rule JSON is hidden behind Developer details.

Fixes:

- Keep full edit capability, but make the default sub-aim row easier to scan.
  - First line: title, owner/agent, validation state.
  - Second line: definition of done and required evidence summary.
  - Expand for why/eval/routing controls.
- Move repeated Move/Merge/Split text actions into compact icon buttons or an overflow menu with tooltips.
- Keep Developer details per sub-aim, but make the disclosure less visually prominent than the product contract.
- Reconsider the metrics strip:
  - Sub-aim count is useful.
  - Quality grade and action count can feel like planning-debug residue unless directly tied to a user action.
- Keep raw JSON out of the default view.

Do not touch:

- Core validation behavior.
- Routing override data shape.
- `CockpitShell.tsx` or sidebar/window selectors.

### Execute

Current state:

- Execute uses `LocalAgentExecutionSummary` to show selected sub-aim, selected local agent, run state, model/reasoning/workspace, evidence state, next human/eval action, and compact activity.
- Human proof submission collects proof note, URL, files, and required-evidence mapping before confirmation.
- Raw run events are not shown by default.

Fixes:

- Establish one selected-work pattern.
  - Left/top: compact list of sub-aims and status.
  - Main/detail: selected sub-aim execution summary and one primary next action.
- Make the primary action depend on the selected route/state:
  - Agent route and not complete: Run agent.
  - Human route and not complete: Submit proof.
  - Completed or low-trust: Review in Eval.
- Keep Break Down as a secondary action, not equal to run/proof.
- Keep the compact activity summary, but avoid showing it above the action unless the run is active or recently failed.
- Keep evidence preview short. Link users to Eval for detailed evaluator/evidence reasoning.

Do not touch:

- Local CLI harness boundaries.
- Evidence append/eval invariants.
- Runtime implementation in this polish pass unless a UI bug requires it.

### Eval

Current state:

- Eval is evidence-detail-first and has evaluator status, trust score, matched evidence, evidence rows, next action, Context Inbox, and completion recap.
- Completion recap is factual and compact rather than celebratory.
- Pending context candidates remain reviewable from Eval.

Fixes:

- Lead with one trust summary:
  - Passing sub-aims.
  - Missing evaluator matches.
  - Low-trust or unmatched proof.
  - Pending context candidates.
- Collapse or progressively reveal per-milestone evaluator/evidence details after the summary.
- Do not show an empty Context Inbox block as a major section when there are no candidates; use a small row or omit it.
- Keep evidence rows detailed enough to show proof, trust, matched rule/evaluator, and next action.
- In completion recap, keep learned context visible but do not duplicate the full Context Inbox unless there are pending candidates.

Do not touch:

- Completion derivation.
- `evaluate()` semantics.
- Append-only evidence behavior.

### Settings

Current state:

- Settings uses the primary left sidebar as category navigation and keeps setup out of the default workbench.
- Provider, local agent, web research, and context sources are separated.
- First-run helper guidance routes to the relevant Settings section from an aim.

Fixes:

- Keep Settings out of the stage loop unless it is solving a concrete helper/setup block.
- When a stage needs Settings, the stage should explain the exact blocker in one line before handing off.
- Avoid making Context stage repeat Settings readiness gates. The Context workbench should remain current-aim local material plus a Settings handoff.

Do not touch:

- Settings locked sidebar behavior.
- Settings sidebar row geometry.
- Footer user menu / language submenu behavior.

## Cross-Stage Fixes

1. Add a stage safe-area rule for workflow pills.
   - The live Context screenshots show overlap with the sidebar toggle.
   - Solve by offsetting or wrapping `.od-stage-nav` / `.od-main` content around the existing titlebar control cluster.
   - Do not change `.od-sidebar-toggle`, `.od-window-drag-strip`, or shell grid behavior.

2. Reduce default card stacking.
   - Favor row groups and separators for repeated facts.
   - Keep cards for repeated items, forms, modals, and genuinely framed tools only.

3. Use the shared `apps/desktop/src/renderer/ui/` primitives for new polish work.
   - Avoid adding more inline style islands in stage content.

4. Preserve 4px grid rhythm.
   - New or touched spacing should converge to 4, 8, 12, 16, 24, and 32 px.

5. Keep debug surfaces opt-in.
   - Current Plan Developer details are acceptable because they are collapsed, but future debug should not appear as default metrics, rails, or raw JSON.

## What Must Not Be Touched

Treat the following as stable infrastructure:

- `CockpitShell` sidebar state model: pinned / collapsed / peek.
- Sidebar hover reveal rail.
- Sidebar toggle behavior.
- Sidebar resize behavior and bounds.
- Main Aim sidebar layout, geometry, and alignment.
- Settings locked sidebar behavior.
- Sidebar footer user menu and language submenu behavior.
- Global Home Panel and New Aim sidebar actions.
- Recent aims list/search/filter behavior.
- Native macOS traffic lights, window chrome, and drag strip behavior.
- Command shortcuts wired through the shell.
- Shell grid behavior that controls whether the sidebar pushes or overlays the workspace.

Avoid editing `apps/desktop/src/renderer/CockpitShell.tsx`.

Avoid modifying selectors beginning with or governing:

- `.od-sidebar`
- `.od-sidebar-*`
- `.od-user-menu-*`
- `.od-window-drag-strip`
- `.od-sidebar-hover-zone`
- `.od-sidebar-peek-trigger`
- `.od-sidebar-toggle`
- `.od-sidebar-resizer`
- shell grid/sidebar state selectors

If a sidebar/window conflict appears unavoidable, stop and record the conflict in
`docs/handoff.md` instead of changing shell behavior.

## Suggested Implementation Batches

### Batch 1: Stage Safe Area And First Viewport

- Fix workflow pill overlap with the sidebar toggle from stage/workspace CSS.
- Verify 960x680, 760x600, and 640x520.
- Keep shell/sidebar/window selectors untouched.

Status: addressed in the stage/workspace CSS pass on 2026-07-07. `.od-main` now owns the compact-width titlebar safe-area offset, and `.od-stage-nav` centers, wraps, and compresses labels without changing the protected shell/sidebar/window selectors. Final visual inspection remains part of the integration verification.

### Batch 2: Context Primary Task Cleanup

- Make blocking intake the sole dominant task.
- Compact aim summary.
- Move source material and Settings handoff below the active question or behind secondary disclosure.
- Keep context review only when it supports the current planning state.

Status: addressed on 2026-07-07. Blocking intake now keeps the active question dominant, renders the aim summary compactly, moves source material behind a secondary disclosure, and hides context review while the blocking question is active.

### Batch 3: Plan Density Pass

- Collapse repeated sub-aim card details into a scannable summary plus expansion.
- Convert structure actions to compact controls.
- Keep Save Aim as the primary action.
- Keep raw JSON behind Developer details.

Status: addressed on 2026-07-07. Plan cards now default to a summary-first contract review with route, validation, definition of done, required evidence, and rationale visible; detailed edits, routing controls, structure actions, and raw acceptance rules stay behind disclosures.

### Batch 4: Execute Selected-Work Pattern

- Introduce selected sub-aim detail behavior.
- Make Run agent / Submit proof / Review in Eval the single state-dependent primary action.
- Move Break Down and activity details to secondary treatment.

Status: backlog. This integration did not change Execute selected-work behavior.

### Batch 5: Eval Trust Summary

- Lead with a concise review summary.
- Collapse detailed evaluator/evidence rows by default when there is no blocker.
- Hide or compress empty Context Inbox state.

Status: addressed on 2026-07-07. Eval keeps milestone evidence and evaluator details behind secondary disclosures by default, preserves pending Context Inbox review, and omits the large empty inbox block when there are no candidates.

### Batch 6: Primitive And Grid Cleanup

- Convert newly touched stage content away from inline style helpers.
- Use shared UI primitives where they match the local surface.
- Recheck 4px spacing, text fit, focus states, dark/light appearance, and narrow widths.

Status: backlog. This integration kept the polish focused on stage hierarchy and did not run a broad primitive or inline-style cleanup.

## Verification Notes For Next Pass

Minimum visual checks:

- 960x680
- 760x600
- 640x520

Minimum flows:

- Empty Aim.
- New Aim composer.
- Context with an active blocking question.
- Context after blocking questions are answered.
- Plan/Contracts with at least three sub-aims.
- Execute with an agent-routed sub-aim, a human-routed sub-aim, and one completed sub-aim.
- Eval with matched evidence, low-trust evidence, no evidence, pending context candidates, and completion recap.

Acceptance:

- No horizontal overflow.
- Workflow pills do not collide with titlebar/sidebar controls.
- One primary action is visually dominant on each stage.
- No raw debug/JSON surface appears by default.
- Evidence and eval details are reviewable without turning the default view into a report wall.
- No shell/sidebar/window-chrome selectors are changed.
