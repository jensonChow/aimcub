# permissions-inspection — worktree report

Make agent execution permissions explicit and inspectable in the Desktop cockpit, plus the
documented threat model. Branch `claude/permissions-inspection-5d3b9b`.

## 1. Per-run permission consent

`RunMilestoneAgentRequest.permission` (`RunPermissionConsent`: sandbox + network + workspace) flows
renderer → `resolveDesktopRunPermission` → `enqueueDesktopRun` → the queued run row. The Execute
stage's selected-work detail carries a compact `RunPermissionControl` (read-only default vs
workspace-write; network off default vs on) whose copy says what each level grants. Run is disabled
until a `workspace-write` grant names a folder, picked through a native dialog (`pickRunWorkspace`).

**Safety property, generalized and preserved.** The background drain still runs
`drain({ sandbox: "read-only" })` — unchanged. Anything above that floor is executed by claiming
that one run **by id** (`claimConsentedRun`, mirroring the CLI's `--workspace` claim). A test now
asserts the desktop worker performs exactly those two drains and no other. The batch-2 test that a
CLI-queued `workspace-write` run stays queued is kept, and a new one proves the same for a
*desktop*-queued widened run left behind by a previous session.

Deliberate consequence, documented: **a widened run still queued when its window closes stays
queued forever.** Consent died with the session; re-run the sub-aim to grant it again.

`danger-full-access` is absent from the UI *and* rejected by main — the renderer is not the
boundary. Main also rejects a non-absent, non-absolute, or non-directory workspace. `cancelRun` is
untouched (covered by a new test).

The Journey's one-tap "Your move" run has no consent control and sends the read-only/network-off
default explicitly — the escalation surface is the Execute stage.

## 2. Run timeline

`runTimeline.ts` (pure) + `RunTimelinePanel.tsx` render one collapsible block per run of the
selected sub-aim from the persisted `getAimJournal` stream: queued/started, tool start↔finish pairs
with durations (unfinished tools read `pending`), log lines, terminal state, retry linkage, and the
run's granted sandbox/network. **Event types are a table lookup, never an exhaustive switch** — an
unrecognized type renders as kind + summary + raw type + time (tested with a deliberately unknown
`sandbox.escaped.hypothetically` fixture, so the parallel artifact worktree's new types land safely).

Live events append: `LiveRunState` now keeps a bounded (400) event buffer plus a total `eventCount`,
and the timeline merges only the not-yet-persisted tail — `eventCount - events.length` keeps the
offset correct after the cap drops the head.

The live-run line got its own Glass row (`.od-live-run`, pulsing accent dot, Stop) replacing the
`od-work-note` reuse flagged in handoff.

## 3. Store diagnostics banner

New `getStoreDiagnostics` IPC over the existing `AimStore.getDiagnostics()`. `StoreDiagnosticsBanner`
is dismissible and non-blocking (`role="status"`), maps each kind to plain copy (en + zh), names the
quarantined file **once per incident**, and reports an unrecognized kind rather than staying silent.
Read in `refreshAll`, so post-startup recoveries surface too; a new incident un-dismisses it.

## 4. Developer mode

`developerMode.tsx` context (default `false`, so an unwrapped component hides its debug affordance),
Settings → General toggle, persisted in a new desktop-only `desktop-settings.json`
(`main/app-settings.ts`, temp+rename, strict-boolean normalize, corrupt file degrades to defaults).

Audited the renderer; exactly two debug-shaped surfaces existed in product UI, both now gated:
1. `PlanContractCard` "Developer details" → raw acceptance-rule JSON (Plan stage).
2. `ProductErrorNotice` "Developer details" → raw failure-line `<pre>`.

`PlanningDebugPanel.tsx` is **dead code** — only `mergePlanningDebugTraces` is imported from it, the
component is mounted nowhere. Left as-is (deleting or mounting it is out of scope); flagged below.
`debug.pending` is only a "Working…" pill label, not a debug surface.

## 5. `docs/agent-permissions.md`

User-facing threat model: the two capabilities, the per-runtime mapping table (codex `--sandbox`
flags incl. `network_access`; claude `--permission-mode plan/acceptEdits/bypassPermissions` +
`--disallowedTools`), why `bypassPermissions` is not offered, how claim scoping prevents
cross-surface escalation, where runs/events/evidence are stored, the evidence trust model
(`mcp_report` = 0.6, low trust, agent's own account), and prompt injection stated honestly.
Linked from the consent control.

## Verification

- **Full gate green**: build 9/9 · test 16/16 (**desktop 339**, was 296) · typecheck 16/16 ·
  lint 10/10 · purity clean.
- **Live boot**, isolated `AIMCUB_HOME` seeded from `examples/local-alpha`: main + preload +
  renderer built, Electron started clean (main + renderer + helpers, no console errors), real
  `~/.aimcub` untouched, no lock/temp debris. *The Electron binary was missing in this worktree
  ("Electron uninstall"); unpacked from the existing local `~/Library/Caches/electron` — no
  download, no dependency change.*
- **I could not walk the three surfaces interactively**: desktop-control access was denied, so no
  click-through happened. Instead I verified the data paths end-to-end against a **real** store
  (copy of the seeded home, not a fixture): clean load → 0 diagnostics; corrupted `store.json` →
  quarantine + backup recovery with the aim intact and exactly the two kinds the banner maps
  (`corrupt_quarantined`, `recovered_from_backup`), both naming the same quarantine path — which is
  what prompted the dedupe fix above. Preferences round-tripped in that home; consent resolution
  returned the right values and rejected `danger-full-access`. Surface rendering is covered by
  rendered-markup tests.

## Out of scope / handoff

- **`packages/**` untouched** (owned by parallel worktrees). Nothing there needed changing — the
  store, queue, and orchestrator APIs already supported all of this.
- **"Learn more" is text, not a link.** There is no public repo URL yet (license/public flip is
  founder-owned), so the consent control names `docs/agent-permissions.md` rather than fabricating
  a URL. Turn it into a real link (new fixed-target `shell.openExternal` IPC, same no-input pattern
  as `revealWorkspace`) once the repo is public.
- **`PlanningDebugPanel.tsx` is dead code.** Either delete it or mount it behind developer mode —
  it is the obvious home for a real developer surface now that the toggle exists.
- **A stranded widened run has no UI.** It stays queued and invisible; a "queued from an earlier
  session — re-grant?" affordance would close that loop.
- A `surface` marker on queue requests (carried from batch 2) would make cross-surface claiming
  explicit rather than inferred from the sandbox filter.
