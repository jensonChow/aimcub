# Good First Contributions

> Status: reflects the repository as of 2026-07-22. Curated by hand against the
> current code, not auto-generated from an issue tracker.

Aimcub is source-available during pre-release — no open-source license has landed
yet, so PRs may be held pending that decision (see
[Contributing & Community](../README.md#contributing--community) in the README).
These items become issues you can actually open and claim once the repository is
public. Until then, treat this page as a map of real, currently-open work for
anyone reading the code today — none of it is hypothetical, and none of it is
already spoken for by work in flight elsewhere in the project.

Each item lists what it is and why it matters, how hard it is, what area of the
repo it touches, and where to start reading. Read [`CONTRIBUTING.md`](../CONTRIBUTING.md)
first for the verification gate every change must pass, and
[`docs/roadmap.md`](roadmap.md) for how each area fits the bigger picture.

## 1. Add a new local agent adapter

**What & why:** Today exactly two local agent runtimes are wired in: Codex and
Claude Code. The adapter interface is explicitly designed so a third runtime is a
self-contained module, not a change to engine dispatch, `@aimcub/types`, the CLI, or
the desktop app. Gemini CLI or Aider would be the highest-value next adapter —
both are widely used local coding agents with scriptable, parseable output. This is
the flagship contribution: it proves the adapter boundary actually holds for code
nobody on the core team wrote.

**Difficulty:** Medium — no framework changes needed, but you have to read a real
runtime's CLI output format carefully and get the sandbox/network mapping right.

**Area:** `packages/local-agent`

**Start here:** [`docs/local-agent-adapters.md`](local-agent-adapters.md) is the
full contract and contribution recipe. Copy the shape of
`packages/local-agent/src/adapters/codex.ts` (JSONL, live model listing) or
`packages/local-agent/src/adapters/claude.ts` (stream-json,
`replacesOutput`). Register in `packages/local-agent/src/registry.ts`. Test with
the fake `ProcessRunner` pattern in `packages/local-agent/src/runtime.test.ts` — no
real child process is ever spawned in tests. Note `buildInvocation` is a *security*
contract: it must map Aimcub's sandbox/network grant onto the runtime's own flags,
choosing the most restrictive available flag if the runtime can't express a mode
exactly (see [`docs/agent-permissions.md`](agent-permissions.md) for why this
matters and how the existing two adapters do it).

## 2. Run the eval-moat benchmark live under a second provider

**What & why:** The core product claim — that accrued context and personalized
eval demonstrably improve later decompositions — now has a real instrument:
[`examples/eval-moat`](../examples/eval-moat/README.md). Its first live run (one
provider, `N=1`) showed a directional positive result, but the benchmark's own
"Honest limitations" section says plainly: *"one judge model, one rubric author...
running `--live` under two different providers and comparing would be the cheapest
next check"* on judge-model bias. Nobody has done this yet.

**Difficulty:** Easy — no code changes required, just a provider API key, careful
reading of the output, and an honest write-up. (Costs real money, but the default
run is estimated at cents on a mid-priced model; `--max-calls` is a hard ceiling.)

**Area:** `examples/eval-moat`

**Start here:** [`examples/eval-moat/README.md`](../examples/eval-moat/README.md)
("Run it" and "Honest limitations"), and
[`examples/eval-moat/sample-live-report.md`](../examples/eval-moat/sample-live-report.md)
for the shape of what a run produces. Configure a second provider the way
`aimcub setup` would (see `apps/cli/src/config.ts` for key resolution), run with
`--live`, and compare the score deltas and judge reasoning against the committed
sample. A PR adding your report plus a short written comparison is the deliverable.

## 3. Add a new persona/aim to the eval-moat benchmark

**What & why:** The benchmark currently covers three personas — enough to avoid
one-aim luck, not enough to generalize, by its own admission. A fourth persona
that stresses a different kind of accrued context (e.g. a domain the current three
don't touch) makes the signal more trustworthy. The rules for a valid fixture are
already written down, which makes this more tractable than it sounds.

**Difficulty:** Medium — the constraints are strict enough that a rushed fixture
will produce a meaningless result; read the rules before writing one.

**Area:** `examples/eval-moat`

**Start here:** [`examples/eval-moat/README.md`](../examples/eval-moat/README.md#adding-an-aim-or-a-persona)
and the header of `examples/eval-moat/src/aims.ts`, which lists the four rules
that keep a fixture honest (identical aim text across conditions, context as
residue of prior work rather than instructions, at least one row that selection
should *not* surface, and prior aims completed the product's way — evidence
appended, completion derived by `evaluate()`, never written directly). Run the dry
run and read the context diff before spending anything on a live run.

## 4. Propose an on-disk store schema-version design

**What & why:** `packages/store` writes a single JSON store per data directory
with atomic writes, corruption recovery, and cross-process locking — but there is
currently no `schema_version` field or migration story anywhere in the store or
its settings files. That's fine at today's alpha scale, but it's a real gap before
the store format can change safely under real users. This is a design item first:
a written proposal for how versioning and migration should work, not necessarily
an implementation.

**Difficulty:** Medium — the interesting part is the design tradeoffs (in-place
migration vs. read-time upgrade, how `AIMCUB_HOME` isolation interacts with it),
not the code.

**Area:** `packages/store`

**Start here:** `packages/store/src/index.ts` (`createJsonFileStore`,
`loadSettings` / `saveSettings` and friends) and `packages/store/src/safe-fs.ts`
(the atomic-write/corruption-recovery primitives a migration would have to respect).
Open a discussion-style issue with your proposal before writing code — this is
exactly the kind of change `docs/v1-spec.md`'s "Local store compaction/export/import
are practical enough for real use" beta-gate condition is waiting on (see
[`docs/roadmap.md`](roadmap.md)).

## 5. Verify the store's atomic-write path on Windows

**What & why:** `packages/store/src/safe-fs.ts` documents its own platform gap
plainly: *"PLATFORM: POSIX/macOS is the target. On Windows `rename` over an
existing file still replaces it atomically, but it can fail with EPERM/EBUSY when
another process ... has the destination open, and a directory handle cannot be
fsync'd — both are handled as best-effort below rather than as hard failures."*
That comment is a design assumption, not a verified fact — nobody has confirmed
what actually happens on a real Windows machine under contention (e.g. antivirus
or a file indexer holding the store file open mid-write).

**Difficulty:** Medium — needs access to a real Windows machine (or a Windows CI
runner) and some deliberate fault injection, not just a clean-path smoke test.

**Area:** `packages/store`

**Start here:** `packages/store/src/safe-fs.ts` — read the whole "Atomic writes"
and "Corruption safety" sections first so you know what invariant you're checking.
A useful deliverable is either confirmation with test evidence, or a fix plus a
test that reproduces the failure mode first.

## 6. Review the `zh` i18n values for accuracy and consistency

**What & why:** The desktop renderer's i18n table
(`apps/desktop/src/renderer/i18n.tsx`) is large — hundreds of English/Chinese
string pairs — and has grown incrementally alongside UI work. English is the
source of truth by convention; nobody has done a dedicated pass to check the `zh`
values for accuracy, tone consistency, or missed pluralization
(`_one` / `_other`) handling.

**Difficulty:** Easy — no build/architecture knowledge required, just careful
bilingual reading.

**Area:** `apps/desktop/src/renderer/i18n.tsx`

**Start here:** The `STRINGS` table at the top of the file. Check terminology
consistency across related keys (e.g. the `shell.*` and `execute.*` families),
and verify `_one` / `_other` plural variants actually read naturally in Chinese
rather than being mechanical translations of the English plural split.

## 7. Fix docs discoverability gaps

**What & why:** Two concrete gaps, found while writing this page: (1) README's
Architecture Map table documents every `packages/*` and `apps/*` path but never
mentions `examples/` at all, even though `examples/local-alpha` is the literal
first command in the README Quickstart and `examples/eval-moat` is the instrument
behind the most important open beta-gate item. (2) Several files under `docs/`
(for example `product-story.md`, `tool-contracts.md`, `desktop-product-bugs.md`)
are not linked from `README.md`, `CONTRIBUTING.md`, or `docs/memory/README.md` —
they're only reachable by browsing the directory. Some may be current reference
material worth surfacing; others may be stale working notes worth removing. Either
answer is a useful contribution; guessing without reading each one first is not.

**Difficulty:** Easy for the README fix; Medium for the orphaned-docs triage,
since it requires reading each file to judge whether it's current.

**Area:** `README.md`, `docs/`

**Start here:** [`README.md`](../README.md) Architecture Map and "Where To Start"
sections; `docs/memory/README.md` for how durable module memory is currently
organized.

---

Found something else while reading the code that isn't on this list and isn't
already claimed by work in flight? That's exactly the kind of thing worth opening
an issue about once the repository is public — this list is a starting point, not
a ceiling.
