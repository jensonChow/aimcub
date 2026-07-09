# Desktop Product Bug Audit

Status: focused audit index, 2026-07-09.

## Draft Lifecycle Audit

See `docs/desktop-draft-lifecycle-audit.md` for the current Desktop audit of
silent work-loss risks caused by volatile React state and navigation/reset
paths. It classifies blocker, major, and minor issues across aim composer,
Context, Plan/Contracts, Execute proof drafts, child breakdown, planning failure
recovery, Settings navigation, command shortcuts, reload/restart, and component
unmount/remount.

## Integration Status

Merged into the real-use product bug integration on 2026-07-09. The code path
now formats draft/refine/save failures through product-facing messages with
recovery actions, keeps raw validator/provider details behind Developer details,
clears stale draft/context state on New Aim and opened aims, and repairs
numeric-string `min_files` values before plan validation. Save validation issues
block Save while leaving Plan/Contracts edit controls available for repair.

Seeded visual inspection in the refreshed app bundle confirmed the default
Contracts, Work, Review, and active Context surfaces hide raw validation/tool
details by default. No runtime forced planning-validation fixture is currently
available; that path remains covered by unit tests.

## Covered Bugs

1. Raw plan validation paths reached user-facing UI.
   - Example: `nodes.10.acceptance_rule.clauses.0.match.min_files: Invalid input`.
   - Impact: users see internal schema paths instead of a recoverable product message.
   - Regression check: default errors say the plan needs repair; raw paths appear only in Developer details.

2. Draft failures after Context could route back to Aim with a stale raw error.
   - Impact: the user loses the sense that their context and retry path are preserved.
   - Regression check: draft failures return to Context so the user can review context and generate again.

3. Refine failures could expose raw validator text while the previous draft was still usable.
   - Impact: the user cannot tell whether they should retry, accept the draft, or start over.
   - Regression check: refine failures keep the previous draft path and show a friendly retry/accept message.

4. Save validation failures surfaced raw joined validator errors.
   - Impact: invalid edited plans were technically blocked, but the visible reason was an internal dump.
   - Regression check: save stays on Plan/Contracts with product text and developer details hidden behind disclosure.

5. Provider output can produce repairable numeric-string acceptance rule counts.
   - Example: `min_files: "2"` in a `commit_pattern` match.
   - Impact: a plan that is otherwise valid can fail schema parsing.
   - Regression check: numeric string counts are repaired before validation; unrepaired invalid plans remain blocked.

6. Fresh navigation must clear stale local composer state.
   - Impact: New Aim or opening an existing aim can be confusing if old draft, answers, context notes, or errors persist.
   - Regression check: New Aim and opened aims clear draft, final plan, planning traces, context answers, context notes, and errors.

## Out Of Scope

- Eval/completion semantics.
- Local agent runtime behavior.
- Desktop shell/sidebar/window-chrome behavior.
- Hosted sync, MCP, Supabase, or packaging flows.
