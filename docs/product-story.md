# The Aimcub Story — the human-centered narrative

> One line: **Set the aim, work as usual — the system records every real bit of progress, judges it from real evidence, and turns the work you do into a context that's yours.**

This doc is the narrative baseline for everything outward-facing: website copy, onboarding, the
general-user decomposition prompt. The protagonist is always **a person and the outcome they want** —
never the toolchain and its events. Commits, webhooks, and evaluators are how the magic works, not
what the story is about. For the underlying thesis (humans-as-agents, memory + eval, context-as-product,
personalized eval) see [`vision.md`](vision.md).

## The three things a person does

For any aim — a website, a dinner, an article, a video — Aimcub asks exactly three things of you:

1. **Say what you want.** One sentence, in your own words. That's the aim.
2. **Connect your helpers.** The tools and agents you already work with (Claude, your photo library,
   your docs, your publishing platform). You and your agents are both just paths to the aim; connecting
   a helper is itself the first milestone of almost any aim.
3. **Gather your materials.** The photos, the drafts, the ingredients — whatever the aim needs.

Everything after that is you living your life. Progress is recorded as a byproduct, never as a chore.
There are no check-ins, no streaks, no forms. A milestone lights when a real thing happens — and the
work you did to get there accrues into your context.

## A walkthrough: Yu's studio website

Yu is a photographer. She can't code, and shouldn't have to.

She tells Aimcub: *"I want a website for my photography studio — portfolio and booking info."*

Aimcub breaks that into **her** to-dos, not engineering steps:

| Milestone | What Yu does | How Aimcub knows it happened |
|---|---|---|
| Find your helper | Connects an agent (e.g. Claude) | The connection itself is the evidence |
| Gather your materials | Picks 20 best shots, writes a bio, registers a domain | Files uploaded; one tap to confirm the domain |
| Let the helper build | Tells the agent "build it with these" | The agent reports its own work when it finishes |
| The site is alive | Nothing | Aimcub visits the URL; it loads → the milestone lights itself |
| Tell the world | Posts the link | A quick AI glance confirms it's really the live portfolio |

Her total real workload: one sentence, one connection, one afternoon of picking photos. The agent does
the building; the system judges each milestone from real evidence and lights it. What's left behind is
a record of an aim achieved — part of the context that, over many aims, becomes Yu's résumé in the new
era.

## More aims, same skeleton

- **A family dinner for New Year's Eve**: plan the menu → buy the ingredients → one trial run → dinner
  on the table. Evidence is a photo (AI glances: "yes, that's braised pork") or a single tap. The aim
  sits on the calendar; the work is the life.
- **A long-form article**: outline → draft → two revisions → published. The writing happens in the
  person's own editor — its edit activity is a natural evidence stream (exactly what git is to a
  developer). "Published" = the link is live.
- **A developer shipping a CLI** (live today): set the aim, connect once, push code as usual — the
  milestone lights itself within a minute of the push. Same skeleton, strictest evidence.

## Why the skeleton never changes

The loop — *aim → decomposition → connect evidence sources → live your life → milestones light → context
accrues* — is identical across all of these. Only the translators at the two ends vary:

- **Evidence emitters generalize.** A developer's emitters are git and CI. Everyone else's are their
  photo library, documents, publishing platforms, calendars, an agent's work report, even a sentence
  said to the system. The MCP "agent reports its own work" channel built for Claude Code is the same
  socket any future consumer agent plugs into.
- **Evaluators generalize.** The schema already reserves `manual_confirm` (one tap), `file_uploaded`
  (a photo), `url` (the link is live), and `llm_judge` (an AI glance) alongside the developer-grade
  `commit_pattern` / `ci_status`. The life scenarios above are built from those four.
- **Milestone zero is universal.** Almost every aim starts with "connect your helpers and evidence
  sources" — and that step is already a product surface (the MCP/OAuth attach flow), not a tutorial.

## Narrative guardrails

- The person is the protagonist; tools and agents are helpers — both are just paths to the aim.
- Outcome language over process language: "the site is alive," not "deployment succeeded."
- Honesty is the brand: a milestone lights only on **real** progress — that's why evidence is verified
  (eval), and that's what makes the resulting context worth something.

## Sequencing

The current product sequence is local harness first, online platform second.

v1 builds the open-source local Aim OS agent harness: aim intake, context gathering,
decomposition, human/agent routing, local agent execution, evidence, eval, and context review.
Developers are still the first credible wedge because local coding agents, git, and CI produce
inspectable evidence today, but the product being proved is not "developer task tracking." It is
the local loop where a person states an aim, agents help execute it, real evidence accumulates, and
context/eval improves the next aim.

The old v1a/v1b split is validation history. v1a proved the hosted automatic-evidence spine; v1b's
context/eval value is now part of the local harness itself. The online Aim platform comes after the
local loop is worth using: sync, teams, permissions, managed infrastructure, and eventually Aim Share.
