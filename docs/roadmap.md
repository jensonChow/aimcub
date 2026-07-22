# Aimcub Roadmap

> Status: reflects the repository as of 2026-07-22. This is a public, plain-language
> summary derived from the gates defined in [`docs/v1-spec.md`](v1-spec.md) — that
> file (and [`docs/vision.md`](vision.md) for the long-term thesis) is the source of
> truth if this page and the code ever disagree. Every status claim below was checked
> against the current code before being written down; if you find one that no longer
> matches what you see in the repo, please open an issue.

Aimcub is a local-first, open-source Aim OS agent harness: it holds an aim, gathers
context, decomposes work into sub-aims, routes each one to a human or a local agent,
records evidence, derives completion through eval, and lets useful context become
reusable memory. See [`docs/vision.md`](vision.md) for why, and
[`docs/quickstart.md`](quickstart.md) for the fastest way to see it run, provider-free.

The project moves through four stages: **Local Harness Alpha → Local Harness Beta →
Online Platform → Aim Share**. Alpha and Beta are the open-source local product. Online
Platform and Aim Share are hosted, later-stage direction. This page tracks where each
stage actually stands.

## Where the project is now

### Local Harness Alpha — complete

The alpha golden path — new aim, context intake, plan with sub-aims and acceptance
rules, human/agent routing, run or manual proof, evidence, eval, context candidate
review, and reuse in later aims — is implemented and covered by tests in `@aimcub/core`
and `@aimcub/store`. You can walk it yourself: [`docs/quickstart.md`](quickstart.md)
seeds a deterministic, provider-free demo store and opens it in Desktop in about five
minutes.

### Local Harness Beta — in progress

The beta gate ([`docs/v1-spec.md`](v1-spec.md), "Local Harness Beta") has six
conditions. Here is where each one honestly stands:

| Gate condition | Status | Notes |
| --- | --- | --- |
| Local agent execution uses a durable run queue with streamed events | **Done** | Runs are claimed atomically from a shared queue; Desktop and the CLI drain the same store safely, retryable failures re-enqueue once, and events stream live to the cockpit as they happen. |
| Tool/file/artifact events are captured as structured evidence or artifacts | **Done** | Adapters report file-level work product (`file_write` / `file_edit` / `file_delete`); the orchestrator persists deduped `artifact.created` events and links them to the run's evidence. See [`docs/local-agent-adapters.md`](local-agent-adapters.md). |
| Per-agent model/reasoning/workspace choices persist | **Done** | Model, reasoning effort, sandbox, network, and workspace are chosen per routed sub-aim and recorded on the run record itself, not just held in memory for one session. |
| The Desktop cockpit is screen-by-screen product-clean, with debug surfaces behind explicit developer mode | **Done** | Developer mode is an explicit, off-by-default toggle that gates the debug surfaces in the product cockpit; it changes what you can see, never what a run may do. See [`docs/agent-permissions.md`](agent-permissions.md). |
| Local store compaction/export/import are practical enough for real use | **Partial** | Export and import (full-snapshot JSON, merge or replace) exist and work today via `aimcub export` / `aimcub import`. Compaction does not exist yet — the store is an append-only log with no pruning or size-bounding strategy, which is fine at alpha scale but is an open design question before real long-running use. |
| Context and personalized eval demonstrably improve later decompositions | **In progress** | This is the core product claim, and it now has an instrument: [`examples/eval-moat`](../examples/eval-moat/README.md) runs the same aim through the real decomposition pipeline with and without accrued context, and has an LLM judge score both, blind, against a fixed rubric. The first live run (one provider, 9 calls, `N=1`) shows a directional positive result — the contexted plan won on 2 of 3 personas, mean score +7.67 of 25 — and also surfaced two real bugs in `@core`'s context selection and plan critique, whose fixes are landing now. `N=1` is a signal, not a proof; see the benchmark's own "Honest limitations" section. |

## What comes next

The stages after Beta are direction, not committed scope or dates. They are
summarized here from [`docs/v1-spec.md`](v1-spec.md) and [`docs/vision.md`](vision.md);
read those for the full reasoning.

### Online Platform

A hosted, multi-user Aim platform layered on the same Aim OS model as the local
harness — not a rewrite of it. Planned shape:

- Supabase schema/API parity for the local Aim OS orchestration entities that need to
  sync (the hosted evidence spine already exists and is live independently of this).
- Teams that can share aims, assignments, permissions, and context routing.
- A hosted app reintroduced as the online collaboration layer over the same model the
  local harness uses today.

### Aim Share

The furthest-out stage: breaking the aim out of a single organization's boundary.

- Aims, context, and capability signals shareable across organizational boundaries.
- A person's accumulated context helping route valuable work beyond one workspace or
  one team — closer to a closed, paid network for goals than a task tracker.

## Deliberately deferred until closer to launch

A few decisions are intentionally not made yet, because making them early would lock
in choices before the local harness itself has proven out. None of these are dated:

- **License.** Aimcub is source-available in this repository during pre-release. No
  open-source license has been chosen yet; until a `LICENSE` file lands, all rights
  are reserved and external contributions may be held pending that decision. See
  [`CONTRIBUTING.md`](../CONTRIBUTING.md).
- **Package publishing.** Nothing is published to npm yet.
- **Distribution.** No signed/notarized build distribution channel (e.g. Homebrew,
  `npx`) exists yet; today the only way to run Aimcub is from a source checkout.
- **Code signing.** Desktop packaging identity work is in place, but signed,
  notarized release builds are not part of the current local alpha.

## Keeping this page honest

This roadmap is meant to be checkable, not aspirational. Every "Done" above points at
real code and, where one exists, a doc that describes it in detail — follow the links.
If something here drifts out of date, that is itself a good first issue: open one, or
see [`docs/good-first-contributions.md`](good-first-contributions.md) for other ways
to help.
