# Agent execution permissions

When Aimcub runs a local agent, it starts a real CLI (Codex, Claude Code, …) on your machine with
your credentials. This page says exactly what such a run can touch, who decides, and where the
record ends up. It is written for the person clicking **Run agent**, not only for contributors.

Short version: **every Desktop run starts read-only with no network.** Anything wider is a choice
you make per run, in front of you, and it does not survive the window you made it in.

## The two things a run is allowed

Aimcub grants a run exactly two capabilities, and both are recorded on the run row before anything
executes.

### 1. Files — the sandbox level

| Level | What it means | Offered in Desktop? |
| --- | --- | --- |
| `read-only` | The agent can read files and think. It cannot create, change, or delete anything. | Yes — the default. |
| `workspace-write` | The agent can create and change files **inside one folder you pick**, and only there. | Yes — an explicit per-run choice. |
| `danger-full-access` | No sandbox at all: the agent can write anywhere your user account can. | **No.** |

`danger-full-access` exists in the runtime layer (`LocalAgentSandboxMode`) because adapters must be
able to describe it, but nothing in the Desktop UI can select it, and the main process **rejects**
it even if the request arrives some other way (`resolveDesktopRunPermission` in
`apps/desktop/src/main/run-queue.ts`). A `workspace-write` grant is also refused unless the folder
you picked is an absolute path that exists as a directory on this machine.

The CLI is a different surface with a different contract: `aimcub run --workspace <dir>` is you
typing the folder yourself, so it can queue a `workspace-write` run without a dialog.

### 2. Network

Off by default. With network off, the runtime is launched with web search and page fetching
disabled. With it on, the agent may search the web and fetch pages during that run — which also
means run content can leave your machine through the runtime's own provider.

Network is separate from Aimcub's own planning research (Settings → Research). Turning network on
for a run does not give the agent your Brave key; it enables the runtime's own web tools.

## How each level maps onto the runtimes

The mapping is the adapter's `buildInvocation` — it is the security contract, and it is the only
place that can keep the promise for its runtime (see `docs/local-agent-adapters.md`).

| Aimcub grant | Codex (`packages/local-agent/src/adapters/codex.ts`) | Claude Code (`.../claude.ts`) |
| --- | --- | --- |
| `read-only` | `--sandbox read-only` | `--permission-mode plan` |
| `workspace-write` | `--sandbox workspace-write` | `--permission-mode acceptEdits` |
| `danger-full-access` *(never granted from Desktop)* | `--sandbox danger-full-access` | `--permission-mode bypassPermissions` |
| network **off** | no `--search` flag | `--disallowedTools WebSearch,WebFetch` |
| network **on** | `--search`; plus `sandbox_workspace_write.network_access=true` when writing | web tools left enabled |

The folder you granted is passed as the process working directory (`-C <dir>` for Codex, the spawn
`cwd` generally). A read-only run gets **no** working directory at all — there is nothing for it to
be rooted in.

Why `bypassPermissions` is not offered: it turns off Claude Code's own per-action approval prompts
*and* Aimcub's sandbox at the same time, so a single mis-click would hand an unattended agent the
full reach of your user account with no second checkpoint anywhere. A one-click UI control is the
wrong shape for that decision. If you genuinely want it, run the runtime yourself, deliberately,
outside Aimcub.

## Why a grant cannot leak across surfaces

Aimcub's run queue **is** the `runs` table: the CLI and the Desktop app drain the same rows. That
is what makes the scoping rule load-bearing rather than cosmetic.

- A worker claims a run atomically, with a **filter**.
- The Desktop background worker drains with `{ sandbox: "read-only" }` — full stop. It will happily
  resume a read-only run left over from a previous session, and it can never claim a
  `workspace-write` run, no matter who queued it.
- A run you widened is executed by **claiming that one run by id**, immediately, in the session
  where you granted it (`claimConsentedRun`). The CLI does the same thing for its own
  `--workspace` run.

The consequence, stated plainly: **a `workspace-write` run that is still queued when its window
closes stays queued.** The next launch will not pick it up, because the consent that justified it
belonged to a person who is no longer there to be asked. Re-run the sub-aim to grant it again. This
is deliberate — the alternative is an app that silently executes a write it was told about
yesterday.

Consent is per run and per sub-aim. It is never written to disk as a preference, so nothing
persists a widened grant into the future.

## Where the record goes

Everything a run does is written locally, under `~/.aimcub` (or `$AIMCUB_HOME`):

- **Run rows** (`runs`) carry the granted `sandbox`, `network_enabled`, and `workspace_root`, plus
  status and attempt. The permission is a receipt, not just an input.
- **Run events** (`run_events`) are the ordered stream: `run.queued`, `run.started`, `tool.started`
  / `tool.finished`, `run.log`, terminal `run.completed` / `run.failed` / `run.cancelled`, and
  whatever a newer writer adds. They are batched to disk on tool boundaries, on terminal events,
  and every 250ms — so a crash loses at most the last fraction of a second. The Execute stage's run
  timeline reads exactly these rows.
- **Evidence** (`evidence`) is appended, never overwritten, and never marks a milestone complete on
  its own — `evaluate()` derives completion.

Nothing is uploaded. If you turn network on, the *runtime* may reach out; Aimcub still writes only
locally.

## How much to trust what a run reports

Not all evidence is equal, and Aimcub does not pretend otherwise.

- **`mcp_report` — low trust (0.6).** This is the agent's own account of what it did, attributed
  automatically at the end of a run. An agent claiming success is a claim, not a proof; it is
  exactly the class of evidence a confused or adversarially-prompted run would produce most
  confidently. Aimcub records it, scores it below the trust floor, and surfaces it for review
  instead of completing work on it.
- **`manual_check`** — you confirmed it, with a proof note, URL, or file reference.
- **Rule-matched evidence** — an evaluator (`commit_pattern`, `ci_status`) matched something
  checkable, rather than something asserted.

The Eval stage is where low-trust evidence is reviewed. The practical rule: a read-only run's
report is a lead worth reading, not a receipt worth trusting.

## Prompt injection, honestly

A local agent reads files, and with network on it reads web pages. Both can contain text aimed at
the agent rather than at you. Aimcub does not neutralize that — no sandbox can — but the defaults
are chosen to keep the blast radius small:

- Read-only by default means injected instructions have nothing to write to.
- Network off by default means a run cannot be steered toward exfiltration by a page it fetched.
- `workspace-write` is bounded to one folder you named, so the worst case is scoped to work you
  already decided to hand over.

The judgment that stays yours: only widen a run whose inputs you would be comfortable executing.

## Developer mode

Settings → General has a **Developer mode** toggle, off by default. It reveals debug surfaces
(traces, raw payloads, the plan's raw acceptance rule) that are otherwise absent from the product
cockpit. It changes what you can *see* and nothing about what a run may *do* — it never widens a
permission, and it is stored in `desktop-settings.json`, which carries no permission fields at all.

## Related

- `docs/local-agent-adapters.md` — the adapter contract, including why `buildInvocation` is the
  security boundary for a runtime.
- `docs/memory/architecture.md` — the run queue, claims, and event persistence.
