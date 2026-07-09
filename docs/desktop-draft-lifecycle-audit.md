# Desktop Draft Lifecycle Audit

Status: focused audit for silent work-loss risks, 2026-07-09.

This audit covers Desktop work that exists in renderer state before it is saved
through the local Aim store. The inspected loss paths were Home Panel, New Aim,
opening a saved aim, stage switches, Settings navigation, Cmd/Ctrl shortcuts,
reload/restart, component unmount/remount, and validation failure followed by
navigation.

## Audited Surfaces

- `apps/desktop/src/renderer/App.tsx`: aim composer, context intake, draft/refine/save orchestration, planning failure recovery, `ProductErrorNotice`, child breakdown entry.
- `apps/desktop/src/renderer/CockpitShell.tsx`: Home Panel, New Aim, recent-aim open, stage switcher, Settings, command palette, Cmd/Ctrl shortcuts.
- `apps/desktop/src/renderer/stages/context/*`: context answers, notes, activity, and stage composition.
- `apps/desktop/src/renderer/ContextSourcesPanel.tsx`: workbench and Settings context source drafts.
- `apps/desktop/src/renderer/stages/plan/*`: generated plans, contract edits, routing edits, structure edits, Developer-details rule edits.
- `apps/desktop/src/renderer/stages/execute/*`: selected work, manual proof submission draft, child breakdown action.
- `apps/desktop/src/main/ipc.ts`, `apps/desktop/src/main/store.ts`, and `packages/store/src/index.ts`: persistence boundary for saved aims and submitted proof.

## Current Protection

- Stage switches between Aim, Context, and Contracts preserve the App-level aim
  builder state while the renderer stays mounted.
- Entering Settings does not call `resetComposer()` or `openGoal()`, so the
  App-level aim builder state remains available when returning without reload.
- Draft, refine, and save failures route back to Context or Contracts with a
  product-facing `ProductErrorNotice` and the repairable plan still in memory.
- New Aim, Home Panel, and opening an existing aim intentionally clear stale
  composer state, which prevents cross-aim contamination but also makes those
  paths destructive for unsaved work.

## Findings

### B1. Unsaved aim-building sessions are discarded by global navigation

Classification: blocker.

Reproduction path:

1. Click New Aim or press Cmd/Ctrl+N.
2. Enter an aim title and optional context, or answer a Context-stage question.
3. Optionally generate a plan and edit Contracts.
4. Click Home Panel, click New Aim again, open a recent aim, or use Cmd/Ctrl+0 or Cmd/Ctrl+N.
5. Return to New Aim.

Source file/function:

- `apps/desktop/src/renderer/App.tsx`: `resetComposer()`, `openHomePanel()`, `startNewAim()`, `openGoal()`.
- `apps/desktop/src/renderer/CockpitShell.tsx`: global action buttons, recent aim rows, command palette actions, and Cmd/Ctrl handlers.

User impact:

The user can silently lose the aim title, description, context answers, context
note, generated draft, edited plan, planning traces, and child-breakdown parent
link before saving. These actions are normal navigation actions, not explicitly
destructive commands.

Recommended product behavior:

Treat the active aim builder as a protected local draft. Home Panel, New Aim,
recent-aim open, and matching shortcuts should either auto-save a recoverable
draft checkpoint or show a product-facing discard/keep-working choice. The
choice should say what Aimcub will preserve and provide a clear return path.

Suggested test:

Add an App-level interaction test that seeds an unsaved title, context answer,
and edited plan, invokes each global navigation callback and shortcut, and
asserts either a guard is shown or the draft can be restored with the same stage
and content.

### B2. Reload or app restart loses the complete in-progress aim builder

Classification: blocker.

Reproduction path:

1. Start a new aim and enter context.
2. Generate a draft plan or edit generated Contracts.
3. Reload the renderer, close/reopen the app, or crash before clicking Save Aim.
4. Desktop rehydrates saved goals from the local store, but the unsaved builder is gone.

Source file/function:

- `apps/desktop/src/renderer/App.tsx`: `useState` fields for `aimTitle`, `aimDescription`, `draft`, `finalPlan`, `planResult`, `intakeAnswers`, `answers`, and `contextNote`.
- `apps/desktop/src/main/ipc.ts`: `saveGoal` is the first persistence point for generated aim plans and context answers.
- `packages/store/src/index.ts`: `createGoal()` persists only after Save Aim.

User impact:

Generated plans can require expensive model calls and user review. Losing that
work on reload or restart makes Desktop feel unreliable even if saved aims are
safe.

Recommended product behavior:

Persist an unsaved aim draft lifecycle outside React state. A minimal version
can store title, description, parent link, stage, intake questions, answers,
context note, current draft/final plan, and validation state in the local Aim
store or a renderer draft store. Restore it after reload with a "Draft restored"
notice and a discard action.

Suggested test:

Add a persistence test around a draft lifecycle adapter: write a draft snapshot,
simulate a new renderer session, and assert the same title, context, active
stage, plan, and parent link are restored. Add a renderer test that shows the
restored draft before saved aims are opened automatically.

### M1. Context answers and notes are durable only after Save Aim

Classification: major.

Reproduction path:

1. Start a new aim and reach the Context stage.
2. Answer an intake question or write a free-form context note.
3. Navigate to Home Panel, New Aim, a recent aim, or reload before Save Aim.
4. Return to the in-progress aim flow.

Source file/function:

- `apps/desktop/src/renderer/App.tsx`: `intakeAnswers`, `answers`, `contextNote`, `descriptionWithContext()`, `continueFromContext()`, `refinePlan()`, `savePlan()`.
- `apps/desktop/src/renderer/stages/context/ContextClarifyPanel.tsx`: `onAnswer` and `onContextNote` receive user-entered answers and notes.

User impact:

Context is the product. Losing answers or notes can change decomposition,
acceptance rules, routing, and future context candidates while giving the user
no indication that their input was temporary.

Recommended product behavior:

Auto-checkpoint context answers and notes as aim-local draft context as soon as
they change. The Context stage should show preserved state after returning from
Settings or reload, and destructive navigation should require an explicit
discard of unsaved context.

Suggested test:

Add a Context flow test that enters a choice answer and note, switches to
Settings and back, then reloads through the draft lifecycle adapter and asserts
the same answer map and note are present. Add a destructive-navigation test that
verifies context cannot be discarded silently.

### M2. Context source edits are component-local until the user clicks Save

Classification: major.

Reproduction path:

1. In Context, use the source workbench to pick a local folder or files.
2. Do not click Save.
3. Switch to Contracts, Settings, Home Panel, or reload.
4. Return to Context.

Source file/function:

- `apps/desktop/src/renderer/ContextSourcesPanel.tsx`: local `draft` state, `pickFolder()`, `pickFiles()`, `save()`, and the workbench variant.
- `apps/desktop/src/renderer/stages/context/ContextStage.tsx`: mounts and unmounts the workbench source panel by stage.

User impact:

The user can spend time selecting context material that planning depends on,
then lose those selections by normal stage navigation if they miss the Save
button. The app later plans from less context than the user intended.

Recommended product behavior:

For the Context workbench, treat selected files/folders as aim-local draft
context immediately or show a sticky unsaved-source guard before leaving the
stage. If the setting remains global, make the Save requirement explicit and
guard stage/Settings/navigation until the source changes are saved or discarded.

Suggested test:

Add a ContextSourcesPanel interaction test that changes local files without
saving, unmounts/remounts through a stage switch, and asserts either the draft
is restored or a navigation guard prevents silent loss.

### M3. Generated and edited plan work has no draft checkpoint before Save Aim

Classification: major.

Reproduction path:

1. Generate a plan.
2. Edit a sub-aim title, description, definition of done, evidence, routing, or structure.
3. Navigate via Home Panel, New Aim, recent aim, Cmd/Ctrl shortcut, or reload before Save Aim.
4. Return to the plan.

Source file/function:

- `apps/desktop/src/renderer/App.tsx`: `draft`, `finalPlan`, `planResult`, `applyPlanEdit()`, `savePlan()`.
- `apps/desktop/src/renderer/stages/plan/PlanPanel.tsx`: `apply()`, `updateNode()`, `updateContract()`, routing and structure edit callbacks.
- `apps/desktop/src/main/ipc.ts`: `saveGoal` persists the plan only after final validation and routing checks.

User impact:

The most expensive generated artifact in the flow can be lost after user edits.
This is especially risky after validation failure, when users may navigate away
to inspect context or settings before repairing the plan.

Recommended product behavior:

Checkpoint valid plan edits as a local unsaved plan draft independent of Save
Aim. On validation failure, explicitly state that the draft is preserved and
keep repair controls active. Destructive navigation should offer Keep editing,
Save draft, or Discard.

Suggested test:

Add an App-level plan edit test that changes a contract field, triggers a stage
switch and a simulated reload, and asserts the edited plan remains recoverable.
Add a validation-failure test that tries to leave the Contracts stage and checks
for a guard or preserved draft.

### M4. Invalid Developer-details acceptance-rule edits are lost on unmount

Classification: major.

Reproduction path:

1. Generate a plan and open Developer details on a sub-aim.
2. Edit the acceptance-rule JSON into a temporarily invalid but meaningful draft.
3. Switch to Context, Settings, Work, Review, or any route that unmounts PlanPanel.
4. Return to Contracts.

Source file/function:

- `apps/desktop/src/renderer/stages/plan/PlanPanel.tsx`: local `ruleDrafts`, `ruleErrors`, `advancedOpen`, `applyRuleText()`, and `onRuleText`.
- `apps/desktop/src/renderer/stages/plan/PlanContractCard.tsx`: Developer-details rule textarea.

User impact:

Acceptance rules are core eval work. Even though the JSON editor is a Developer
details surface, a user can lose a partially repaired rule without pressing
Cancel or Discard.

Recommended product behavior:

Lift per-node rule text buffers and errors to the plan draft lifecycle, or keep
PlanPanel mounted across non-destructive stage switches. Invalid rule text
should survive navigation until the user applies a valid rule or discards the
edit.

Suggested test:

Add a PlanPanel interaction test that enters invalid rule JSON, changes stages,
returns to Contracts, and asserts both the draft text and inline error remain.

### M5. Manual proof drafts are lost when Execute unmounts

Classification: major.

Reproduction path:

1. Open a saved aim with a human-routed sub-aim.
2. Click Submit proof.
3. Enter a proof note, URL, file references, or required-evidence checklist state.
4. Switch to Review, Contracts, Context, Settings, Home Panel, or reload before submitting.
5. Return to Work and open Submit proof again.

Source file/function:

- `apps/desktop/src/renderer/stages/execute/ExecutePanel.tsx`: local `activeProofId`, `proofDrafts`, `pickingFilesFor`, `openProof()`, `updateProofDraft()`, `submitProof()`.
- `apps/desktop/src/renderer/stages/execute/EvidenceSubmissionForm.tsx`: proof note, URL, files, and required evidence inputs.
- `apps/desktop/src/main/ipc.ts`: `confirmMilestone` is the first persistence point for manual proof.

User impact:

Manual proof is often the only evidence a human contributes. Losing a proof
draft can erase URLs, local file references, and the user's explanation of why
the sub-aim is done.

Recommended product behavior:

Persist proof drafts per `goalId` and `milestoneId` until Submit proof or an
explicit Cancel/Discard. Switching stages should hide the form, not delete its
content. Submit should clear only the submitted milestone draft after the store
confirms evidence was recorded.

Suggested test:

Add an Execute interaction test that fills proof fields, switches to Eval and
back to Work, reopens the proof form, and asserts the note, URL, files, and
checklist state are still present. Add a submit test that asserts the draft is
cleared only after successful `confirmMilestone`.

### M6. Child breakdown drafts lose parent linkage before Save Aim

Classification: major.

Reproduction path:

1. Open Work on a saved aim.
2. Click Break down for a sub-aim.
3. Edit the prefilled child aim title or context.
4. Navigate Home, New Aim, recent aim, Settings plus reload, or Cmd/Ctrl shortcut before saving.

Source file/function:

- `apps/desktop/src/renderer/App.tsx`: `breakDown()`, `parent`, `aimTitle`, `aimDescription`, `resetComposer()`, `savePlan()`.
- `packages/store/src/index.ts`: `createGoal()` persists the parent-child relation only after Save Aim.

User impact:

The child aim draft and its parent goal/milestone relation are renderer-only.
Losing that link turns child decomposition into throwaway text instead of a
recoverable sub-aim workflow.

Recommended product behavior:

Create a protected child-draft mode keyed by `parentGoalId` and
`parentMilestoneId`. The UI should offer Return to parent, Keep child draft, and
Discard child draft actions, and restore the parent linkage after reload.

Suggested test:

Add a child breakdown test that starts a breakdown from Execute, edits the child
draft, simulates navigation/reload, and asserts the title, description, and
parent identifiers are restored until saved or explicitly discarded.

### M7. Validation failure is repairable only while the current renderer state survives

Classification: major.

Reproduction path:

1. Generate a plan.
2. Edit Contracts into a validation or routing failure.
3. Click Save Aim and see the product-facing error.
4. Navigate to Home Panel, New Aim, a recent aim, Settings plus reload, or press Cmd/Ctrl+0 or Cmd/Ctrl+N.
5. Return to the flow.

Source file/function:

- `apps/desktop/src/renderer/App.tsx`: `savePlan()` validation branches and `ProductErrorNotice`.
- `apps/desktop/src/renderer/workflow/planningErrors.ts`: `formatPlanningFailure()` and `routeAfterPlanningFailure()`.
- `apps/desktop/src/renderer/stages/plan/PlanPanel.tsx`: validation disables Save but keeps repair controls enabled.

User impact:

The current behavior correctly keeps invalid plans repairable in-place, but the
repair state is still renderer memory. A user who navigates after a failure can
lose the exact draft they were told to repair.

Recommended product behavior:

After a validation or routing failure, mark the plan draft as protected. The
notice should say the draft is preserved, and leaving the flow should require a
clear choice. If draft checkpointing exists, failed plans should restore with
the same validation issues.

Suggested test:

Add a failing-save test that records the validation error, attempts each
destructive navigation path, and asserts a guard or restored invalid plan with
the same repair controls.

### m1. Settings setup form drafts are lost on section switches

Classification: minor.

Reproduction path:

1. Open Settings.
2. Type an API key, custom model, web research key, or context-source reference.
3. Switch Settings sections or leave Settings before saving.
4. Return to the previous section.

Source file/function:

- `apps/desktop/src/renderer/App.tsx`: `SettingsPanel`, `SettingsPrimarySidebar`, `settingsSection`.
- `apps/desktop/src/renderer/ProviderForm.tsx`: local provider setup state.
- `apps/desktop/src/renderer/WebResearchForm.tsx`: local web research setup state.
- `apps/desktop/src/renderer/ContextSourcesPanel.tsx`: Settings variant local context-source draft.

User impact:

This is not aim content, but it can still lose user-entered setup text and can
block the current aim if the user went to Settings from an aim-helper recovery
path.

Recommended product behavior:

Settings sections should either preserve unsaved form state while Settings is
open or show a section-leave guard when a form is dirty. Secrets should not be
auto-saved, but the user should not lose them silently.

Suggested test:

Add Settings form tests that type unsaved values, switch sections, and assert a
dirty guard or preserved in-memory form state. Include a reload test that does
not persist secrets unless the user saved them.

## Non-Issues Observed

- Plain stage switching among Aim, Context, and Contracts does not by itself
  clear App-level composer, context answer, note, draft, or final-plan state
  while the renderer stays mounted.
- Entering Settings does not reset App-level aim-building state in the same
  renderer session.
- `ProductErrorNotice` keeps raw planning failure details behind Developer
  details by default.
- Submitted proof and saved aims are durable after `confirmMilestone()` or
  `saveGoal()` completes because they are stored through the shared local store.

## Product Recommendation

Desktop needs an explicit draft lifecycle before more orchestration polish:

1. Define draft scopes: new aim draft, child aim draft, context answer draft,
   generated plan draft, proof draft, and Settings setup draft.
2. Persist product-critical drafts locally before route changes can destroy
   React state.
3. Add a shared navigation guard for destructive routes: Home Panel, New Aim,
   open saved aim, Cmd/Ctrl shortcuts, command palette actions, reload/restart
   restore, and validation-failure recovery.
4. Keep debug details secondary. The default copy should say what work is
   preserved and what action will discard it.

