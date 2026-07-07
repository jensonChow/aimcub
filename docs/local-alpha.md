# Aimcub Local Alpha Contract

> Status: local alpha contract, 2026-07-07. This narrows the open-source local
> harness promise so alpha work can be tested without pulling in hosted-platform
> scope.

## Contract

Local alpha is the inspectable, open-source Aim OS loop that runs on one local
machine. It must let a user create an aim, gather planning context, inspect the
plan and eval contracts, route sub-aims to humans or local agents, record proof,
derive progress through eval, review context candidates, and reuse accepted
context in later work.

The local alpha product is credible only if `@core/*` owns the aim logic and the
local store can replay the loop without a hosted service.

## Golden Path

```text
New Aim
  -> Context intake
  -> Plan/contracts
  -> Human/agent routing
  -> Run/manual proof
  -> Evidence append
  -> Eval
  -> Context candidate review
  -> Future reuse
```

Each step has an explicit local-alpha meaning:

- **New Aim:** a user starts one local aim with a title, description, and domain.
- **Context intake:** Aimcub records the local memory, file/source, research, or
  user-answer readiness that can materially change the plan.
- **Plan/contracts:** decomposition creates sub-aims with acceptance rules,
  required evidence, likely owner, missing context, and eval signals.
- **Human/agent routing:** each sub-aim materializes an assignment to a human or
  local agent, with user overrides preserved.
- **Run/manual proof:** local agent runs and human proof tasks create auditable
  work records without bypassing eval.
- **Evidence append:** proof is append-only, attributed to the run, assignment,
  actor, milestone, and aim where that context exists.
- **Eval:** `evaluate()` and manual confirmation derive completion; completion is
  not hand-written checklist state.
- **Context candidate review:** useful eval and work signals become pending
  memory candidates before they become active context.
- **Future reuse:** accepted local memory is available to shape later aim
  planning and personalized eval.

## Non-Goals

Local alpha does not include:

- hosted multiplayer
- sync
- teams
- Aim Share
- iOS
- browser extension
- cloud-agent runner
- vector memory

These remain online-platform or later-memory-infrastructure scope. Local alpha
can expose seams for them, but it must not depend on them to complete the golden
path.

## Test Lock

The golden path should stay covered in `@core/domain` and `@core/store` tests.
At minimum, the tests should exercise one realistic local aim through
decomposition contracts, routing assignment materialization, evidence or manual
proof, derived completion, `AimProgressReadModel` next actions and evidence
review, pending context candidates, accepted context, and later local-memory
reuse.
