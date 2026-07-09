# Desktop Action Menu Audit

Status: focused audit, 2026-07-09. The draft recovery findings in this audit
were resolved by the Desktop draft action-menu integration; legacy unmounted
surfaces remain deferred.

## Scope

This audit reviews Desktop renderer list rows and repeated entries that open,
resume, select, review, or edit content. It focuses on visible secondary or
destructive actions, duplicated row/card interaction surfaces, one-off menu
patterns, native browser dialogs, keyboard handling, outside-click behavior, and
accessible names for overflow controls.

## Row Classification

| Surface | Classification | Audit assessment |
| --- | --- | --- |
| `AimDraftSidebarRows` | Content entry / navigation entry | Resolved in integration. The row resumes a draft and destructive discard moved behind More Actions. |
| `AimDraftHomeSection` | Content entry / navigation entry | Resolved in integration. The Home recovery row uses the same content-entry and More Actions pattern as the sidebar. |
| Saved aim sidebar rows | Content entry / navigation entry | Current active sidebar rows are correct: the whole row opens the aim and no destructive action is exposed inline. |
| Legacy `HomeView` saved aim cards | Content entry / navigation entry | Deferred issue if this surface is re-mounted: visible `Delete` sits inside a clickable aim card. |
| Context source path rows | Editor/control row | Visible `Remove` is appropriate because the row is part of a settings/workbench editor draft. |
| Context source online rows | Editor/control row | Visible provider, label, reference, enable, and `Remove` controls are appropriate for a setup editor. |
| Context Inbox candidate rows | Review task row | Visible `Accept` and `Reject` are appropriate because the row's purpose is memory review. |
| Evidence rows | Content/evidence detail rows | No inline destructive or secondary actions found. |
| Execute selected-work selector rows | Navigation entry | Current rows only select work and do not expose inline secondary/destructive actions. |
| Execute proof file rows | Editor/control row | Visible `Remove`, `Cancel`, and `Submit proof` are appropriate inside the proof submission editor. |
| Settings nav and overview rows | Navigation/editor-control rows | Current controls open settings sections or forms; visible controls are appropriate. |
| `SidebarUserMenu` | Existing menu pattern | Good reference behavior for Escape, outside pointer close, keyboard navigation, aria menu roles, and labeled trigger. |
| `CommandPalette` | Existing command/dialog pattern | Good reference behavior for Escape, backdrop close, keyboard selection, and aria dialog/listbox roles. |

## Findings

### 1. Visible draft discard in sidebar content rows

- Component/file: `apps/desktop/src/renderer/stages/aim/AimDraftRecovery.tsx` (`AimDraftSidebarRows`) and `apps/desktop/src/renderer/cockpit.css`.
- Pre-fix symptom: each sidebar draft row had a primary resume button plus a visible `Discard` button. If the draft was selected, the wrapper and inner controls could each render independent interaction surfaces.
- Severity: major.
- Resolution: the row's primary click resumes the draft, and `Discard draft` is available through a trailing More Actions menu with an accessible `More actions for {draft title}` label.

### 2. Nested hover and selected surfaces on sidebar draft rows

- Component/file: `apps/desktop/src/renderer/stages/aim/AimDraftRecovery.tsx` (`AimDraftSidebarRows`) and `apps/desktop/src/renderer/cockpit.css`.
- Pre-fix symptom: selected wrapper, primary child button, and discard child button could each draw backgrounds or shadows, so one row read as multiple stacked controls.
- Severity: major.
- Resolution: selected, hover, and focus background now belong to the content-entry row surface. The overflow trigger keeps its own compact focus affordance without a second row card or shadow.

### 3. Visible draft discard in Home recovery rows

- Component/file: `apps/desktop/src/renderer/stages/aim/AimDraftRecovery.tsx` (`AimDraftHomeSection`) and `apps/desktop/src/renderer/App.tsx` (`InitialWorkspacePanel`).
- Pre-fix symptom: each Home recovery row showed draft title/status plus visible `Resume` and `Discard` actions.
- Severity: major.
- Resolution: Home recovery rows use the same content-entry pattern as sidebar drafts. The row resumes the draft; discard is menu-gated.

### 4. Draft discard used a native browser confirmation dialog

- Component/file: `apps/desktop/src/renderer/App.tsx` (`discardAimDraft`) and `apps/desktop/src/renderer/App.test.tsx`.
- Pre-fix symptom: clicking `Discard` called `window.confirm`, blocking the renderer with a browser modal and bypassing Aimcub's product interaction language.
- Severity: major.
- Resolution: `window.confirm` was removed from the draft discard path. The menu opens an inline confirmation state with action-specific copy before deletion.

### 5. No shared contextual menu primitive for row overflow actions

- Component/file: `apps/desktop/src/renderer/ui/ActionMenu.tsx`.
- Pre-fix symptom: robust menu behaviors existed inline in `SidebarUserMenu`, but there was no shared contextual menu primitive for row More Actions.
- Severity: major.
- Resolution: Desktop now has a shared `ActionMenu` primitive with a labeled trigger, menu roles, Escape close, outside pointer close, arrow-key navigation, focus return, and destructive item states.

### 6. Legacy HomeView exposes saved aim Delete inline

- Component/file: `apps/desktop/src/renderer/HomeView.tsx`.
- Pre-fix symptom: `HomeView` renders each saved aim as a clickable panel and places a visible `Delete` button inside the same card. Current active Desktop routing does not mount `HomeView`, but the component remains in the renderer source.
- Severity: minor.
- Recommendation: if `HomeView` is re-mounted, saved aim deletion should move behind row More Actions with product confirmation or undo. If the surface is obsolete, remove it in a cleanup branch so the stale pattern is not copied.
- Status: deferred unless the component is reactivated.

### 7. Legacy ContextHealthPanel exposes Archive inline

- Component/file: `apps/desktop/src/renderer/HomeView.tsx`.
- Pre-fix symptom: `ContextHealthPanel` shows `Deprioritize` and destructive `Archive` buttons directly on memory health rows. This is acceptable only if the surface is clearly a review/maintenance queue; it would be wrong as a passive content entry.
- Severity: minor.
- Recommendation: if the panel returns as an explicit review queue, keep visible review actions but require a product confirmation or undo for Archive. If it returns as a passive health summary, move Archive behind More Actions.
- Status: deferred until `HomeView` or `ContextHealthPanel` is reactivated.

## Non-Findings

- Saved aim sidebar rows in `CockpitShell` are correct content-entry rows: one primary open action, no inline destructive action, and accessible selected state.
- Context source path and online rows are editor/control rows; visible remove/toggle/edit controls are appropriate because users are editing an unsaved setup draft.
- Context Inbox candidate rows are review task rows; visible Accept/Reject is the row's main purpose.
- Execute selector rows are navigation rows without destructive actions.
- Evidence rows are detail rows without exposed secondary/destructive controls.
- Settings sidebar and overview rows are navigation/control rows; visible Configure/Manage controls are appropriate.

## Shared Primitive Rule

Use the shared contextual menu primitive for row overflow actions. Content-entry
and navigation rows should keep one primary row action and move secondary or
destructive actions behind a trailing More Actions menu. Review task rows and
editor/control rows may show task-native controls when those controls are the
row's purpose.
